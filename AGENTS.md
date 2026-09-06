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

### 1.2. Quy tắc Ngôn ngữ Toàn hệ thống (100% ENGLISH UI SURFACE vs IN-MEMORY CHINESE VOICE)
> 🚨 **QUY TẮC CỐT TỬ (THE GOLDEN LANGUAGE CONTRACT):**
> **GIAO DIỆN, BONG BÓNG THOẠI & LỊCH SỬ CHAT PHẢI LÀ 100% TIẾNG ANH (FULL ENGLISH SURFACE). NGOẠI TRỪ DUY NHẤT LÀ GIỌNG NÓI PHÁT RA TỪ LOA CỦA CYRENE LÀ TIẾNG TRUNG (MANDARIN VOICE VIA HUGGING FACE GPT-SOVITS).**

1. **Giao diện Người dùng & Lời thoại Bề mặt (100% English UI Surface)**:
   - Tất cả các cửa sổ, components, dialogs, buttons, tooltips, placeholders, headers, thông báo toast:
     * **Cyrene Chat Window (`Alt+1`)**: 100% English labels, controls, settings, chat text.
     * **Live2D Speech Bubbles (`companion-bubbles.ts`)**: 100% English display text.
     * **Status & Companion Panel (`Alt+2`)**: 100% English.
     * **Today's Schedule & Tasks (`Alt+3`)**: 100% English.
     * **Response & Activity Log (`Alt+4`)**: 100% English headers, types, channels.
     * **Quick Mini-Chat (`Alt+5`)**: 100% English placeholder, indicators, buttons, bubble replies.
     * **Settings Center (`Alt+6` / `Alt+S`)**: 100% English labels, tabs, descriptions.
     * **Call Window (Voice Call Mode)**: 100% English controls.
     * **System Tray & Right-Click Context Menus**: 100% English menu items.
   - **Tuyệt đối cấm pha trộn nửa Anh nửa Trung**:
     * CẤM ra lệnh cho LLM trả lời bằng tiếng Trung trong các tương tác xoa đầu, vuốt ve, chat nhanh hay co-watch.
     * CẤM để xuất hiện các đoạn dịch song ngữ như `(Original Chinese): ...` hay câu nửa nọ nửa kia. Toàn bộ hội thoại và văn bản phải thuần tiếng Anh tự nhiên.
2. **Cầu Nối Dịch Giọng Nói In-Memory (In-Memory Speech Translation Bridge)**:
   - Nhân vật Cyrene phát âm giọng mẫu tiếng Trung qua Hugging Face GPT-SoVITS.
   - Khi Cyrene phản hồi (bằng tiếng Anh), văn bản thoại hiển thị trên màn hình và lưu trong Chat là **100% tiếng Anh**.
   - Trước khi gửi văn bản thoại cho engine TTS (`voice.ts -> speak()`), hệ thống kiểm tra nếu văn bản chưa có ký tự tiếng Trung (`!/[\u4e00-\u9fa5]/.test(speechDialogue)`), hàm sẽ tự động gọi cầu nối `window.tts.translateToChinese(speechDialogue)` dịch ngầm trong bộ nhớ RAM sang tiếng Trung rồi mới nạp vào GPT-SoVITS.
   - **Quy trình này hoàn toàn vô hình với UI**: Lịch sử chat và bong bóng thoại vẫn giữ nguyên 100% tiếng Anh, chỉ có luồng âm thanh phát ra là tiếng Trung chuẩn của Cyrene.

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

### 2.2. Hoạt động Độc lập của Voice Pet (Decoupled Voice Lifecycle):
- Live2D Pet Companion sở hữu `voiceService` độc lập nằm ngay trong renderer của Pet (`src/renderer/live2d/voice.ts`).
- **Hoàn toàn độc lập với Cửa sổ Chat (`Alt+1`)**: Khi Pet phản hồi (xoa đầu, vuốt ve, chat mini, tự thoại), âm thanh phát trực tiếp từ Pet.
- **TUYỆT ĐỐI CẤM** việc phụ thuộc vào việc mở cửa sổ Chat (`Alt+1`) để phát âm. Đóng, ẩn hay mở `Alt+1` không được làm ngắt hoặc chặn giọng nói của Pet.

