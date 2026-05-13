//! URL safety validation for outbound provider usage queries.
//!
//! Enforces three rules beyond the PR1 length/scheme checks:
//!
//! 1. Scheme must be `https://` (no `http://`, no custom schemes).
//! 2. Host must be a public, externally routable name or IP literal — reject
//!    loopback, RFC1918, link-local, ULA, broadcast, multicast, unspecified,
//!    and IPv4-mapped/compatible equivalents. This is an SSRF guardrail for
//!    both desktop and server modes; the backend controls the outbound
//!    request, so a malicious `base_url` could otherwise be aimed at the
//!    server host's LAN or local metadata endpoints.
//! 3. Port (if explicit) must be non-zero.
//!
//! The helper is called from create/update core paths before persisting, and
//! again just before the HTTP client runs (defense in depth — a config row
//! written by an older build should still be re-validated at query time).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::app_error::AppCommandError;

const MAX_BASE_URL_LEN: usize = 2048;

/// Lowercase hostnames that always refer to a loopback interface regardless
/// of `/etc/hosts` trickery. Matched case-insensitively.
const LOCAL_HOST_ALIASES: &[&str] = &[
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
];

/// Validate a user-supplied NewAPI base URL. Returns the parsed `reqwest::Url`
/// on success so callers don't need to re-parse.
pub fn ensure_https_url(base_url: &str) -> Result<reqwest::Url, AppCommandError> {
    if base_url.is_empty() {
        return Err(AppCommandError::invalid_input("Base URL cannot be empty"));
    }
    if base_url.len() > MAX_BASE_URL_LEN {
        return Err(AppCommandError::invalid_input(format!(
            "Base URL must be {MAX_BASE_URL_LEN} characters or less"
        )));
    }

    let url = reqwest::Url::parse(base_url).map_err(|e| {
        AppCommandError::invalid_input("Base URL is not a valid URL").with_detail(e.to_string())
    })?;

    if url.scheme() != "https" {
        return Err(AppCommandError::invalid_input(
            "Base URL must start with https://",
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| AppCommandError::invalid_input("Base URL must include a host"))?;

    // `url` keeps IPv6 literals in the raw input as `[...]`; `host_str`
    // strips the brackets. Try parsing as IP literal first so numeric hosts
    // go through the SSRF net-class checks; fall back to domain-name rules
    // otherwise.
    if let Ok(ip) = host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => validate_ipv4(v4)?,
            IpAddr::V6(v6) => validate_ipv6(v6)?,
        }
    } else {
        validate_domain(host)?;
    }

    if let Some(port) = url.port() {
        if port == 0 {
            return Err(AppCommandError::invalid_input(
                "Base URL port must be non-zero",
            ));
        }
    }

    Ok(url)
}

fn validate_domain(name: &str) -> Result<(), AppCommandError> {
    if name.is_empty() {
        return Err(AppCommandError::invalid_input("Base URL host is empty"));
    }

    let lower = name.to_ascii_lowercase();
    let normalized = lower.trim_end_matches('.');

    if LOCAL_HOST_ALIASES
        .iter()
        .any(|alias| *alias == lower || *alias == normalized)
    {
        return Err(AppCommandError::invalid_input(
            "Base URL host refers to the local machine",
        ));
    }

    // Public DNS names have at least one dot (`example.com`). Single-label
    // hosts like `intranet-router` resolve to LAN names on the server's
    // network, which we treat the same as RFC1918 literals.
    if !normalized.contains('.') {
        return Err(AppCommandError::invalid_input(
            "Base URL host must be a fully qualified public domain name",
        ));
    }

    Ok(())
}

fn validate_ipv4(addr: Ipv4Addr) -> Result<(), AppCommandError> {
    if addr.is_unspecified() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is the unspecified address",
        ));
    }
    if addr.is_loopback() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a loopback address",
        ));
    }
    if addr.is_private() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a private (RFC1918) address",
        ));
    }
    if addr.is_link_local() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a link-local address",
        ));
    }
    if addr.is_broadcast() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a broadcast address",
        ));
    }
    if addr.is_multicast() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a multicast address",
        ));
    }
    if addr.is_documentation() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a documentation address",
        ));
    }

    // 100.64.0.0/10 Carrier-grade NAT / shared address space — internal by
    // convention; stable-Rust has no is_shared(), so check manually.
    let octets = addr.octets();
    if octets[0] == 100 && (octets[1] & 0xC0) == 64 {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a carrier-grade NAT address",
        ));
    }

    // 0.0.0.0/8 "this network" — loopback check above only catches 127/8.
    if octets[0] == 0 {
        return Err(AppCommandError::invalid_input(
            "Base URL host is in the reserved 0.0.0.0/8 range",
        ));
    }

    Ok(())
}

