use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{collections::HashSet, fs, path::{Path, PathBuf}};

pub type Result<T> = std::result::Result<T, String>;
pub fn error(e: impl std::fmt::Display) -> String { e.to_string() }


#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub data_dir: String,
    #[serde(default)] pub show_output_timestamps: bool,
    #[serde(default = "crate::locale::system_locale")] pub locale: String,
    #[serde(default)] pub node_path: String,
    #[serde(default)] pub uv_path: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub version: String,
    #[serde(default)] pub description: String,
    pub host_api: String,
    pub runtime: Runtime,
    pub platforms: Option<Vec<Platform>>,
    pub dependencies: Option<Dependencies>,
    #[serde(default)] pub settings: Map<String, Value>,
    pub actions: Map<String, Value>,
    #[serde(default)] pub hooks: std::collections::BTreeMap<String, Hook>,
    #[serde(default)] pub docs: Vec<Document>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hook { pub event: String, pub entry: String, pub param_keys: Option<Vec<String>> }
#[derive(Clone, Serialize, Deserialize)]
pub struct Runtime { pub kind: String, pub version: String, pub source: String }
#[derive(Clone, Serialize, Deserialize)]
pub struct Platform { pub os: String, pub arch: Option<Vec<String>> }
#[derive(Clone, Serialize, Deserialize)]
pub struct Dependencies { pub manager: String, pub file: String, pub lockfile: Option<String> }
#[derive(Clone, Serialize, Deserialize)]
pub struct Document { #[serde(skip_serializing_if = "Option::is_none")] pub locale: Option<String>, pub id: String, pub title: String, pub path: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub manifest: Manifest,
    pub directory: String,
    pub installed: bool,
    pub compatible: bool,
    pub settings: Value,
    pub issue: Option<String>,
}

