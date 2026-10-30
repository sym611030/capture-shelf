import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_SETTINGS, type AppSettings, type CaptureSource, type ScreenshotItem, type SettingsPatch, type View } from './contracts';

interface RecordRow {
  id: string; hash: string; source: CaptureSource; width: number; height: number;
  created_at: number; activated_at: number; recycled_at: number | null; state: View;
}
export interface PreparedImage { hash: string; png: Buffer; thumbnail: Buffer; width: number; height: number }

export class ScreenshotRepository {
  private db: DatabaseSync;
  readonly screenshots: string;
  readonly thumbnails: string;
  constructor(readonly root: string, private now: () => number = Date.now) {
    this.screenshots = path.join(root, 'screenshots');
    this.thumbnails = path.join(root, 'thumbnails');
    for (const directory of [root, this.screenshots, this.thumbnails]) fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'metadata.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, source TEXT NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL,
        activated_at INTEGER NOT NULL, recycled_at INTEGER, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS item_state ON items(state, activated_at);`);
    this.reconcile();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  getSettings(): AppSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='preferences'").get() as { value: string } | undefined;
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
  }
  updateSettings(patch: SettingsPatch | { watchedDirectories: string[] }): AppSettings {
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.has(key)) throw new Error('未知设置');
      const example = DEFAULT_SETTINGS[key as keyof AppSettings];
      if (typeof example === 'boolean' && typeof value !== 'boolean') throw new Error('无效的开关值');
      if (typeof example === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('无效的数值');
      if (Array.isArray(example) && (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))) throw new Error('无效的目录');
    }
    const settings = { ...this.getSettings(), ...patch };
    if (settings.opacity < 0.65 || settings.opacity > 1) throw new Error('透明度应在 65%–100%');
    if (!Number.isInteger(settings.activeLimit) || settings.activeLimit < 1 || settings.activeLimit > 100) throw new Error('活跃数量应在 1–100');
    if (settings.recycleLimit !== 100 || settings.recycleDays !== 7) throw new Error('首版回收区上限为 100 张 / 7 天');
    if (settings.thumbnailSize < 120 || settings.thumbnailSize > 260) throw new Error('缩略图尺寸应在 120–260');
    this.transaction(() => {
      this.db.prepare("INSERT INTO settings VALUES ('preferences', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));
      this.enforceLimit(settings.activeLimit);
    });
    this.purge();
    return settings;
  }
  getValue<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  setValue(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  private rows(state?: View): RecordRow[] {
    return (state
      ? this.db.prepare('SELECT * FROM items WHERE state=? ORDER BY activated_at DESC, rowid DESC').all(state)
      : this.db.prepare('SELECT * FROM items').all()) as unknown as RecordRow[];
  }
  list(state: View): ScreenshotItem[] {
    return this.rows(state).map((row) => ({
      id: row.id, contentHash: row.hash, source: row.source, width: row.width, height: row.height,
      createdAt: new Date(row.created_at).toISOString(), recycledAt: row.recycled_at === null ? null : new Date(row.recycled_at).toISOString(),
      state: row.state, thumbnailUrl: `shelf-image://image/${row.id}/thumb`,
    }));
  }
  getPath(id: string, thumbnail = false): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的截图 ID');
    if (!this.db.prepare('SELECT id FROM items WHERE id=?').get(id)) throw new Error('截图已不存在');
    return path.join(thumbnail ? this.thumbnails : this.screenshots, `${id}.png`);
  }
  private atomicWrite(filePath: string, bytes: Buffer) {
    const temp = `${filePath}.pending`;
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, filePath);
  }
  add(image: PreparedImage, source: CaptureSource): boolean {
    if (this.db.prepare('SELECT id FROM items WHERE hash=?').get(image.hash)) return false;
    this.atomicWrite(path.join(this.screenshots, `${image.hash}.png`), image.png);
    this.atomicWrite(path.join(this.thumbnails, `${image.hash}.png`), image.thumbnail);
    const time = this.now();
    this.transaction(() => {
      this.db.prepare('INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)').run(image.hash, image.hash, source, image.width, image.height, time, this.nextActivation(), 'active');
      this.enforceLimit(this.getSettings().activeLimit);
    });
    this.purge();
    return true;
  }
  private enforceLimit(limit: number) {
    for (const item of this.rows('active').slice(limit)) this.db.prepare("UPDATE items SET state='recycled', recycled_at=? WHERE id=?").run(this.now(), item.id);
  }
  private nextActivation() {
    const row = this.db.prepare('SELECT MAX(activated_at) AS latest FROM items').get() as { latest: number | null };
    return Math.max(this.now(), (row.latest ?? 0) + 1);
  }
  recycle(id: string) {
    this.getPath(id);
    this.db.prepare("UPDATE items SET state='recycled', recycled_at=? WHERE id=? AND state='active'").run(this.now(), id);
    this.purge();
  }
  restore(id: string) {
    this.getPath(id);
    this.transaction(() => {
      this.db.prepare("UPDATE items SET state='active', recycled_at=NULL, activated_at=? WHERE id=? AND state='recycled'").run(this.nextActivation(), id);
      this.enforceLimit(this.getSettings().activeLimit);
    });
    this.purge();
  }
  permanentlyDelete(id: string) {
    const row = this.db.prepare('SELECT state FROM items WHERE id=?').get(id) as { state: View } | undefined;
    if (!row || row.state !== 'recycled') throw new Error('只能永久删除回收区截图');
    this.db.prepare('DELETE FROM items WHERE id=?').run(id);
    for (const directory of [this.screenshots, this.thumbnails]) {
      try { fs.unlinkSync(path.join(directory, `${id}.png`)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  emptyRecycle() { for (const item of this.rows('recycled')) this.permanentlyDelete(item.id); }
  purge(): boolean {
    const settings = this.getSettings();
    const rows = this.rows('recycled').sort((a, b) => (b.recycled_at ?? 0) - (a.recycled_at ?? 0));
    let changed = false;
    for (const [index, item] of rows.entries()) {
      if (index >= settings.recycleLimit || this.now() - (item.recycled_at ?? 0) >= settings.recycleDays * 86400000) {
        this.permanentlyDelete(item.id); changed = true;
      }
    }
    return changed;
  }
  private reconcile() {
    for (const row of this.rows()) {
      if (!fs.existsSync(path.join(this.screenshots, `${row.id}.png`))) this.db.prepare('DELETE FROM items WHERE id=?').run(row.id);
    }
    const known = new Set(this.rows().map((row) => `${row.id}.png`));
    for (const directory of [this.screenshots, this.thumbnails]) {
      for (const name of fs.readdirSync(directory)) {
        if ((name.endsWith('.pending') || /^[a-f0-9]{64}\.png$/.test(name)) && !known.has(name)) fs.unlinkSync(path.join(directory, name));
      }
    }
    this.purge();
  }
  close() { this.db.close(); }
}

export function pixelHash(bitmap: Buffer, width: number, height: number): string {
  return crypto.createHash('sha256').update(`${width}x${height}:`).update(bitmap).digest('hex');
}
