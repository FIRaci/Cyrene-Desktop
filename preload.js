const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  onOpenEmote: (callback) => ipcRenderer.on('trigger-emote-menu', callback),
  onOpenChat: (callback) => ipcRenderer.on('trigger-chat', callback),
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', dx, dy),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  onActiveWindowChanged: (callback) => ipcRenderer.on('active-window-changed', callback),
  onSystemAudioChanged: (callback) => ipcRenderer.on('system-audio-changed', callback),
  onMousePos: (callback) => ipcRenderer.on('mouse-pos', callback)
});
