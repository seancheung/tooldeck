use std::collections::{HashMap, HashSet};
use serde_json::{Map, Value};
use crate::model::Result;

pub fn host_text<'a>(locale: &str, english: &'a str) -> &'a str {
    static CHINESE: std::sync::OnceLock<HashMap<String, String>> = std::sync::OnceLock::new();
    if locale == "zh-CN" {
        return CHINESE.get_or_init(|| serde_json::from_str(include_str!("../../src/locales/native.zh-CN.json"))
            .expect("invalid native message catalog")).get(english).map(String::as_str).unwrap_or(english);
    }
    english
}

pub fn system_locale() -> String {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        extern "system" { fn GetUserDefaultUILanguage() -> u16; }
        return if unsafe { GetUserDefaultUILanguage() } & 0x3ff == 4 { "zh-CN" } else { "en" }.into();
    }
    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        if let Ok(output) = std::process::Command::new("defaults").args(["read", "-g", "AppleLocale"]).output() {
            if output.status.success() { return supported_locale(&String::from_utf8_lossy(&output.stdout)); }
        }
        for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
            if let Ok(value) = std::env::var(key) {
                if !value.trim().is_empty() { return supported_locale(&value); }
            }
        }
        "en".into()
    }
}

#[cfg(not(windows))]
fn supported_locale(value: &str) -> String {
    if value.trim().split(['-', '_', '.']).next().is_some_and(|v| v.eq_ignore_ascii_case("zh")) {
        "zh-CN".into()
    } else { "en".into() }
}

// Resolve presentation fields only. In particular, schema defaults, enum values
// and availableWhen operands are user data, even if they look like locale maps.
fn resolve(obj: &mut Value, key: &str, locale: &str, fallback: Option<&str>) -> Result<()> {
    let Some(value) = obj.get(key) else { return Ok(()); };
    if value.is_string() { return Ok(()); }
    let map = value.as_object().ok_or_else(|| format!("{key}: expected a string or locale map"))?;
    if map.values().any(|v| !v.is_string()) { return Err(format!("{key}: locale values must be strings")); }
    let selected = map.get(locale).or_else(|| map.get("en")).and_then(Value::as_str).or(fallback).map(str::to_owned);
    let object = obj.as_object_mut().unwrap();
    if let Some(text) = selected { object.insert(key.into(), Value::String(text)); }
    else { object.remove(key); }
    Ok(())
}

fn fields(map: &mut Map<String, Value>, locale: &str) -> Result<()> {
    for field in map.values_mut() {
        if let Some(schema) = field.get_mut("schema") { resolve(schema, "description", locale, None)?; }
        let Some(ui) = field.get_mut("ui") else { continue; };
        for key in ["label", "description", "placeholder"] { resolve(ui, key, locale, None)?; }
        if let Some(options) = ui.get_mut("options").and_then(Value::as_array_mut) {
            for option in options.iter_mut() {
                if option.get("label").is_none() { return Err("Select option is missing label".into()); }
                resolve(option, "label", locale, None)?;
            }
        }
    }
    Ok(())
}

pub fn localize_manifest(mut raw: Value, locale: &str) -> Result<Value> {
    let id = raw["id"].as_str().unwrap_or("").to_owned();
    resolve(&mut raw, "name", locale, Some(&id))?;
    resolve(&mut raw, "description", locale, None)?;
    if let Some(map) = raw.get_mut("settings").and_then(Value::as_object_mut) { fields(map, locale)?; }
    if let Some(actions) = raw.get_mut("actions").and_then(Value::as_object_mut) {
        for (id, action) in actions {
            resolve(action, "name", locale, Some(id))?;
            resolve(action, "description", locale, None)?;
            if let Some(map) = action.get_mut("params").and_then(Value::as_object_mut) { fields(map, locale)?; }
        }
    }
    if let Some(docs) = raw.get_mut("docs").and_then(Value::as_array_mut) {
        let mut seen = HashSet::new();
        let mut indexes = HashMap::<String, (usize, u8)>::new();
        let mut chosen = Vec::new();
        for doc in docs.iter() {
            let id = doc["id"].as_str().ok_or("Document is missing id")?;
            let lang = doc.get("locale").map(|v| v.as_str().ok_or("Document locale must be a string")).transpose()?;
            if !seen.insert((id, lang)) { return Err(format!("Duplicate document id and locale: {id}")); }
            let rank = match lang { Some(l) if l == locale => 3, Some("en") => 2, None => 1, _ => continue };
            if let Some((index, previous)) = indexes.get_mut(id) {
                if rank > *previous { chosen[*index] = doc.clone(); *previous = rank; }
            } else { indexes.insert(id.into(), (chosen.len(), rank)); chosen.push(doc.clone()); }
        }
        *docs = chosen;
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn localizes_text_only_and_falls_back_per_document() {
        let input = json!({
            "id":"org.test.locale", "name":{"en":"Tool","zh-CN":"localized tool"}, "description":{"en":"Fallback"},
            "settings": {"s":{"ui":{"label":{"fr":"unused"},"placeholder":{"en":"Enter text"}}}},
            "actions":{"go":{"name":{"en":"Run","zh-CN":"localized action"},"params":{
                "x":{"schema":{"default":{"en":"literal"}},"ui":{"options":[{"value":{"en":"literal"},"label":{"zh-CN":"localized choice"}}]}}
            }}},
            "docs":[{"id":"guide","locale":"en","path":"en.md"},{"id":"guide","locale":"zh-CN","path":"zh.md"},
                    {"id":"api","locale":"en","path":"api.md"},{"id":"old","path":"old.md"}]
        });
        let zh = localize_manifest(input.clone(),"zh-CN").unwrap();
        assert_eq!(zh["name"],"localized tool");
        assert_eq!(zh["description"],"Fallback");
        assert!(zh["settings"]["s"]["ui"].get("label").is_none());
        assert_eq!(zh["settings"]["s"]["ui"]["placeholder"], "Enter text");
        assert_eq!(zh["actions"]["go"]["name"],"localized action");
        assert_eq!(zh["actions"]["go"]["params"]["x"]["schema"]["default"], json!({"en":"literal"}));
        assert_eq!(zh["docs"][0]["path"],"zh.md");
        assert_eq!(zh["docs"][1]["path"],"api.md");
        assert_eq!(zh["docs"][2]["path"],"old.md");
        let en = localize_manifest(input,"en").unwrap();
        assert!(en["actions"]["go"]["params"]["x"]["ui"]["options"][0].get("label").is_none());
        assert_eq!(en["docs"][0]["path"],"en.md");
        assert!(localize_manifest(json!({"name":{"en":12}}),"en").is_err());
    }
}