### 2.3. Những điều NGHIÊM CẤM (STRICT PROHIBITIONS):
1. **CẤM** tự ý chuyển sang Microsoft Edge-TTS (`zh-CN-XiaoyiNeural`, `zh-CN-XiaoxiaoNeural`, v.v.) hay Web Speech API làm voice mặc định. Edge-TTS chỉ là giọng robot tổng hợp phổ thông, **KHÔNG PHẢI** là Cyrene thật.
2. **CẤM** tự ý chuyển sang bất kỳ giọng tiếng Anh nào (`en-US-AnaNeural`, English fallback...). Cyrene là nhân vật tiếng Trung trong game.
3. **CẤM** để trống trường `ttsGptsovitsRefAudioPath` hay `ttsGptsovitsPromptText` dẫn đến việc GPT-SoVITS API ném lỗi và âm thầm fallback sang voice khác. Code bắt buộc phải tự động resolve về `resources/voice/cyrene/ref_audio.wav` và `prompt_text.txt`.
4. Nếu GPT-SoVITS local server chưa bật, hệ thống giữ im lặng hoặc thông báo lỗi cấu hình, **tuyệt đối không được tự ý fallback sang giọng robot Edge-TTS** làm hỏng trải nghiệm người dùng.
5. Khi người dùng nhắc nhở *"Dùng voice Trung đi"*, nghĩa là **hãy kiểm tra và dùng đúng Voice Hugging Face GPT-SoVITS qua cầu nối dịch âm thanh in-memory**, tuyệt đối không được hiểu nhầm thành Edge-TTS tiếng Trung!

---

## 3. TƯƠNG TÁC CỬ CHỈ: XOA ĐẦU & VUỐT VE (GESTURE INTERACTION CONTRACT)
1. **Không Hardcode phản hồi (No Hardcoded Replies)**:
   - Phản hồi xoa đầu (head-pat) và vuốt ve (petting) phải do AI / LLM sinh tự nhiên trong thời gian thực qua `agui.run({ executionMode: "chat" })`.
   - Không được dùng các chuỗi hardcode thô thiển; hãy truyền system prompt phong phú bằng **Tiếng Anh** để AI tự do nhập vai waifu Cyrene.
2. **Cú pháp Hành động & Suy nghĩ (`*...*` và `/.../`)**:
   - Cho phép AI viết miêu tả hành động trong dấu sao `*...*` (ví dụ: `*gently leans into your hand*`).
   - Cho phép AI viết dòng suy nghĩ nội tâm trong dấu gạch `/.../` (ví dụ: `/so warm.../`).
   - **Hiển thị trên Bong bóng thoại (Speech Bubble)**: Giữ nguyên hành động và suy nghĩ để người dùng đọc được cảm xúc sống động của Cyrene.
   - **Bộ lọc âm thanh (Voice Speech Filter)**: Hàm `extractSpokenText` / `cleanTextForSpeech` **bắt buộc phải loại bỏ toàn bộ** `*...*` và `/.../` trước khi gửi cho TTS, để giọng nói chỉ phát ra lời thoại ngọt ngào, không bao giờ đọc ra dấu sao hay ký hiệu.
3. **Tuyệt đối Không đưa Kaomoji vào Văn bản (Kaomojis Are Particles ONLY)**:
   - **QUY TẮC CỨNG**: Kaomoji (ví dụ: `(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)`, `(*^▽^*)`, `(｡♥‿♥｡)`) **KHÔNG ĐƯỢC PHÉP XUẤT HIỆN TRONG BONG BÓNG CHAT HOẶC CỬA SỔ CHAT**.
   - Mọi hàm xử lý tin nhắn (`cleanGestureReply`, `sanitizeBubbleSpeech`, `mini-chat.ts`) bắt buộc phải gọi `stripKaomojis()` để tẩy sạch kaomoji khỏi text trước khi render bubble hoặc lưu vào chat.
   - Kaomoji **chỉ được phép "ném" ra ngoài màn hình** dưới dạng hiệu ứng hạt trôi nổi (particle visual effect) thông qua hàm `tossKaomoji(particleEl)`.
