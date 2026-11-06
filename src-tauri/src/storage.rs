use crate::model::*;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io, path::{Path, PathBuf}};

pub fn tool_dir(config: &Config, id: &str) -> Result<PathBuf> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { return Err("Invalid tool ID".into()); }
    Ok(Path::new(&config.data_dir).join("tools").join(id))
}
pub fn is_installed(dir: &Path, manifest: &Manifest) -> bool {
    if manifest.runtime.kind != "python" && manifest.dependencies.is_none() {
        return true;
    }
    dir.join(".tooldeck/installed.json").is_file() && match manifest.runtime.kind.as_str() {
        "python" => python_venv(dir).is_file() && dir.join(".venv/pyvenv.cfg").is_file(),
        "nodejs" => dir.join("node_modules").is_dir(),
        _ => false,
    }
}
pub fn list(config: &Config) -> Result<Vec<Tool>> {
    let root = Path::new(&config.data_dir).join("tools");
    fs::create_dir_all(&root).map_err(error)?;
    let mut tools = vec![];
    for item in fs::read_dir(root).map_err(error)? {
        let dir = item.map_err(error)?.path();
        if !dir.join("manifest.yaml").exists() { continue; }
        let m = read_manifest_for(&dir, &config.locale)?;
        let settings = values(&m.settings, &read_json(&dir.join(".tooldeck/settings.json")), false)?;
        let installed = is_installed(&dir, &m);
        tools.push(Tool { compatible: compatible(&m), manifest: m, directory: dir.to_string_lossy().into(), installed, settings, issue: None });
    }
    tools.sort_by(|a,b| a.manifest.name.cmp(&b.manifest.name));
    Ok(tools)
}
fn copy_dir(source: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest).map_err(error)?;
    for item in fs::read_dir(source).map_err(error)? {
        let item = item.map_err(error)?;
        if item.file_type().map_err(error)?.is_dir() { copy_dir(&item.path(), &dest.join(item.file_name()))?; }
        else { fs::copy(item.path(), dest.join(item.file_name())).map_err(error)?; }
    }
    Ok(())
}
fn unchanged_dependencies(old_dir: &Path, new_dir: &Path, old: &Manifest, new: &Manifest) -> Result<bool> {
    if old.runtime.kind != new.runtime.kind || old.runtime.version != new.runtime.version || old.runtime.source != new.runtime.source { return Ok(false); }
    if old.dependencies.is_none() && new.dependencies.is_none() {
        return Ok(old.runtime.kind == "python" && is_installed(old_dir, old));
    }
    let (Some(a), Some(b)) = (&old.dependencies, &new.dependencies) else { return Ok(false); };
    if a.manager != b.manager || a.file != b.file || a.lockfile != b.lockfile { return Ok(false); }
    let mut files = vec![a.file.clone()];
    if let Some(lock) = &a.lockfile { files.push(lock.clone()); }
    if a.manager == "npm" {
        for name in ["package-lock.json", "npm-shrinkwrap.json", ".npmrc"] {
            // An undeclared lockfile generated during installation can be retained.
            if new_dir.join(name).exists() { files.push(name.into()); }
        }
    }
    for file in files {
        if !old_dir.join(&file).is_file() { return Ok(false); }
        let old_bytes = fs::read(old_dir.join(&file)).map_err(error)?;
        let new_bytes = fs::read(new_dir.join(&file)).map_err(error)?;
        if a.manager == "npm" && file == a.file {
            let mut old_package: serde_json::Value = serde_json::from_slice(&old_bytes).map_err(error)?;
            let mut new_package: serde_json::Value = serde_json::from_slice(&new_bytes).map_err(error)?;
            for package in [&mut old_package, &mut new_package] {
                if let Some(object) = package.as_object_mut() {
                    for key in ["name", "version", "description", "author", "license", "homepage", "repository", "bugs", "keywords"] { object.remove(key); }
                }
            }
            if old_package != new_package { return Ok(false); }
        } else if a.manager == "npm" && matches!(file.as_str(), "package-lock.json" | "npm-shrinkwrap.json") {
            if npm_lock_dependencies(&old_bytes)? != npm_lock_dependencies(&new_bytes)? { return Ok(false); }
        } else if old_bytes != new_bytes { return Ok(false); }
    }
    Ok(old_dir.join(".tooldeck/installed.json").is_file() && match a.manager.as_str() {
        "pip" => python_venv(old_dir).is_file(),
        "npm" => old_dir.join("node_modules").is_dir(),
        _ => false,
    })
}

fn npm_lock_dependencies(bytes: &[u8]) -> Result<Value> {
    let mut lock: Value = serde_json::from_slice(bytes).map_err(error)?;
    // npm version writes release metadata at both the top level and packages[""].
    // Nested package versions, integrity hashes and resolution data still matter.
    if let Some(top) = lock.as_object_mut() {
        top.remove("name");
        top.remove("version");
    }
    if let Some(root) = lock.pointer_mut("/packages/").and_then(Value::as_object_mut) {
        root.remove("name");
        root.remove("version");
    }
    Ok(lock)
}

