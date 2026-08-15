const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  onOpenEmote: (callback) => ipcRenderer.on('trigger-emote-menu', callback),
  onOpenChat: (callback) => ipcRenderer.on('trigger-chat', callback),
  onToggleLogPanel: (callback) => ipcRenderer.on('trigger-log-panel', callback),
  onToggleNsPanel: (callback) => ipcRenderer.on('trigger-ns-panel', callback),
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', dx, dy),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  onActiveWindowChanged: (callback) => ipcRenderer.on('active-window-changed', callback),
  onSystemAudioChanged: (callback) => ipcRenderer.on('system-audio-changed', callback),
  onMousePos: (callback) => ipcRenderer.on('mouse-pos', callback),
  onIncomingRemielleMessage: (callback) => ipcRenderer.on('incoming-remielle-message', callback),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  // Phase 4 — Task Automation
  taskOpenUrl: (url) => ipcRenderer.invoke('task-open-url', url),
  taskListDir: (dirPath) => ipcRenderer.invoke('task-list-dir', dirPath),
  taskCreateFile: (filePath, content) => ipcRenderer.invoke('task-create-file', filePath, content),
  taskRename: (oldPath, newPath) => ipcRenderer.invoke('task-rename', oldPath, newPath),
  taskRunCmd: (command) => ipcRenderer.invoke('task-run-cmd', command),
});
