# 📜 CYRENE DESKTOP: BẢN NGUYÊN TẮC VÀ CHỈ THỊ BẤT HỦ
> **TÀI LIỆU CỐT LÕI (CORE DIRECTIVES & SYSTEM RULES) - BẮT BUỘC ĐỌC VÀ TUÂN THỦ**
> Mọi AI Agent (Antigravity, Claude Code, Gemini CLI, v.v.) làm việc trên repo này **PHẢI TUÂN THỦ 100% VÀ KHÔNG ĐƯỢC PHÉP THAY ĐỔI HAY TỰ Ý SÁNG TÁC LÀM SAI LỆCH**.

---

## 1. ĐỊNH DANH NHÂN VẬT & MỤC TIÊU DỰ ÁN
- **Nhân vật**: Cyrene (昔涟 / 希琳) từ tựa game *Honkai: Star Rail* (HoYoverse).
- **Tính cách & Persona**: Waifu ngọt ngào, dịu dàng, đáng yêu, gắn bó sâu sắc và luôn hướng về Master (开拓者 / Người khai phá).
- **Hình thức thể hiện**: Live2D Desktop Companion trong suốt, ghim trên màn hình, tương tác qua click/vuốt ve, hội thoại giọng nói tiếng Trung và nhận biết ngữ cảnh (Co-Watch màn hình).

---

## 2. CHỈ THỊ TỐI CAO VỀ GIỌNG NÓI (VOICE DIRECTIVES)
> 🚨 **CẢNH BÁO ĐẶC BIỆT QUAN TRỌNG:**
> ĐÃ CHỐT VÀ KHÓA DUY NHẤT: **GIỌNG NÓI TIẾNG TRUNG CỦA CYRENE TỪ HUGGING FACE**.
> TUYỆT ĐỐI KHÔNG BAO GIỜ ĐƯỢC PHÉP TỰ Ý ĐỔI SANG BẤT KỲ VOICE NÀO KHÁC!

### 2.1. Nguồn Model & Cấu hình chuẩn:
- **Hugging Face Repository**: [https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS](https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS)
- **Engine Engine ID**: `gptsovits` (GPT-SoVITS Local API Server v2).
- **Default Base URL**: `http://127.0.0.1:9880`
- **Tệp Model trên máy (đã tải và cấu hình)**:
  - GPT Model Checkpoint: `resources/models/gptsovits/Cyrene-e15.ckpt` (155 MB)
  - SoVITS Weights: `resources/models/gptsovits/Cyrene_e8_s128.pth` (134 MB)
  - Reference Audio: `resources/voice/cyrene/ref_audio.wav`
  - Reference Transcript: `resources/voice/cyrene/prompt_text.txt` (`"开拓者，希琳一直都在这里陪着你哦。"`)
- **Ngôn ngữ phát âm (TTS Language Mode)**: `zh` / `original-mandarin` (Tiếng Trung phổ thông nguyên bản).

### 2.2. Những điều NGHIÊM CẤM (STRICT PROHIBITIONS):
1. **CẤM** tự ý chuyển sang Microsoft Edge-TTS (`zh-CN-XiaoyiNeural`, `zh-CN-XiaoxiaoNeural`, v.v.) hay Web Speech API làm voice mặc định. Edge-TTS chỉ là generic robotic voice, **KHÔNG PHẢI** là giọng Cyrene thật.
2. **CẤM** tự ý chuyển sang bất kỳ giọng tiếng Anh nào (`en-US-AnaNeural`, English fallback...). Cyrene là waifu tiếng Trung.
3. **CẤM** để trống trường `refAudioPath` hay `promptText` dẫn đến việc GPT-SoVITS báo lỗi và âm thầm nhảy sang fallback khác. Nếu cài đặt trống, hệ thống **bắt buộc** fallback về `resources/voice/cyrene/ref_audio.wav` và `prompt_text.txt`.
4. Khi người dùng nhắc nhở "Dùng voice Trung đi", nghĩa là **hãy kiểm tra và dùng đúng Voice Hugging Face GPT-SoVITS**, tuyệt đối không được hiểu nhầm thành Edge-TTS tiếng Trung!

---