4. **Đồng bộ Thời lượng Bong bóng thoại với Giọng nói (Speech Bubble Lifetime Bound to Voice)**:
   - Không được để bong bóng thoại vừa hiện lên 3-5 giây đã biến mất trong khi âm thanh Cyrene vẫn đang nói dở dang!
   - Hàm `say(text, durationMs, voiceService)` trong `companion-bubbles.ts` được kết nối trực tiếp với `voiceService`.
   - Khi bộ hẹn giờ đếm ngược hết thời gian cơ bản, nó bắt buộc phải kiểm tra `voiceService.getIsSpeaking()`. Nếu âm thanh vẫn đang phát, bong bóng tiếp tục trì hoãn việc đóng cho đến khi Cyrene nói xong hoàn toàn mới biến mất một cách duyên dáng.
5. **Vị trí Bong bóng thoại (Speech Bubble Positioning)**:
   - Vị trí bong bóng thoại phải cố định ngay phía trên đỉnh đầu Live2D một khoảng cách vừa vặn, tinh tế.
   - Không được đặt quá thấp che mặt Pet và không được nhảy xa tít tắp khi người dùng zoom Pet.

---

## 4. HỢP ĐỒNG ĐỒNG BỘ CHAT & HIỂN THỊ (CHAT & RESPONSE DISPLAY CONTRACT)
> 🚨 **QUY TẮC BẤT DI BẤT DỊCH:**
> Mọi câu nói, phản hồi của Cyrene từ bất kỳ nguồn nào **BẮT BUỘC PHẢI XUẤT HIỆN Ở CỬA SỔ CHAT (`Alt+1`) VÀ KHÔNG BAO GIỜ BỊ DUPLICATE**.

### 4.1. Khử Trùng lặp Tin nhắn Tuyệt đối (Strict Message Deduplication):
- `chatsStore.appendMessage(sessionId, message)` tại `src/main/chats/chats-store.ts` được bảo vệ bằng cơ chế chống duplicate 2 lớp (Idempotency Guard):
  1. **Trùng ID**: Nếu tin nhắn có cùng `id` đã tồn tại trong session, cập nhật in-place nội dung, không thêm bản ghi mới.
  2. **Trùng Nội dung & Vai trò trong Cửa sổ Thời gian (10,000ms)**: Nếu tin nhắn cuối cùng trong session có cùng `role` và nội dung y hệt (`content === last.content`) trong khoảng 10 giây, thao tác append sẽ tự động bị bỏ qua.
- Đảm bảo tuyệt đối không có hiện tượng bot nói 1 câu nhưng hiển thị 2 lần trên chat UI!

### 4.2. Tất cả nguồn phát ngôn của Cyrene:
1. **Co-Watch Screen Reactions**: Khi Cyrene nhìn màn hình và bình luận.
2. **Gesture Interactions**: Khi xoa đầu, vuốt ve, chạm vào Live2D.
3. **Quick Mini-Chat (`Alt+5`)**: Khi gõ tin nhắn nhanh tại Pet.
4. **Proactive Dialogue & Autonomous Thoughts**: Khi Cyrene tự động bắt chuyện hoặc phát sinh suy nghĩ lúc rảnh rỗi.

### 4.3. Yêu cầu kỹ thuật bắt buộc:
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
   - Lời thoại phản hồi quan sát màn hình chỉ được dài **1 đến 2 câu ngắn gọn**, ngọt ngào bằng tiếng Anh (hoặc dịch ngầm sang tiếng Trung khi phát âm).
   - **TUYỆT ĐỐI CẤM YAPPING**: Không được độc thoại tràng giang đại hải, không làm văn nghị luận, không liệt kê giải thích dài dòng.
2. **Biểu tượng Giao diện (Vector SVG Icons)**:
   - **KHÔNG DÙNG EMOJI**: Tuyệt đối không dùng emoji (👁️, 💤, ⏸️...) trên giao diện Co-Watch hay Chat.
   - Phải dùng **Vector SVG icons chuẩn** sang trọng, tinh tế, đồng bộ 100% với visual theme của Cyrene Desktop.
3. **Chụp màn hình an toàn**:
   - Hỗ trợ chụp màn hình nhanh qua native screen capturer (`cyrene-screenshot.exe`), downscale tối ưu hiệu năng để LLM phân tích nhanh chóng.

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

