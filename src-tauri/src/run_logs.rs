use crate::model::{error, Config, Result};
use serde_json::{json, Value};
use std::{fs::{self, File}, io::Write, path::Path, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};

pub struct RunLog(Mutex<(File, Option<String>)>);
impl RunLog {
    pub fn new(config: &Config) -> Result<Self> {
        let dir = Path::new(&config.data_dir).join("logs");
        fs::create_dir_all(&dir).map_err(error)?;
        let file = File::options().write(true).create_new(true)
            .open(dir.join(format!("{}.jsonl", uuid::Uuid::new_v4()))).map_err(error)?;
        Ok(Self(Mutex::new((file, None))))
    }
    pub fn record(&self, run: &str, kind: &str, payload: &Value) {
        let mut state = self.0.lock().unwrap();
        let event = json!({"timestampMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
            "runId": run, "type": kind, "payload": payload});
        if let Err(e) = writeln!(state.0, "{event}") { state.1 = Some(e.to_string()); }
    }
    pub fn finish(&self) -> Result<()> {
        let mut state = self.0.lock().map_err(error)?;
        state.0.flush().map_err(error)?;
        if let Some(e) = &state.1 { return Err(format!("Could not save run log: {e}")); }
        Ok(())
    }
}

pub fn clear(config: &Config) -> Result<usize> {
    let dir = Path::new(&config.data_dir).join("logs");
    if !dir.exists() { return Ok(0); }
    let base = Path::new(&config.data_dir).canonicalize().map_err(error)?;
    if dir.canonicalize().map_err(error)? != base.join("logs") { return Err("The log directory cannot be an external link".into()); }
    let mut count = 0;
    for entry in fs::read_dir(dir).map_err(error)? {
        let entry = entry.map_err(error)?;
        let path = entry.path();
        if entry.file_type().map_err(error)?.is_file() && path.extension().is_some_and(|e| e == "jsonl")
            && path.file_stem().and_then(|s| s.to_str()).is_some_and(|s| uuid::Uuid::parse_str(s).is_ok()) {
            fs::remove_file(path).map_err(error)?;
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_and_clears_only_host_logs() {
        let root = std::env::temp_dir().join(format!("tooldeck-logs-test-{}", uuid::Uuid::new_v4()));
        let config = Config { locale: "en".into(), data_dir: root.to_string_lossy().into(), node_path: String::new(), uv_path: String::new() };
        let log = RunLog::new(&config).unwrap();
        log.record("run", "finished", &json!({"status":"cancelled"}));
        log.finish().unwrap(); drop(log);
        let file = fs::read_dir(root.join("logs")).unwrap().next().unwrap().unwrap().path();
        let event: Value = serde_json::from_str(fs::read_to_string(file).unwrap().trim()).unwrap();
        assert_eq!(event["payload"]["status"], "cancelled");
        fs::write(root.join("logs/keep.txt"), "keep").unwrap();
        assert_eq!(clear(&config).unwrap(), 1);
        assert!(root.join("logs/keep.txt").exists());
        assert_eq!(clear(&config).unwrap(), 0);
        fs::remove_dir_all(root).unwrap();
    }
}