pub fn read_manifest(dir: &Path) -> Result<Manifest> {
    read_manifest_for(dir, "en")
}
pub fn read_manifest_for(dir: &Path, locale: &str) -> Result<Manifest> {
    let text = fs::read_to_string(dir.join("manifest.yaml")).map_err(error)?;
    let raw: Value = serde_yaml::from_str(&text).map_err(error)?;
    let m: Manifest = serde_json::from_value(crate::locale::localize_manifest(raw, locale)?).map_err(error)?;
    if m.manifest_version != 1 { return Err("Only manifestVersion 1 is supported".into()); }
    let _: node_semver::Version = m.version.parse().map_err(|e| format!("Invalid tool version: {e}"))?;
    if m.id.is_empty() || !m.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { return Err("Invalid tool ID".into()); }
    if m.actions.is_empty() { return Err("The tool must define at least one action".into()); }
    if !matches!(m.runtime.kind.as_str(), "python"|"nodejs"|"bash"|"powershell") || m.runtime.source != "system" { return Err("Invalid runtime declaration".into()); }
    let _: node_semver::Range = m.runtime.version.parse().map_err(error)?;
    if !version_matches("1.0.0", &m.host_api)? { return Err("hostApi is incompatible with execution protocol 1.0.0".into()); }
    if let Some(platforms) = &m.platforms {
        if platforms.is_empty() { return Err("platforms cannot be empty".into()); }
        for p in platforms { if p.arch.as_ref().is_some_and(|v| v.is_empty()) { return Err("arch cannot be empty".into()); } }
    }
    if m.settings.values().any(|field| field.get("availableWhen").is_some()) {
        return Err("availableWhen applies only to action parameters".into());
    }
    validate_fields(&m.settings, matches!(m.runtime.kind.as_str(), "bash"|"powershell"))?;
    let mut entries = HashSet::new();
    for (key, action) in &m.actions {
        if !valid_key(key) { return Err(format!("Invalid action key: {key}")); }
        let entry = action["entry"].as_str().ok_or("Action is missing its entry")?;
        let file = fs::canonicalize(dir.join(entry)).map_err(|e| format!("Entry {entry}: {e}"))?;
        if !file.is_file() || !entries.insert(file) { return Err("Each action requires its own entry file".into()); }
        if let Some(fields) = action.get("params").and_then(Value::as_object) { validate_fields(fields, matches!(m.runtime.kind.as_str(), "bash"|"powershell"))?; }
    }
    for (id, hook) in &m.hooks {
        if !valid_key(id) || !matches!(hook.event.as_str(), "paramsChange" | "actionOpen" | "actionClose" | "actionReset") { return Err(format!("Invalid hook: {id}")); }
        let entry = fs::canonicalize(dir.join(&hook.entry)).map_err(error)?;
        if Path::new(&hook.entry).is_absolute() || !entry.starts_with(fs::canonicalize(dir).map_err(error)?) || !entry.is_file() {
            return Err(format!("Invalid hook entry: {}", hook.entry));
        }
        if let Some(keys) = &hook.param_keys {
            let mut seen = HashSet::new();
            if hook.event != "paramsChange" || keys.is_empty() || keys.iter().any(|key| !seen.insert(key) || !m.actions.values().any(|action| action["params"].get(key).is_some())) {
                return Err(format!("Invalid paramKeys for hook {id}"));
            }
        }
    }
    if let Some(d) = &m.dependencies {
        if !matches!((m.runtime.kind.as_str(), d.manager.as_str()), ("python", "pip")|("nodejs", "npm")) { return Err("Dependency manager does not match the runtime".into()); }
        if !dir.join(&d.file).is_file() { return Err(format!("Dependency file does not exist: {0}", d.file)); }
        if let Some(lock) = &d.lockfile { if !dir.join(lock).is_file() { return Err(format!("Lockfile does not exist: {lock}")); } }
    }
    Ok(m)
}
fn valid_key(key: &str) -> bool { key.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') }
fn condition_matches(condition: &Value, fields: &Map<String, Value>, supplied: &Value) -> Result<bool> {
    let op = condition["op"].as_str().ok_or("Condition is missing op")?;
    if matches!(op, "and" | "or") {
        let children = condition["cond"].as_array().ok_or("Compound conditions require a cond array")?;
        let mut result = op == "and";
        for child in children {
            let matches = condition_matches(child, fields, supplied)?;
            if op == "and" { result &= matches; } else { result |= matches; }
        }
        return Ok(result);
    }
    let key = condition["key"].as_str().ok_or("Condition is missing key")?;
    let field = fields.get(key).ok_or_else(|| format!("Unknown parameter {key}"))?;
    let actual = supplied.get(key).or_else(|| field["schema"].get("default"));
    match op {
        "null" => Ok(actual.is_none_or(Value::is_null)),
        "notNull" => Ok(actual.is_some_and(|v| !v.is_null())),
        "empty" => Ok(actual.is_none_or(|v| v.is_null() || v.as_str() == Some(""))),
        "eq" | "not" => {
            let expected = condition.get("value").ok_or("Comparison is missing value")?;
            // JSON numbers have one type in the form, including nested values.
            let equal = actual.is_some_and(|v| json_equal(v, expected));
            Ok(if op == "eq" { equal } else { !equal })
        }
        "gt" | "gte" | "lt" | "lte" => {
            let expected = condition["value"].as_f64().ok_or("Numeric comparisons require a numeric value")?;
            let Some(number) = actual.and_then(Value::as_f64) else { return Ok(false); };
            Ok(match op { "gt" => number > expected, "gte" => number >= expected,
                          "lt" => number < expected, _ => number <= expected })
        }
        _ => Err(format!("Unknown condition operator {op}")),
    }
}

pub(crate) fn json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(i,j)| json_equal(i,j)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k,v)| y.get(k).is_some_and(|w| json_equal(v,w))),
        _ => a == b,
    }
}

