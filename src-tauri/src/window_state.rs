use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

#[derive(Serialize, Deserialize)]
struct WindowState {
    width: f64,
    height: f64,
    maximized: bool,
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else { return Ok(()); };
    let path = app.path().app_config_dir()?.join("window-state.json");
    let mut saved = std::fs::read(&path).ok()
        .and_then(|bytes| serde_json::from_slice::<WindowState>(&bytes).ok())
        .filter(|state| state.width.is_finite() && state.height.is_finite() && state.width > 0.0 && state.height > 0.0)
        .unwrap_or(WindowState { width: 1440.0, height: 1024.0, maximized: false });
    saved.width = saved.width.max(1040.0);
    saved.height = saved.height.max(720.0);
    window.set_size(tauri::LogicalSize::new(saved.width, saved.height))?;
    if saved.maximized { window.maximize()?; }
    let state = Mutex::new(saved);
    let handle = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. }) { return; }
        let Ok(mut state) = state.lock() else { return; };
        if !handle.is_minimized().unwrap_or(false) {
            state.maximized = handle.is_maximized().unwrap_or(state.maximized);
            if !state.maximized && !handle.is_fullscreen().unwrap_or(false) {
                if let (Ok(size), Ok(scale)) = (handle.inner_size(), handle.scale_factor()) {
                    let size = size.to_logical::<f64>(scale);
                    if size.width >= 1040.0 && size.height >= 720.0 {
                        state.width = size.width;
                        state.height = size.height;
                    }
                }
            }
        }
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            if let Err(error) = crate::model::write_json(&path, &*state) {
                eprintln!("Could not save window size: {error}");
            }
        }
    });
    window.show()?;
    Ok(())
}
