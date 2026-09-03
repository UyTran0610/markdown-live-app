<div align="center">

# Markdown Live

Trình soạn thảo Markdown hai chiều thời gian thực hoạt động độc lập, ngoại tuyến (Offline-first) được đóng gói trên nền tảng Tauri v2.

[![Tauri Version](https://img.shields.io/badge/Tauri-v2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021_Edition-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![JavaScript](https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows_x64-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

</div>

---

## Tổng quan kiến trúc

Markdown Live được thiết kế với mục tiêu tối ưu hiệu năng bộ nhớ và tốc độ phản hồi. Ứng dụng sử dụng kiến trúc hybrid:
- **Core Runtime:** Tauri v2 (Rust backend) đảm bảo kích thước binary nhỏ gọn, quản lý clipboard native và API hệ thống với mức tiêu hao tài nguyên thấp.
- **Frontend Layer:** Hoàn toàn bằng Vanilla JavaScript/HTML5/CSS3. Không sử dụng Single Page Application (SPA) framework nặng nề, toàn bộ dependencies thư viện được lưu trữ cục bộ (`vendor/`), không phụ thuộc mạng CDN ngoài.

> [!NOTE]
> Ứng dụng chạy hoàn toàn offline. Mọi quá trình parse Markdown, biên dịch công thức Toán học KaTeX và vẽ biểu đồ Mermaid đều được thực thi trực tiếp tại Webview client-side.

---

## Tính năng kỹ thuật

- **Dual-Pane Bidirectional Sync:** Soạn thảo song song cùng màn hình render với độ trễ gần như bằng 0.
- **GFM Alert Specifications:** Tương thích chuẩn Markdown Alerts của GitHub (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`).
- **LaTeX Math Rendering:** Tích hợp KaTeX parser cho công thức nội dòng (`$...$`) và dạng khối (`$$...$$`).
- **Diagrams as Code:** Tích hợp Mermaid.js engine biên dịch biểu đồ luồng (Flowchart), biểu đồ tuần tự (Sequence), biểu đồ quan hệ (ERD).
- **Code Syntax Highlighting:** Tự động phát hiện và định dạng mã nguồn đa ngôn ngữ thông qua Highlight.js.
- **Dynamic Syntax Overlay:** Khung textarea được xử lý đồng bộ màu cú pháp Markdown trực tiếp.
- **Vector PDF Print Engine:** Khả năng trích xuất PDF dạng vector (văn bản giữ nguyên khả năng highlight/copy, không bị rasterize thành ảnh).

---

## Công nghệ sử dụng

| Phân hệ | Công nghệ / Thư viện | Vai trò |
| :--- | :--- | :--- |
| **Backend Core** | Tauri v2, Rust | Quản trị cửa sổ, Clipboard Manager, Opener Plugin |
| **Markdown Parser**| Marked.js + DOMPurify | Phân tích cú pháp Markdown và lọc XSS an toàn |
| **Mathematics** | KaTeX + marked-katex-extension | Xử lý công thức Toán học TeX/LaTeX |
| **Diagram Engine** | Mermaid.js | Render biểu đồ từ cú pháp khai báo |
| **Code Engine** | Highlight.js | Tô màu cú pháp khối mã lệnh |
| **Iconography** | Lucide Icons | Hệ thống icon giao diện người dùng |

---

## Hướng dẫn xuất PDF chuẩn Vector

> [!IMPORTANT]
> **Cấu hình Print Engine của hệ thống:**
> Để bản in hoặc file xuất PDF giữ nguyên toàn bộ nền màu, định dạng Alert Callouts và khối mã nguồn:
> 1. Trong hộp thoại in của hệ thống (Print Dialog), mở rộng danh mục **More settings (Cài đặt khác)**.
> 2. Bật tùy chọn **Background graphics (Đồ họa nền)**.

---

## Giấy phép

Phát hành dưới giấy phép [MIT](LICENSE).