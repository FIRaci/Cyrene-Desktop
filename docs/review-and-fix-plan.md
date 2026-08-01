# Cyrene Test — Báo Cáo Review & Kế Hoạch Sửa Lỗi

> **Ngày tạo:** 2026-08-01  
> **Trạng thái:** Chờ duyệt — **chưa thực hiện sửa code**  
> **Phạm vi review:** Toàn bộ repo (codebase scan + đọc tài liệu MD + chạy build/test)

---

## 1. Dự Án Đang Làm Gì?

### 1.1. Tầm nhìn (theo docs tiếng Việt)

Cyrene Companion là **người bạn đồng hành ảo (Waifu / Virtual Companion)** chạy trên Windows Desktop:

- Live2D nhân vật **Cyrene (昔涟)** — từ *Honkai: Star Rail*
- Chat tiếng Việt, tính cách tsundere nhẹ, gọi user là **"chủ nhân"**
- Tự động tương tác khi idle, phản ứng khi click, nhận thức ngữ cảnh (cửa sổ đang mở, thời tiết, thời gian)
- LLM local qua **Ollama** (`llama3.1` tại `http://localhost:11434/api/chat`)
- Trí nhớ ngắn hạn (20 messages) + dài hạn (30 facts, localStorage)

### 1.2. Thực tế trong repo — **Hai stack song song**

| Layer | Mô tả | Entry point | Trạng thái |
|-------|--------|-------------|------------|
| **A. Companion đơn giản (VN fork)** | Electron thuần JS + 1 file HTML | `main.js` → `cyrene_companion.html` | **Đang chạy** (`package.json` main đã đổi) |
| **B. Cyrene-Agent đầy đủ (upstream)** | Electron + TypeScript, Agent workflow, TTS/ASR, Feishu/WeChat, RAG, Memory L0/L1/L2… | `dist/main/main/index.js` (gốc) | **Có source, không phải entry hiện tại** |

**Kết luận:** Repo này là fork của [Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent) nhưng đã **chuyển entry sang companion VN đơn giản** (Ollama local). Toàn bộ `src/` TypeScript vẫn còn và **build/test pass**, nhưng `npm start` hiện chạy `main.js` thay vì app đầy đủ.

### 1.3. Sơ đồ kiến trúc Companion (layer đang dùng)

```
┌─────────────────────────────────────────────────────────┐
│  main.js (Electron Main)                                │
│  - Tray, global shortcuts (Ctrl+1/2/3/` )              │
│  - Poll active window (PowerShell 5s)                   │
│  - Poll mouse position (33ms) → eye tracking            │
│  - IPC: setIgnoreMouseEvents, moveWindow                │
└────────────────────┬────────────────────────────────────┘
                     │ preload.js
┌────────────────────▼────────────────────────────────────┐
│  cyrene_companion.html (Renderer)                       │
│  - PixiJS + pixi-live2d-display                         │
│  - Chat panel, dialogue bubble, context menu            │
│  - Ollama API (JSON schema response)                    │
│  - MemorySystem (localStorage)                          │
│  - Idle thoughts loop (30s check, 120s idle)            │
│  - Weather/location (ip-api + wttr.in)                  │
└─────────────────────────────────────────────────────────┘
```

### 1.4. File launcher phụ

| File | Vai trò |
|------|---------|
| `Start Cyrene.bat` | Chạy `electron .` |
| `Cyrene.vbs` | Chạy bat ẩn (không hiện cửa sổ console) |
| `cyrene_app.py` | Launcher thay thế bằng pywebview (Python) |
| `get_active_window.ps1` | Lấy tiêu đề cửa sổ foreground (Win32 API) |

---

## 2. Kết Quả Verification (Đã Chạy)

| Kiểm tra | Kết quả | Ghi chú |
|----------|---------|---------|
| `npm test` (Vitest) | ✅ **196 files, 1593 tests PASS** | Test suite của layer B (TypeScript) |
| `npm run build` | ✅ **Exit 0** | Build skills + main + preload + renderer |
| `tsc -p tsconfig.main.json --noEmit` | ✅ **Pass** | Không lỗi type main process |
| `npm start` (companion) | ⚠️ **Chưa smoke test runtime** | Cần Ollama + Electron GUI |
| Live2D motion files | ✅ **Đã rename** `动作#6_N` → `动作_6_N` | Fix path `#` trên Windows |