#[cfg(test)]
mod dependency_tests {
    use super::*;
    #[test]
    fn npm_lock_ignores_only_root_release_metadata() {
        let lock = serde_json::json!({"version":"1.0.0","lockfileVersion":3,"packages":{
            "":{"version":"1.0.0","dependencies":{"yaml":"^2"}},
            "node_modules/yaml":{"version":"2.9.0","integrity":"original"}
        }});
        let compare = |v: &Value| npm_lock_dependencies(&serde_json::to_vec(v).unwrap()).unwrap();
        let mut newer = lock.clone();
        newer["version"] = "1.1.0".into();
        newer["packages"][""]["version"] = "1.1.0".into();
        assert_eq!(compare(&lock), compare(&newer));
        newer["packages"]["node_modules/yaml"]["version"] = "2.9.1".into();
        assert_ne!(compare(&lock), compare(&newer));
    }
}
#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub id: String,
    pub name: String,
    pub version: String,
    pub previous_version: Option<String>,
    pub needs_confirmation: bool,
    pub manifest: Manifest,
    pub manifest_hash: String,
}
pub fn import_zip(config: &Config, file: &str) -> Result<ImportResult> {
    import_zip_confirmed(config, file, None)
}
pub fn import_zip_confirmed(config: &Config, file: &str, confirmation: Option<&ImportResult>) -> Result<ImportResult> {
    let stage = Path::new(&config.data_dir).join(".imports").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&stage).map_err(error)?;
    let outcome = (|| {
        let input = fs::File::open(file).map_err(error)?;
        let mut zip = zip::ZipArchive::new(input).map_err(error)?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(error)?;
            let relative = entry.enclosed_name().ok_or("Invalid ZIP entry path")?;
            let dest = stage.join(relative);
            if entry.is_dir() { fs::create_dir_all(&dest).map_err(error)?; }
            else { fs::create_dir_all(dest.parent().unwrap()).map_err(error)?; let mut output = fs::File::create(dest).map_err(error)?; io::copy(&mut entry, &mut output).map_err(error)?; }
        }
        let source = if stage.join("manifest.yaml").is_file() { stage.clone() } else {
            let candidates: Vec<_> = fs::read_dir(&stage).map_err(error)?.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.join("manifest.yaml").is_file()).collect();
            if candidates.len() != 1 { return Err("Expected manifest.yaml at the ZIP root or in a single top-level folder".into()); }
            candidates[0].clone()
        };
        let manifest = read_manifest_for(&source, &config.locale)?;
        let manifest_hash = format!("{:x}", Sha256::digest(fs::read(source.join("manifest.yaml")).map_err(error)?));
        let dest = tool_dir(config, &manifest.id)?;
        let incoming: node_semver::Version = manifest.version.parse().map_err(error)?;
        let mut preserve_dependencies = false;
        let previous_version = if dest.exists() {
            let current = read_manifest(&dest)?;
            let current_version: node_semver::Version = current.version.parse().map_err(error)?;
            if incoming <= current_version {
                return Err(format!("Cannot import v{1} over v{0}. Choose a higher version.", current.version, manifest.version));
            }
            preserve_dependencies = unchanged_dependencies(&dest, &source, &current, &manifest)?;
            Some(current.version)
        } else { None };

        if let Some(confirmed) = confirmation {
            if confirmed.manifest_hash != manifest_hash || confirmed.id != manifest.id || confirmed.version != manifest.version || confirmed.previous_version != previous_version || serde_json::to_value(&confirmed.manifest).map_err(error)? != serde_json::to_value(&manifest).map_err(error)? {
                return Err("Tool details or version changed. Import and confirm again.".into());
            }
        } else {
            return Ok(ImportResult { id: manifest.id.clone(), name: manifest.name.clone(), version: manifest.version.clone(), previous_version, needs_confirmation: true, manifest, manifest_hash });
        }

        // Prepare the complete replacement before touching the existing tool.
        let prepared = stage.join(".prepared-tool");
        if source == stage {
            // Keep the destination outside the source tree during recursive copy.
            let temporary = Path::new(&config.data_dir).join(".imports").join(format!("prepared-{}", uuid::Uuid::new_v4()));
            if let Err(e) = copy_dir(&source, &temporary) { let _ = fs::remove_dir_all(&temporary); return Err(e); }
            fs::rename(temporary, &prepared).map_err(error)?;
        } else { copy_dir(&source, &prepared)?; }
        for name in [".venv", "node_modules"] {
            let path = prepared.join(name);
            if path.exists() { fs::remove_dir_all(path).map_err(error)?; }
        }
        let marker = prepared.join(".tooldeck/installed.json");
        if marker.exists() { fs::remove_file(marker).map_err(error)?; }
        {
            let settings = if previous_version.is_some() { dest.join(".tooldeck/settings.json") }
                else { retained_settings(config, &manifest.id)? };
            if settings.is_file() {
                fs::create_dir_all(prepared.join(".tooldeck")).map_err(error)?;
                fs::copy(settings, prepared.join(".tooldeck/settings.json")).map_err(error)?;
            }
        }
        fs::create_dir_all(dest.parent().unwrap()).map_err(error)?;
        let backup = stage.join(".previous-tool");
        if previous_version.is_some() { fs::rename(&dest, &backup).map_err(error)?; }
        let mut moved = Vec::new();
        let replacement = (|| -> io::Result<()> {
            if preserve_dependencies {
                fs::create_dir_all(prepared.join(".tooldeck"))?;
                let environment = if manifest.runtime.kind == "python" { ".venv" } else { "node_modules" };
                for name in [environment, ".tooldeck/installed.json"] {
                    fs::rename(backup.join(name), prepared.join(name))?;
                    moved.push(name);
                }
                if manifest.runtime.kind == "nodejs" {
                    for name in ["package-lock.json", "npm-shrinkwrap.json"] {
                        if !prepared.join(name).exists() && backup.join(name).is_file() {
                            fs::copy(backup.join(name), prepared.join(name))?;
                        }
                    }
                }
            }
            fs::rename(&prepared, &dest)
        })();
        if let Err(e) = replacement {
            for name in moved.iter().rev() {
                if let Err(restore_error) = fs::rename(prepared.join(name), backup.join(name)) {
                    return Err(format!("Upgrade failed: {e}. Dependency restore failed: {restore_error}. Backup: {0}", stage.display()));
                }
            }
            if backup.exists() {
                if let Err(restore_error) = fs::rename(&backup, &dest) {
                    // Keep the backup if restoration fails; do not remove it with the staging folder.
                    let recovery = Path::new(&config.data_dir).join(format!("recovery-{}", uuid::Uuid::new_v4()));
                    let recovered = fs::rename(&backup, &recovery);
                    return Err(format!("Upgrade failed: {e}. Restore failed: {restore_error}. Backup: {} ({recovered:?})", recovery.display()));
                }
            }
            return Err(error(e));
        }
        Ok(ImportResult { id: manifest.id.clone(), name: manifest.name.clone(), version: manifest.version.clone(), previous_version, needs_confirmation: false, manifest, manifest_hash })
    })();
    if outcome.is_ok() || !stage.join(".previous-tool").exists() {
        let _ = fs::remove_dir_all(stage);
    }
    outcome
}
pub fn uninstall(config: &Config, id: &str) -> Result<()> {
    let dir = tool_dir(config, id)?;
    let _ = read_manifest(&dir)?;
    for name in [".venv", "node_modules"] { let path = dir.join(name); if path.exists() { fs::remove_dir_all(path).map_err(error)?; } }
    let marker = dir.join(".tooldeck/installed.json"); if marker.exists() { fs::remove_file(marker).map_err(error)?; }
    Ok(())
}
fn retained_settings(config: &Config, id: &str) -> Result<PathBuf> {
    tool_dir(config, id)?;
    let base = Path::new(&config.data_dir).canonicalize().map_err(error)?;
    let dir = base.join("retained-settings");
    if dir.exists() && dir.canonicalize().map_err(error)? != dir { return Err("Retained settings directory cannot be an external link".into()); }
    Ok(dir.join(format!("{id}.json")))
}

