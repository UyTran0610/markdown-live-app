use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

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

// Đuôi file app được phép duyệt — phải chứa hết MARKDOWN_EXTS trong js/io/documents.js.
// Ranh giới duy nhất của lệnh webview gọi được: không mở được file nhị phân.
const TEXT_EXTS: [&str; 9] = [
    "md", "markdown", "mdown", "mkd", "mdx", "rmd", "qmd", "txt", "text",
];

// File tạm cạnh file gốc khi ghi atomic (khớp TMP_SUFFIX trong js/export/file-save.js).
const TMP_SUFFIX: &str = ".md-live.tmp";

// Duyệt path cho fs plugin: thêm vào runtime scope (đọc + ghi).
fn allow_path(app: &AppHandle, path: &str) -> bool {
    app.fs_scope().allow_file(path).is_ok()
}

// Đuôi văn bản, hoặc không đuôi (README, LICENSE) — khớp isMarkdownPath() bên JS:
// tên file không đuôi, hoặc bắt đầu bằng '.', được coi là văn bản; còn lại đuôi sau dấu '.'
// cuối cùng phải nằm trong TEXT_EXTS (nên "a.md.bak" và "trailing." đều bị từ chối).
fn has_text_ext(path: &str) -> bool {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();
    match name.rfind('.') {
        None | Some(0) => !name.is_empty(),
        Some(i) => TEXT_EXTS.contains(&&name[i + 1..]),
    }
}

// Webview xin duyệt file để đọc/ghi (session, Recent, kéo-thả): Rust kiểm file có thật
// và là file văn bản. Lệnh này TIN webview — mọi file văn bản tồn tại do webview nêu
// đều được duyệt, nên ranh giới tin cậy là webview (DOMPurify), không phải danh sách đuôi.
#[tauri::command]
fn allow_text_files(app: AppHandle, paths: Vec<String>) -> usize {
    let mut allowed = 0;
    for path in &paths {
        if Path::new(path).is_file() && has_text_ext(path) && allow_path(&app, path) {
            allowed += 1;
        }
    }
    allowed
}

// File .tmp cạnh file gốc: chỉ duyệt khi file gốc ĐÃ nằm trong scope.
#[tauri::command]
fn allow_temp_sibling(app: AppHandle, path: String) -> bool {
    let scope = app.fs_scope();
    if !scope.is_allowed(&path) {
        return false;
    }
    scope.allow_file(format!("{path}{TMP_SUFFIX}")).is_ok()
}

// Windows: WebView2 tự xử lý phím trình duyệt (Ctrl+F mở thanh tìm của trình duyệt) và
// phím KHÔNG xuống web, nên app không nhận được Ctrl+F. Tắt cờ đó để phím tắt tìm kiếm
// của app hoạt động. wry có sẵn `with_browser_accelerator_keys` nhưng Tauri chưa truyền qua
// (tauri#16306), nên gọi thẳng COM của WebView2.
#[cfg(windows)]
fn release_browser_accelerator_keys(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let _ = window.with_webview(move |webview| unsafe {
        let settings = webview.controller().CoreWebView2().and_then(|core| core.Settings());
        if let Ok(settings) = settings {
            if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // PHẢI đăng ký trước mọi plugin: nếu không, hai cửa sổ cùng ghi đè một session IndexedDB.
        // Instance thứ hai gửi argv sang instance đầu rồi thoát.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = file_args(argv);
            // Instance thứ hai mở file: duyệt scope ngay, không chờ webview.
            for path in &paths {
                allow_path(app, path);
            }
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
        // Windows 11: HWND trong suốt phủ nút maximize, vì WebView2 chặn WM_NCHITTEST của cửa sổ.
        .plugin(tauri_plugin_snap_layout::init().button_id("win-max").build())
        .plugin(tauri_plugin_opener::init())
        // dialog + fs: hộp thoại Save As và ghi file cho Import/Export.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // manage() TRƯỚC setup(): setup ghi argv của instance đầu vào state này.
        .manage(InitialPaths::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            take_initial_paths,
            allow_text_files,
            allow_temp_sibling
        ])
        .setup(|app| {
            let paths = file_args(std::env::args());
            if !paths.is_empty() {
                // File association: OS mở app với file cụ thể -> duyệt scope ngay.
                for path in &paths {
                    allow_path(app.handle(), path);
                }
                *app.state::<InitialPaths>().0.lock().unwrap() = paths;
            }
            // Nhả Ctrl+F cho web để widget tìm kiếm của app nhận được phím.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                release_browser_accelerator_keys(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::has_text_ext;

    #[test]
    fn only_text_extensions_pass() {
        assert!(has_text_ext("C:\\notes\\a.md"));
        assert!(has_text_ext("C:\\notes\\a.MDX"));
        assert!(has_text_ext("C:\\notes\\README"));
        assert!(has_text_ext("C:\\notes\\.md"));
        assert!(!has_text_ext("C:\\notes\\a.exe"));
        assert!(!has_text_ext("C:\\notes\\a.md.bak"));
        // Tên kết thúc bằng dấu chấm: JS cũng từ chối, phải khớp.
        assert!(!has_text_ext("C:\\notes\\trailing."));
        assert!(!has_text_ext("C:\\notes\\"));
    }
}
