# 📁 CYRENE DESKTOP ARCHITECTURE & DIRECTORY STRUCTURE

Dự án **Cyrene Desktop** được tổ chức theo kiến trúc phân tầng chuyên nghiệp, chuẩn mực của một ứng dụng AI Desktop Companion hiện đại (kết hợp Electron, TypeScript, Live2D Cubism, LanceDB Vector DB và hệ sinh thái kỹ năng AI).

---

## 🏛️ TỔNG QUAN CÁC KHU VỰC CHỨC NĂNG

```
d:\Cyrene-Desktop/ (hoặc d:\Cyrene Test/)
│
├── 🧠 data/ ──► [Junction liên kết sang D:\CyreneData] (Cơ sở dữ liệu & bộ nhớ người dùng)
├── ⚙️ src/
│   ├── main/       ──► Backend (Electron Main Process, Orchestrator, RAG, Memory, Scheduler)
│   ├── renderer/   ──► Frontend (Live2D Pet, Chat UI, Settings, Call Window HUD, Tasks)
│   ├── preload/    ──► Secure IPC Bridge (Cầu nối giao tiếp an toàn 2 chiều)
│   └── shared/     ──► Shared Contracts (Types, IPC Channels, Themes, Enums)
├── 🧩 skills/      ──► 9 Kỹ năng Agent thông minh mở rộng (Office, Voice, Music, v.v.)
├── 🤖 models/      ──► Mô hình AI cục bộ (BGE Reranker, MiniLM Vector Embedding)
├── 🎨 assets/      ──► Tài nguyên nhân vật Live2D (Moc3, Model3, Textures, Physics)
├── 📜 prompts/     ──► Linh hồn nhân vật (soul.md, persona, system prompts)
├── 🛠️ resources/   ──► Native C++ Binary (cyrene-screenshot.exe)
├── 📚 docs/        ──► Toàn bộ tài liệu đặc tả, checklist kiểm thử & kiến trúc
└── 🚀 scripts/     ──► Công cụ build, test tự động và smoke test
```

---

## 1. ⚙️ BACKEND (`src/main/`) — Trái Tim Xử Lý Của Cyrene

Backend chịu trách nhiệm toàn bộ logic nghiệp vụ, quản lý vòng đời ứng dụng, giao tiếp với các mô hình AI (Ollama/Cloud), cơ sở dữ liệu và hệ điều hành:

- `src/main/index.ts`: Entry point chính của Electron, quản lý vòng đời ứng dụng, System Tray, Global Shortcuts, tạo và điều phối các cửa sổ.
- `src/main/orchestrator/`: Động cơ điều phối công cụ (Tool Orchestrator):
  - `built-in-tools.ts`: Công cụ tìm kiếm web DuckDuckGo miễn phí (`web_search`), thời tiết Open-Meteo (`weather`), chạy lệnh an toàn (`run_shell`), đọc nội dung trang web (`fetch_url`).
  - `travel-tools.ts`: Công cụ lập kế hoạch lộ trình đường bộ toàn cầu (`plan_trip`), tính khoảng cách và thời gian di chuyển với Open-Meteo / Google Maps.
  - `life-tools.ts`: Quản lý tài chính cá nhân, tỷ giá hối đoái, ghi chép chi tiêu.
  - `tool-registry.ts`: Sổ đăng ký kiểm soát quyền thực thi công cụ theo cấp độ phân quyền an toàn (*read-only*, *companion-safe*, *unrestricted*).
- `src/main/rag/`: Hệ thống RAG & Cơ sở dữ liệu Vector:
  - Tích hợp **LanceDB** (`@lancedb/lancedb`) lưu trữ và truy vấn vector ngữ nghĩa tốc độ cao dưới dạng file nhúng, không cần chạy server ngầm.
  - `document-cache.ts`: Cache tài liệu và văn bản đã được đánh chỉ mục.
