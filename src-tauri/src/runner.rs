use crate::{model::*, storage};
use serde_json::{json, Value};
use std::{path::Path, process::Stdio, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
pub type EventSink = Arc<dyn Fn(&str, &str, Value) + Send + Sync>;
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, net::TcpListener, process::Command};

fn emit(app: &EventSink, run: &str, kind: &str, payload: Value) { app(run, kind, payload); }
fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)] cmd.creation_flags(0x08000000);
    #[cfg(unix)] cmd.process_group(0);
    cmd.kill_on_drop(true);
    cmd
}
async fn capture(program: &str, args: &[&str]) -> Result<String> {
    let output = command(program).args(args).output().await.map_err(error)?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().into()); }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}
fn executable(config: &Config, kind: &str) -> Result<String> {
    let detected = storage::detect();
    match kind {
        "nodejs" => if config.node_path.is_empty() { detected.node } else { Some(config.node_path.clone()) },
        "uv" => if config.uv_path.is_empty() { detected.uv } else { Some(config.uv_path.clone()) },
        "powershell" => detected.powershell,
        "bash" => detected.bash,
        _ => None,
    }.ok_or(format!("{kind} was not found. Check the runtime path in app settings."))
}
async fn system_python(uv: &str, version: &str) -> Result<String> {
    // uv accepts a PEP 440 range; manifest ranges use space-separated comparators.
    let request = version.split_whitespace().collect::<Vec<_>>().join(",");
    capture(uv, &["python", "find", "--system", "--no-python-downloads", &request]).await
}
async fn check_version(program: &str, runtime: &Runtime) -> Result<()> {
    let text = if runtime.kind == "powershell" { capture(program, &["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]).await? } else { capture(program, &["--version"]).await? };
    let version = text.split(|c: char| !(c.is_ascii_digit() || c == '.')).find(|s| s.matches('.').count() >= 2).ok_or(format!("Unrecognized runtime version: {text}"))?;
    if !version_matches(version, &runtime.version)? { return Err(format!("Installed {0} {version} does not satisfy {1}", runtime.kind, runtime.version)); }
    Ok(())
}
async fn terminate(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)] { let _ = command("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output().await; }
        #[cfg(unix)] unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}
async fn process(mut cmd: Command, app: &EventSink, run: &str, flag: Arc<AtomicBool>, timeout: u64) -> Result<()> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(error)?;
    let stdout = child.stdout.take().unwrap(); let stderr = child.stderr.take().unwrap();
    let app1 = app.clone(); let run1 = run.to_owned();
    let out = tokio::spawn(async move { let mut lines = BufReader::new(stdout).lines(); while let Ok(Some(line)) = lines.next_line().await { emit(&app1, &run1, "log", json!({"message":line,"level":"info"})); } });
    let app2 = app.clone(); let run2 = run.to_owned();
    let err = tokio::spawn(async move { let mut lines = BufReader::new(stderr).lines(); while let Ok(Some(line)) = lines.next_line().await { emit(&app2, &run2, "log", json!({"message":line,"level":"warning"})); } });
    let started = Instant::now();
    let status = loop {
        if flag.load(Ordering::SeqCst) { terminate(&mut child).await; break Err("Cancelled".into()); }
        if timeout > 0 && started.elapsed().as_secs() >= timeout { terminate(&mut child).await; break Err("Run timed out".into()); }
        if let Some(status) = child.try_wait().map_err(error)? { break if status.success() { Ok(()) } else { Err(format!("Process exited with code {0}", status.code().unwrap_or(-1))) }; }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    // Flush ordinary output before reporting completion.
    let _ = tokio::time::timeout(Duration::from_secs(2), out).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), err).await;
    status
}
async fn npm_command(config: &Config, dir: &Path) -> Result<Command> {
    let node = executable(config, "nodejs")?;
    let parent = Path::new(&node).parent().ok_or("Invalid Node.js path")?;
    let candidates = [parent.join("node_modules/npm/bin/npm-cli.js"), parent.join("../lib/node_modules/npm/bin/npm-cli.js")];
    let cli = candidates.into_iter().find(|p| p.is_file()).or_else(|| which::which("npm").ok().and_then(|p| p.canonicalize().ok()).filter(|p| p.extension().is_some_and(|e| e == "js")) ).ok_or("npm-cli.js was not found. Select a Node.js installation with npm.")?;
    let mut cmd = command(&node); cmd.arg(cli).current_dir(dir);
    let mut paths = vec![parent.to_path_buf()]; paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    cmd.env("PATH", std::env::join_paths(paths).map_err(error)?);
    Ok(cmd)
}
#[cfg(test)]
pub async fn job(app: &EventSink, config: &Config, id: &str, run: &str, operation: &str, action_id: Option<&str>, params: Value, flag: Arc<AtomicBool>) -> Result<String> {
    job_with_form(app, config, id, run, operation, action_id, params, json!({}), flag).await
}
pub async fn job_with_form(app: &EventSink, config: &Config, id: &str, run: &str, operation: &str, action_id: Option<&str>, params: Value, overrides: Value, flag: Arc<AtomicBool>) -> Result<String> {
    // Deleting logs must not create a new log for the deletion itself.
    if operation == "delete" { return job_inner(app, config, id, run, operation, action_id, params, overrides, flag).await; }
    let log = Arc::new(crate::run_logs::RunLog::new(config)?);
    log.record(run, "started", &json!({"toolId":id,"operation":operation,"actionId":action_id}));
    let downstream = app.clone();
    let writer = log.clone();
    let sink: EventSink = Arc::new(move |run, kind, payload| {
        if kind != "updateParams" { writer.record(run, kind, &payload); }
        downstream(run, kind, payload);
    });
    let result = job_inner(&sink, config, id, run, operation, action_id, params, overrides, flag).await;
    let status = match &result { Ok(_) => "success", Err(e) if e == "Cancelled" => "cancelled", Err(_) => "error" };
    log.record(run, "finished", &json!({"status":status,"message":result.as_ref().map(|v| v.as_str()).unwrap_or_else(|e| e.as_str())}));
    log.finish()?;
    result
}

struct RunTemp(std::path::PathBuf);
impl Drop for RunTemp {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

async fn job_inner(app: &EventSink, config: &Config, id: &str, run: &str, operation: &str, action_id: Option<&str>, params: Value, overrides: Value, flag: Arc<AtomicBool>) -> Result<String> {
    let dir = storage::tool_dir(config, id)?;
    if operation == "delete" {
        let options = if params.is_null() { storage::DeleteOptions::default() } else { serde_json::from_value(params).map_err(error)? };
        let config = config.clone(); let id = id.to_owned();
        tauri::async_runtime::spawn_blocking(move || storage::delete(&config, &id, options)).await.map_err(error)??;
        return Ok("Deleted".into());
    }
    let m = read_manifest_for(&dir, &config.locale)?;
    if operation == "uninstall" {
        emit(app, run, "log", json!({"message":crate::locale::host_text(&config.locale, "Removing dependencies and virtual environment…"),"level":"info"}));
        let c = config.clone(); let id = id.to_owned();
        tauri::async_runtime::spawn_blocking(move || storage::uninstall(&c, &id)).await.map_err(error)??;
        return Ok("Environment uninstalled. Tool files and settings were retained.".into());
    }
    if !compatible(&m) { return Err("This tool does not support the current platform or architecture".into()); }
    if operation == "install" {
        let marker = dir.join(".tooldeck/installed.json");
        if marker.exists() { std::fs::remove_file(&marker).map_err(error)?; }
        if m.runtime.kind == "python" {
            let uv = executable(config, "uv")?;
            let interpreter = python_venv(&dir);
            if !interpreter.is_file() || !dir.join(".venv/pyvenv.cfg").is_file() {
                let base = system_python(&uv, &m.runtime.version).await?;
                check_version(&base, &m.runtime).await?;
                emit(app, run, "log", json!({"message":crate::locale::host_text(&config.locale, "Creating Python environment .venv"),"level":"info"}));
                let mut cmd = command(&uv);
                cmd.args(["venv", "--python", &base, "--no-python-downloads"])
                    .arg(dir.join(".venv")).current_dir(&dir);
                process(cmd, app, run, flag.clone(), 0).await?;
            }
            let path = interpreter.to_string_lossy();
            check_version(&path, &m.runtime).await?;
            if let Some(deps) = &m.dependencies {
                let mut cmd = command(&uv);
                cmd.args(["pip", "install", "--python"]).arg(&interpreter)
                    .arg("-r").arg(&deps.file).current_dir(&dir);
                process(cmd, app, run, flag, 0).await?;
            }
            write_json(&marker, &json!({"version":m.version,"runtime":"python","python":path}))?;
        } else if let Some(deps) = &m.dependencies {
            check_version(&executable(config, "nodejs")?, &m.runtime).await?;
            let mut cmd = npm_command(config, &dir).await?;
            cmd.arg(if deps.lockfile.is_some() { "ci" } else { "install" }).args(["--no-audit", "--no-fund"]);
            process(cmd, app, run, flag, 0).await?;
            std::fs::create_dir_all(dir.join("node_modules")).map_err(error)?;
            write_json(&marker, &json!({"version":m.version,"runtime":m.runtime.kind}))?;
        }
        return Ok("Installation completed".into());
    }
    if operation != "run" && operation != "hook" { return Err("Unknown operation".into()); }
    let action_id = action_id.ok_or("Select an action")?;
    let action = m.actions.get(action_id).ok_or("Action not found")?;
    if !storage::is_installed(&dir, &m) { return Err("Install the tool environment first".into()); }
    let fields = action.get("params").and_then(Value::as_object).cloned().unwrap_or_default();
    let effective = crate::param_patch::form_fields(&fields, &overrides)?;
    let (entry_name, event, params) = if operation == "hook" {
        let hook = params["hookId"].as_str().and_then(|id| m.hooks.get(id)).ok_or("Hook not found")?;
        if params["event"].as_str().unwrap_or("paramsChange") != hook.event { return Err("Hook event mismatch".into()); }
        let mut event = json!({"type":hook.event});
        if hook.event == "paramsChange" {
            let keys = params["changedKeys"].as_array().ok_or("Missing changedKeys")?;
            if keys.is_empty() || keys.iter().any(|k| k.as_str().is_none_or(|s| !fields.contains_key(s))) ||
                hook.param_keys.as_ref().is_some_and(|watch| !keys.iter().any(|k| watch.iter().any(|w| k.as_str() == Some(w)))) {
                return Err("Hook does not match these parameters".into());
            }
            event["changedKeys"] = keys.clone().into();
        }
        (hook.entry.as_str(), Some(event), values(&effective, &params["values"], false)?)
    } else {
        (action["entry"].as_str().ok_or("Action is missing its entry")?, None, values(&effective, &params, true)?)
    };
    let settings = values(&m.settings, &read_json(&dir.join(".tooldeck/settings.json")), event.is_none())?;
    let runtime = if m.runtime.kind == "python" { python_venv(&dir).to_string_lossy().into_owned() } else { executable(config, &m.runtime.kind)? };
    check_version(&runtime, &m.runtime).await?;
    let temporary = RunTemp(std::env::temp_dir().join(format!("tooldeck-run-{}", uuid::Uuid::new_v4())));
    let data = Path::new(&config.data_dir).join("data").join(id);
    let temp = &temporary.0;
    for p in [&data, temp] { std::fs::create_dir_all(p).map_err(error)?; }
    let mut context = json!({"locale":config.locale,"apiVersion":"1.0.0","runId":run,"toolId":id,"toolVersion":m.version,"actionId":action_id,"params":params,"settings":settings,"paths":{"tool":dir,"data":data,"temp":temp}});
    if let Some(event) = &event { context["hookEvent"] = event.clone(); }
    let entry = dir.join(entry_name);
    let mut cmd = command(&runtime); cmd.current_dir(&dir);
    for (key,_) in std::env::vars_os() { if key.to_string_lossy().to_ascii_uppercase().starts_with("TOOLDECK_") { cmd.env_remove(key); } }
    if m.runtime.kind == "python" {
        let mut paths = vec![Path::new(&runtime).parent().unwrap().to_path_buf()];
        paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
        cmd.env("VIRTUAL_ENV", dir.join(".venv")).env("PATH", std::env::join_paths(paths).map_err(error)?)
            .env_remove("PYTHONHOME").env_remove("PYTHONPATH");
    }
    let mut ipc = None;
    if matches!(m.runtime.kind.as_str(), "python"|"nodejs") {
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(error)?;
        let port = listener.local_addr().map_err(error)?.port();
        let host_dir = temp;
        let (name, source) = if m.runtime.kind == "python" { ("python_host.py", include_str!("../hosts/python_host.py")) } else { ("node_host.mjs", include_str!("../hosts/node_host.mjs")) };
        let host = host_dir.join(name); std::fs::write(&host, source).map_err(error)?;
        cmd.arg(host).arg(&entry).arg(port.to_string()).env("PYTHONUTF8", "1").env("PYTHONUNBUFFERED", "1");
        let app = app.clone(); let run = run.to_owned();
        ipc = Some(tokio::spawn(async move {
            let (mut socket,_) = tokio::time::timeout(Duration::from_secs(15), listener.accept()).await.map_err(error)?.map_err(error)?;
            socket.write_all(format!("{}\n", context).as_bytes()).await.map_err(error)?;
            let (reader, mut writer) = socket.into_split(); let mut lines = BufReader::new(reader).lines();
            let mut seq = 0u64;
            while let Some(line) = lines.next_line().await.map_err(error)? {
                let event: Value = serde_json::from_str(&line).map_err(error)?;
                seq += 1;
                if event["runId"] != run || event["seq"] != seq { return Err("Invalid ctx event sequence".into()); }
                let kind = event["type"].as_str().ok_or("Event is missing type")?;
                if kind == "updateParams" {
                    let valid = crate::param_patch::validate_patch(&fields, &event["payload"]);
                    if let Err(message) = valid {
                        writer.write_all(format!("error: {message}\n").as_bytes()).await.map_err(error)?;
                        return Err(message);
                    }
                }
                if kind == "clearOutput" && !event["payload"].is_null() {
                    writer.write_all(b"error: clearOutput takes no arguments\n").await.map_err(error)?;
                    return Err("clearOutput takes no arguments".into());
                }
                emit(&app, &run, kind, event["payload"].clone());
                writer.write_all(b"ok\n").await.map_err(error)?;
            }
            Ok::<(), String>(())
        }));
    } else {
        if m.runtime.kind == "powershell" { cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-File"]); }
        else { cmd.args(["--noprofile", "--norc"]); }
        cmd.arg(entry);
        if let Some(event) = &event { cmd.env("TOOLDECK_EVENT", event.to_string()); }
        for (prefix, values) in [("TOOLDECK_PARAM_", &params), ("TOOLDECK_SETTING_", &settings)] {
            for (key,value) in values.as_object().unwrap() { cmd.env(format!("{prefix}{}", key.to_ascii_uppercase()), value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string())); }
        }
        for (key,value) in [("LOCALE",config.locale.as_str()),("API_VERSION","1.0.0"),("RUN_ID",run),("TOOL_ID",id),("TOOL_VERSION",&m.version),("ACTION_ID",action_id)] { cmd.env(format!("TOOLDECK_{key}"), value); }
        for (key,path) in [("TOOL",&dir),("DATA",&data),("TEMP",temp)] { cmd.env(format!("TOOLDECK_{key}_DIR"), path); }
    }
    if event.is_none() { emit(app, run, "log", json!({"message":format!("{} · {}", crate::locale::host_text(&config.locale, "Starting"), action["name"].as_str().unwrap_or(action_id)),"level":"info"})); }
    let timeout = if event.is_some() { 30 } else { action["execution"]["timeoutSeconds"].as_u64().unwrap_or(0) };
    let result = process(cmd, app, run, flag, timeout).await;
    if let Some(mut ipc) = ipc {
        if result.is_err() { ipc.abort(); } else {
            match tokio::time::timeout(Duration::from_secs(5), &mut ipc).await { Ok(joined) => joined.map_err(error)??, Err(_) => { ipc.abort(); return Err("The ctx event channel did not close normally".into()); } }
        }
    }
    result?;
    Ok("Run completed".into())
}