---

## 3. Lỗi & Vấn Đề Phát Hiện

### 🔴 Critical — Ảnh hưởng runtime / hiệu năng

#### C1. Memory leak: `mousemove` listener bị đăng ký lặp trong `fitModel()`

**File:** `cyrene_companion.html` (~dòng 652–689)

**Vấn đề:** `fitModel()` được gọi mỗi lần `resize`. Bên trong có `document.addEventListener('mousemove', ...)` **không có guard**. Mỗi lần resize → thêm 1 listener → IPC `setIgnoreMouseEvents` bị gọi nhân đôi → lag FPS (đúng vấn đề mô tả trong `docs/code-standards.md` §3).

**Cách sửa:**
```javascript
// Thêm flag guard (tương tự _mouseListenerRegistered đã có cho eye tracking)
if (!window._mousemoveListenerRegistered) {
  window._mousemoveListenerRegistered = true;
  document.addEventListener('mousemove', (e) => { /* ... */ });
}
```

---

#### C2. Pollution short-term memory: greeting push JSON thay vì plain text

**File:** `cyrene_companion.html` (~dòng 789)

**Vấn đề:**
```javascript
conversationHistory.push({ role: 'assistant', content: JSON.stringify({ text }) });
```
Vi phạm `docs/code-standards.md` §2 — chỉ lưu `parsed.text`, không lưu JSON. LLM sẽ nhận chuỗi `{"text":"..."}` trong context → waste token + có thể hallucinate.

**Cách sửa:**
```javascript
conversationHistory.push({ role: 'assistant', content: text });
```

---

#### C3. Idle thoughts chạy khi chat đang mở

**File:** `cyrene_companion.html` (~dòng 833–836)

**Vấn đề:** Điều kiện idle chỉ check `!isTyping`, **không check `!isChatOpen`**. Khi user đang chat, Cyrene vẫn có thể tự lẩm bẩm bubble → gây nhiễu UX.

**Cách sửa:** Thêm `&& !isChatOpen` vào điều kiện idle loop (phiên bản trong `temp.js` đã có check này).

---

### 🟠 Important — Vi phạm tiêu chuẩn / chất lượng

#### I1. Emoji Unicode trong error message

**File:** `cyrene_companion.html` (~dòng 1203)

```javascript
addMessage('cyrene', '... Chủ nhân kiểm tra lại xem? 🥺');
```

Vi phạm `docs/code-standards.md` §1 — chỉ dùng kaomoji, không emoji Unicode.

**Cách sửa:** Thay `🥺` bằng `(´・ω・\')` hoặc tương đương.

---

#### I2. Dialogue bubble timeout 5s thay vì 6s

**File:** `cyrene_companion.html` (~dòng 817–819)

`docs/code-standards.md` §5 quy định fadeOut sau **6 giây**, code hiện dùng `5000`.

**Cách sửa:** Đổi `5000` → `6000`.

---

#### I3. `Cyrene.vbs` hardcode đường dẫn tuyệt đối

**File:** `Cyrene.vbs`

```vbscript
WshShell.Run chr(34) & "D:\Cyrene Test\Start Cyrene.bat" & Chr(34), 0
```

Không portable — fail nếu copy sang máy/folder khác.

**Cách sửa:** Dùng `CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)` để resolve path tương đối.

---

#### I4. `package.json` main trỏ sai stack so với upstream

**File:** `package.json`

```diff
- "main": "dist/main/main/index.js"   // upstream Cyrene-Agent
+ "main": "main.js"                    // companion VN fork
```

Không phải bug nếu **cố ý** chạy companion. Nhưng gây nhầm lẫn vì README upstream mô tả app đầy đủ.

**Cách sửa (đề xuất):** Thêm script riêng:
```json
"start:companion": "electron .",
"start:agent": "npm run build && electron dist/main/main/index.js"
```
Và document rõ trong README/docs.

---

### 🟡 Cleanup — File rác / trùng lặp