- `src/main/memory/`: Hệ thống Trí Nhớ Nhân Vật (Short-term & Long-term Memory):
  - `entity-graph.ts`: Đồ thị thực thể (Entity Graph) lưu giữ các mối quan hệ, sở thích và thông tin người dùng.
  - `memory-judge.ts`: AI phán đoán xem thông tin mới trong cuộc trò chuyện có đáng đưa vào trí nhớ dài hạn không.
  - `memory-compressor.ts`: Nén và tổng hợp trí nhớ để tối ưu token ngữ cảnh.
- `src/main/audio/` & `src/main/call/`: Xử lý âm thanh & Cuộc gọi thoại thời gian thực:
  - `call-manager.ts`: Quản lý trạng thái gọi thoại (VAD, duplex audio state, kết nối nhận diện giọng nói).
  - Tích hợp Google Web Speech ASR nội bộ cho người nói tiếng Anh ESL.
- `src/main/scheduler/`: Động cơ lập lịch chủ động (Scheduler Engine) cho các tác vụ định kỳ và lời nhắc nhở.
- `src/main/chats/`: Quản lý danh sách các phiên trò chuyện (`chats-store.ts`) và lịch sử tin nhắn.

---

## 2. 🎨 FRONTEND (`src/renderer/`) — Giao Diện Người Dùng Sống Động

Giao diện người dùng được xây dựng hiện đại, phong cách thủy tinh (Glassmorphism), animation mượt mà, phân tách thành các cửa sổ độc lập:

- `src/renderer/index.html` & `src/renderer/index.ts`: **Cửa sổ nhân vật Live2D để bàn (Pet Companion)**:
  - Render nhân vật Live2D với khung trong suốt, không viền (*frameless*), luôn nổi trên các ứng dụng khác (*always-on-top*).
  - Hỗ trợ tương tác vuốt ve (*touch/hitbox*), nháy mắt, cử động theo chuột, kéo thả (`Alt + Drag`) và zoom mượt mà (`Alt + Wheel`).
- `src/renderer/chat/`: **Cửa sổ Trò Chuyện (Floating Chat Window)**:
  - Hiển thị phản hồi streaming Markdown, tô màu cú pháp code với Shiki, đính kèm ảnh chụp màn hình, nút bấm micro gọi thoại nhanh.
- `src/renderer/settings/`: **Bảng Điều Khiển Cài Đặt Toàn Diện (Settings UI)**:
  - Cấu hình Model AI (Ollama Local / Cloud), công cụ tìm kiếm DuckDuckGo, âm thanh TTS (GPT-SoVITS & RVC Model), phân quyền an toàn và theme giao diện.
- `src/renderer/call/`: **Giao Diện Gọi Thoại HUD (Call Window)**:
  - Nền hiệu ứng hạt ánh sáng lung linh (*particle canvas*), hiển thị phụ đề thời gian thực và trạng thái lắng nghe / trả lời.
- `src/renderer/sidebar/`: Thanh trạng thái phụ, hiển thị cảm xúc hiện tại của Cyrene (*feeling status*).
- `src/renderer/tasks/`: Giao diện quản lý danh sách công việc và lịch nhắc nhở.
- `src/renderer/sticker-manager/`: Quản lý bộ sưu tập nhãn dán biểu cảm của Cyrene.

---

## 3. 🌉 IPC BRIDGE (`src/preload/`) & SHARED CONTRACTS (`src/shared/`)

- `src/preload/index.ts`: Cầu nối trung gian an toàn (`contextBridge`) giữa Frontend và Backend. Cô lập môi trường Renderer (`contextIsolation: true`, `nodeIntegration: false`), ngăn chặn hoàn toàn các lỗ hổng XSS.
  - Phơi bày các API có kiểu rõ ràng: `window.cyrene`, `window.chat`, `window.call`, `window.settings`, `window.tasks`.
- `src/shared/`:
  - `ipc-channels.ts`: Định nghĩa tập trung tất cả các kênh IPC, loại trừ lỗi gõ sai chuỗi sự kiện.
  - `preferences.ts`: Các tùy chọn mặc định của người dùng.
  - `ui-theme.ts` & `ui-font.ts`: Hệ thống chủ đề giao diện (Dark/Light) và phông chữ.

---

## 4. 🧩 EXTENSIBLE SKILLS (`skills/`) — 9 Kỹ Năng Agent Chuyên Sâu

