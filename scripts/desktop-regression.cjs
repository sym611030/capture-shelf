// Explicitly opt into a desktop/clipboard integration run; npm test never runs it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { _electron, chromium } = require('playwright');
if (process.platform !== 'win32' || !process.argv.includes('--live-clipboard')) {
  throw new Error('Run on Windows with --live-clipboard to exercise native desktop gestures and restore the clipboard afterward.');
}
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-shelf-desktop-'));
const edgePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
let app, browser, page, clipboardSaved = false;
const checks = [];
const gesture = (from, to) => {
  const values = [...from, ...to].map(Math.round);
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ShelfMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); }';
    [ShelfMouse]::SetCursorPos(${values[0]},${values[1]}) | Out-Null;
    Start-Sleep -Milliseconds 100;
    [ShelfMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero);
    for ($step=1;$step -le 20;$step++) {
      [ShelfMouse]::SetCursorPos([int](${values[0]}+(${values[2]}-${values[0]})*$step/20),[int](${values[1]}+(${values[3]}-${values[1]})*$step/20)) | Out-Null;
      Start-Sleep -Milliseconds 25;
    }
    [ShelfMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero);
  `], { windowsHide: true, timeout: 10000, stdio: 'pipe' });
};
const state = () => page.evaluate(() => window.captureShelf.getState());
const waitState = async predicate => {
  const deadline = Date.now() + 6000;
  let current;
  do { current = await state(); if (predicate(current)) return current; await page.waitForTimeout(100); } while (Date.now() < deadline);
  throw new Error(JSON.stringify({ error: 'capture timeout', warnings: current?.warnings, count: current?.active.length }));
};
(async () => {
  const env = { ...process.env, CAPTURE_SHELF_DATA: profile };
  for (const name of ['CAPTURE_SHELF_TEST', 'CAPTURE_SHELF_PREVIEW', 'ELECTRON_RUN_AS_NODE', 'CAPTURE_SHELF_CLICK_THROUGH']) delete env[name];
  app = await _electron.launch({ executablePath: process.env.CAPTURE_SHELF_ELECTRON || require('electron'), args: [root], env });
  page = await app.firstWindow();
  await page.waitForFunction(() => window.captureShelf && document.querySelector('.app-shell'));
  await page.getByRole('button', { name: '开始使用' }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.evaluate(() => window.captureShelf.updateSettings({ clipboardCaptureEnabled: false }));
  await app.evaluate(async ({ app, clipboard, ClipboardItem }) => {
    app.clipboardBackupForRegression = [];
    for (const entry of await clipboard.read()) {
      const blobs = {};
      for (const type of entry.types) blobs[type] = await entry.getType(type);
      app.clipboardBackupForRegression.push(new ClipboardItem(blobs));
    }
    await clipboard.write([]);
  });
  clipboardSaved = true;
  const sample = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 647; canvas.height = 409;
    const context = canvas.getContext('2d'); context.fillStyle = '#d7e8de'; context.fillRect(0, 0, 647, 409);
    context.fillStyle = '#184f38'; context.font = '30px sans-serif'; context.fillText('DESKTOP CAPTURE TEST', 35, 180);
    return canvas.toDataURL();
  });
  await page.evaluate(() => window.captureShelf.updateSettings({ clipboardCaptureEnabled: true }));
  const started = Date.now();
  await app.evaluate(async ({ clipboard, ClipboardItem }, data) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(data.split(',')[1], 'base64')], { type: 'image/png' }) })]);
  }, sample);
  const captured = await waitState(current => current.active.some(item => item.width === 647 && item.height === 409 && item.source === 'clipboard'));
  const clipboardLatencyMs = Date.now() - started;
  assert.equal(captured.preview, false);
  checks.push('normal mode automatically collects an image written to the real OS clipboard');
  await page.evaluate(() => window.captureShelf.updateSettings({ clipboardCaptureEnabled: false }));
  const id = captured.active.find(item => item.width === 647 && item.height === 409).id;
  for (const item of captured.active) if (item.id !== id) await page.evaluate(id => window.captureShelf.recycleImage(id), item.id);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 30, width: 1180, height: 215 }));
  await page.waitForTimeout(300);
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const handle = await page.locator('.rope-drag-handle').boundingBox();
  gesture([before.x + handle.x + handle.width / 2, before.y + handle.y + handle.height / 2], [before.x + handle.x + handle.width / 2 + 45, before.y + handle.y + handle.height / 2 + 25]);
  const moved = await app.evaluate(({ BrowserWindow }) => ({ bounds: BrowserWindow.getAllWindows()[0].getBounds(), visible: BrowserWindow.getAllWindows()[0].isVisible() }));
  assert.equal(moved.visible, true);
  assert.ok(moved.bounds.x !== before.x || moved.bounds.y !== before.y, 'dragging the title should move the rope');
  assert.ok(moved.bounds.y >= 0, 'title must remain on-screen');
  checks.push('physical title drag moves the rope and preserves a visible window');
  assert.ok(edgePath, 'Edge is needed for the cross-process file upload test');
  const fixture = path.join(profile, 'drop-target.html');
  fs.writeFileSync(fixture, '<!doctype html><meta charset="utf-8"><style>body{font:22px sans-serif;padding:30px;background:#edf4ef}input{display:block;width:650px;height:210px;padding:30px;border:3px dashed #65977b;box-sizing:border-box}</style><h1>Local file-drop regression</h1><input id="upload" type="file" accept="image/*"><p id="result">Drop screenshot here</p><script>upload.onchange=async()=>{const f=upload.files[0];window.received={name:f.name,type:f.type,bytes:[...new Uint8Array(await f.arrayBuffer())].slice(0,8)};result.textContent=f.name;}</script>');
  browser = await chromium.launch({ executablePath: edgePath, headless: false, args: ['--window-position=700,430', '--window-size=1000,580', '--no-first-run'] });
  const target = await browser.newPage({ viewport: null });
  await target.goto(require('node:url').pathToFileURL(fixture).href);
  const upload = await target.locator('#upload').boundingBox();
  const frame = await target.evaluate(() => ({ x: screenX, y: screenY, chrome: outerHeight - innerHeight, scale: devicePixelRatio }));
  assert.equal(frame.scale, 1, 'this regression run expects desktop scale 100%');
  const source = await page.locator(`.rope-card[data-id="${id}"] .rope-card-surface`).boundingBox();
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  gesture([bounds.x + source.x + source.width / 2, bounds.y + source.y + source.height / 2], [frame.x + upload.x + upload.width / 2, frame.y + frame.chrome + upload.y + upload.height / 2]);
  await target.waitForFunction(() => window.received, null, { timeout: 5000 });
  const received = await target.evaluate(() => window.received);
  assert.equal(received.type, 'image/png');
  assert.deepEqual(received.bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  const after = await app.evaluate(({ BrowserWindow }) => ({ visible: BrowserWindow.getAllWindows()[0].isVisible(), bounds: BrowserWindow.getAllWindows()[0].getBounds() }));
  assert.equal(after.visible, true);
  assert.deepEqual(after.bounds, bounds);
  checks.push('physical image drag uploads a valid PNG into a separate Edge process and keeps the rope visible');
  const report = { ok: true, runtime: 'Electron 45.1.0 / Windows', clipboardLatencyMs, checks, limitations: ['macOS and individual chat clients still need device acceptance'] };
  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'outputs', 'desktop-regression.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (app && clipboardSaved) {
    await page.evaluate(() => window.captureShelf.updateSettings({ capturePaused: true })).catch(() => {});
    await app.evaluate(async ({ app, clipboard }) => { await clipboard.write(app.clipboardBackupForRegression); }).catch(error => { console.error('Clipboard restore failed:', error.message); process.exitCode = 1; });
  }
  if (browser) await browser.close();
  if (app) await app.close();
});