| File/Folder | Vấn đề | Hành động đề xuất |
|-------------|--------|-------------------|
| `build_temp/` | Copy trùng toàn bộ project (~1000+ files) | **Xóa** hoặc thêm vào `.gitignore` |
| `temp.js` | Bản draft cũ của companion logic, có bug thêm (idle → addMessage + push history) | **Xóa** |
| `test.js`, `test_0.js` … `test_4.js` | File scratch (chỉ polyfill `process`) | **Xóa** |
| `images (1).jpg` | Asset lạ, không dùng | **Xóa** hoặc move vào assets |
| `cyrene_preview.html` | Preview tĩnh, không wired vào app | Giữ hoặc xóa tùy nhu cầu |

---

### 🟢 Đã Fix (không cần làm lại)

| Item | Chi tiết |
|------|----------|
| Live2D motion `#` trong filename | Đã rename `动作#6_N` → `动作_6_N`, `Cyrene.model3.json` đã cập nhật path |
| Eye tracking listener duplicate | Đã có guard `_mouseListenerRegistered` |
| Idle không push vào `conversationHistory` | Phiên bản `cyrene_companion.html` hiện tại đúng (dùng `applyAIActions` only) |
| Click reaction không push history | Phiên bản hiện tại đúng (khác `temp.js`) |

---

### 📋 Documentation Gap

| Tài liệu | Vấn đề |
|----------|--------|
| `README.md` | Mô tả Cyrene-Agent đầy đủ (cloud LLM, Agent workflow) — **không khớp** companion VN fork |
| `docs/system-architecture.md` | Mô tả Ollama/llama3.1 — **khớp** companion |
| `docs/project-overview-pdr.md` | Mô tả vision VN — **khớp** companion |
| `docs/code-standards.md` | Quy tắc dev — **khớp** companion |

**Đề xuất:** Thêm `docs/companion-vs-agent.md` giải thích 2 layer và cách chạy từng cái.

---

## 4. Kế Hoạch Sửa Chi Tiết (File-by-File)

### Phase 1 — Fix bug runtime (ưu tiên cao)

#### 4.1. `cyrene_companion.html`

| # | Vị trí | Sửa gì | Sửa như thế nào |
|---|--------|--------|-----------------|
| 1 | `fitModel()` ~652 | Mousemove leak | Wrap listener trong guard `window._mousemoveListenerRegistered` |
| 2 | `openChat()` ~789 | JSON trong history | `content: text` thay vì `JSON.stringify({ text })` |
| 3 | Idle loop ~836 | Idle khi chat mở | Thêm `&& !isChatOpen` |
| 4 | `sendMessage()` catch ~1203 | Emoji | Thay `🥺` → kaomoji |
| 5 | `showDialogueBubble()` ~819 | Timeout | `5000` → `6000` |

**Diff mẫu Phase 1:**

```diff
// fitModel() — guard mousemove
+ if (!window._mousemoveListenerRegistered) {
+   window._mousemoveListenerRegistered = true;
    document.addEventListener('mousemove', (e) => {
      ...
    });
+ }

// openChat() greeting
- conversationHistory.push({ role: 'assistant', content: JSON.stringify({ text }) });
+ conversationHistory.push({ role: 'assistant', content: text });

// idle loop
- if (idleTime > 120000 && !isTyping) {
+ if (idleTime > 120000 && !isChatOpen && !isTyping) {

// error message
- '... Chủ nhân kiểm tra lại xem? 🥺'
+ '... Chủ nhân kiểm tra lại xem? (´・ω・\')'

// bubble timeout
- }, 5000);
+ }, 6000);
```

---

#### 4.2. `Cyrene.vbs`

| Sửa gì | Sửa như thế nào |
|--------|-----------------|
| Hardcoded path | Resolve path relative to script location |

```vbscript
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run Chr(34) & scriptDir & "\Start Cyrene.bat" & Chr(34), 0
```

---

### Phase 2 — Cấu trúc & scripts (ưu tiên trung bình)

#### 4.3. `package.json`

Thêm scripts tách biệt 2 mode:

```json
{
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "start:companion": "electron .",
    "start:agent": "npm run build && cross-env CYRENE_MODE=agent electron dist/main/main/index.js",
    "dev:companion": "electron .",
    "dev": "npm run build:skills && npm run build:main && npm run build:preload && concurrently \"vite\" \"cross-env VITE_DEV=1 electron dist/main/main/index.js\""
  }
}
```

> **Lưu ý:** Script `dev` gốc chạy agent mode. Companion mode không cần Vite dev server.

---

