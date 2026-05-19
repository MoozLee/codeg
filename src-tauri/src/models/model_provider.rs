use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProviderInfo {
    pub id: i32,
    pub name: String,
    pub api_url: String,
    pub api_key: String,
    pub api_key_masked: String,
    pub agent_type: String,
    pub model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn mask_api_key(key: &str) -> String {
    let len = key.len();
    if len <= 8 {
        "\u{2022}".repeat(len)
    } else {
        format!(
            "{}{}{}",
            &key[..4],
            "\u{2022}".repeat(len.min(20) - 8),
            &key[len - 4..]
        )
    }
}

impl From<crate::db::entities::model_provider::Model> for ModelProviderInfo {
    fn from(m: crate::db::entities::model_provider::Model) -> Self {
        let agent_type = if m.agent_type.is_empty() {
            // Fallback for rows backfilled with empty agent_type.
            serde_json::from_str::<Vec<String>>(&m.agent_types_json)
                .ok()
                .and_then(|list| list.into_iter().next())
                .unwrap_or_default()
        } else {
            m.agent_type
        };
        Self {
            id: m.id,
            name: m.name,
            api_url: m.api_url,
            api_key: m.api_key.clone(),
            api_key_masked: mask_api_key(&m.api_key),
            agent_type,
            model: m.model,
            created_at: m.created_at.to_rfc3339(),
            updated_at: m.updated_at.to_rfc3339(),
        }
    }
}