fn validate_ipv6(addr: Ipv6Addr) -> Result<(), AppCommandError> {
    if addr.is_unspecified() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is the unspecified IPv6 address",
        ));
    }
    if addr.is_loopback() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is the IPv6 loopback address",
        ));
    }
    if addr.is_multicast() {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a multicast IPv6 address",
        ));
    }

    let segments = addr.segments();

    // fc00::/7 Unique Local Addresses — stable Rust has no is_unique_local().
    if (segments[0] & 0xfe00) == 0xfc00 {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a unique local IPv6 address",
        ));
    }

    // fe80::/10 link-local.
    if (segments[0] & 0xffc0) == 0xfe80 {
        return Err(AppCommandError::invalid_input(
            "Base URL host is a link-local IPv6 address",
        ));
    }

    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) variants
    // are rejected outright. Running the embedded IPv4 through the v4
    // validator first produces a better error for private/loopback
    // mappings; any remaining mapped address is still rejected.
    if let Some(v4) = addr.to_ipv4_mapped() {
        validate_ipv4(v4)?;
        return Err(AppCommandError::invalid_input(
            "Base URL host is an IPv4-mapped IPv6 address",
        ));
    }
    if let Some(v4) = addr.to_ipv4() {
        validate_ipv4(v4)?;
        return Err(AppCommandError::invalid_input(
            "Base URL host is an IPv4-compatible IPv6 address",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_public_https_host() {
        assert!(ensure_https_url("https://api.example.com").is_ok());
        assert!(ensure_https_url("https://api.example.com:8443/v1").is_ok());
    }

    #[test]
    fn rejects_http_scheme() {
        let err = ensure_https_url("http://api.example.com").unwrap_err();
        assert!(err.message.contains("https"));
    }

    #[test]
    fn rejects_unsupported_scheme() {
        let err = ensure_https_url("ftp://api.example.com").unwrap_err();
        assert!(err.message.contains("https"));
    }

    #[test]
    fn rejects_missing_host() {
        assert!(ensure_https_url("https://").is_err());
    }

    #[test]
    fn rejects_empty_value() {
        assert!(ensure_https_url("").is_err());
    }

    #[test]
    fn rejects_localhost_alias() {
        assert!(ensure_https_url("https://localhost").is_err());
        assert!(ensure_https_url("https://LOCALHOST").is_err());
        assert!(ensure_https_url("https://localhost.").is_err());
        assert!(ensure_https_url("https://ip6-localhost").is_err());
    }

    #[test]
    fn rejects_single_label_intranet_host() {
        assert!(ensure_https_url("https://intranet").is_err());
    }

    #[test]
    fn rejects_loopback_ipv4() {
        assert!(ensure_https_url("https://127.0.0.1").is_err());
        assert!(ensure_https_url("https://127.1.2.3:8080").is_err());
    }

    #[test]
    fn rejects_private_ipv4() {
        assert!(ensure_https_url("https://10.0.0.1").is_err());
        assert!(ensure_https_url("https://192.168.1.1").is_err());
        assert!(ensure_https_url("https://172.16.5.7").is_err());
    }

    #[test]
    fn rejects_link_local_ipv4() {
        assert!(ensure_https_url("https://169.254.169.254").is_err());
    }

    #[test]
    fn rejects_cgn_ipv4() {
        assert!(ensure_https_url("https://100.64.0.1").is_err());
        assert!(ensure_https_url("https://100.127.255.255").is_err());
    }

    #[test]
    fn rejects_reserved_zero_ipv4() {
        assert!(ensure_https_url("https://0.0.0.1").is_err());
    }

    #[test]
    fn rejects_ipv6_loopback_and_ula() {
        assert!(ensure_https_url("https://[::1]").is_err());
        assert!(ensure_https_url("https://[fc00::1]").is_err());
        assert!(ensure_https_url("https://[fd12::1]").is_err());
    }

    #[test]
    fn rejects_ipv6_link_local() {
        assert!(ensure_https_url("https://[fe80::1]").is_err());
    }

    #[test]
    fn rejects_ipv4_mapped_ipv6() {
        assert!(ensure_https_url("https://[::ffff:127.0.0.1]").is_err());
    }

    #[test]
    fn rejects_zero_port() {
        assert!(ensure_https_url("https://api.example.com:0").is_err());
    }
}