#### 4.4. `.gitignore` (nếu chưa có entry)

Thêm:
```
build_temp/
temp.js
test_*.js
test.js
images (1).jpg
```

---

### Phase 3 — Cleanup (ưu tiên thấp, cần confirm user)

| Hành động | File |
|-----------|------|
| Xóa | `build_temp/` (toàn bộ) |
| Xóa | `temp.js`, `test.js`, `test_0.js` … `test_4.js` |
| Xóa (optional) | `images (1).jpg`, `cyrene_preview.html` |

---

### Phase 4 — Documentation (sau khi fix code)

#### 4.5. `docs/companion-vs-agent.md` (file mới)

Nội dung:
- Giải thích 2 layer A/B
- Bảng so sánh tính năng
- Hướng dẫn chạy: `npm start` (companion) vs `npm run start:agent` (full agent)
- Yêu cầu: Ollama + llama3.1 cho companion; API key cho agent

#### 4.6. Cập nhật `docs/system-architecture.md`

- Thêm note ở đầu: "Tài liệu này mô tả **Companion Layer A**"
- Link sang README upstream cho Layer B

---

## 5. Thứ Tự Thực Hiện

```
Phase 1 (Critical bugs)     → cyrene_companion.html, Cyrene.vbs
        ↓
Verify manual               → Mở app, resize window, mở chat, test idle
        ↓
Phase 2 (Scripts)           → package.json
        ↓
Phase 3 (Cleanup)           → Xóa file rác [cần user OK]
        ↓
Phase 4 (Docs)              → companion-vs-agent.md
        ↓
Code review adversarial     → Re-check memory leaks, edge cases
```

---

## 6. Acceptance Criteria (Khi Nào Coi Là Xong)

- [ ] Resize window 10+ lần → không tăng số lượng mousemove handler (DevTools Performance ổn định)
- [ ] Mở chat lần đầu → `conversationHistory[0].content` là plain text, không phải JSON string
- [ ] Chat đang mở → idle thoughts **không** hiện bubble
- [ ] Error Ollama → message không chứa emoji Unicode
- [ ] Dialogue bubble biến mất sau ~6 giây
- [ ] `Cyrene.vbs` chạy được khi copy project sang folder khác
- [ ] `npm test` vẫn 1593/1593 pass (không regression layer B)
- [ ] `npm run build` vẫn exit 0

---

## 7. Out of Scope (Không Làm Trong Round Này)

| Item | Lý do |
|------|-------|
| Migrate companion sang TypeScript / vào `src/renderer/` | Refactor lớn, cần plan riêng |
| Tích hợp companion với Agent workflow (CITA, Action Gate…) | Scope khác hẳn |
| Fix/supply cloud LLM API key | Cấu hình user |
| Cài Ollama + pull llama3.1 | Môi trường user |
| Build Rust screenshot helper | Chỉ cần cho Agent mode |
| Việt hóa toàn bộ README upstream | Không liên quan companion |
| Xóa `build_temp/` nếu user còn dùng làm backup | Cần confirm |

---

## 8. Rủi Ro & Lưu Ý

1. **Ollama dependency:** Companion **không chạy chat** nếu Ollama offline hoặc chưa pull `llama3.1`. Đây là expected behavior, không phải bug code.
2. **Dual stack confusion:** Sửa companion không ảnh hưởng test suite TypeScript, nhưng dev mới có thể nhầm README vs thực tế entry point.
3. **`build_temp/`:** Có thể là backup thủ công — **hỏi user trước khi xóa**.
4. **Weather API:** `ip-api.com` + `wttr.in` cần internet; fail silently là đúng thiết kế.

---

## 9. Tóm Tắt Cho User

| Hạng mục | Số lượng |
|----------|----------|
| Bug Critical cần fix | **3** |
| Bug Important | **4** |
| File cần sửa code | **2** (`cyrene_companion.html`, `Cyrene.vbs`) |
| File cần sửa config | **1** (`package.json`) |
| File rác đề xuất xóa | **~8+** (incl. `build_temp/`) |
| Test/Build hiện tại | **PASS** (layer TypeScript) |

**Bước tiếp theo:** User duyệt plan này → Agent thực hiện Phase 1 → verify → Phase 2–4.

---

*Generated by codebase review scan — chưa apply bất kỳ thay đổi code nào.*
