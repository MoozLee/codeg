import type { AcpAgentInfo } from "@/lib/types"

/**
 * env_json key where BYO-pi stores a custom agent/config directory
 * (`PI_CODING_AGENT_DIR`). Set from the Pi runtime panel's advanced section; it
 * is injected only into the spawned pi child, never into codeg's own process.
 */
export const PI_CONFIG_DIR_ENV = "PI_CODING_AGENT_DIR"

/**
 * Whether this agent is pi pointed at a custom `PI_CODING_AGENT_DIR`.
 *
 * codeg's Settings skill store (Skills tab, Experts, Office tools) manages each
 * agent type's DEFAULT global skill directory — `~/.pi/agent/skills` for pi. A
 * per-agent custom config dir lives only in env_json (it reaches the pi child
 * but not codeg's process), so the skill store can't target it. The backend
 * exposes only a safe derived boolean, allowing callers to exclude such a pi
 * without receiving its path. Default-dir pi (the common case) participates
 * normally.
 */
export function piUsesCustomAgentDir(agent: AcpAgentInfo): boolean {
  return agent.agent_type === "pi" && agent.pi_uses_custom_agent_dir === true
}
