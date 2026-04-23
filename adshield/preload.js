const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adshieldElectron', {
  reportBlocked: () => ipcRenderer.send('adshield-content-blocked'),
  getCount:      () => ipcRenderer.invoke('adshield-get-count'),
  resetCount:    () => ipcRenderer.invoke('adshield-reset-count'),
  onCountUpdate: (cb) => ipcRenderer.on('adshield-count-update', (_, n) => cb(n)),
});