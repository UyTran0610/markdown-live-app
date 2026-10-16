// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{Emitter, Manager};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // PHẢI đăng ký trước mọi plugin khác, nếu không nó không kịp giành quyền làm tiến trình
        // duy nhất và hai cửa sổ sẽ cùng ghi đè một phiên làm việc trong IndexedDB.
        // Tiến trình thứ hai (do double-click file .md khi app đang chạy) đưa đường dẫn trong argv
        // rồi thoát; ta bắn sang tiến trình đầu để nó mở thành tab.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths: Vec<String> = argv
                .iter()
                .skip(1)
                .filter(|arg| !arg.starts_with('-'))
                .cloned()
                .collect();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                if !paths.is_empty() {
                    let _ = window.emit("open-paths", paths);
                }
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        // dialog + fs: phục vụ Import/Export file (hộp thoại Save As và ghi file ra máy)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