## 3. HIỂN THỊ TIN NHẮN & ĐỒNG BỘ CHAT (CHAT & DISPLAY CONTRACT)
> 🚨 **QUY TẮC HIỂN THỊ ĐỐI THOẠI:**
> Mọi câu nói, phản hồi của Cyrene phát ra từ bất kỳ nguồn nào **BẮT BUỘC PHẢI XUẤT HIỆN Ở CỬA SỔ CHAT (`Alt+1`)**.

### 3.1. Các nguồn phát ngôn của Cyrene:
1. **Co-Watch Screen Reactions**: Khi Cyrene quan sát màn hình và đưa ra nhận xét.
2. **Gesture Interactions**: Khi người dùng xoa đầu (head-pat), vuốt ve (petting), click vào Live2D.
3. **Quick Mini-Chat (`Alt+5`)**: Khi người dùng gõ tin nhắn nhanh tại pet.
4. **Proactive Dialogue & Autonomous Thoughts**: Khi Cyrene tự động bắt chuyện lúc rảnh rỗi.

### 3.2. Yêu cầu kỹ thuật bắt buộc:
1. **Lưu trữ vào Session thật**:
   - Mọi câu nói phải được tạo thành tin nhắn `{ id, role: "model", content, at }` và gọi `chatsStore.appendMessage(sessionId, message)`.
   - Phải phát tín hiệu `broadcastChatsChanged()` (gửi IPC `chats:changed`) để các cửa sổ đồng bộ.
2. **Không phân biệt đối xử giữa Chat và Log**:
   - **Log (`Alt+4`)** chỉ là nơi ghi nhật ký vận hành kỹ thuật (telemetry / diagnostics).
   - **Chat (`Alt+1`)** là trải nghiệm chính của người dùng. **KHÔNG BAO GIỜ** chỉ ghi vào `pushActivityLog` mà bỏ quên không ghi vào `chatsStore`!
3. **Tuyệt đối cấm chuỗi Session ID `"default"`**:
   - Hệ thống `chatsStore` lưu tệp theo UUID dạng `sessions/<uuid>.json`.
   - Ghi vào `"default"` sẽ bị từ chối và drop tin nhắn trong im lặng.
   - Luôn luôn resolve session ID qua `ensureActiveChatSessionId()` (trả về active session hiện tại, hoặc session gần nhất từ `listSessions()`, hoặc tạo mới hợp lệ).
4. **Cửa sổ Chat (`Alt+1`) phải tự động reload**:
   - Khi người dùng nhấn `Alt+1` để unhide / switch vào cửa sổ chat, `chat/main.ts` phải gọi `loadSessionTailIntoUI()` để cập nhật các tin nhắn mới nhất được ghi trong nền.
   - Khi cửa sổ Chat nhận `focus`, phải kiểm tra `session.updatedAt > seenSessionUpdatedAt` và cập nhật tức thì.

---

## 4. QUY TẮC CO-WATCH (CO-WATCHING PACING & BEHAVIOR)
1. **Ngắn gọn, phản xạ nhanh, đúng lúc**:
   - Phản hồi quan sát màn hình chỉ được dài **1 đến 2 câu ngắn gọn**, ngọt ngào bằng tiếng Trung.
   - **CẤM YAPPING**: Không được độc thoại tràng giang đại hải, không liệt kê hay giải thích dài dòng như làm bài luận.
2. **Biểu tượng giao diện (Icons)**:
   - **KHÔNG DÙNG EMOJI**: Không dùng emoji icon (như 👁️, 💤, ⏸️...) trên giao diện HUD Co-Watch hay Chat.
   - Phải dùng **Vector SVG icons chuẩn** cao cấp, tinh tế, đồng bộ với toàn bộ design system của Cyrene Desktop.
3. **Không cướp quyền điều khiển (Non-intrusive)**:
   - Co-Watch hoạt động âm thầm bên cạnh Live2D pet.
   - Không được tự động bung cửa sổ Chat (`Alt+1`) đè lên ứng dụng người dùng đang làm việc (như Antigravity, VS Code, Browser...).

---

## 5. BỐ CỤC GIAO DIỆN & PHÍM TẮT (UI & SHORTCUTS)
1. **Thanh Zoom phần trăm Pet (`.pet-zoom-hud`)**:
   - Vị trí cố định: **Lệch hẳn sang cạnh phải** (`right: 14px; top: 50%; transform: translateY(-50%)`).
   - **TUYỆT ĐỐI KHÔNG ĐƯỢC ĐẶT Ở GIỮA MÀN HÌNH** che mất Live2D model của người dùng.
