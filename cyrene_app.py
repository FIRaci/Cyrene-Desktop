# -*- coding: utf-8 -*-
"""
Cyrene Desktop Companion - Full Version
========================================
- Transparent frameless overlay (always on top)
- Hidden from taskbar (only in system tray)
- Custom Cyrene icon in tray
- Desktop shortcut auto-created on first run

Requirements:
  pip install pywebview pystray pillow pywin32

Run:
  python cyrene_app.py  or  double-click "Start Cyrene.bat"
"""

import os
import sys
import io
import threading
import time
import http.server
import socketserver
import ctypes
from pathlib import Path

# Force stdout to UTF-8 so Vietnamese/special chars don't crash
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ==========================================
#  Config
# ==========================================
PORT        = 19234
BASE_DIR    = Path(__file__).resolve().parent
HTML        = "cyrene_companion.html"
ICON_ICO    = BASE_DIR / "cyrene_icon.ico"
ICON_PNG    = BASE_DIR / "cyrene_icon.png"
APP_W       = 480
APP_H       = 600
APP_TITLE   = "Cyrene"

# ==========================================
#  Win32 constants for hiding from taskbar
# ==========================================
GWL_EXSTYLE      = -20
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW  = 0x00040000

# ==========================================
#  Local file server (serves HTML + model assets)
# ==========================================
class _Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(BASE_DIR), **kw)

    def log_message(self, *_):
        pass  # silence console spam

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def _start_server():
    # Allow address reuse so restart doesn't need to wait
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), _Handler) as s:
        s.serve_forever()


# ==========================================
#  Hide window from taskbar (Win32)
# ==========================================
def _hide_from_taskbar(hwnd):
    try:
        user32 = ctypes.windll.user32
        ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        ex = (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex)
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0003)
        print("[Cyrene] OK: Hidden from taskbar")
    except Exception as e:
        print(f"[Cyrene] taskbar hide error: {e}")


def _find_hwnd(title="Cyrene"):
    try:
        hwnd = ctypes.windll.user32.FindWindowW(None, title)
        return hwnd if hwnd else None
    except Exception:
        return None


# ==========================================
#  JS API exposed to HTML/JavaScript
# ==========================================
class CyreneAPI:
    def __init__(self, win=None):
        self.win = win

    def minimize(self):
        if self.win:
            try:
                self.win.minimize()
            except Exception:
                pass

    def close_window(self):
        if self.win:
            try:
                self.win.destroy()
            except Exception:
                pass


# ==========================================
#  Tray icon
# ==========================================
def _load_tray_img():
    """Load user's Cyrene icon, fallback to purple circle."""
    try:
        from PIL import Image
        # Prefer PNG (faster), fallback to ICO
        if ICON_PNG.exists():
            return Image.open(ICON_PNG).convert("RGBA").resize((64, 64))
        elif ICON_ICO.exists():
            return Image.open(ICON_ICO).convert("RGBA").resize((64, 64))
    except Exception as e:
        print(f"[Cyrene] Icon load error: {e}")

    # Fallback: purple circle
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse([2, 2, 62, 62], fill=(199, 125, 222, 230))
        d.ellipse([20, 20, 44, 44], fill=(255, 255, 255, 200))
        return img
    except Exception:
        return None


