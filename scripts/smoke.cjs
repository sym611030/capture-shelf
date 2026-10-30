const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appDir = path.resolve(__dirname, '..');
const executablePath = process.env.CAPTURE_SHELF_ELECTRON || require('electron');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-shelf-e2e-'));
const evidence = process.env.CAPTURE_SHELF_EVIDENCE || path.join(appDir, 'outputs');
fs.mkdirSync(evidence, { recursive: true });
const failures = [];
const checks = [];
let app;
async function launch() {
  const env = { ...process.env, CAPTURE_SHELF_TEST: '1', CAPTURE_SHELF_TEST_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: [appDir], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => failures.push(error.message));
  await page.waitForFunction(() => !!window.captureShelf && document.querySelector('.app-shell'));
  return page;
}
const state = () => app.evaluate(({ app }) => app.captureShelfTest.state());
const ingest = data => app.evaluate(({ app }, image) => app.captureShelfTest.ingest(image), data);
async function count(page, n) { await page.waitForFunction(expected => document.querySelectorAll('.rope-card').length === expected, n, { timeout: 7000 }); }
async function panelAction(page, name) {
  await page.getByRole('button', { name: '更多选项' }).click();
  await page.getByRole('menuitem', { name }).click();
}
async function drawSamples(page) {
  return page.evaluate(() => {
    const names = ['Product notes', 'A quiet afternoon', 'Week planner', 'Terminal / local', 'Design tokens', 'Capture ideas', 'Image reference', 'Local files'];
    const colors = ['#E6E5DF', '#6E9A83', '#EBE3D6', '#1C2834', '#E2DFD8', '#D8E5E0', '#9DABB9', '#ECE9E1'];
    return Array.from({ length: 32 }, (_, index) => {
      const canvas = document.createElement('canvas'); canvas.width = 920; canvas.height = 620;
      const c = canvas.getContext('2d');
      c.fillStyle = colors[index % colors.length]; c.fillRect(0, 0, 920, 620);
      c.fillStyle = index % 8 === 3 ? '#374758' : 'rgba(255,255,255,.6)'; c.fillRect(0, 0, 920, 55);
      c.fillStyle = '#637068'; c.font = '16px Segoe UI'; c.fillText('SYNTHETIC TEST IMAGE', 26, 34);
      c.fillStyle = index % 8 === 3 ? '#D6F2E4' : '#243A32'; c.font = 'bold 38px Segoe UI'; c.fillText(names[index % 8], 48, 128);
      if (index % 8 === 1 || index % 8 === 6) {
        c.fillStyle = '#B8D0C6'; c.fillRect(48, 165, 824, 360);
        c.fillStyle = '#7BA18B'; c.beginPath(); c.moveTo(48, 450); c.lineTo(300, 230); c.lineTo(510, 450); c.fill();
        c.fillStyle = '#477B65'; c.beginPath(); c.moveTo(320, 525); c.lineTo(645, 210); c.lineTo(872, 525); c.fill();
        c.fillStyle = '#F1E2AF'; c.beginPath(); c.arc(720, 240, 40, 0, Math.PI * 2); c.fill();
      } else if (index % 8 === 2) {
        for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) { c.fillStyle = row === 1 && col === 2 ? '#A3C9B9' : '#F8F4EC'; c.fillRect(48 + col * 166, 170 + row * 85, 151, 72); }
      } else {
        for (let row = 0; row < 8; row++) { c.fillStyle = index % 8 === 3 ? (row % 3 === 0 ? '#91D7B5' : '#758B9B') : '#A2B1A7'; c.fillRect(48, 175 + row * 38, 400 + ((row * 73) % 380), 12); }
      }
      c.fillStyle = index % 8 === 3 ? '#677D8D' : '#6F8277'; c.font = '16px Segoe UI'; c.fillText(`LOCAL TEST · ${String(index + 1).padStart(2, '0')}`, 48, 580);
      return canvas.toDataURL('image/png');
    });
  });
}
(async () => {
  let page = await launch();
  const version = await app.evaluate(({ app }) => process.versions.electron);
  await page.getByRole('dialog', { name: '让截图，随手可用' }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'onboarding.png') });
  assert.equal((await state()).active.length, 0);
  await page.getByRole('button', { name: '开始使用' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => innerHeight === 80);
  checks.push('empty rope uses 80px and has no persistent toolbars');
  checks.push('first-run disclosure before any capture');
  const samples = await drawSamples(page);
  await ingest(samples[0]); await count(page, 1);
  await page.waitForFunction(() => innerHeight <= 230 && document.querySelector('.rope-card-surface').getBoundingClientRect().top < 65);
  assert.equal(await page.locator('.rope-toolbar, .rope-footer, .view-tabs').count(), 0);
  checks.push('photos hang immediately below the rope in a compact window');
  // A synthetic DragEvent has no held native mouse button. Inspect the browser
  // handoff here; real desktop gestures are verified separately.
  await app.evaluate(({ app, ipcMain }) => {
    app.nativeDragListeners = ipcMain.listeners('start-drag');
    ipcMain.removeAllListeners('start-drag');
    app.nativeDragRequests = [];
    ipcMain.on('start-drag', (_event, id) => app.nativeDragRequests.push(id));
  });
  const browserDragCanceled = await page.locator('.rope-card-surface').evaluate(element => {
    const event = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(browserDragCanceled, true, 'native file drag must cancel the competing Chromium drag');
  const nativeDragRequests = await app.evaluate(({ app, ipcMain }) => {
    ipcMain.removeAllListeners('start-drag');
    for (const listener of app.nativeDragListeners) ipcMain.on('start-drag', listener);
    return app.nativeDragRequests.length;
  });
  assert.equal(nativeDragRequests, 1);
  checks.push('native drag cancels Chromium default drag and preserves the source window');
  assert.equal(await ingest(samples[0]), false);
  checks.push('decoded image deduplication');
  const watchDir = fs.mkdtempSync(path.join(dataDir, 'watch-'));
  fs.writeFileSync(path.join(watchDir, 'existing.png'), Buffer.from(samples[4].split(',')[1], 'base64'));
  await app.evaluate(({ app }, directory) => app.captureShelfTest.addWatch(directory), watchDir);
  await page.waitForTimeout(550); assert.equal((await state()).active.length, 1);
  fs.writeFileSync(path.join(watchDir, 'same-pixels.png'), Buffer.from(samples[0].split(',')[1], 'base64'));
  await page.waitForTimeout(650); assert.equal((await state()).active.length, 1);
  const before = Date.now();
  fs.writeFileSync(path.join(watchDir, 'new-image.png'), Buffer.from(samples[1].split(',')[1], 'base64'));
  await count(page, 2);
  const directoryLatencyMs = Date.now() - before;
  checks.push('directory watcher ignores existing files and deduplicates clipboard capture');
  for (let i = 2; i < 31; i++) await ingest(samples[i]);
  await count(page, 30);
  assert.equal((await state()).recycled.length, 1);
  const recycledId = (await state()).recycled[0].id;
  await panelAction(page, '打开回收区'); await count(page, 1);
  await page.getByRole('button', { name: '恢复到绳子' }).click(); await count(page, 1);
  assert.ok((await state()).active.some(item => item.id === recycledId));
  checks.push('31st capture recycles the oldest; restore at full capacity preserves restored item');
  await page.getByRole('button', { name: '返回最近截图' }).click(); await count(page, 30);
  await page.locator('.rope-card-surface').first().click();
  await page.getByRole('status').filter({ hasText: '图片已复制' }).waitFor();
  checks.push('click-to-copy bridge and user feedback (OS clipboard isolated)');
  const id = (await state()).active[0].id;
  const dragPath = await app.evaluate(({ app }, id) => app.captureShelfTest.dragFile(id), id);
  assert.ok(fs.existsSync(dragPath));
  await page.evaluate(id => window.captureShelf.recycleImage(id), id);
  await page.evaluate(id => window.captureShelf.permanentlyDeleteImage(id), id);
  assert.ok(fs.existsSync(dragPath));
  checks.push('materialized drag file survives removal of shelf original');
  await panelAction(page, '切换置顶');
  assert.equal((await state()).settings.alwaysOnTop, false);
  await panelAction(page, '暂停全部捕获');
  assert.equal((await state()).captureStatus, 'paused');
  fs.writeFileSync(path.join(watchDir, 'paused-image.png'), Buffer.from(samples[31].split(',')[1], 'base64'));
  await page.waitForTimeout(650); assert.equal((await state()).active.length, 29);
  checks.push('pin toggle and pause stop directory capture');
  await panelAction(page, '设置');
  await page.screenshot({ path: path.join(evidence, 'settings.png') });
  await page.getByRole('button', { name: '返回截图' }).click();
  await panelAction(page, '继续捕获');
  const results = await page.evaluate(async () => {
    let invalidSettingsRejected = false; let traversalRejected = false; let networkBlocked = false;
    try { await window.captureShelf.updateSettings({ opacity: NaN }); } catch { invalidSettingsRejected = true; }
    try { await window.captureShelf.openImage('../../secrets'); } catch { traversalRejected = true; }
    try { await fetch('https://example.com/'); } catch { networkBlocked = true; }
    return { invalidSettingsRejected, traversalRejected, networkBlocked, nodeHidden: typeof window.require === 'undefined' };
  });
  assert.ok(Object.values(results).every(Boolean)); checks.push('IPC validation, path traversal, no renderer Node access and blocked network');
  // Show eight uncluttered synthetic images for the deliverable preview.
  await page.evaluate(() => window.captureShelf.updateSettings({ activeLimit: 10 }));
  await page.waitForTimeout(4200);
  await page.screenshot({ path: path.join(evidence, 'capture-shelf-preview.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 215));
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, 'compact-preview.png') });
  checks.push('1180px and 720px layouts fit the native window');
  const beforeRestart = await state();
  await app.close(); app = undefined;
  page = await launch();
  assert.equal((await state()).active.length, beforeRestart.active.length);
  assert.equal((await state()).recycled.length, beforeRestart.recycled.length);
  assert.equal((await state()).settings.alwaysOnTop, false);
  assert.equal(await page.getByRole('dialog').count(), 0);
  checks.push('restart restores SQLite metadata, preferences and onboarding');
  assert.deepEqual(failures, []);
  const report = { ok: true, runtime: `Electron ${version} / ${process.platform}`, directoryLatencyMs, checks, failures, limitations: ['OS clipboard deliberately isolated', 'External chat-client drop and macOS device acceptance require live tests'] };
  fs.writeFileSync(path.join(evidence, 'e2e-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
