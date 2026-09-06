const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marginShell', Object.freeze({
  setExpanded(expanded) { ipcRenderer.send('margin-shell:set-expanded', Boolean(expanded)); },
  hide() { ipcRenderer.send('margin-shell:hide'); },
  quit() { ipcRenderer.send('margin-shell:quit'); },
  toggleAlwaysOnTop() { return ipcRenderer.invoke('margin-shell:toggle-always-on-top'); },
  getAlwaysOnTop() { return ipcRenderer.invoke('margin-shell:get-always-on-top'); },
}));