def _run_tray(window):
    try:
        import pystray

        img = _load_tray_img()
        if img is None:
            print("[Cyrene] Tray icon unavailable")
            return

        shown = [True]

        def on_toggle(icon, _):
            if shown[0]:
                window.hide()
                shown[0] = False
            else:
                window.show()
                shown[0] = True
                threading.Timer(0.3, lambda: _hide_from_taskbar(_find_hwnd())).start()

        def on_quit(icon, _):
            icon.stop()
            window.destroy()

        menu = pystray.Menu(
            pystray.MenuItem("Hien/An Cyrene", on_toggle, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Thoat", on_quit),
        )
        icon = pystray.Icon("cyrene", img, "Cyrene - AI Companion", menu)
        icon.run()

    except ImportError:
        print("[Cyrene] pystray not installed - tray icon disabled")
    except Exception as e:
        print(f"[Cyrene] Tray error: {e}")


# ==========================================
#  Create Desktop shortcut
# ==========================================
def _create_desktop_shortcut():
    """Create or refresh a .lnk shortcut on the Desktop."""
    try:
        import win32com.client
        desktop = Path(os.path.expanduser("~")) / "Desktop"
        lnk_path = desktop / "Cyrene.lnk"

        # Always recreate to keep icon fresh
        shell = win32com.client.Dispatch("WScript.Shell")
        sc = shell.CreateShortcut(str(lnk_path))
        sc.TargetPath       = str(BASE_DIR / "Start Cyrene.bat")
        sc.WorkingDirectory = str(BASE_DIR)
        sc.IconLocation     = str(ICON_ICO) if ICON_ICO.exists() else ""
        sc.Description      = "Cyrene AI Desktop Companion"
        sc.WindowStyle      = 7   # Minimized = hides the bat console flash
        sc.Save()
        print(f"[Cyrene] Desktop shortcut OK: {lnk_path}")

    except ImportError:
        print("[Cyrene] pywin32 not found - skipping shortcut creation")
    except Exception as e:
        print(f"[Cyrene] Shortcut error: {e}")


# ==========================================
#  Screen size helper
# ==========================================
def _get_screen_size():
    try:
        u = ctypes.windll.user32
        return u.GetSystemMetrics(0), u.GetSystemMetrics(1)
    except Exception:
        return 1920, 1080


# ==========================================
#  Main
# ==========================================
def main():
    print("=" * 50)
    print("  Cyrene Desktop Companion")
    print("  Powered by Ollama (qwen2.5:7b)")
    print("=" * 50)

    # 1. Start local file server
    threading.Thread(target=_start_server, daemon=True).start()
    time.sleep(0.5)  # Wait for server to bind

    url = f"http://127.0.0.1:{PORT}/{HTML}"
    print(f"[Cyrene] Server -> {url}")

    # 2. Refresh desktop shortcut every launch (keeps icon in sync)
    threading.Thread(target=_create_desktop_shortcut, daemon=True).start()

    # 3. Import pywebview
    try:
        import webview
    except ImportError:
        import webbrowser
        print("[Cyrene] pywebview not found - run: pip install pywebview")
        webbrowser.open(url)
        input("Press Enter to quit...")
        return

    # 4. Position: bottom-right corner
    sw, sh = _get_screen_size()
    x = sw - APP_W - 16
    y = sh - APP_H - 56   # Leave space for taskbar

    api = CyreneAPI()

    # NOTE: background_color must be 6-char hex (#RRGGBB), NOT 8-char
    # Transparency is handled by transparent=True flag instead
    window = webview.create_window(
        title            = APP_TITLE,
        url              = url,
        width            = APP_W,
        height           = APP_H,
        x                = x,
        y                = y,
        frameless        = True,
        transparent      = True,
        on_top           = True,
        resizable        = False,
        shadow           = False,
        background_color = "#000000",   # 6-char - pywebview requirement
        js_api           = api,
    )
    api.win = window

    # 5. After page loads: hide from taskbar
    def _on_loaded():
        time.sleep(0.6)
        hwnd = _find_hwnd(APP_TITLE)
        if hwnd:
            _hide_from_taskbar(hwnd)
        else:
            print("[Cyrene] HWND not found - taskbar hiding skipped")

    window.events.loaded += lambda: threading.Thread(
        target=_on_loaded, daemon=True
    ).start()

    # 6. System tray (runs in background thread)
    threading.Thread(target=_run_tray, args=(window,), daemon=True).start()

    print("[Cyrene] Starting window (check system tray for icon)")
    webview.start(debug=False, private_mode=False)
    print("[Cyrene] Exited.")


if __name__ == "__main__":
    main()
