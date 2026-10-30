import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, screen, session, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ScreenshotRepository } from './repository';
import { CaptureService, type WatchDirectory } from './capture-service';
import { DragService } from './drag-service';
import { clampBounds, type Bounds } from './window-state';
import type { AppState, SettingsPatch, View } from './contracts';

app.setName('Capture Shelf');
const testMode = !app.isPackaged && process.env.CAPTURE_SHELF_TEST === '1';
const previewMode = testMode && process.env.CAPTURE_SHELF_PREVIEW === '1';
if (testMode && process.env.CAPTURE_SHELF_TEST_DATA) app.setPath('userData', path.resolve(process.env.CAPTURE_SHELF_TEST_DATA));
if (!testMode && process.env.CAPTURE_SHELF_DATA) app.setPath('userData', path.resolve(process.env.CAPTURE_SHELF_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'shelf-image', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win: BrowserWindow | null = null;
let tray: Tray | undefined;
let repository: ScreenshotRepository;
let capture: CaptureService;
let drag: DragService;
let quitting = false;
let timer: NodeJS.Timeout;
let saveBoundsTimer: NodeJS.Timeout;
let interactiveRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
let compactBounds: Bounds | undefined;
const warnings = new Set<string>();
const assetPath = (name: string) => path.join(__dirname, '../assets', name);
const devUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
const rendererFile = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;

function watchDirectories(): WatchDirectory[] {
  const rules: WatchDirectory[] = [];
  if (!testMode) {
    const pictures = app.getPath('pictures');
    if (process.platform === 'win32') {
      rules.push({ directory: path.join(pictures, 'Screenshots'), screenshotNamesOnly: false }, { directory: path.join(pictures, '屏幕截图'), screenshotNamesOnly: false });
    } else {
      try {
        const configured = execFileSync('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).trim();
        if (path.isAbsolute(configured)) rules.push({ directory: configured, screenshotNamesOnly: true });
      } catch { /* unset location means Desktop */ }
      rules.push({ directory: path.join(pictures, 'Screenshots'), screenshotNamesOnly: false });
    }
    rules.push({ directory: app.getPath('desktop'), screenshotNamesOnly: true });
  }
  for (const directory of repository.getSettings().watchedDirectories) rules.push({ directory, screenshotNamesOnly: false });
  const unique = new Map<string, WatchDirectory>();
  for (const rule of rules) unique.set(path.resolve(rule.directory), rule);
  return [...unique.values()];
}
function state(): AppState {
  const settings = repository.getSettings();
  return {
    preview: previewMode,
    active: repository.list('active'), recycled: repository.list('recycled'), settings,
    watchedDirectories: watchDirectories().map((rule) => rule.directory), warnings: [...warnings], platform: process.platform,
    captureStatus: settings.capturePaused || !settings.onboardingComplete || (!settings.clipboardCaptureEnabled && !settings.directoryCaptureEnabled) ? 'paused' : 'running',
  };
}
function broadcast() { if (win && !win.isDestroyed()) win.webContents.send('state-changed', state()); }
function notice(message: string) { win?.webContents.send('notice', message); }
function warn(message: string) {
  warnings.add(message);
  if (warnings.size > 4) warnings.delete(warnings.values().next().value!);
  broadcast();
}
function show(view?: View) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  const bounds = win.getBounds();
  win.setBounds(clampBounds(bounds, screen.getDisplayMatching(bounds).workArea));
  win.show(); win.focus();
  if (view) win.webContents.send('view-changed', view);
}
function updateTray() {
  if (!tray) return;
  const settings = repository.getSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示截图板', click: () => show('active') },
    { label: '打开回收区', click: () => show('recycled') },
    { label: '暂停全部自动捕获', type: 'checkbox', checked: settings.capturePaused, click: (item) => { void updateSettings({ capturePaused: item.checked }).catch((error) => notice(error.message)); } },
    { type: 'separator' }, { label: '退出', click: () => app.quit() },
  ]));
}
async function updateSettings(patch: SettingsPatch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || 'watchedDirectories' in patch) throw new Error('无效设置');
  const previous = repository.getSettings();
  if (patch.onboardingComplete === false && previous.onboardingComplete) throw new Error('初始化状态不可回退');
  if (patch.launchAtLogin === true && (!app.isPackaged || testMode)) throw new Error('登录启动仅在安装版中启用');
  const settings = repository.updateSettings(patch);
  if ('launchAtLogin' in patch && app.isPackaged && !testMode) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  win?.setAlwaysOnTop(settings.alwaysOnTop);
  win?.setOpacity(settings.opacity);
  if (['directoryCaptureEnabled', 'capturePaused', 'onboardingComplete'].some((key) => key in patch)) await capture.restartDirectories();
  updateTray(); broadcast();
  return state();
}
function validateSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (event.sender !== win?.webContents || !url || !(url === rendererFile || (devUrl && new URL(url).origin === new URL(devUrl).origin))) throw new Error('拒绝未知窗口请求');
}
function registerIpc() {
  const handle = (channel: string, action: (...args: any[]) => unknown) => ipcMain.handle(channel, async (event, ...args) => {
    validateSender(event);
    try { return await action(...args); }
    catch (error) { throw new Error((error as Error).message); }
  });
  handle('get-state', state);
  handle('update-settings', updateSettings);
  handle('add-directory', async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: '选择截图文件夹' });
    if (!result.canceled && result.filePaths[0]) {
      const directory = fs.realpathSync(result.filePaths[0]);
      const appData = fs.realpathSync(repository.root);
      if (directory === appData || directory.startsWith(appData + path.sep)) throw new Error('不能监听应用自己的缓存目录');
      repository.updateSettings({ watchedDirectories: [...new Set([...repository.getSettings().watchedDirectories, directory])] });
      await capture.restartDirectories(); broadcast();
    }
    return state();
  });
  handle('remove-directory', async (directory: string) => {
    repository.updateSettings({ watchedDirectories: repository.getSettings().watchedDirectories.filter((entry) => entry !== directory) });
    await capture.restartDirectories(); broadcast(); return state();
  });
  handle('import-images', async () => {
    const result = await dialog.showOpenDialog(win!, { title: '导入图片', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    let count = 0;
    for (const file of result.filePaths) { try { if (capture.ingestFile(file)) count++; } catch (error) { notice((error as Error).message); } }
    if (!result.canceled) notice(`已导入 ${count} 张新图片，重复图片自动跳过`);
    return state();
  });
  handle('ingest-dropped-image', (filePath: string) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('无法读取拖入的文件');
    const resolved = fs.realpathSync(filePath);
    const appData = fs.realpathSync(repository.root);
    if (resolved === appData || resolved.startsWith(appData + path.sep)) throw new Error('不能把截图板自己的缓存文件重新拖入');
    if (!/\.(png|jpe?g|webp)$/i.test(resolved)) throw new Error('请拖入 PNG、JPG 或 WebP 图片');
    capture.ingestFile(resolved, 'manual');
    broadcast();
    return state();
  });
  ipcMain.on('set-interactive-regions', (event, regions: unknown) => {
    try {
      validateSender(event as unknown as IpcMainInvokeEvent);
      if (!Array.isArray(regions) || regions.length > 256) return;
      interactiveRegions = regions.filter((region): region is { x: number; y: number; width: number; height: number } => {
        if (!region || typeof region !== 'object') return false;
        const candidate = region as Record<string, unknown>;
        return ['x', 'y', 'width', 'height'].every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))
          && Number(candidate.width) >= 0 && Number(candidate.height) >= 0;
      }).map((region) => ({ x: Math.max(0, region.x), y: Math.max(0, region.y), width: Math.min(2400, region.width), height: Math.min(1200, region.height) }));
    } catch { /* ignore stale renderer messages */ }
  });
  handle('copy-image', async (id: string) => {
    const image = nativeImage.createFromPath(repository.getPath(id));
    if (image.isEmpty()) throw new Error('原图不可读');
    capture.markCopied(image);
    if (!testMode) {
      if (typeof (clipboard as any).read === 'function') await (clipboard as any).write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })]);
      else (clipboard as any).writeImage(image);
    }
  });
  handle('open-image', async (id: string) => {
    const target = repository.getPath(id);
    if (!testMode) { const error = await shell.openPath(target); if (error) throw new Error(error); }
  });
  for (const [channel, action] of [
    ['recycle-image', (id: string) => repository.recycle(id)],
    ['restore-image', (id: string) => repository.restore(id)],
    ['delete-image', (id: string) => repository.permanentlyDelete(id)],
  ] as const) handle(channel, (id: string) => { action(id); broadcast(); return state(); });
  handle('empty-recycle', () => { repository.emptyRecycle(); broadcast(); return state(); });
  handle('hide-window', () => win?.hide());
  handle('open-data-folder', async () => { if (!testMode) await shell.openPath(repository.root); });
  handle('quit', () => app.quit());
  ipcMain.on('set-panel-expanded', (event, expanded: unknown, compactHeight: unknown) => {
    try {
      validateSender(event as unknown as IpcMainInvokeEvent);
      if (typeof expanded !== 'boolean' || !win) return;
      const height = typeof compactHeight === 'number' && Number.isInteger(compactHeight) && compactHeight >= 80 && compactHeight <= 380 ? compactHeight : 230;
      if (expanded && !compactBounds) {
        compactBounds = { ...win.getBounds(), height };
        const area = screen.getDisplayMatching(compactBounds).workArea;
        win.setBounds(clampBounds({ ...compactBounds, height: Math.max(compactBounds.height, 640) }, area));
      } else if (!expanded && compactBounds) {
        const current = win.getBounds();
        const next = { ...current, height };
        compactBounds = undefined;
        win.setBounds(clampBounds(next, screen.getDisplayMatching(next).workArea));
      } else if (!expanded && win.getBounds().height !== height) {
        const next = { ...win.getBounds(), height };
        win.setBounds(clampBounds(next, screen.getDisplayMatching(next).workArea));
      }
    } catch { /* ignore stale renderer messages */ }
  });
  // Send instead of async invoke keeps the native drag attached to Chromium's dragstart gesture.
  ipcMain.on('start-drag', (event, id: string) => {
    try {
      validateSender(event as unknown as IpcMainInvokeEvent);
      const file = drag.prepareDragFile(id);
      const icon = nativeImage.createFromPath(file).resize({ width: 96 });
      event.sender.startDrag({ file, icon });
    } catch (error) { notice(`拖放失败：${(error as Error).message}`); }
  });
}
function createWindow() {
  const saved = repository.getValue<Bounds>('window-bounds');
  const display = saved ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay();
  const bounds = clampBounds(saved, display.workArea);
  const settings = repository.getSettings();
  win = new BrowserWindow({
    ...bounds, minWidth: 720, minHeight: 80, frame: false, resizable: true, show: false,
    transparent: true, hasShadow: false, alwaysOnTop: settings.alwaysOnTop, opacity: settings.opacity, backgroundColor: '#00000000',
    title: 'Capture Shelf', icon: assetPath('icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, webSecurity: true },
  });
  const save = () => {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => { if (win && !win.isDestroyed()) repository.setValue('window-bounds', compactBounds ? { ...win.getNormalBounds(), height: compactBounds.height } : win.getNormalBounds()); }, 250);
  };
  win.on('move', save).on('resize', save);
  win.on('moved', () => {
    if (!win) return;
    const current = win.getBounds();
    const visible = clampBounds(current, screen.getDisplayMatching(current).workArea);
    if (current.x !== visible.x || current.y !== visible.y) win.setBounds(visible);
  });
  win.on('close', (event) => { if (!quitting) { event.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', () => warn('界面进程异常，重新打开应用可恢复本地截图。'));
  win.once('ready-to-show', () => win?.show());
  if (devUrl) void win.loadURL(devUrl); else void win.loadFile(path.join(__dirname, '../dist/index.html'));
  screen.on('display-removed', () => {
    if (!win) return;
    const current = win.getBounds();
    win.setBounds(clampBounds(current, screen.getDisplayMatching(current).workArea));
  });
}
async function start() {
  const root = path.join(app.getPath('userData'), 'capture-shelf');
  repository = new ScreenshotRepository(root);
  drag = new DragService(root, (id) => repository.getPath(id));
  capture = new CaptureService(repository, watchDirectories, broadcast, warn, testMode);
  protocol.handle('shelf-image', async (request) => {
    try {
      const url = new URL(request.url);
      const match = /^\/([a-f0-9]{64})\/thumb$/.exec(url.pathname);
      if (url.hostname !== 'image' || !match) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(repository.getPath(match[1], true)).href);
      return response;
    } catch { return new Response('Not found', { status: 404 }); }
  });
  // The released app cannot make HTTP(S) requests; captures remain local.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    callback({ cancel: !(devUrl && ['http://127.0.0.1:5173', 'ws://127.0.0.1:5173'].includes(new URL(details.url).origin)) });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  registerIpc(); createWindow();
  if (!testMode || previewMode) {
    tray = new Tray(nativeImage.createFromPath(assetPath(process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png')));
    tray.setToolTip('Capture Shelf · 截图板');
    tray.on('click', () => show()); updateTray();
  }
  capture.start();
  timer = setInterval(() => { try { if (repository.purge()) broadcast(); drag.cleanupExpiredDragFiles(); } catch (error) { warn(`本地清理失败：${(error as Error).message}`); } }, 60000);
  if (!testMode && !globalShortcut.register('CommandOrControl+Shift+Space', () => win?.isVisible() ? win.hide() : show())) warn('显示快捷键被其他程序占用，可通过托盘打开。');
  if (testMode) {
    // Only exists in unpackaged, explicitly isolated test runs. Never reads the user's clipboard.
    (app as any).captureShelfTest = {
      ingest: (dataUrl: string, source = 'clipboard') => capture.ingestNative(nativeImage.createFromDataURL(dataUrl), source as any),
      state,
      dragFile: (id: string) => drag.prepareDragFile(id),
      addWatch: async (directory: string) => { repository.updateSettings({ watchedDirectories: [directory] }); await capture.restartDirectories(); return state(); },
      pointerState: () => ({ ignored: false, regions: interactiveRegions, bounds: win?.getBounds() }),
    };
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => show());
  app.whenReady().then(start).catch((error) => { dialog.showErrorBox('Capture Shelf 启动失败', `${error.message}\n本地数据未被重置。`); app.quit(); });
  app.on('activate', () => show());
  app.on('before-quit', () => {
    quitting = true; clearInterval(timer); clearTimeout(saveBoundsTimer); globalShortcut.unregisterAll();
    if (win && !win.isDestroyed() && repository) repository.setValue('window-bounds', compactBounds ? { ...win.getNormalBounds(), height: compactBounds.height } : win.getNormalBounds());
    void capture?.stop();
  });
  app.on('will-quit', () => { tray?.destroy(); repository?.close(); });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
}
