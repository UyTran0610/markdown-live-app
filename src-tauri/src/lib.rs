// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Đường dẫn file mà OS đưa cho instance ĐẦU TIÊN (double-click file .md khi app chưa chạy).
// Callback của single-instance chỉ chạy ở instance THỨ HAI, nên không có state này thì argv của lần
// khởi động đầu bị bỏ đi và double-click chẳng mở được file nào — trong khi tauri.conf.json đã đăng
// ký file association cho .md/.markdown/.mdown/.mkd/.txt.
#[derive(Default)]
struct InitialPaths(Mutex<Vec<String>>);

// Phần tử đầu của argv là đường dẫn của chính app; các cờ của webview bắt đầu bằng '-'.
fn file_args<I: IntoIterator<Item = String>>(argv: I) -> Vec<String> {
    argv.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect()
}

// Frontend hỏi đúng một lần sau khi khôi phục session xong. std::mem::take nên gọi lại cũng không mở
// trùng tab cũ.
#[tauri::command]
fn take_initial_paths(state: State<'_, InitialPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // PHẢI đăng ký trước mọi plugin khác, nếu không nó không kịp giành quyền làm tiến trình
        // duy nhất và hai cửa sổ sẽ cùng ghi đè một phiên làm việc trong IndexedDB.
        // Tiến trình thứ hai (do double-click file .md khi app đang chạy) đưa đường dẫn trong argv
        // rồi thoát; ta bắn sang tiến trình đầu để nó mở thành tab.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = file_args(argv);
            if let Some(window) = app.get_webview_window("main") {
                // Cửa sổ đang thu nhỏ thì set_focus() một mình không bật nó lên được: người dùng
                // double-click file và không thấy gì xảy ra.
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
        // dialog + fs: phục vụ Import/Export file (hộp thoại Save As và ghi file ra máy)
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