## 7. BỐ CỤC PET, ZOOM, PHÍM TẮT & QUY TRÌNH BUILD (UI, SHORTCUTS & PACKAGING)

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
- `Alt+6`: **Settings Center** (Trung tâm cài đặt LLM, TTS, Voice, Memory - cũng hỗ trợ `Alt+S`).
- `Alt+C`: **Show / Hide Pet** (Ẩn/Hiện nhanh Pet trên desktop).
- `Alt+Q`: **Quick Quit Application** (Tắt nhanh toàn bộ ứng dụng).
  * **Cơ chế thoát dứt khoát**: Đăng ký trong `src/main/index.ts`. Gọi `app.quit()` kết hợp bộ fallback `setTimeout(() => app.exit(0), 400)` để đảm bảo tiến trình Electron và mọi cửa sổ con tắt ngay lập tức, không bị treo tiến trình chạy ngầm.

### 7.3. Activity & Response Log (`Alt+4`)
- Log ghi đầy đủ: reasoning, suy nghĩ, kaomoji, user prompt, tool calls, channel, timestamps.
- Nút "Clear Log" phải thực sự xóa sạch buffer và cập nhật giao diện để giải phóng bộ nhớ cho máy người dùng.

### 7.4. Tiêu chuẩn Đóng gói & Build (Packaging Standards):
- Sau mỗi đợt chỉnh sửa, **bắt buộc phải build lại toàn bộ**:
  1. `npm run build`: Build TypeScript main, preload, renderer và skills.
  2. `npm run package:win:dir`: Đóng gói ứng dụng vào thư mục `release\win-unpacked\Cyrene.exe`.
  - Nếu người dùng test ứng dụng chạy từ file `.exe` đã đóng gói, việc quên chạy `package:win:dir` sẽ khiến người dùng chạy code cũ từ quá khứ và lầm tưởng lỗi chưa được sửa!

---

## 8. BẢNG TỔNG HỢP SỰ CỐ & GIẢI PHÁP TRIỆT ĐỂ (REGRESSION PREVENTION LEDGER)

