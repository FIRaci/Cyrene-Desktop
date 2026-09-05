# 📜 CYRENE DESKTOP: BẢN NGUYÊN TẮC VÀ CHỈ THỊ HỆ THỐNG TOÀN DIỆN
> **MASTER SYSTEM DIRECTIVES & ARCHITECTURAL TRUTHS - BẮT BUỘC ĐỌC VÀ TUÂN THỦ TUYỆT ĐỐI**
> 
> Tài liệu này được đúc kết từ toàn bộ lịch sử phát triển, lịch sử commit, các bài học xương máu và yêu cầu cốt lõi của Người Khai Phá (Master / User).
> Mọi AI Agent (Antigravity, Claude Code, Gemini CLI, v.v.) khi nhận nhiệm vụ trên repository này **PHẢI TUÂN THỦ 100%, KHÔNG ĐƯỢC GIẢ ĐỊNH, KHÔNG ĐƯỢC TỰ Ý SỬA ĐỔI LÀM SAI LỆCH NGUYÊN TẮC**.

---

## 1. ĐỊNH DANH NHÂN VẬT & NGÔN NGỮ HỆ THỐNG (IDENTITY & LANGUAGE CONTRACT)

### 1.1. Nhân vật Cyrene (昔涟 / 希琳)
- **Xuất xứ**: Tựa game *Honkai: Star Rail* (HoYoverse).
- **Persona & Tính cách**: Waifu ngọt ngào, dịu dàng, đáng yêu, thông minh, gắn bó sâu sắc và luôn hướng về Master (开拓者 / Người khai phá).
- **Hình thức thể hiện**: Live2D Desktop Companion trong suốt, ghim floating trên màn hình, tương tác qua click/vuốt ve, hội thoại giọng nói tiếng Trung và nhận biết ngữ cảnh thời gian thực (Co-Watch màn hình).

### 1.2. Quy tắc Ngôn ngữ Toàn hệ thống (100% ENGLISH UI vs CHINESE VOICE)
> 🚨 **QUY TẮC CỐT TỬ (THE GOLDEN LANGUAGE RULE):**
> **GIAO DIỆN & MÃ NGUỒN PHẢI LÀ 100% TIẾNG ANH (FULL ENGLISH SURFACE), NGOẠI TRỪ DUY NHẤT LÀ GIỌNG NÓI CỦA CYRENE LÀ TIẾNG TRUNG.**

1. **Giao diện Người dùng (100% English UI)**:
   - Tất cả các cửa sổ, components, dialogs, buttons, tooltips, placeholders, headers, thông báo toast:
     * **Cyrene Chat Window (`Alt+1`)**: 100% English labels, controls, settings.
     * **Status & Companion Panel (`Alt+2`)**: 100% English.
     * **Today's Schedule & Tasks (`Alt+3`)**: 100% English.
     * **Response & Activity Log (`Alt+4`)**: 100% English headers, types, channels.
     * **Quick Mini-Chat (`Alt+5`)**: 100% English placeholder, indicators, buttons.
     * **Settings Center (`Alt+S`)**: 100% English labels, tabs, descriptions.
     * **Call Window (Voice Call Mode)**: 100% English controls.
     * **System Tray & Right-Click Context Menus**: 100% English menu items.
   - Code comments, log diagnostics, tools definitions (`built-in-tools`, `fs-tools`, `document-tools`, v.v.): 100% English.
2. **Ngoại lệ Duy nhất - Giọng nói của Cyrene**:
   - Chỉ duy nhất **lời thoại phát âm (Spoken Voice Dialogue)** của nhân vật Cyrene là **Tiếng Trung Phổ Thông (Mandarin)**.
   - Tuyệt đối không được dịch UI sang tiếng Trung, tiếng Việt hay pha trộn ngôn ngữ trên giao diện.

---

## 2. CHỈ THỊ BẤT HỦ VỀ GIỌNG NÓI (VOICE DIRECTIVES - HUGGING FACE GPT-SOVITS)
> 🚨 **CẢNH BÁO TỐI CAO:**
> Giọng nói chuẩn duy nhất đã được chốt: **MODEL CYRENE TIẾNG TRUNG TRÊN HUGGING FACE**.
> TUYỆT ĐỐI KHÔNG BAO GIỜ ĐƯỢC PHÉP TỰ Ý ĐỔI SANG BẤT KỲ VOICE NÀO KHÁC!