Thư mục `skills/` chứa các module kỹ năng độc lập, được Agent tự động nạp và gọi khi bạn yêu cầu các tác vụ chuyên biệt:

1. **`cyrene-music-companion/`**: Trợ lý âm nhạc, tìm kiếm bài hát, quản lý danh sách phát và đồng hành thưởng thức âm nhạc.
2. **`cyrene-original-voice/`**: Điều khiển giọng nói nguyên bản của Cyrene, kết nối hệ thống chuyển văn bản thành giọng nói (GPT-SoVITS) và chuyển đổi ngữ điệu (RVC).
3. **`docx/`**: Kỹ năng đọc, phân tích, tạo lập và định dạng các văn bản Microsoft Word (`.docx`).
4. **`pdf/`**: Kỹ năng trích xuất nội dung, tìm kiếm và phân tích tài liệu PDF.
5. **`pptx-generator/`**: Kỹ năng tự động tạo bài thuyết trình PowerPoint (`.pptx`) từ nội dung trao đổi.
6. **`self-improving-agent/`**: Kỹ năng tự học và tự cải thiện phản hồi dựa trên phản hồi của người dùng.
7. **`skill-creator/`**: Kỹ năng mở rộng cho phép Agent tự thiết kế và cài đặt thêm các kỹ năng mới.
8. **`write-expense-report/`**: Tự động tổng hợp và kết xuất báo cáo chi tiêu, tài chính.
9. **`xlsx/`**: Kỹ năng xử lý, tính toán và phân tích bảng tính Excel (`.xlsx`).

---

## 5. 🤖 LOCAL AI MODELS (`models/`)

Chứa các mô hình Transformer cục bộ dùng cho tác vụ phân tích nhanh trong tiến trình app:
- `bge-reranker-base`: Mô hình cross-encoder đánh giá độ liên quan của các đoạn văn bản truy xuất từ RAG.
- `ms-marco-MiniLM-L-6-v2`: Mô hình vector embedding phục vụ tìm kiếm tương đồng ngữ nghĩa.

---

## 6. 🧠 USER PERSISTENT DATA (`data/` ──► `D:\CyreneData`)

Thư mục `data/` trong dự án là một **NTFS Directory Junction** trỏ trực tiếp đến `D:\CyreneData`. Tất cả dữ liệu của bạn được gom gọn gàng tại đây, không tốn ổ C:
- `data/rag-data/`: Cơ sở dữ liệu vector LanceDB.
- `data/chats/`: Lịch sử các phiên trò chuyện.
- `data/cyrene-tts-cache/`: File âm thanh giọng nói đã tổng hợp.
- `data/model-settings.json`: Cấu hình API và Model AI.
- `data/app-settings.json`: Cài đặt giao diện và ứng dụng.
- `data/user-profile.json`: Hồ sơ của bạn để Cyrene ghi nhớ tên, cách xưng hô.
- `data/memory.json`: Bộ nhớ sự thật và đồ thị quan hệ dài hạn.

---

## 7. 🚀 KHỞI ĐỘNG & ĐỔI TÊN THƯ MỤC DỰ ÁN

- **Khởi động ứng dụng**: Chạy file [`Start Cyrene.bat`](file:///d:/Cyrene%20Test/Start%20Cyrene.bat) hoặc lệnh `npm start`.
- **Về việc đổi tên thư mục gốc thành `Cyrene-Desktop`**:
  - Tên dự án trong `package.json` đã được cập nhật thành: `"name": "cyrene-desktop"`.
  - Để đổi tên thư mục gốc trên ổ đĩa từ `d:\Cyrene Test` sang `d:\Cyrene-Desktop`, bạn chỉ cần:
    1. Đóng Antigravity IDE (để giải phóng thư mục làm việc hiện tại).
    2. Chạy file [`Rename-Folder-To-Cyrene-Desktop.bat`](file:///d:/Cyrene%20Test/Rename-Folder-To-Cyrene-Desktop.bat).
    3. Mở lại Antigravity IDE tại đường dẫn mới `d:\Cyrene-Desktop`.
