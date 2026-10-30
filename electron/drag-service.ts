import fs from 'node:fs';
import path from 'node:path';
export class DragService {
  readonly directory: string;
  constructor(root: string, private resolve: (id: string) => string, private now: () => number = Date.now) {
    this.directory = path.join(root, 'drag-temp');
    fs.mkdirSync(this.directory, { recursive: true });
    this.cleanupExpiredDragFiles();
  }
  prepareDragFile(id: string) {
    const original = this.resolve(id);
    const target = path.join(this.directory, `capture-${id}.png`);
    if (!fs.existsSync(target)) fs.copyFileSync(original, target);
    const timestamp = new Date(this.now());
    fs.utimesSync(target, timestamp, timestamp);
    return target;
  }
  cleanupExpiredDragFiles() {
    for (const name of fs.readdirSync(this.directory)) {
      if (!/^capture-[a-f0-9]{64}\.png$/.test(name)) continue;
      const target = path.join(this.directory, name);
      if (this.now() - fs.statSync(target).mtimeMs >= 86400000) fs.unlinkSync(target);
    }
  }
}
