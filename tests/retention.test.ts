import { afterEach, describe, expect, it } from 'vitest';
import { ScreenshotRepository, pixelHash } from '../electron/repository';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
let repository: ScreenshotRepository;
let root: string;
let time = 1_790_000_000_000;
function create() { root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-retention-')); repository = new ScreenshotRepository(root, () => time); return repository; }
function add(n: number) { const png = Buffer.from(`synthetic image ${n}`); const hash = pixelHash(png, n + 1, 10); repository.add({ hash, png, thumbnail: png, width: n + 1, height: 10 }, 'clipboard'); return hash; }
afterEach(() => { repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
describe('retention, restart and deletion boundaries', () => {
  it('retains exactly 30 active and at most 100 recycled items', () => { create(); for (let i = 0; i < 132; i++) { time++; add(i); } expect(repository.list('active')).toHaveLength(30); expect(repository.list('recycled')).toHaveLength(100); });
  it('expires recycled copies after seven days and leaves the active originals', () => { create(); const id = add(1); add(2); repository.recycle(id); time += 7 * 86400000; expect(repository.purge()).toBe(true); expect(repository.list('recycled')).toHaveLength(0); expect(repository.list('active')).toHaveLength(1); });
  it('does not resurrect a recycled image when the other source reports a duplicate', () => { create(); const id = add(1); repository.recycle(id); add(1); expect(repository.list('active')).toHaveLength(0); expect(repository.list('recycled')).toHaveLength(1); });
  it('recovers settings, active images and recycle state after reopening the database', () => { create(); const id = add(1); add(2); repository.recycle(id); repository.updateSettings({ opacity: .8 }); repository.close(); repository = new ScreenshotRepository(root, () => time); expect(repository.list('recycled')[0].id).toBe(id); expect(repository.list('active')).toHaveLength(1); expect(repository.getSettings().opacity).toBe(.8); });
  it('removes missing image rows and orphan files after a simulated interrupted write', () => { create(); const id = add(1); fs.unlinkSync(repository.getPath(id)); const orphan = path.join(repository.screenshots, `${'f'.repeat(64)}.png`); fs.writeFileSync(orphan, 'orphan'); repository.close(); repository = new ScreenshotRepository(root, () => time); expect(repository.list('active')).toHaveLength(0); expect(fs.existsSync(orphan)).toBe(false); });
  it('rejects path traversal and invalid settings before changing data', () => { create(); add(1); expect(() => repository.getPath('../../secrets')).toThrow(); expect(() => repository.updateSettings({ activeLimit: NaN })).toThrow(); expect(() => repository.updateSettings({ activeLimit: 0 })).toThrow(); expect(repository.getSettings().activeLimit).toBe(30); });
});
