import { contextBridge, ipcRenderer } from "electron";

function normalizeWindowState(state) {
  return {
    isMaximized: Boolean(state && typeof state === "object" && state.isMaximized)
  };
}

contextBridge.exposeInMainWorld(
  "marginDesktop",
  Object.freeze({
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    getSettings: () => ipcRenderer.invoke("settings:get"),
    updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
    onWindowState: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      let active = true;
      const pushState = (state) => {
        if (active) {
          callback(normalizeWindowState(state));
        }
      };
      const listener = (_event, state) => pushState(state);

      ipcRenderer.on("window:state", listener);
      ipcRenderer
        .invoke("window:get-state")
        .then((state) => {
          pushState(state);
        })
        .catch(() => {
          pushState({ isMaximized: false });
        });

      return () => {
        active = false;
        ipcRenderer.removeListener("window:state", listener);
      };
    }
  })
);
