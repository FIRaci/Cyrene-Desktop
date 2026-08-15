const { app, BrowserWindow, ipcMain, Tray, Menu, screen, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');

let mainWindow;
let tray = null;
let lastActiveWindow = '';

const APP_W = 800;
const APP_H = 600;

let isPollingWindow = false;

function pollAndSendActiveWindow() {
  if (isPollingWindow) return;
  isPollingWindow = true;
  exec('powershell -NoProfile -ExecutionPolicy Bypass -File get_active_window.ps1', { cwd: __dirname, timeout: 4000 }, (err, stdout) => {
    isPollingWindow = false;
    if (err) return;
    const title = stdout.trim();
    // Always push current title so renderer knows what Master is doing (not only on change)
    if (title && !title.includes('Cyrene')) {
      lastActiveWindow = title;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('active-window-changed', title);
      }
    }
  });
}

let isPollingAudio = false;
let lastAudioState = '';

function pollAndSendAudio() {
  if (isPollingAudio) return;
  isPollingAudio = true;
  exec('powershell -NoProfile -ExecutionPolicy Bypass -File get_audio_sessions.ps1', { cwd: __dirname, timeout: 4000 }, (err, stdout) => {
    isPollingAudio = false;
    if (err) return;
    try {
      const dataStr = stdout.trim();
      if (dataStr !== lastAudioState) {
        lastAudioState = dataStr;
        const data = JSON.parse(dataStr);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('system-audio-changed', data);
        }
      }
    } catch(e) {}
  });
}

// Poll active window every 5 seconds
setInterval(pollAndSendActiveWindow, 5000);
// Poll audio every 5 seconds (offset by 2.5s to reduce spike)
setTimeout(() => {
  setInterval(pollAndSendAudio, 5000);
}, 2500);

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = width - APP_W - 16;
  const y = height - APP_H; // Work area already excludes taskbar

  mainWindow = new BrowserWindow({
    width: APP_W,
    height: APP_H,
    x: x,
    y: y,
    frame: false,            // No window frame
    transparent: true,       // Native transparency
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,       // Hide from taskbar
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,      // Allow local file:// fetch for Live2D model
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver'); // Prevent Alt-Tab flicker by forcing highest z-index

  mainWindow.loadFile('cyrene_companion.html');

  // DevTools: uncomment below to debug in UI
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Make sure it clicks through transparent areas correctly (optional, but good for widgets)
  // We won't do ignoreMouseEvents because we need to interact with the UI.

  // Forward renderer console logs to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (line: ${line}, source: ${sourceId})`);
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'cyrene_icon.ico');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show / Hide Cyrene', 
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          // Force skip taskbar again just in case Windows tries to show it
          mainWindow.setSkipTaskbar(true);
        }
      } 
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.quit();
      } 
    }
  ]);
  
  tray.setToolTip('Cyrene - AI Companion');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.setSkipTaskbar(true);
      }
    }
  });
}

// Hardware acceleration can sometimes mess up transparency on certain Windows configs, 
// but usually it's fine. We disable it only if transparency is fully broken.
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Initial active-window snapshot (renderer needs this before first title change)
  setTimeout(pollAndSendActiveWindow, 800);

  // Poll global mouse position (30 FPS) for Live2D eye tracking
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      const pos = screen.getCursorScreenPoint();
      mainWindow.webContents.send('mouse-pos', pos);
    }
  }, 33);

  // Register Global Shortcuts
  // Ctrl+1: Toggle Hide/Show
  globalShortcut.register('CommandOrControl+1', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // If it's visible AND focused, we hide. Otherwise, we force show.
      // Games might push the window back, so if it's visible but not focused, showing brings it to front.
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        // Give it always on top temporarily to pierce fullscreen apps
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
      }
    }
  });

  // Ctrl+`: Quit App
  globalShortcut.register('CommandOrControl+`', () => {
    app.quit();
  });

  // Ctrl+2: Open Chat
  globalShortcut.register('CommandOrControl+2', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible() || !mainWindow.isFocused()) {
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
      }
      mainWindow.webContents.send('trigger-chat');
    }
  });

  // Ctrl+3: Toggle Emote Context Menu
  globalShortcut.register('CommandOrControl+3', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible() || !mainWindow.isFocused()) {
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
      }
      mainWindow.webContents.send('trigger-emote-menu');
    }
  });

  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on('window-move', (e, dx, dy) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  });

  // ----------------------------------------------------
  // Screen Vision Tool
  // ----------------------------------------------------
  ipcMain.handle('take-screenshot', async () => {
    try {
      const sources = await desktopCapturer.getSources({ 
        types: ['screen'], 
        thumbnailSize: { width: 1280, height: 720 } 
      });
      if (sources.length > 0) {
        // Return the first screen as a base64 image (removing the data:image/png;base64, prefix for Ollama)
        const dataUrl = sources[0].thumbnail.toDataURL();
        return dataUrl.replace(/^data:image\/\w+;base64,/, '');
      }
      return null;
    } catch (err) {
      console.error('[Vision] Error capturing screen:', err);
      return null;
    }
  });

  ipcMain.on('set-ignore-mouse', (event, ignore) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Start IPC Server for Remielle
  const ipcServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/chat') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data && data.message) {
            console.log(`[IPC Cyrene] Received from Remielle: ${data.message}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('incoming-remielle-message', data.message);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch(e) {
          res.writeHead(400);
          res.end('Bad Request');
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  ipcServer.listen(39393, () => {
    console.log('[IPC Cyrene] Listening on port 39393 for Remielle messages.');
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