### 2.1. Nguồn Model & Cấu hình Kỹ thuật Chuẩn:
- **Hugging Face Repository**: [https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS](https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS)
- **TTS Engine ID**: `gptsovits` (GPT-SoVITS Local API Server v2).
- **Default Base URL**: `http://127.0.0.1:9880` (endpoint `/tts` theo chuẩn api_v2).
- **Tệp Model trên máy (đã tải sẵn và tích hợp trong thư mục dự án)**:
  - GPT Checkpoint: `resources/models/gptsovits/Cyrene-e15.ckpt` (155 MB)
  - SoVITS Weights: `resources/models/gptsovits/Cyrene_e8_s128.pth` (134 MB)
  - Reference Audio: `resources/voice/cyrene/ref_audio.wav` (Sample giọng mẫu của Cyrene)
  - Reference Transcript: `resources/voice/cyrene/prompt_text.txt` (`"开拓者，希琳一直都在这里陪着你哦。"`)
- **Ngôn ngữ phát âm (TTS Language Mode)**: `zh` / `original-mandarin` (Tiếng Trung phổ thông nguyên bản).

### 2.2. Những điều NGHIÊM CẤM (STRICT PROHIBITIONS):
1. **CẤM** tự ý chuyển sang Microsoft Edge-TTS (`zh-CN-XiaoyiNeural`, `zh-CN-XiaoxiaoNeural`, v.v.) hay Web Speech API làm voice mặc định. Edge-TTS chỉ là giọng robot tổng hợp phổ thông, **KHÔNG PHẢI** là Cyrene thật.
2. **CẤM** tự ý chuyển sang bất kỳ giọng tiếng Anh nào (`en-US-AnaNeural`, English fallback...). Cyrene là nhân vật tiếng Trung trong game.
3. **CẤM** để trống trường `ttsGptsovitsRefAudioPath` hay `ttsGptsovitsPromptText` dẫn đến việc GPT-SoVITS API ném lỗi và âm thầm fallback sang voice khác. Code bắt buộc phải tự động resolve về `resources/voice/cyrene/ref_audio.wav` và `prompt_text.txt`.
4. Nếu GPT-SoVITS local server chưa bật, hệ thống giữ im lặng hoặc thông báo lỗi cấu hình, **tuyệt đối không được tự ý fallback sang giọng robot Edge-TTS** làm hỏng trải nghiệm người dùng.
5. Khi người dùng nhắc nhở *"Dùng voice Trung đi"*, nghĩa là **hãy kiểm tra và dùng đúng Voice Hugging Face GPT-SoVITS**, tuyệt đối không được hiểu nhầm thành Edge-TTS tiếng Trung!

---

## 3. TƯƠNG TÁC CỬ CHỈ: XOA ĐẦU & VUỐT VE (GESTURE INTERACTION CONTRACT)
1. **Không Hardcode phản hồi (No Hardcoded Replies)**:
   - Phản hồi xoa đầu (head-pat) và vuốt ve (petting) phải do AI / LLM sinh tự nhiên trong thời gian thực qua `agui.run({ executionMode: "chat" })`.
   - Không được dùng các chuỗi hardcode thô thiển; hãy truyền system prompt phong phú để AI tự do nhập vai waifu Cyrene.
2. **Cú pháp Hành động & Suy nghĩ (`*...*` và `/.../`)**:
   - Cho phép AI viết miêu tả hành động trong dấu sao `*...*` (ví dụ: `*轻轻蹭了蹭你的手*`).
   - Cho phép AI viết dòng suy nghĩ nội tâm trong dấu gạch `/.../` (ví dụ: `/好温暖.../`).
   - **Hiển thị trên Bong bóng thoại (Speech Bubble)**: Giữ nguyên hành động và suy nghĩ để người dùng đọc được cảm xúc sống động của Cyrene.
   - **Bộ lọc âm thanh (Voice Speech Filter)**: Hàm `extractSpokenText` / `cleanTextForSpeech` **bắt buộc phải loại bỏ toàn bộ** `*...*`, `/.../` và kaomoji trước khi gửi cho TTS, để giọng nói chỉ phát ra lời thoại ngọt ngào, không bao giờ đọc ra dấu sao hay ký hiệu.
