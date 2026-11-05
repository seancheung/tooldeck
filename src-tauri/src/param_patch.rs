use crate::model::{error, values, Result};
use serde_json::{json, Map, Value};

type Fields = Map<String, Value>;

// Validate against the original declaration, even when replacing an earlier option list.
pub fn validate_patch(fields: &Fields, patch: &Value) -> Result<()> {
    for (key, change) in patch.as_object().ok_or("Expected a parameter patch object")? {
        let field = fields.get(key).ok_or_else(|| format!("Unknown parameter: {key}"))?;
        let change = change.as_object().ok_or("Expected a field patch object")?;
        if change.is_empty() || change.keys().any(|k| !matches!(k.as_str(), "value"|"unset"|"options"|"visible")) {
            return Err(format!("{key}: invalid patch properties"));
        }
        if change.get("unset").is_some_and(|v| v != &Value::Bool(true) || change.contains_key("value")) ||
            change.get("visible").is_some_and(|v| !v.is_boolean()) {
            return Err(format!("{key}: invalid unset or visible flag"));
        }
        if let Some(v) = change.get("value") {
            values(&Map::from_iter([(key.clone(), field.clone())]), &json!({(key):v}), true)?;
        }
        if let Some(options) = change.get("options") {
            let select = field["ui"]["component"].as_str().map_or(field["schema"]["enum"].is_array(), |s| s == "select");
            if !select { return Err(format!("{key}: options require a select field")); }
            let validator = jsonschema::validator_for(&field["schema"]).map_err(error)?;
            let options = options.as_array().ok_or("Expected an options array")?;
            let mut strings = std::collections::HashSet::new();
            let mut others = Vec::new();
            for opt in options {
                let value = opt.get("value").ok_or("Missing option value")?;
                let duplicate = match value.as_str() {
                    Some(s) => !strings.insert(s),
                    None => {
                        let duplicate = others.iter().any(|prev| crate::model::json_equal(prev, value));
                        others.push(value.clone());
                        duplicate
                    }
                };
                if !validator.is_valid(value) || duplicate ||
                    opt.get("label").is_some_and(|v| v.as_str().is_none_or(|s| s.trim().is_empty())) {
                    return Err(format!("{key}: invalid or duplicate option"));
                }
            }
            if change.get("value").is_some_and(|v| !options.iter().any(|opt| crate::model::json_equal(&opt["value"], v))) {
                return Err(format!("{key}: selected value is outside the options"));
            }
        }
    }
    Ok(())
}

pub fn form_fields(fields: &Fields, overrides: &Value) -> Result<Fields> {
    validate_patch(fields, overrides)?;
    let mut effective = fields.clone();
    for (key, field) in &mut effective {
        let change = &overrides[key];
        if change["visible"] == false { field["required"] = json!(false); }
        if let Some(allowed) = field["schema"].as_bool() {
            field["schema"] = if allowed { json!({}) } else { json!({"not":{}}) };
        }
        if change["unset"] == true { field["schema"].as_object_mut().unwrap().remove("default"); }
        let options = change["options"].as_array();
        let dynamic_select = field["ui"]["component"] == "select" && !field["schema"]["enum"].is_array();
        if options.is_some() || dynamic_select {
            let allowed: Vec<_> = options.into_iter().flatten().map(|opt| &opt["value"]).collect();
            // An empty list must reject every supplied value, including null.
            if allowed.is_empty() {
                field["schema"]["not"] = json!({});
            } else {
                field["schema"]["enum"] = json!(allowed);
            }
        }
    }
    Ok(effective)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_the_whole_patch_against_declared_fields() {
        let fields: Fields = serde_json::from_value(json!({
            "mode":{"schema":{"type":"string","enum":["a","b"]}},
            "count":{"schema":{"type":"integer","minimum":0}}
        })).unwrap();
        for bad in [
            json!({"mode":{"visible":false},"missing":{"unset":true}}),
            json!({"mode":{"options":[{"value":"c"}]}}),
            json!({"mode":{"options":[{"value":"a"},{"value":"a"}]}}),
            json!({"mode":{"value":"b","options":[{"value":"a"}]}}),
            json!({"count":{"value":-1}}), json!({"count":{"options":[]}}),
            json!({"count":{"value":1,"unset":true}}), json!({"count":{"required":false}})
        ] { assert!(validate_patch(&fields,&bad).is_err(), "{bad}"); }
    }

    #[test]
    fn unset_suppresses_defaults_and_hidden_values_still_validate() {
        let fields: Fields = serde_json::from_value(json!({
            "name":{"schema":{"type":["null","string"],"default":"default"},"required":true}
        })).unwrap();
        let effective = form_fields(&fields,&json!({"name":{"visible":false,"unset":true}})).unwrap();
        assert_eq!(values(&effective,&json!({}),true).unwrap(),json!({}));
        assert_eq!(values(&effective,&json!({"name":null}),true).unwrap(),json!({"name":null}));
        assert!(values(&effective,&json!({"name":1}),true).is_err());
    }
}
