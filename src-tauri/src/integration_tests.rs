use crate::{model::*, runner, storage};
use serde_json::{json, Value};
use std::{fs, io::Write, path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};


fn fixture(name: &str) -> (Config, String) {
    let root = std::env::temp_dir().join(format!("tooldeck-integration-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let config = Config { locale: "en".into(), data_dir: root.to_string_lossy().into(), node_path: which::which("node").unwrap().to_string_lossy().into(), uv_path: std::env::var("TOOLDECK_TEST_UV").unwrap_or_default() };
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples").join(name);
    let archive = root.join("tool.zip");
    let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
    for item in fs::read_dir(&source).unwrap() {
        let item = item.unwrap();
        if item.path().is_file() {
            zip.start_file(item.file_name().to_string_lossy(), zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(&fs::read(item.path()).unwrap()).unwrap();
        }
    }
    zip.finish().unwrap();
    let preview = storage::import_zip(&config, archive.to_str().unwrap()).unwrap();
    assert!(preview.needs_confirmation);
    assert!(!storage::tool_dir(&config, &preview.id).unwrap().exists());
    let id = storage::import_zip_confirmed(&config, archive.to_str().unwrap(), Some(&preview)).unwrap().id;
    assert!(storage::import_zip(&config, archive.to_str().unwrap()).is_err());
    (config, id)
}
fn flag() -> Arc<AtomicBool> { Arc::new(AtomicBool::new(false)) }

#[tokio::test]
async fn node_import_install_run_uninstall() {
    
    let events = Arc::new(Mutex::new(Vec::<Value>::new())); let sink=events.clone();
    let app: runner::EventSink = Arc::new(move |run, kind, payload| sink.lock().unwrap().push(json!({"runId":run,"type":kind,"payload":payload})));
    let (config,id)=fixture("node-example"); let dir=storage::tool_dir(&config,&id).unwrap();
    assert!(!storage::list(&config).unwrap()[0].installed);
    let lifecycle = |hook: &str, event: &str| json!({"hookId":hook,"event":event,"values":{}});
    assert!(runner::job(&app,&config,&id,"uninstalled-open","hook",Some("write"),
        lifecycle("onOpen","actionOpen"),flag()).await.is_err());
    fs::create_dir_all(dir.join("test-package")).unwrap();
    fs::write(dir.join("test-package/package.json"),r#"{"name":"tooldeck-test-package","version":"1.0.0","main":"index.js"}"#).unwrap();
    fs::write(dir.join("test-package/index.js"),"module.exports = 'dependency loaded';").unwrap();
    fs::write(dir.join("package.json"),r#"{"type":"module","dependencies":{"tooldeck-test-package":"file:./test-package"}}"#).unwrap();
    let original=fs::read_to_string(dir.join("preview.mjs")).unwrap();
    fs::write(dir.join("preview.mjs"),format!("import value from 'tooldeck-test-package';\nif(value !== 'dependency loaded') throw new Error('dependency missing');\n{original}")).unwrap();
    runner::job(&app,&config,&id,"install-node","install",None,json!({}),flag()).await.unwrap();
    assert!(storage::list(&config).unwrap()[0].installed);
    for (hook, event) in [("onOpen","actionOpen"),("onClose","actionClose")] {
        runner::job(&app,&config,&id,event,"hook",Some("write"),lifecycle(hook,event),flag()).await.unwrap();
        assert!(events.lock().unwrap().iter().any(|e| e["runId"] == event && e["payload"]["message"] == format!("{event}: write")));
    }
    write_json(&dir.join(".tooldeck/settings.json"),&json!({"prefix":"Hi","uppercase":false})).unwrap();
    runner::job(&app,&config,&id,"run-node","run",Some("preview"),json!({"name":"Montréal"}),flag()).await.unwrap();
    assert!(events.lock().unwrap().iter().any(|e| e["type"]=="output" && e["payload"]["message"]=="Hi, Montréal!"));
    // The write form may still be missing its required destination when name loses focus.
    runner::job(&app,&config,&id,"hook-node","hook",Some("write"),
        json!({"hookId":"previewName","changedKeys":["name"],"values":{"name":"Ada"}}),flag()).await.unwrap();
    let hook_events: Vec<_> = events.lock().unwrap().iter().filter(|e| e["runId"]=="hook-node").cloned().collect();
    assert_eq!(hook_events.len(), 2);
    assert_eq!(hook_events[0]["type"], "clearOutput");
    assert_eq!(hook_events[1]["payload"]["message"], "Name for this greeting: Ada");
    assert!(runner::job(&app,&config,&id,"hook-unmatched","hook",Some("write"),
        json!({"hookId":"previewName","changedKeys":["destination"],"values":{}}),flag()).await.is_err());
    let folder = dir.join("inputs");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("sample.txt"), "example").unwrap();
    runner::job(&app,&config,&id,"discover","hook",Some("inspectFolder"),
        json!({"hookId":"listFiles","changedKeys":["folder"],"values":{"folder":folder}}),flag()).await.unwrap();
    let patch = events.lock().unwrap().iter().find(|e| e["runId"]=="discover" && e["type"]=="updateParams").unwrap()["payload"].clone();
    assert_eq!(patch["sourceFile"]["value"], "sample.txt");
    let overrides = json!({"sourceFile":{"options":patch["sourceFile"]["options"],"visible":true}});
    let run_file = |name: &str| runner::job_with_form(&app,&config,&id,"inspect","run",Some("inspectFolder"),
        json!({"folder":folder,"sourceFile":name}),overrides.clone(),flag());
    run_file("sample.txt").await.unwrap();
    assert!(run_file("unlisted.txt").await.is_err());
    runner::job_with_form(&app,&config,&id,"empty-folder","run",Some("inspectFolder"),
        json!({"folder":folder}),json!({"sourceFile":{"visible":false,"unset":true,"options":[]}}),flag()).await.unwrap();
    runner::job(&app,&config,&id,"uninstall-node","uninstall",None,json!({}),flag()).await.unwrap();
    assert!(!dir.join("node_modules").exists()); assert!(!storage::list(&config).unwrap()[0].installed);
    assert!(dir.join("preview.mjs").exists()); assert_eq!(read_json(&dir.join(".tooldeck/settings.json"))["prefix"],"Hi");
}

#[tokio::test]
async fn python_uv_install_run_uninstall() {
    if std::env::var("TOOLDECK_TEST_UV").is_err() { eprintln!("Set TOOLDECK_TEST_UV to run the uv integration check"); return; }
    let app: runner::EventSink = Arc::new(|_,_,_| {}); let (config,id)=fixture("python-example"); let dir=storage::tool_dir(&config,&id).unwrap();
    let wheel=dir.join("tooldeck_test_dep-1.0.0-py3-none-any.whl");
    let mut zip=zip::ZipWriter::new(fs::File::create(&wheel).unwrap());
    for (name, content) in [
        ("tooldeck_test_dep/__init__.py", "VALUE = 'dependency loaded'\n"),
        ("tooldeck_test_dep-1.0.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: tooldeck-test-dep\nVersion: 1.0.0\n"),
        ("tooldeck_test_dep-1.0.0.dist-info/WHEEL", "Wheel-Version: 1.0\nGenerator: tooldeck-tests\nRoot-Is-Purelib: true\nTag: py3-none-any\n"),
        ("tooldeck_test_dep-1.0.0.dist-info/RECORD", ""),
    ] { zip.start_file(name,zip::write::SimpleFileOptions::default()).unwrap(); zip.write_all(content.as_bytes()).unwrap(); }
    zip.finish().unwrap();
    fs::write(dir.join("requirements.txt"),"./tooldeck_test_dep-1.0.0-py3-none-any.whl\n").unwrap();
    let original=fs::read_to_string(dir.join("preview.py")).unwrap();
    fs::write(dir.join("preview.py"),format!("from tooldeck_test_dep import VALUE\nassert VALUE == 'dependency loaded'\n{original}")).unwrap();
    runner::job(&app,&config,&id,"install-python","install",None,json!({}),flag()).await.unwrap();
    assert!(python_venv(&dir).exists()); assert!(storage::list(&config).unwrap()[0].installed);
    runner::job(&app,&config,&id,"run-python","run",Some("preview"),json!({"name":"Montréal"}),flag()).await.unwrap();
    runner::job(&app,&config,&id,"uninstall-python","uninstall",None,json!({}),flag()).await.unwrap();
    assert!(!dir.join(".venv").exists()); assert!(dir.join("preview.py").exists());
}

#[tokio::test]
async fn cancellation_and_timeout() {
    let app: runner::EventSink = Arc::new(|_,_,_| {}); let (config,id)=fixture("node-example"); let dir=storage::tool_dir(&config,&id).unwrap();
    runner::job(&app,&config,&id,"prepare","install",None,json!({}),flag()).await.unwrap();
    fs::write(dir.join("preview.mjs"),"import fs from 'node:fs'; import path from 'node:path'; export async function main(ctx) { if ('output' in ctx.paths || process.env.TOOLDECK_OUTPUT_DIR) throw new Error('unexpected artifact directory'); fs.writeFileSync(path.join(ctx.paths.data, 'temp-path.txt'),ctx.paths.temp); ctx.log('started'); await new Promise(r=>setTimeout(r,10000)); }").unwrap();
    let cancel=flag(); let signal=cancel.clone();
    tokio::spawn(async move { tokio::time::sleep(std::time::Duration::from_millis(500)).await; signal.store(true,Ordering::SeqCst); });
    let result=runner::job(&app,&config,&id,"cancel","run",Some("preview"),json!({"name":"test"}),cancel).await;
    assert_eq!(result.unwrap_err(),"Cancelled");
    let manifest=fs::read_to_string(dir.join("manifest.yaml")).unwrap().replace("timeoutSeconds: 30","timeoutSeconds: 1"); fs::write(dir.join("manifest.yaml"),manifest).unwrap();
    let result=runner::job(&app,&config,&id,"timeout","run",Some("preview"),json!({"name":"test"}),flag()).await;
    assert_eq!(result.unwrap_err(),"Run timed out");
    let temp = fs::read_to_string(Path::new(&config.data_dir).join("data").join(&id).join("temp-path.txt")).unwrap();
    assert!(!Path::new(&temp).exists());
    assert!(!Path::new(&config.data_dir).join("runs").exists());
    let events: Vec<Value> = fs::read_dir(Path::new(&config.data_dir).join("logs")).unwrap()
        .flat_map(|e| fs::read_to_string(e.unwrap().path()).unwrap().lines().map(|line| serde_json::from_str::<Value>(line).unwrap()).collect::<Vec<_>>()).collect();
    assert!(events.iter().any(|e| e["runId"] == "cancel" && e["type"] == "finished" && e["payload"]["status"] == "cancelled"));
    assert!(events.iter().any(|e| e["runId"] == "timeout" && e["type"] == "finished" && e["payload"]["status"] == "error"));

}

#[test]
fn platform_and_arch_optional() {
    let dir=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../examples/node-example");
    let mut m=read_manifest(&dir).unwrap(); assert!(compatible(&m));
    m.platforms=Some(vec![Platform{os:std::env::consts::OS.into(),arch:None}]); assert!(compatible(&m));
    m.platforms=Some(vec![Platform{os:"unavailable".into(),arch:None}]); assert!(!compatible(&m));
}

#[test]
fn import_preview_and_upgrade_confirmation() {
    let (config, id) = fixture("node-example");
    let dir = storage::tool_dir(&config, &id).unwrap();
    let original = fs::read_to_string(dir.join("manifest.yaml")).unwrap();
    let current = read_manifest(&dir).unwrap();
    let lock = |version: &str| json!({"version": version, "lockfileVersion": 3, "packages": {"": {"version": version}}});
    write_json(&dir.join("package-lock.json"), &lock(&current.version)).unwrap();
    fs::create_dir_all(dir.join("node_modules")).unwrap();
    fs::write(dir.join("node_modules/retained"), "installed").unwrap();
    write_json(&dir.join(".tooldeck/installed.json"), &json!({"version":current.version})).unwrap();
    let archive = Path::new(&config.data_dir).join("upgrade.zip");
    let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
    for item in fs::read_dir(&dir).unwrap() {
        let item = item.unwrap();
        if item.path().is_file() {
            zip.start_file(item.file_name().to_string_lossy(), zip::write::SimpleFileOptions::default()).unwrap();
            let data = if item.file_name() == "manifest.yaml" { original.replace(&format!("version: \"{}\"", current.version), "version: \"99.0.0\"").into_bytes() }
                else if item.file_name() == "package-lock.json" { serde_json::to_vec(&lock("99.0.0")).unwrap() }
                else { fs::read(item.path()).unwrap() };
            zip.write_all(&data).unwrap();
        }
    }
    zip.finish().unwrap();
    let path = archive.to_str().unwrap();
    let mut preview = storage::import_zip(&config, path).unwrap();
    assert!(preview.needs_confirmation);
    assert_eq!(preview.previous_version.as_deref(), Some(current.version.as_str()));
    assert_eq!(preview.manifest.version, "99.0.0");
    assert_eq!(fs::read_to_string(dir.join("manifest.yaml")).unwrap(), original);
    // A changed description must require a new preview, even at the same version.
    preview.manifest.description.push_str("changed");
    assert!(storage::import_zip_confirmed(&config, path, Some(&preview)).is_err());
    assert_eq!(fs::read_to_string(dir.join("manifest.yaml")).unwrap(), original);
    let preview = storage::import_zip(&config, path).unwrap();
    let result = storage::import_zip_confirmed(&config, path, Some(&preview)).unwrap();
    assert!(!result.needs_confirmation);
    assert_eq!(read_manifest(&dir).unwrap().version, "99.0.0");
    assert!(storage::is_installed(&dir, &result.manifest));
    assert!(dir.join("node_modules/retained").is_file());
    fs::remove_dir_all(&config.data_dir).unwrap();
}

#[tokio::test]
async fn python_without_packages_requires_venv() {
    if std::env::var("TOOLDECK_TEST_UV").is_err() { return; }
    let (config, id) = fixture("python-example");
    let dir = storage::tool_dir(&config, &id).unwrap();
    let mut manifest = read_manifest(&dir).unwrap();
    manifest.dependencies = None;
    fs::write(dir.join("manifest.yaml"), serde_yaml::to_string(&manifest).unwrap()).unwrap();
    fs::remove_file(dir.join("requirements.txt")).unwrap();
    fs::write(dir.join("preview.py"), r#"import sys, shutil, subprocess
from pathlib import Path
def main(ctx):
    assert ctx.locale == "en"
    assert Path(sys.prefix) == Path(ctx.paths.tool) / ".venv"
    assert sys.prefix != sys.base_prefix
    assert Path(shutil.which("python")) == Path(sys.executable)
    child = subprocess.check_output([sys.executable, "-c", "import sys; print(sys.prefix)"], text=True)
    assert Path(child.strip()) == Path(sys.prefix)
"#).unwrap();
    let app: runner::EventSink = Arc::new(|_,_,_| {});
    let run = || runner::job(&app, &config, &id, "test-run", "run", Some("preview"), json!({"name":"test"}), flag());
    assert!(run().await.is_err());
    assert!(!storage::list(&config).unwrap()[0].installed);
    runner::job(&app, &config, &id, "setup", "install", None, json!({}), flag()).await.unwrap();
    assert!(storage::list(&config).unwrap()[0].installed);
    run().await.unwrap();
    runner::job(&app, &config, &id, "remove", "uninstall", None, json!({}), flag()).await.unwrap();
    assert!(!dir.join(".venv").exists());
    assert!(run().await.is_err());
}
#[tokio::test]
async fn shell_receives_display_language() {
    for (kind, example, file, script) in [
        ("powershell", "pws-example", "preview.ps1", "if ($env:TOOLDECK_LOCALE -ne 'zh-CN') { exit 1 }"),
        ("bash", "bash-example", "preview.sh", "test \"$TOOLDECK_LOCALE\" = zh-CN"),
    ] {
        if which::which(if kind == "bash" { "bash" } else { "pwsh" }).is_err() { continue; }
        let (mut config, id) = fixture(example);
        config.locale = "zh-CN".into();
        let dir = storage::tool_dir(&config, &id).unwrap();
        if !compatible(&read_manifest(&dir).unwrap()) { continue; }
        fs::write(dir.join(file), script).unwrap();
        let app: runner::EventSink = Arc::new(|_,_,_| {});
        runner::job(&app, &config, &id, "shell-locale", "run", Some("preview"), json!({"name":"World"}), flag()).await.unwrap();
    }
}
#[test]
fn saved_locale_drives_catalog_and_document_variants() {
    let (mut config, _) = fixture("python-example");
    let file = Path::new(&config.data_dir).join("config.json");
    let example: Value = serde_yaml::from_str(include_str!("../../examples/python-example/manifest.yaml")).unwrap();
    for (locale, name, title, path) in [
        ("en", "Python Example", "User guide", "README.md"),
        ("zh-CN", example["name"]["zh-CN"].as_str().unwrap(), example["docs"].as_array().unwrap().iter().find(|doc| doc["locale"] == "zh-CN").unwrap()["title"].as_str().unwrap(), "README.zh.md"),
    ] {
        config.locale = locale.into();
        write_json(&file, &config).unwrap();
        let persisted: Config = serde_json::from_value(read_json(&file)).unwrap();
        let tool = storage::list(&persisted).unwrap().pop().unwrap();
        assert_eq!(tool.manifest.name, name);
        let docs = &tool.manifest.docs;
        assert_eq!(docs.len(), 1);
        assert_eq!((&*docs[0].title, &*docs[0].path), (title, path));
        assert!(Path::new(&tool.directory).join(path).is_file());
    }
    let old: Config = serde_json::from_value(json!({"dataDir":"example"})).unwrap();
    assert_eq!(old.locale, crate::locale::system_locale());
}
