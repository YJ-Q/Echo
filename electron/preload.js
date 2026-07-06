import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("echoDesktop", {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  onWindowState: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, state) => callback(state);
    ipcRenderer.on("window:state", listener);
    ipcRenderer.invoke("window:get-state").then((state) => callback(state));

    return () => ipcRenderer.removeListener("window:state", listener);
  }
});
