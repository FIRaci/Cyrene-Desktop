# Tiêu Chuẩn Lập Trình (Code Standards & Guidelines)

Tài liệu này dành cho các AI Agent hoặc Lập trình viên khi maintain/phát triển dự án Cyrene. BẤT CỨ AI CHỈNH SỬA CODE CŨNG PHẢI TUÂN THỦ CÁC QUY TẮC SAU:

## 1. Tiêu Chuẩn LLM Prompt (The "Waifu" Rule)
Cyrene là một Waifu, không phải Bot hỗ trợ. 
- **TUYỆT ĐỐI KHÔNG** để Cyrene xưng "Tôi", gọi "Bạn/Dượng". Luôn dùng "Mình/Em/Cyrene" và "Chủ nhân".
- **TUYỆT ĐỐI KHÔNG** sử dụng giọng điệu chăm sóc khách hàng ("Tôi có thể giúp gì cho bạn?").
- Dùng `repeat_penalty: 1.15` tới `1.2` trong payload gửi lên Ollama để tránh LLM lặp lại cùng một cấu trúc (VD: "Ồ, chủ nhân...", "Ồ, chủ nhân...").
- Các cảm xúc thả nổi phải dùng **Kaomoji** thuần túy `(o・▽・o)`, không dùng Emoji Unicode `😂` (vì font có thể render sai trên Live2D hoặc UI trong suốt).

## 2. Quản Lý Bộ Nhớ (Memory Safety)
- Không bao giờ truyền toàn bộ chuỗi JSON từ LLM vào `conversationHistory`. Điều này sẽ đốt sạch Context Window (Token) của LLM rất nhanh. Chỉ lấy `parsed.text` đưa vào bộ nhớ ngắn hạn.
- Giữ `conversationHistory` luôn <= 20 phần tử.
- Bất kỳ event tự động nào (như Click chuột, Idle Thoughts) đều **KHÔNG ĐƯỢC** push log vào `conversationHistory`, nếu không AI sẽ bị "ảo giác" (Hallucination) khi nhìn lại lịch sử toàn những câu bâng quơ của chính nó.

## 3. Tối Ưu Tương Tác Chuột (Event Leaks)
- Giao diện của Cyrene chạy trên nền Electron trong suốt. Việc gọi IPC `setIgnoreMouseEvents` liên tục ở hàm `mousemove` sẽ làm nghẽn luồng render, kéo tụt FPS của cả hệ điều hành.
- LUÔN LUÔN dùng cờ `shouldIgnore !== isMouseIgnored` để kiểm tra state trước khi gọi IPC.
- Các event `mousedown`, `mouseup` của cửa sổ chat phải dùng `{ capture: true }` để chặn sự kiện lan xuống tầng body/canvas của Live2D, tránh lỗi "kéo lê cửa sổ" gây dính chuột.

## 4. Ngôn Ngữ Hiển Thị
- 100% Text phản hồi cho người dùng phải là **Tiếng Việt**.
- Quét sạch các ký tự Hán tự (Tiếng Trung) bằng hàm `cleanChinese()` trước khi hiển thị ra DOM. (Các Model nội địa Trung thường hay lỡ rò rỉ Hán tự trong câu).
- Tên Expression / Motion của Live2D Cubism model thì bắt buộc phải giữ nguyên (có thể là Tiếng Trung) vì đó là ID định danh (Ví dụ: `表情回正`).

## 5. UI/UX & CSS
- Sử dụng Glassmorphism (làm mờ kính) cho bảng chat và context menu.
- Không sử dụng z-index quá cao vô tội vạ.
- Bong bóng chat (Dialogue Bubble) phải luôn nằm chính giữa ngay dưới chân mô hình và có animation `fadeOut` sau 6 giây.