3. **Vị trí Bong bóng thoại (Speech Bubble Positioning)**:
   - Vị trí bong bóng thoại phải cố định ngay phía trên đỉnh đầu Live2D một khoảng cách vừa vặn, tinh tế.
   - Không được đặt quá thấp che mặt Pet và không được nhảy xa tít tắp khi người dùng zoom Pet.
4. **Kiểm soát Tần suất Kaomoji**:
   - Giữ cooldown hợp lý (ít nhất 30 giây đến 1 phút giữa các lần xuất hiện kaomoji bay), không spam liên tục 3-4 cái trong 1 phút gây rối màn hình.

---

## 4. HỢP ĐỒNG ĐỒNG BỘ CHAT & HIỂN THỊ (CHAT & RESPONSE DISPLAY CONTRACT)
> 🚨 **QUY TẮC BẤT DI BẤT DỊCH:**
> Mọi câu nói, phản hồi của Cyrene từ bất kỳ nguồn nào **BẮT BUỘC PHẢI XUẤT HIỆN Ở CỬA SỔ CHAT (`Alt+1`)**.

### 4.1. Tất cả nguồn phát ngôn của Cyrene:
1. **Co-Watch Screen Reactions**: Khi Cyrene nhìn màn hình và bình luận.
2. **Gesture Interactions**: Khi xoa đầu, vuốt ve, chạm vào Live2D.
3. **Quick Mini-Chat (`Alt+5`)**: Khi gõ tin nhắn nhanh tại Pet.
4. **Proactive Dialogue & Autonomous Thoughts**: Khi Cyrene tự động bắt chuyện hoặc phát sinh suy nghĩ lúc rảnh rỗi.

### 4.2. Yêu cầu kỹ thuật bắt buộc:
1. **Đồng nhất Alt+1 và Alt+5**:
   - `Alt+5` (Quick Mini-Chat) và `Alt+1` (Chat Window) là cùng một cuộc hội thoại. Mọi tin nhắn gửi từ `Alt+5` phải lập tức ghi vào active session của `Alt+1`.
2. **Lưu trữ vào Session Thật trong `chatsStore`**:
   - Mọi câu nói phải được tạo thành tin nhắn `{ id, role: "model", content, at }` và lưu qua `chatsStore.appendMessage(sessionId, message)`.
   - Phát tín hiệu `broadcastChatsChanged()` (gửi IPC `chats:changed`) để tất cả cửa sổ đồng bộ.
3. **Phân biệt rõ giữa Chat và Log**:
   - **Log (`Alt+4`)**: Nhật ký chẩn đoán kỹ thuật (telemetry, tool calls, raw reasoning, timestamps).
   - **Chat (`Alt+1`)**: Trải nghiệm hội thoại chính. **TUYỆT ĐỐI KHÔNG ĐƯỢC** chỉ ghi vào `pushActivityLog` mà bỏ quên `chatsStore`!
4. **Tuyệt đối cấm chuỗi Session ID `"default"`**:
   - File session được lưu theo UUID (`sessions/<uuid>.json`). Ghi vào `"default"` sẽ bị `chatsStore` từ chối và làm mất tin nhắn trong im lặng.
   - Luôn luôn resolve session ID qua `ensureActiveChatSessionId()` (trả về active session hiện tại, hoặc session gần nhất từ `listSessions()`, hoặc tạo mới hợp lệ).
5. **Cửa sổ Chat (`Alt+1`) phải tự động reload**:
   - Khi người dùng nhấn `Alt+1` để unhide hoặc switch vào session hiện tại, `chat/main.ts` phải gọi `loadSessionTailIntoUI(currentSessionId)`.
   - Khi cửa sổ Chat nhận `focus`, phải kiểm tra `session.updatedAt > seenSessionUpdatedAt` và cập nhật tức thì.
