use serde_json::json;
use tellegen::api_contract::{present_blocks, validate_response_contract};

#[test]
fn solver_response_contract_has_stable_identity() {
    let response = json!({
        "formulation": "dcopf",
        "status": "optimal",
        "lmp": [{"bus": 1, "value": 12.5}],
        "flows": []
    });

    let text = serde_json::to_string(&response).expect("serialize fixture");
    validate_response_contract(&text).expect("valid response contract");

    let blocks = present_blocks(&text).expect("response blocks");
    assert_eq!(blocks, vec!["flows", "lmp"]);
}

#[test]
fn malformed_solver_responses_fail_closed() {
    for response in [
        json!({"status": "optimal"}),
        json!({"formulation": "dcopf"}),
        json!(null),
        json!([]),
    ] {
        let text = serde_json::to_string(&response).expect("serialize fixture");
        assert!(validate_response_contract(&text).is_err());
    }
}
