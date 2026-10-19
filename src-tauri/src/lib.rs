use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// argv của instance ĐẦU TIÊN (double-click .md khi app chưa chạy); callback single-instance chỉ chạy
// ở instance THỨ HAI nên không có state này là mất đường dẫn.
#[derive(Default)]
struct InitialPaths(Mutex<Vec<String>>);

// Phần tử đầu của argv là đường dẫn app; cờ webview bắt đầu bằng '-'.
fn file_args<I: IntoIterator<Item = String>>(argv: I) -> Vec<String> {
    argv.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect()
}

// Frontend hỏi một lần sau khi restore; std::mem::take nên gọi lại không mở trùng.
#[tauri::command]
fn take_initial_paths(state: State<'_, InitialPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // PHẢI đăng ký trước mọi plugin: nếu không, hai cửa sổ cùng ghi đè một session IndexedDB.
        // Instance thứ hai gửi argv sang instance đầu rồi thoát.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = file_args(argv);
            if let Some(window) = app.get_webview_window("main") {
                // set_focus() không bật được cửa sổ đang thu nhỏ: phải unminimize + show trước.
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                if !paths.is_empty() {
                    let _ = window.emit("open-paths", paths);
                }
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        // dialog + fs: hộp thoại Save As và ghi file cho Import/Export.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // manage() TRƯỚC setup(): setup ghi argv của instance đầu vào state này.
        .manage(InitialPaths::default())
        .invoke_handler(tauri::generate_handler![greet, take_initial_paths])
        .setup(|app| {
            let paths = file_args(std::env::args());
            if !paths.is_empty() {
                *app.state::<InitialPaths>().0.lock().unwrap() = paths;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