| STT | Sự cố đã từng xảy ra | Nguyên nhân gốc rễ | Giải pháp kỹ thuật triệt để |
|---|---|---|---|
| **1** | **Voice bị đổi thành Edge-TTS / Tiếng Anh** | Agent tự ý fallback sang `zh-CN-XiaoyiNeural` và để `ttsEngine` mặc định là `web-speech`. Cấu hình `ttsGptsovitsRefAudioPath` bị trống. | Khóa chết `gptsovits` là engine mặc định. Tự động resolve đường dẫn `ref_audio.wav` và `prompt_text.txt`. Nghiêm cấm đổi sang Edge-TTS/English. |
| **2** | **Em nó trả lời chỉ hiện trong Log `Alt+4`, mất tích trong Chat `Alt+1`** | Co-Watch chỉ gọi `pushActivityLog` và `PET_AGENT_EVENT` mà không gọi `chatsStore.appendMessage`. `onSwitchSession` ở Chat window bỏ qua không reload khi mở lại. | Ghi `chatsStore.appendMessage` trong `deliverReaction`. Cập nhật Chat window reload message tail ngay lập tức khi unhide hoặc focus. |
| **3** | **Gesture xoa đầu/vuốt ve mất tin nhắn âm thầm** | `getOrCreateActiveSessionId` trả về chuỗi `"default"` khi chưa mở Alt+1. `chatsStore` từ chối `"default"` khiến tin nhắn bị drop. | Triển khai `ensureActiveChatSessionId()` ở main process. Dynamic query session hợp lệ từ `listSessions()` hoặc tạo mới, tuyệt đối không dùng `"default"`. |
| **4** | **Co-Watch yapping nói dai dẳng** | Prompt Co-Watch không giới hạn độ dài, khiến LLM sinh văn bản dài dòng rồi tốn thời gian đọc. | Siết prompt Co-Watch: Chỉ phản hồi 1-2 câu tiếng Anh ngắn gọn, tinh tế, giữ cooldown hợp lý. |
| **5** | **Thanh % zoom chắn giữa mặt Pet** | CSS `.pet-zoom-hud` trước đây để `left: 50%` canh giữa màn hình. | Đã chỉnh dời sang mép phải `right: 14px; top: 50%`. Cấm sửa lại vào giữa màn hình. |
| **6** | **Giao diện bị lẫn lộn tiếng Việt / tiếng Trung** | Một số thông báo, nhãn cài đặt bị viết tiếng Việt hoặc tiếng Trung không đồng bộ. | Khóa nguyên tắc: 100% English UI bề mặt cho toàn bộ ứng dụng. Chỉ lời nói phát ra của Cyrene là tiếng Trung. |
| **7** | **Xoa đầu bị hardcode phản hồi** | Code gán các câu phản hồi cố định lặp đi lặp lại gây nhàm chán. | Chuyển sang AI sinh động qua `agui.run()` với prompt vai diễn phong phú, hỗ trợ `*hành động*` và `/suy nghĩ/`. |
| **8** | **Tin nhắn trả lời bị lặp đúp (Duplicate Message)** | Sự kiện nhận tin nhắn từ agent hoặc gesture bị bắn đúp từ nhiều nguồn (agent event + chatsStore write). | Thiết lập cơ chế Idempotency trong `chatsStore.appendMessage`: cập nhật theo id trùng hoặc bỏ qua nếu nội dung trùng trong 10 giây. |
| **9** | **Lời thoại nửa Anh nửa Trung, lộ `(Original Chinese): ...`** | Prompt gesture ra lệnh cho LLM `React naturally in CHINESE (简体中文)`, xung đột với prompt hệ thống tiếng Anh, khiến LLM in cả hai thứ tiếng. | Khóa toàn bộ prompt sang 100% tiếng Anh. Không bao giờ yêu cầu LLM viết tiếng Trung trên UI. Lời nói tiếng Trung do tầng âm thanh giải quyết. |
| **10** | **Voice tiếng Anh hoặc im lặng khi nói trên Pet** | Đưa trực tiếp văn bản tiếng Anh vào model GPT-SoVITS vốn chỉ hiểu tiếng Trung, khiến server báo lỗi hoặc fallback giọng robot. | Thiết lập cầu nối dịch ngầm in-memory `window.tts.translateToChinese()` trong `voice.ts` trước khi gửi request tới GPT-SoVITS API. |
| **11** | **Tắt `Alt+1` là Pet im bặt, phải bật `Alt+1` mới chịu nói** | Quy trình phát âm bị ràng buộc hoặc gắn với vòng đời của cửa sổ Chat thay vì chạy độc lập trên Pet companion. | Tách biệt hoàn toàn `voiceService` trong renderer Live2D Pet (`voice.ts`). Pet tự xử lý phát âm mà không phụ thuộc vào trạng thái đóng/mở của `Alt+1`. |
| **12** | **Bong bóng chat vừa hiện lên đã tắt, nói chưa hết câu** | Bong bóng thoại sử dụng thời gian biến mất cứng (hardcoded 5000ms), trong khi audio nói dài 7-10 giây. | Liên kết thời lượng bong bóng với `voiceService.getIsSpeaking()`. Khi đếm hết giờ, nếu âm thanh vẫn phát, trì hoãn đóng bong bóng cho đến khi dứt lời. |
| **13** | **Kaomoji in chình ình trong bong bóng chat và lịch sử chat** | AI hoặc fallback gán chuỗi kaomoji như `(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)` vào text phản hồi thay vì chỉ render particle. | Tẩy sạch mọi biểu tượng kaomoji bằng hàm `stripKaomojis()` trước khi render text hay lưu database. Kaomoji chỉ được ném ra màn hình bằng `tossKaomoji()`. |
| **14** | **Phím tắt `Alt+Q` bấm không có tác dụng** | Ứng dụng đã đóng gói ở `release\win-unpacked` là bản build cũ (10:54 AM), chưa tích hợp shortcut mới. | Tăng cường `app.quit()` + `app.exit(0)`, đồng thời luôn chạy `npm run package:win:dir` để cập nhật file thực thi sau khi hoàn thành code. |

---

