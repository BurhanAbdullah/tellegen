//! Deterministic contract checks for the public JSON solver boundary.
//!
//! These helpers intentionally test the wire contract without depending on a
//! browser, HTTP server, or platform-specific native artifact.

use serde_json::Value;

/// Extract the response block names that are actually present in a JSON solve
/// response, in deterministic object-key order.
pub fn present_blocks(response_json: &str) -> Result<Vec<String>, String> {
    let value: Value = serde_json::from_str(response_json)
        .map_err(|error| format!("invalid solve response JSON: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "solve response must be a JSON object".to_string())?;

    let mut blocks = object
        .iter()
        .filter_map(|(key, value)| match key.as_str() {
            "formulation" | "status" => None,
            _ if value.is_null() => None,
            _ => Some(key.clone()),
        })
        .collect::<Vec<_>>();
    blocks.sort();
    Ok(blocks)
}

/// Require the public response identity fields and reject non-finite numeric
/// values anywhere in the response. JSON itself cannot represent NaN/Infinity,
/// but this check also protects future serializers that may emit those values
/// through a custom representation.
pub fn validate_response_contract(response_json: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(response_json)
        .map_err(|error| format!("invalid solve response JSON: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "solve response must be a JSON object".to_string())?;

    match object.get("formulation") {
        Some(Value::String(_)) => {}
        _ => return Err("solve response is missing string field `formulation`".into()),
    }
    match object.get("status") {
        Some(Value::String(_)) => {}
        _ => return Err("solve response is missing string field `status`".into()),
    }

    validate_finite_json(&value, "$")
}

fn validate_finite_json(value: &Value, path: &str) -> Result<(), String> {
    match value {
        Value::Array(values) => values
            .iter()
            .enumerate()
            .try_for_each(|(i, child)| validate_finite_json(child, &format!("{path}[{i}]"))),
        Value::Object(values) => values.iter().try_for_each(|(key, child)| {
            validate_finite_json(child, &format!("{path}.{key}"))
        }),
        Value::Number(_) | Value::String(_) | Value::Bool(_) | Value::Null => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_contract_requires_identity_fields() {
        assert!(validate_response_contract(r#"{"formulation":"dcopf","status":"optimal"}"#).is_ok());
        assert!(validate_response_contract(r#"{"status":"optimal"}"#).is_err());
        assert!(validate_response_contract(r#"{"formulation":"dcopf"}"#).is_err());
        assert!(validate_response_contract("[]").is_err());
    }

    #[test]
    fn present_blocks_is_deterministic_and_omits_identity_and_nulls() {
        let blocks = present_blocks(
            r#"{
                "flows": [],
                "formulation": "dcopf",
                "lmp": [],
                "status": "optimal",
                "vm": null,
                "va": []
            }"#,
        )
        .unwrap();
        assert_eq!(blocks, vec!["flows", "lmp", "va"]);
    }
}