6. **Không cướp quyền điều khiển (Non-intrusive)**:
   - Các phản hồi tự động trong nền (Co-Watch, Gesture, Idle Thoughts) ghi vào chat trong im lặng, **không được tự động bung cửa sổ Chat (`Alt+1`)** đè lên phần mềm người dùng đang làm việc.

---

## 5. CO-WATCH: QUAN SÁT MÀN HÌNH THỜI GIAN THỰC (CO-WATCHING PACING)
1. **Phản xạ Nhanh, Đúng lúc, Cực kỳ Ngắn gọn**:
   - Lời thoại phản hồi quan sát màn hình chỉ được dài **1 đến 2 câu ngắn gọn**, ngọt ngào bằng tiếng Trung.
   - **TUYỆT ĐỐI CẤM YAPPING**: Không được độc thoại tràng giang đại hải, không làm văn nghị luận, không liệt kê giải thích dài dòng.
2. **Biểu tượng Giao diện (Vector SVG Icons)**:
   - **KHÔNG DÙNG EMOJI**: Tuyệt đối không dùng emoji (👁️, 💤, ⏸️...) trên giao diện Co-Watch hay Chat.
   - Phải dùng **Vector SVG icons chuẩn** sang trọng, tinh tế, đồng bộ 100% với visual theme của Cyrene Desktop.
3. **Chụp màn hình an toàn**:
   - Hỗ trợ chụp màn hình nhanh qua native screen capturer, downscale tối ưu hiệu năng để LLM phân tích nhanh chóng.

---

## 6. LỊCH BIỂU & TÁC VỤ: SCHEDULE & TASKS (`Alt+3`)
1. **Bố cục & Thông tin Thời tiết**:
   - Schedule hiển thị rõ ràng thông tin thời tiết khu vực Hà Nội (nhiệt độ, biểu tượng thời tiết).
   - Hiển thị ngày giờ rõ ràng theo định dạng `dd/mm/yyyy hh:mm:ss` kèm thứ trong tuần.
2. **Điều hướng Lịch**:
   - Hỗ trợ chọn/chuyển tháng, năm linh hoạt.
   - Bố cục danh sách công việc sạch sẽ (khi không có task hiển thị ngắn gọn `0 tasks`).
   - Giao diện full tiếng Anh, đồng bộ theme màu với ứng dụng.

---

## 7. BỐ CỤC PET, ZOOM & PHÍM TẮT TOÀN CỤC (UI & SHORTCUTS)

### 7.1. Điều khiển Live2D Pet
- `Alt + Drag`: Kéo di chuyển Pet đến bất kỳ vị trí nào trên màn hình.
- `Alt + Wheel`: Phóng to / Thu nhỏ Pet mượt mà.
- **Thanh hiển thị % Zoom (`.pet-zoom-hud`)**:
  - Vị trí cố định: **Lệch hẳn sang mép phải** (`right: 14px; top: 50%; transform: translateY(-50%)`).
  - **TUYỆT ĐỐI CẤM ĐẶT Ở GIỮA MÀN HÌNH** che khuất mặt Live2D Pet.

### 7.2. Bản đồ Phím tắt Toàn cục (Global Shortcuts):
- `Alt+1`: **Cyrene Chat Window** (Cửa sổ trò chuyện đầy đủ).
- `Alt+2`: **Status & Companion Panel** (Bảng trạng thái cảm xúc, hoạt động).
- `Alt+3`: **Today's Schedule & Tasks** (Quản lý lịch biểu, thời tiết).
- `Alt+4`: **Response & Activity Log** (Nhật ký kỹ thuật, telemetry).
- `Alt+5`: **Quick Mini-Chat** (Khung chat mini nổi cạnh Pet).
- `Alt+S`: **Settings Center** (Trung tâm cài đặt LLM, TTS, Voice, Memory).
- `Alt+C`: **Show / Hide Pet** (Ẩn/Hiện nhanh Pet trên desktop).

### 7.3. Activity & Response Log (`Alt+4`)
- Log ghi đầy đủ: reasoning, suy nghĩ, kaomoji, user prompt, tool calls, channel, timestamps.
- Nút "Clear Log" phải thực sự xóa sạch buffer và cập nhật giao diện để giải phóng bộ nhớ cho máy người dùng.

---