## 9. NGUYÊN TẮC THIẾT KẾ SOLID & BẢN ĐỒ VỊ TRÍ CODE BẤT KHẢ XÂM PHẠM (CODE ANCHOR MAP)
> **Mục tiêu**: Code có độ kết dính cao (High Cohesion), độ phụ thuộc thấp (Low Coupling), khó làm hỏng tính năng cũ (Closed for modification) nhưng dễ dàng mở rộng (Open for extension).

### 9.1. Bản đồ Vị trí Code Trọng yếu (Critical File Anchors):
1. **Quản lý Session & Khử Duplicate Chat**:
   - `src/main/chats/chats-store.ts` (Hàm `appendMessage`):
     * **Trách nhiệm duy nhất (SRP)**: Lưu trữ, truy xuất tin nhắn session và đảm bảo tính idempotent.
     * **KHÔNG ĐƯỢC CHẠM VÀO**: Đoạn kiểm tra trùng ID và trùng nội dung trong 10s.
2. **Cầu Nối Dịch Ngầm & Phát Âm Live2D**:
   - `src/renderer/live2d/voice.ts` (Hàm `speak`):
     * **Trách nhiệm duy nhất (SRP)**: Tiếp nhận lời thoại, kiểm tra và dịch ngầm sang tiếng Trung qua `window.tts.translateToChinese()`, gửi đến engine Hugging Face GPT-SoVITS.
     * **KHÔNG ĐƯỢC CHẠM VÀO**: Đoạn cầu nối dịch âm thanh in-memory `translateToChinese`.
3. **Hiển thị Bong bóng thoại & Đồng bộ Âm thanh**:
   - `src/renderer/live2d/companion-bubbles.ts` (Hàm `say`):
     * **Trách nhiệm duy nhất (SRP)**: Quản lý hiển thị bong bóng trên đỉnh Live2D và đồng bộ thời lượng hiển thị với `voiceService.getIsSpeaking()`.
     * **KHÔNG ĐƯỢC CHẠM VÀO**: Vòng lặp kiểm tra trạng thái phát âm trước khi ẩn bong bóng.
4. **Điều khiển Tương tác Cử chỉ & Lọc Kaomoji**:
   - `src/renderer/live2d/gesture-interaction-controller.ts` (Hàm `handleHeadPat`, `handlePetting`, `cleanGestureReply`):
     * **Trách nhiệm duy nhất (SRP)**: Giao tiếp với AI nhập vai cử chỉ, tẩy sạch kaomoji bằng `stripKaomojis()`, ném hạt kaomoji và hiển thị bong bóng.
     * **KHÔNG ĐƯỢC CHẠM VÀO**: Prompt tiếng Anh và bộ lọc kaomoji.
5. **Vòng đời Ứng dụng & Phím tắt Nhanh**:
   - `src/main/index.ts` (Hàm đăng ký `Alt+Q`):
     * **Trách nhiệm duy nhất (SRP)**: Khởi tạo ứng dụng, gán global shortcut và đảm bảo tiến trình tắt sạch sẽ.

---

## 10. QUY TRÌNH LÀM VIỆC & TIÊU CHUẨN ĐÓNG GÓI (WORKING PROTOCOL)
1. **Đọc tệp này đầu tiên**: Trước khi bắt đầu bất kỳ chỉnh sửa nào liên quan đến Voice, Chat, Live2D, Co-Watch, UI Layout, hãy đối chiếu với tệp này.
2. **Tuyệt đối không tự ý giả định (No Assumptions)**: Nếu có điểm chưa rõ về ý muốn của User, giữ nguyên các thiết lập đã khóa trong tài liệu này hoặc hỏi trực tiếp, không tự ý "sửa hộ" sang công nghệ khác.
3. **Bảo toàn Test & Build**:
   - Luôn chạy `npx vitest run` (Toàn bộ 256 file test, 1,932+ tests phải pass 100%).
   - Luôn chạy `npm run build` để biên dịch TypeScript và Vite.
   - Luôn chạy `npm run package:win:dir` để đóng gói bản chạy thực tế tại `release\win-unpacked\Cyrene.exe`.
4. **Git Commit & Push**: Tuân thủ conventional commit (`feat`, `fix`, `style`, `refactor`), cập nhật tài liệu và push lên nhánh `master` khi hoàn thành.