#[derive(serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DeleteOptions { pub settings: bool, pub data: bool, pub logs: bool }
impl Default for DeleteOptions {
    fn default() -> Self { Self { settings: true, data: false, logs: false } }
}

pub fn delete(config: &Config, id: &str, options: DeleteOptions) -> Result<()> {
    let dir = tool_dir(config, id)?;
    if !dir.join("manifest.yaml").is_file() { return Err("Tool not found".into()); }
    let base = Path::new(&config.data_dir).canonicalize().map_err(error)?;
    if dir.canonicalize().map_err(error)? != base.join("tools").join(id) { return Err("Tool directory cannot be an external link".into()); }
    let data = Path::new(&config.data_dir).join("data").join(id);
    if options.data && data.exists() && data.canonicalize().map_err(error)? != base.join("data").join(id) {
        return Err("Tool data directory cannot be an external link".into());
    }
    let retained = retained_settings(config, id)?;
    let settings = dir.join(".tooldeck/settings.json");
    if !options.settings && settings.is_file() {
        fs::create_dir_all(retained.parent().unwrap()).map_err(error)?;
        if retained.exists() { fs::remove_file(&retained).map_err(error)?; }
        fs::copy(settings, &retained).map_err(error)?;
    } else if retained.exists() { fs::remove_file(&retained).map_err(error)?; }
    if options.logs { crate::run_logs::clear_tool(config, id)?; }
    if options.data && data.exists() { fs::remove_dir_all(data).map_err(error)?; }
    fs::remove_dir_all(dir).map_err(error)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection { pub node: Option<String>, pub uv: Option<String>, pub powershell: Option<String>, pub bash: Option<String> }
pub fn detect() -> Detection {
    fn find(name: &str) -> Option<String> { which::which(name).ok().map(|p| p.to_string_lossy().into()) }
    let uv = find("uv").or_else(|| {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
        let path = PathBuf::from(home).join(if cfg!(windows) { ".local/bin/uv.exe" } else { ".local/bin/uv" });
        path.is_file().then(|| path.to_string_lossy().into())
    });
    Detection { node: find("node"), uv, powershell: find("pwsh"), bash: find("bash") }
}
