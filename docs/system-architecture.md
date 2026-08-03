# Kiến Trúc Hệ Thống (System Architecture)

Dự án này sử dụng kiến trúc hai runtime riêng biệt (Two-Runtime Split) để cân bằng giữa bảo mật, khả năng tác vụ nặng và giao diện tương tác Live2D (Companion).

## 1. Kiến Trúc Hai Runtime (Two-Runtime Architecture)

### 1.1. TypeScript Agent Runtime (`src/`)
- **Vai trò:** Lõi xử lý AI, lập kế hoạch tác vụ (Planning), cấp quyền (Permission), gọi công cụ (Function Calling / MCP Tools) và xử lý RAG.
- **Công nghệ:** TypeScript, Electron backend (`src/main/`), React frontend (`src/renderer/`).
- **Bảo mật:** Cách ly khỏi các quyền không an toàn. Mọi tool file-system và shell đều bị giới hạn bởi quyền (read-only, scoped, per-action) cấu hình qua `permission.ts`.

### 1.2. JavaScript Companion Runtime (`main.js` & `cyrene_companion.html`)
- **Vai trò:** Giao diện Waifu xuyên thấu (overlay), xử lý biểu cảm Live2D, trò chuyện idle (Idle Thoughts), và nhận thức ngữ cảnh liên tục (Sensory Loop - âm thanh, cửa sổ hiện hành).
- **Công nghệ:** Vanilla JS, PixiJS, Electron BrowserWindow độc lập.
- **Polling:** Thực hiện vòng lặp PowerShell để đọc hệ thống mà không cản trở lõi Agent, giao tiếp ngược lại bằng IPC (system-audio-changed, vv.).
- **Giới hạn:** Companion không có quyền gọi MCP hay thay đổi tệp, chỉ có quyền chat và giao tiếp UI.

## 2. Tổng Quan Công Nghệ (Tech Stack)
Dự án Cyrene Companion sử dụng kiến trúc Desktop App chạy nền với các công nghệ sau:
- **Core:** Electron.js (Giao diện trong suốt, xuyên thấu, không viền).
- **Backend IPC:** Node.js (Quản lý window, phím tắt toàn cục, tương tác OS).
- **Đồ họa Live2D:** PixiJS kết hợp với `pixi-live2d-display` (Render mô hình 2D động).
- **Mô Hình AI (LLM):** Ollama chạy local (Model: `llama3.1`). Tương tác qua REST API `http://localhost:11434/api/chat`.
- **Giao diện UI/UX:** HTML, CSS, Vanilla JavaScript.

## 3. Luồng Xử Lý (Workflow & Logic Flow)

### 3.1. Vòng lặp nhận thức ngữ cảnh (Sensory Loop)
- **Audio & Active Window Tracker:** Mỗi 5 giây, `main.js` gọi script PowerShell `get_active_window.ps1` và `get_audio_sessions.ps1` (chạy độc lập với timeout chống treo) để lấy thông tin hệ thống và gửi xuống Renderer qua IPC (`active-window-changed` và `system-audio-changed`). Mọi cập nhật chỉ được gửi khi trạng thái thực sự thay đổi.
- **Thời gian & Thời tiết:** Renderer liên tục cập nhật giờ địa phương (UTC+7, Việt Nam) và gọi API lấy thời tiết 30 phút/lần.
- Tất cả thông tin này hợp nhất thành `SensoryContext` mỗi khi gọi AI.

### 3.2. Vòng lặp tương tác tự động (Idle Thoughts Loop)
- Renderer duy trì một biến `lastInteractionTime`.
- Mỗi 30 giây, hệ thống kiểm tra nếu người dùng không tương tác trong vòng **120 giây**, AI sẽ tự bốc 1 kịch bản từ `IDLE_PROMPT_POOL` và gửi request lên Ollama.
- Kết quả được in ra bong bóng thoại (Dialogue Bubble) mà không đưa vào lịch sử chat chính để tránh làm tràn Context.

### 3.3. Trí nhớ dài hạn & ngắn hạn (Memory System)
- **Short-term Memory:** `conversationHistory` giới hạn ở 20 đoạn hội thoại gần nhất. Nó chỉ chứa nội dung Text thuần, không chứa định dạng JSON thô.
- **Long-term Memory:** Module `MemorySystem` quản lý tối đa 30 Facts (Sự kiện/Thói quen của người dùng). Dữ liệu được serialize vào `localStorage`. Khi đầy, nó xóa cái cũ nhất (FIFO).
- Khi gọi Ollama, LLM được yêu cầu trích xuất "new_facts_learned" nếu có điều gì mới từ người dùng.

## 4. Tối ưu Hiệu Năng (Performance Architecture)
- **Ignore Mouse Events:** Electron window được cài đặt cơ chế `setIgnoreMouseEvents` linh hoạt. Khi con trỏ không nhắm vào Cyrene hay bảng chat, event chuột xuyên qua cửa sổ tới OS, giúp người dùng không bị vướng khi chơi game.
- **Tắt Hardware Acceleration:** Được tắt ở `main.js` để đảm bảo độ trong suốt hoạt động mượt trên mọi cấu hình Windows.
- **Render Loop:** PixiJS được tối ưu để chỉ vẽ mô hình, hạn chế DOM reflow.

## 5. Giao Tiếp Llama (JSON Prompting)
Tất cả response từ LLM bắt buộc tuân theo Schema sau:
```json
{
  "text": "Câu trả lời tiếng Việt",
  "expression": "Tên biểu cảm",
  "motion": "GroupName:Index",
  "emote": "Kaomoji",
  "new_facts_learned": []
}
```
Nếu LLM trả về JSON lỗi, hàm `parseLlamaResponse()` sử dụng regex fallback để cứu vãn dữ liệu, tránh gây crash.