fn validate_fields(fields: &Map<String, Value>, shell: bool) -> Result<()> {
    let mut keys = HashSet::new();
    for (key, field) in fields {
        if !valid_key(key) { return Err(format!("Invalid field key: {key}")); }
        if shell && !keys.insert(key.to_ascii_uppercase()) { return Err(format!("Conflicting environment variable name: {key}")); }
        if let Some(condition) = field.get("availableWhen") {
            condition_matches(condition, fields, &Value::Null)
                .map_err(|e| format!("Invalid availableWhen on {key}: {e}"))?;
        }
        if field.get("env").is_some() { return Err(format!("Unknown property on {key}")); }
        if let Some(multiple) = field["ui"].get("multiple") {
            if !multiple.is_boolean() || field["ui"]["component"] != "file" {
                return Err(format!("{key}: ui.multiple must be a boolean on a file field"));
            }
        }
        if field["ui"]["multiple"] == true {
            if field["schema"]["type"] != "array" || field["schema"]["items"]["type"] != "string" {
                return Err(format!("{key}: multiple files require a string array schema"));
            }
            if field["ui"].get("mode").is_some_and(|v| v != "open") {
                return Err(format!("{key}: multiple files require open mode"));
            }
        }
        jsonschema::validator_for(field.get("schema").ok_or(format!("Missing schema for {key}"))?).map_err(error)?;
        if let Some(options) = field["ui"].get("options") {
            if field["ui"].get("component").is_some_and(|c| c != "select") {
                return Err(format!("{key}: ui.options applies only to select"));
            }
            let choices = field["schema"]["enum"].as_array().ok_or(format!("{key}: ui.options requires schema.enum"))?;
            let options = options.as_array().ok_or(format!("{key}: ui.options must be an array"))?;
            let mut seen = Vec::new();
            for option in options {
                let value = option.get("value").ok_or(format!("{key}: option is missing value"))?;
                if option.get("label").is_some_and(|v| v.as_str().is_none_or(|s| s.trim().is_empty())) {
                    return Err(format!("{key}: option label must be a nonempty string"));
                }
                if !choices.contains(value) || seen.contains(&value) {
                    return Err(format!("{key}: option values must be unique members of schema.enum"));
                }
                seen.push(value);
            }
        }
    }
    Ok(())
}
pub fn values(fields: &Map<String, Value>, supplied: &Value, check_required: bool) -> Result<Value> {
    let mut result = Map::new();
    for (key, field) in fields {
        let value = supplied.get(key).or_else(|| field["schema"].get("default"));
        if let Some(value) = value {
            if check_required {
                let validator = jsonschema::validator_for(&field["schema"]).map_err(error)?;
                if let Err(e) = validator.validate(value) { return Err(format!("{key}: {e}")); }
                if let Some(rule) = field.get("path") {
                    let paths: Vec<&Value> = if let Some(items) = value.as_array() { items.iter().collect() } else { vec![value] };
                    for item in paths {
                    let p = Path::new(item.as_str().ok_or("Expected a path or an array of paths")?);
                    if !p.is_absolute() { return Err(format!("{key}: choose an absolute path")); }
                    if rule["mustExist"] == true && !p.exists() { return Err(format!("{key}: path does not exist")); }
                    if p.exists() && ((rule["kind"] == "directory" && !p.is_dir()) || (rule["kind"] == "file" && !p.is_file())) { return Err(format!("{key}: unexpected path type")); }
                    }
                }
            }
            result.insert(key.clone(), value.clone());
        } else if check_required && field["required"] == true {
            let visible = match field.get("availableWhen") {
                Some(condition) => condition_matches(condition, fields, supplied)?,
                None => true,
            };
            if visible { return Err(format!("Enter a value for {key}")); }
        }
    }
    Ok(Value::Object(result))
}
pub fn compatible(m: &Manifest) -> bool {
    let os = match std::env::consts::OS { "macos"=>"macos", "windows"=>"windows", _=>"linux" };
    let arch = match std::env::consts::ARCH { "x86_64"=>"amd64", "aarch64"=>"arm64", a=>a };
    m.platforms.as_ref().is_none_or(|ps| ps.iter().any(|p| p.os == os && p.arch.as_ref().is_none_or(|a| a.iter().any(|v| v == arch))))
}
pub fn version_matches(version: &str, range: &str) -> Result<bool> {
    let version: node_semver::Version = version.trim().trim_start_matches('v').parse().map_err(error)?;
    let range: node_semver::Range = range.parse().map_err(error)?;
    Ok(range.satisfies(&version))
}
pub fn read_json(path: &Path) -> Value { fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| serde_json::json!({})) }
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(error)?; }
    fs::write(path, serde_json::to_vec_pretty(value).map_err(error)?).map_err(error)
}
pub fn python_venv(dir: &Path) -> PathBuf { dir.join(if cfg!(windows) { ".venv/Scripts/python.exe" } else { ".venv/bin/python" }) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn empty_condition_controls_required() {
        use serde_json::json;
        let mut fields = json!({"name":{"schema":{}}, "note":{"required":true,"schema":{"type":"string"},
            "availableWhen":{"op":"empty","key":"name"}}});
        assert!(validate_fields(fields.as_object().unwrap(), false).is_ok());
        for input in [json!({}), json!({"name":null}), json!({"name":""})] {
            assert!(values(fields.as_object().unwrap(), &input, true).is_err());
        }
        for name in [json!(" "), json!("text"), json!(0), json!(false), json!([])] {
            assert!(values(fields.as_object().unwrap(), &json!({"name":name}), true).is_ok());
        }
        fields["name"]["schema"]["default"] = json!("default");
        assert!(values(fields.as_object().unwrap(), &json!({}), true).is_ok());
    }

    #[test] fn conditional_required() {
        use serde_json::json;
        let fields = json!({
            "name":{"required":true,"schema":{"type":"string","minLength":1},"availableWhen":{"op":"and","cond":[
                {"op":"not","key":"mode","value":"basic"},
                {"op":"or","cond":[{"op":"gte","key":"count","value":2},{"op":"null","key":"count"}]}
            ]}},
            "mode":{"schema":{"type":"string","default":"basic"}},
            "count":{"schema":{"type":["integer","null"],"default":1}}
        });
        let fields = fields.as_object().unwrap();
        assert!(validate_fields(fields, false).is_ok());
        assert!(values(fields, &json!({}), true).is_ok());
        assert!(values(fields, &json!({"mode":"advanced","count":2}), true).is_err());
        assert!(values(fields, &json!({"mode":"advanced","count":null}), true).is_err());
        assert!(values(fields, &json!({"mode":"advanced","count":1}), true).is_ok());
        assert!(values(fields, &json!({"name":""}), true).is_err());
        assert_eq!(values(fields, &json!({"name":"saved"}), true).unwrap()["name"], "saved");
        assert!(condition_matches(&json!({"op":"eq","key":"missing","value":1}),fields,&Value::Null).is_err());
    }

    #[test] fn multiple_file_paths() {
        let fields = serde_json::json!({"files":{"required":true,"schema":{"type":"array","items":{"type":"string"},"minItems":1,"uniqueItems":true},"ui":{"component":"file","multiple":true,"mode":"open"},"path":{"kind":"file","mustExist":true}}});
        let fields = fields.as_object().unwrap();
        assert!(validate_fields(fields, false).is_ok());
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        assert!(values(fields, &serde_json::json!({"files":[path]}), true).is_ok());
        for input in [serde_json::json!({}), serde_json::json!({"files":[]}), serde_json::json!({"files":[path,"relative.mp3"]}), serde_json::json!({"files":[path,path]}), serde_json::json!({"files":[path,env!("CARGO_MANIFEST_DIR")]}), serde_json::json!({"files":[path, path.join("missing.wav")]})] {
            assert!(values(fields, &input, true).is_err());
        }
    }
    #[test] fn select_option_labels() {
        let mut fields = serde_json::json!({"mode": {"schema": {"enum": ["render", "extract", 1, true, null]}, "ui": {"options": [{"value": "render", "label": "Render page"}, {"value": 1, "label": "One"}, {"value": null, "label": "None"}]}}});
        assert!(validate_fields(fields.as_object().unwrap(), false).is_ok());
        assert_eq!(values(fields.as_object().unwrap(), &serde_json::json!({"mode":"render"}), true).unwrap()["mode"], "render");
        for options in [serde_json::json!([{"value":"other","label":"Unknown"}]), serde_json::json!([{"value":"render","label":""}]), serde_json::json!([{"label":"Missing"}]), serde_json::json!([{"value":1,"label":"One"},{"value":1,"label":"Duplicate"}]), serde_json::json!({})] {
            fields["mode"]["ui"]["options"] = options;
            assert!(validate_fields(fields.as_object().unwrap(), false).is_err());
        }
    }
    #[test] fn version_ranges() { assert!(version_matches("3.12.1", ">=3.10.0 <4.0.0").unwrap()); assert!(!version_matches("18.0.0", ">=22 <23").unwrap()); }
    #[test] fn defaults_and_validation() {
        let fields = serde_json::json!({"count":{"schema":{"type":"integer","minimum":1,"default":2}}, "name":{"schema":{"type":"string"},"required":true}});
        assert!(values(fields.as_object().unwrap(), &serde_json::json!({}), true).is_err());
        assert_eq!(values(fields.as_object().unwrap(), &serde_json::json!({"name":"test"}), true).unwrap()["count"], 2);
    }
}