## 8. BẢNG TỔNG HỢP SỰ CỐ & GIẢI PHÁP TRIỆT ĐỂ (REGRESSION PREVENTION LEDGER)

| STT | Sự cố đã từng xảy ra | Nguyên nhân gốc rễ | Giải pháp kỹ thuật triệt để |
|---|---|---|---|
| **1** | **Voice bị đổi thành Edge-TTS / Tiếng Anh** | Agent tự ý fallback sang `zh-CN-XiaoyiNeural` và để `ttsEngine` mặc định là `web-speech`. Cấu hình `ttsGptsovitsRefAudioPath` bị trống. | Khóa chết `gptsovits` là engine mặc định. Tự động resolve đường dẫn `ref_audio.wav` và `prompt_text.txt`. Nghiêm cấm đổi sang Edge-TTS/English. |
| **2** | **Em nó trả lời chỉ hiện trong Log `Alt+4`, mất tích trong Chat `Alt+1`** | Co-Watch chỉ gọi `pushActivityLog` và `PET_AGENT_EVENT` mà không gọi `chatsStore.appendMessage`. `onSwitchSession` ở Chat window bỏ qua không reload khi mở lại. | Ghi `chatsStore.appendMessage` trong `deliverReaction`. Cập nhật Chat window reload message tail ngay lập tức khi unhide hoặc focus. |
| **3** | **Gesture xoa đầu/vuốt ve mất tin nhắn âm thầm** | `getOrCreateActiveSessionId` trả về chuỗi `"default"` khi chưa mở Alt+1. `chatsStore` từ chối `"default"` khiến tin nhắn bị drop. | Triển khai `ensureActiveChatSessionId()` ở main process. Dynamic query session hợp lệ từ `listSessions()` hoặc tạo mới, tuyệt đối không dùng `"default"`. |
| **4** | **Co-Watch yapping nói dai dẳng** | Prompt Co-Watch không giới hạn độ dài, khiến LLM sinh văn bản dài dòng rồi tốn thời gian đọc. | Siết prompt Co-Watch: Chỉ phản hồi 1-2 câu tiếng Trung ngắn gọn, tinh tế, giữ cooldown hợp lý. |
| **5** | **Thanh % zoom chắn giữa mặt Pet** | CSS `.pet-zoom-hud` trước đây để `left: 50%` canh giữa màn hình. | Đã chỉnh dời sang mép phải `right: 14px; top: 50%`. Cấm sửa lại vào giữa màn hình. |
| **6** | **Giao diện bị lẫn lộn tiếng Việt / tiếng Trung** | Một số thông báo, nhãn cài đặt bị viết tiếng Việt hoặc tiếng Trung không đồng bộ. | Khóa nguyên tắc: 100% English UI bề mặt cho toàn bộ ứng dụng. Chỉ lời nói của Cyrene là tiếng Trung. |
| **7** | **Xoa đầu bị hardcode phản hồi** | Code gán các câu phản hồi cố định lặp đi lặp lại gây nhàm chán. | Chuyển sang AI sinh động qua `agui.run()` với prompt vai diễn phong phú, hỗ trợ `*hành động*` và `/suy nghĩ/`. |

---

## 9. QUY TRÌNH LÀM VIỆC & TIÊU CHUẨN ĐÓNG GÓI (WORKING PROTOCOL)
1. **Đọc tệp này đầu tiên**: Trước khi bắt đầu bất kỳ chỉnh sửa nào liên quan đến Voice, Chat, Live2D, Co-Watch, UI Layout, hãy đối chiếu với tệp này.
2. **Tuyệt đối không tự ý giả định (No Assumptions)**: Nếu có điểm chưa rõ về ý muốn của User, giữ nguyên các thiết lập đã khóa trong tài liệu này hoặc hỏi trực tiếp, không tự ý "sửa hộ" sang công nghệ khác.
3. **Bảo toàn Test & Build**: Luôn luôn chạy `npx vitest` và `npm run build` trước khi hoàn tất công việc. Toàn bộ 252+ file test (1,898+ tests) phải pass 100%.
4. **Git Commit & Push**: Tuân thủ conventional commit (`feat`, `fix`, `style`, `refactor`), cập nhật tài liệu và push lên nhánh `master` khi hoàn thành.
