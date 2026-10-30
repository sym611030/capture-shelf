import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenshotRepository, type PreparedImage } from '../electron/repository';
import { DragService } from '../electron/drag-service';
import { isCaptureFile } from '../electron/file-filter';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function image(id: string): PreparedImage { return { hash: id.repeat(64 / id.length), png: Buffer.from(`png-${id}`), thumbnail: Buffer.from(`thumb-${id}`), width: 20, height: 10 }; }
function repo(now = () => Date.now()) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-shelf-')); roots.push(root); return new ScreenshotRepository(root, now); }

describe('ScreenshotRepository', () => {
  it('deduplicates hashes and recycles the oldest active item', () => {
    const repository = repo();
    repository.updateSettings({ activeLimit: 2 });
    expect(repository.add(image('a'), 'clipboard')).toBe(true);
    expect(repository.add(image('a'), 'directory')).toBe(false);
    expect(repository.add(image('b'), 'clipboard')).toBe(true);
    expect(repository.add(image('c'), 'directory')).toBe(true);
    expect(repository.list('active').map((item) => item.id)).toEqual([image('c').hash, image('b').hash]);
    expect(repository.list('recycled').map((item) => item.id)).toEqual([image('a').hash]);
    repository.close();
  });
  it('restores into active and enforces the same limit', () => {
    const repository = repo();
    repository.updateSettings({ activeLimit: 2 });
    repository.add(image('a'), 'clipboard'); repository.add(image('b'), 'clipboard'); repository.add(image('c'), 'clipboard');
    repository.restore(image('a').hash);
    expect(repository.list('active')).toHaveLength(2);
    expect(repository.list('active')[0].id).toBe(image('a').hash);
    expect(repository.list('recycled')).toHaveLength(1);
    repository.close();
  });
  it('does not delete active content when permanentlyDelete is called', () => {
    const repository = repo();
    repository.add(image('a'), 'clipboard');
    expect(() => repository.permanentlyDelete(image('a').hash)).toThrow();
    expect(repository.list('active')).toHaveLength(1);
    repository.close();
  });
});

describe('capture and drag helpers', () => {
  it('only accepts named screenshot files when requested', () => {
    expect(isCaptureFile('C:/Desktop/Screenshot 2026-10-30.png', true)).toBe(true);
    expect(isCaptureFile('C:/Desktop/photo.png', true)).toBe(false);
    expect(isCaptureFile('C:/Desktop/photo.png', false)).toBe(true);
  });
  it('prepares a stable drag file and removes stale files', () => {
    let now = Date.now();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-drag-')); roots.push(root);
    const original = path.join(root, 'original.png'); fs.writeFileSync(original, 'image');
    const service = new DragService(root, () => original, () => now);
    const dragFile = service.prepareDragFile('a'.repeat(64));
    expect(fs.readFileSync(dragFile, 'utf8')).toBe('image');
    now += 86400001; service.cleanupExpiredDragFiles();
    expect(fs.existsSync(dragFile)).toBe(false);
  });
});