2. **Hệ thống phím tắt toàn cục (Global Shortcuts)**:
   - `Alt+1`: **Cyrene Chat Window** (Cửa sổ trò chuyện đầy đủ).
   - `Alt+2`: **Settings Center** (Trung tâm cài đặt LLM, TTS, Voice, Memory).
   - `Alt+3`: **Task Automation Window** (Cửa sổ quản lý tác vụ).
   - `Alt+4`: **Activity & Response Log** (Nhật ký phản hồi và hoạt động).
   - `Alt+5`: **Quick Mini-Chat** (Khung chat mini nổi cạnh Pet).
   - `Alt + Drag`: Kéo di chuyển Live2D Pet trên màn hình.
   - `Alt + Wheel`: Phóng to / Thu nhỏ Live2D Pet.

---

## 6. NHẬT KÝ SỰ CỐ & BÀI HỌC XƯƠNG MÁU (REGRESSION PREVENTION LEDGER)

| STT | Sự cố đã từng xảy ra | Nguyên nhân gốc rễ | Giải pháp triệt để đã chốt |
|---|---|---|---|
| **1** | **Voice bị đổi thành Edge-TTS / Tiếng Anh** | Agent trước tự ý fallback sang `zh-CN-XiaoyiNeural` và để `ttsEngine` mặc định là `web-speech` thay vì giữ vững mô hình GPT-SoVITS Cyrene. | Khóa chết cấu hình Voice: Chỉ dùng Hugging Face GPT-SoVITS (`resources/models/gptsovits/`). Đảm bảo `ttsGptsovitsRefAudioPath` luôn tự resolve tới tệp có sẵn. |
| **2** | **Em nó trả lời chỉ hiện trong Log `Alt+4`, mất tích trong Chat `Alt+1`** | Co-Watch chỉ gọi `pushActivityLog` và `PET_AGENT_EVENT` mà không gọi `chatsStore.appendMessage`. Đồng thời `onSwitchSession` ở Chat window bỏ qua không reload khi mở lại. | Bổ sung ghi `chatsStore.appendMessage` vào `deliverReaction`. Cập nhật Chat window reload message tail ngay lập tức khi unhide hoặc focus. |
| **3** | **Gesture xoa đầu/vuốt ve mất tin nhắn âm thầm** | `getOrCreateActiveSessionId` trả về chuỗi `"default"` khi chưa mở Alt+1. `chatsStore` từ chối `"default"` khiến tin nhắn bị drop. | Triển khai `ensureActiveChatSessionId()` ở main process. Dynamic query session hợp lệ từ `listSessions()` hoặc tạo mới, tuyệt đối không dùng `"default"`. |
| **4** | **Co-Watch yapping nói dai dẳng** | Prompt Co-Watch không giới hạn độ dài, khiến LLM sinh văn bản dài dòng rồi tốn thời gian đọc. | Siết prompt Co-Watch: Chỉ phản hồi 1-2 câu tiếng Trung ngắn gọn, tinh tế, giữ cooldown hợp lý. |
| **5** | **Thanh % zoom chắn giữa mặt Pet** | CSS `.pet-zoom-hud` trước đây để `left: 50%` canh giữa màn hình. | Đã chỉnh dời sang mép phải `right: 14px; top: 50%`. Cấm sửa lại vào giữa màn hình. |

---

## 7. CAM KẾT CHẤT LƯỢNG KHI LÀM VIỆC (AGENT WORKING PROTOCOL)
1. **Kiểm tra file này trước khi code**: Bất kỳ tính năng hay bugfix nào liên quan tới Voice, Chat, Live2D, Co-Watch đều phải đối chiếu với các điều khoản trong file này.
2. **Không tự ý giả định (No Assumptions)**: Nếu có điểm chưa rõ về ý đồ của User, hỏi trực tiếp hoặc giữ nguyên thiết lập đã chốt, không tự ý "sửa hộ" sang công nghệ khác.
3. **Bảo toàn Test & Build**: Luôn chạy `npx vitest` và `npm run build` trước khi hoàn tất công việc. Toàn bộ 252+ file test (1,898+ tests) phải pass 100%.
