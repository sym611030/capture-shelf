import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CaptureShelfAPI } from './contracts';
function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}
const api: CaptureShelfAPI = {
  getState: () => ipcRenderer.invoke('get-state'),
  updateSettings: (patch) => ipcRenderer.invoke('update-settings', patch),
  addDirectory: () => ipcRenderer.invoke('add-directory'),
  removeDirectory: (directory) => ipcRenderer.invoke('remove-directory', directory),
  importImages: () => ipcRenderer.invoke('import-images'),
  ingestDroppedImage: async (file) => ipcRenderer.invoke('ingest-dropped-image', webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])),
  setInteractiveRegions: (regions) => { ipcRenderer.send('set-interactive-regions', regions); },
  setPanelExpanded: (expanded, compactHeight) => { ipcRenderer.send('set-panel-expanded', expanded, compactHeight); },
  copyImage: (id) => ipcRenderer.invoke('copy-image', id),
  openImage: (id) => ipcRenderer.invoke('open-image', id),
  recycleImage: (id) => ipcRenderer.invoke('recycle-image', id),
  restoreImage: (id) => ipcRenderer.invoke('restore-image', id),
  permanentlyDeleteImage: (id) => ipcRenderer.invoke('delete-image', id),
  emptyRecycle: () => ipcRenderer.invoke('empty-recycle'),
  startDrag: (id) => ipcRenderer.send('start-drag', id),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  quit: () => ipcRenderer.invoke('quit'),
  onStateChange: (callback) => subscribe('state-changed', callback),
  onViewChange: (callback) => subscribe('view-changed', callback),
  onNotice: (callback) => subscribe('notice', callback),
};
contextBridge.exposeInMainWorld('captureShelf', api);
