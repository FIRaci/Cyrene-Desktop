# Cyrene Desktop

**Cyrene Desktop** là phiên bản desktop companion dành cho Cyrene (昔涟) — nhân vật đến từ tựa game *Honkai: Star Rail* của HoYoverse.

Dự án được fork từ [Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent) và phát triển thành bản companion tiếng Việt chạy hoàn toàn bằng AI cục bộ qua **Ollama** — không cần API key, không cần kết nối cloud.

Live2D Cyrene luôn ở trên màn hình, có thể trò chuyện, tương tác cảm xúc và tự động nhắc chuyện khi bạn đang rảnh.

---

## Tinh nang

- Live2D desktop pet trong suot, luon o tren cung, co the keo tha va an trong system tray
- Tro chuyen tieng Viet voi ca tinh day du (nhan cach, cam xuc, ky uc, ke hoach noi chuyen)
- Hoat dong 100% local qua Ollama — khong can API key
- Cam bien hoat dong: nhan biet cua so dang dung, am thanh, chuot de tu dong tuong tac
- TTS noi chuyen duoc (tuy chon)
- He thong nhan cach + ky uc dai han tu prompt engine cua Cyrene-Agent goc

---

## Yeu cau

- **Windows 10 / 11 64-bit**
- **[Ollama](https://ollama.com)** da cai dat va da pull model:

```powershell
ollama pull llama3.1
# hoac: ollama pull qwen2.5:7b
```

- **Node.js 24 LTS** (chay bang Electron)

---

## Cach chay

### Cach 1: Electron (khuyen nghi)

```powershell
npm ci
Start Cyrene.bat
```

hoac:

```powershell
npm ci
npm start
```

### Cach 2: Python (nhe nhat)

```powershell
pip install pywebview pystray pillow pywin32
python cyrene_app.py
```

Mac dinh companion goi `llama3.1` tai `http://localhost:11434/api/chat`. Neu dung model khac, doi trong `cyrene_companion.html` (bien `OLLAMA_BASE` / `model`).

---

## Cau truc

```
cyrene_companion.html   # Giao dien companion chinh (Live2D + chat)
cyrene_app.py           # Cach chay bang Python (pywebview)
main.js                 # Cach chay bang Electron
preload.js              # IPC bridge cho Electron
Start Cyrene.bat        # Chao chuong trinh nhanh
get_active_window.ps1   # Cam bien cua so dang dung
get_audio_sessions.ps1  # Cam bien am thanh he thong
prompts/                # Prompt engine: nhan cach, the gioi, cam xuc, ky uc
docs/                   # Tai lieu kien truc (tieng Viet)
```

---

## Tri an

Du an nay khong the thanh hinh neu thieu su dong gop cua nhung nguoi va du an tuyet voi sau:

- **[Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent)** — du an goc ma toi fork ra. Cam on tac gia vi da xay dung mot Live2D AI desktop companion day du va ma nguon mo, cho phep toi hoc hoi va phat trien them.
- **[Ollama](https://ollama.com)** — nen tang LLM local mien phi, giup Cyrene chay hoan toan offline, khong can API key.
- **[@是依七哒](https://space.bilibili.com/457683484)** — hoa sy da ve va lam Live2D model Cyrene. Cam on vi da cho phep su dung, chinh sua va tai phan phoi model trong du an nay (xem [MODEL_LICENSE.md](./MODEL_LICENSE.md)).
- **HoYoverse / mihoyo** — chu so huu nhan vat "Cyrene" (昔涟) trong *Honkai: Star Rail*.
- **Live2D Cubism SDK** — SDK render Live2D duoc su dung trong du an.

Mot lan nua, cam on that nhieu! <3

---

## Ghi chu ban quyen

- **Ma nguon** cua du an nay duoc cap phep theo [MIT License](./LICENSE).
- **Nhan vat Cyrene, Live2D model va tai nguyen nghe thuat** khong thuoc pham vi MIT — xem [MODEL_LICENSE.md](./MODEL_LICENSE.md) va quy tac fan-work cua mihoyo.
- Day la du an fan-made phi thuong mai, khong lien ket, xac nhan hay tai tro boi HoYoverse / mihoyo.

---

Neu ban thich du an nay, hay cho du an goc [Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent) mot star nhe!
