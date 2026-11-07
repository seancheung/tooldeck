mod locale;
mod model;
mod param_patch;
mod storage;
mod runner;
mod window_state;
mod run_logs;
#[cfg(test)] mod integration_tests;

use model::*;
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    config_file: PathBuf,
    config: Mutex<Config>,
    jobs: Mutex<HashMap<String, (String, String, Arc<AtomicBool>)>>,
}
impl AppState { fn config(&self) -> Result<Config> { Ok(self.config.lock().map_err(error)?.clone()) } }

#[tauri::command]
fn get_config(state: State<AppState>) -> Result<Config> { state.config() }
#[tauri::command]
fn clear_run_logs(state: State<AppState>) -> Result<usize> {
    let jobs = state.jobs.lock().map_err(error)?;
    if !jobs.is_empty() { return Err("Wait for running jobs before clearing logs".into()); }
    crate::run_logs::clear(&state.config()?)
}
#[tauri::command]
fn detect_runtimes() -> storage::Detection { storage::detect() }
#[tauri::command]
fn save_config(state: State<AppState>, config: Config) -> Result<Config> {
    if !state.jobs.lock().map_err(error)?.is_empty() { return Err("Wait for running jobs before changing settings".into()); }
    if !matches!(config.locale.as_str(), "en" | "zh-CN") { return Err("Unsupported display language".into()); }
    if !std::path::Path::new(&config.data_dir).is_absolute() { return Err("Data directory must be an absolute path".into()); }
    for path in [&config.node_path, &config.uv_path] { if !path.is_empty() && !std::path::Path::new(path).is_file() { return Err(format!("Executable does not exist: {path}")); } }
    std::fs::create_dir_all(std::path::Path::new(&config.data_dir).join("tools")).map_err(error)?;
    write_json(&state.config_file, &config)?;
    *state.config.lock().map_err(error)? = config.clone();
    Ok(config)
}
#[tauri::command]
fn list_tools(state: State<AppState>) -> Result<Vec<Tool>> { storage::list(&state.config()?) }
#[tauri::command]
fn read_tool_icon(state: State<AppState>, id: String) -> Result<Vec<u8>> {
    let dir = storage::tool_dir(&state.config()?, &id)?;
    let manifest = read_manifest(&dir)?;
    let icon = manifest.icon.ok_or("No tool icon configured")?;
    std::fs::read(dir.join(icon)).map_err(error)
}
#[tauri::command]
async fn import_tool(app: tauri::AppHandle, state: State<'_, AppState>, path: String, confirmation: Option<storage::ImportResult>) -> Result<storage::ImportResult> {
    let config = state.config()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let jobs = state.jobs.lock().map_err(error)?;
        if !jobs.is_empty() { return Err("Wait for running jobs before importing".into()); }
        match confirmation.as_ref() {
            Some(confirmed) => storage::import_zip_confirmed(&config, &path, Some(confirmed)),
            None => storage::import_zip(&config, &path),
        }
    }).await.map_err(error)?
}
#[tauri::command]
fn save_tool_settings(state: State<AppState>, id: String, settings: Value) -> Result<Value> {
    let dir = storage::tool_dir(&state.config()?, &id)?;
    let manifest = read_manifest(&dir)?;
    let settings = values(&manifest.settings, &settings, true)?;
    write_json(&dir.join(".tooldeck/settings.json"), &settings)?;
    Ok(settings)
}
#[tauri::command]
fn read_document(state: State<AppState>, id: String, document_id: String) -> Result<String> {
    let config = state.config()?;
    let dir = storage::tool_dir(&config, &id)?;
    let manifest = read_manifest_for(&dir, &config.locale)?;
    let doc = manifest.docs.iter().find(|d| d.id == document_id).ok_or("Document not found")?;
    std::fs::read_to_string(dir.join(&doc.path)).map_err(error)
}
#[tauri::command]
fn read_dependencies(state: State<AppState>, id: String) -> Result<Value> {
    let dir = storage::tool_dir(&state.config()?, &id)?;
    let manifest = read_manifest(&dir)?;
    match manifest.dependencies {
        Some(deps) => {
            let content = std::fs::read_to_string(dir.join(&deps.file)).map_err(error)?;
            Ok(serde_json::json!({"manager":deps.manager,"file":deps.file,"lockfile":deps.lockfile,"content":content}))
        }
        None => Ok(Value::Null),
    }
}
#[tauri::command]
fn open_target(app: tauri::AppHandle, target: String) -> Result<()> {
    if target.starts_with("http://") || target.starts_with("https://") { app.opener().open_url(target, None::<&str>).map_err(error) }
    else {
        let path = std::path::Path::new(&target);
        if !path.exists() { return Err("File or directory no longer exists".into()); }
        if path.is_file() { app.opener().reveal_item_in_dir(path).map_err(error) }
        else { app.opener().open_path(target, None::<&str>).map_err(error) }
    }
}
#[tauri::command]
fn cancel_job(state: State<AppState>, run_id: String) -> Result<()> {
    if let Some((_, _, flag)) = state.jobs.lock().map_err(error)?.get(&run_id) { flag.store(true, Ordering::SeqCst); }
    Ok(())
}
#[tauri::command]
async fn execute_job(app: tauri::AppHandle, state: State<'_, AppState>, id: String, run_id: String, operation: String, action_id: Option<String>, params: Option<Value>, form_overrides: Option<Value>) -> Result<String> {
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state.jobs.lock().map_err(error)?;
        if jobs.contains_key(&run_id) { return Err("Duplicate run ID".into()); }
        for (tool, active, _) in jobs.values() {
            if tool != &id { continue; }
            // Hooks may overlap each other and an action, but never an environment change.
            match (operation.as_str(), active.as_str()) {
                ("hook", "hook" | "run") | ("run", "hook") => (),
                _ => return Err("This tool is busy".into()),
            }
        }
        jobs.insert(run_id.clone(), (id.clone(), operation.clone(), flag.clone()));
    }
    let config = state.config()?;
    let sink: runner::EventSink = Arc::new(move |run, kind, payload| { let _ = app.emit("tooldeck:event", serde_json::json!({"runId":run,"type":kind,"payload":payload})); });
    let result = runner::job_with_form(&sink, &config, &id, &run_id, &operation, action_id.as_deref(), params.unwrap_or(serde_json::json!({})), form_overrides.unwrap_or(serde_json::json!({})), flag).await;
    state.jobs.lock().map_err(error)?.remove(&run_id);
    result
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            window_state::setup(app)?;
            let config_file = app.path().app_config_dir()?.join("config.json");
            let config = if config_file.exists() { serde_json::from_slice(&std::fs::read(&config_file)?)? } else {
                Config { show_output_timestamps: false, locale: locale::system_locale(), data_dir: app.path().app_data_dir()?.to_string_lossy().into(), node_path: String::new(), uv_path: String::new() }
            };
            app.manage(AppState { config_file, config: Mutex::new(config), jobs: Mutex::new(HashMap::new()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, clear_run_logs, detect_runtimes, save_config, list_tools, read_tool_icon, import_tool, save_tool_settings, read_document, read_dependencies, open_target, execute_job, cancel_job])
        .run(tauri::generate_context!())
        .expect("Unable to start ToolDeck");
}
