const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('caMac', {
  status: () => ipcRenderer.invoke('ca-mac:status'),
  check: (profile) => ipcRenderer.invoke('ca-mac:check', profile),
});
