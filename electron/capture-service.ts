import { clipboard, nativeImage, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { CaptureSource } from './contracts';
import { pixelHash, ScreenshotRepository } from './repository';
export interface WatchDirectory { directory: string; screenshotNamesOnly: boolean }
import { isCaptureFile } from './file-filter';
export class CaptureService {
  private timer?: NodeJS.Timeout;
  private polling = false;
  private stopped = false;
  private watcher?: FSWatcher;
  private lastClipboardHash = '';
  private watchedVersions = new Map<string, string>();
  constructor(private repository: ScreenshotRepository, private directories: () => WatchDirectory[], private changed: () => void, private warn: (message: string) => void, private testMode = false) {}
  start() {
    this.stopped = false;
    this.timer = setInterval(() => { void this.pollClipboard(); }, 350);
    void this.restartDirectories();
  }
  async restartDirectories() {
    await this.watcher?.close();
    this.watcher = undefined;
    if (this.stopped) return;
    const settings = this.repository.getSettings();
    if (!settings.onboardingComplete || settings.capturePaused || !settings.directoryCaptureEnabled) return;
    const rules = this.directories();
    if (!rules.length) return;
    this.watcher = watch(rules.map((rule) => rule.directory), {
      ignoreInitial: true, depth: 0, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      ignored: (file, stats) => !!stats?.isFile() && !/\.(png|jpe?g|webp)$/i.test(file),
      usePolling: true, interval: 250, binaryInterval: 250,
    });
    const receive = (file: string) => {
      const rule = rules.find((candidate) => path.resolve(path.dirname(file)) === path.resolve(candidate.directory));
      if (!rule || !isCaptureFile(file, rule.screenshotNamesOnly)) return;
      try {
        const stat = fs.statSync(file);
        const version = `${stat.size}:${stat.mtimeMs}`;
        if (this.watchedVersions.get(file) === version) return;
        this.watchedVersions.set(file, version);
        if (this.watchedVersions.size > 5000) this.watchedVersions.delete(this.watchedVersions.keys().next().value!);
        this.ingestFile(file, 'directory');
      } catch (error) { this.warn(`无法读取新截图：${(error as Error).message}`); }
    };
    this.watcher.on('add', receive).on('change', receive).on('error', (error) => this.warn(`目录监听失败，请允许目录访问或使用手动导入：${String(error)}`));
    await new Promise<void>((resolve) => { this.watcher!.once('ready', resolve); this.watcher!.once('error', () => resolve()); });
  }
  private async pollClipboard() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    const settings = this.repository.getSettings();
    if (this.testMode || !settings.onboardingComplete || settings.capturePaused || !settings.clipboardCaptureEnabled) { this.polling = false; return; }
    try {
      let image: NativeImage;
      if (typeof (clipboard as any).read === 'function') {
        const items = await (clipboard as any).read();
        const item = items.find((candidate: { types: string[] }) => candidate.types.some((format) => format.startsWith('image/')));
        if (!item) { this.lastClipboardHash = ''; return; }
        const format = item.types.find((candidate: string) => candidate.startsWith('image/'))!;
        const blob = await item.getType(format);
        image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      } else {
        image = (clipboard as any).readImage();
      }
      if (image.isEmpty()) return;
      if (this.stopped) return;
      const latest = this.repository.getSettings();
      if (this.stopped || latest.capturePaused || !latest.clipboardCaptureEnabled) return;
      const size = image.getSize();
      const hash = pixelHash(image.toBitmap(), size.width, size.height);
      if (hash === this.lastClipboardHash) return;
      this.lastClipboardHash = hash;
      this.ingestNative(image, 'clipboard', hash);
    } catch (error) { this.warn(`剪贴板暂不可读：${(error as Error).message}`); }
    finally { this.polling = false; }
  }
  ingestNative(image: NativeImage, source: CaptureSource, knownHash?: string) {
    if (image.isEmpty()) throw new Error('无法识别此图片');
    const { width, height } = image.getSize();
    if (width * height > 60_000_000) throw new Error('图片超过 6000 万像素');
    const result = this.repository.add({
      hash: knownHash ?? pixelHash(image.toBitmap(), width, height),
      png: image.toPNG(), width, height,
      thumbnail: image.resize({ width: Math.min(width, 520), quality: 'good' }).toPNG(),
    }, source);
    if (result) this.changed();
    return result;
  }
  ingestFile(file: string, source: CaptureSource = 'manual') {
    if (fs.statSync(file).size > 80 * 1024 * 1024) throw new Error('图片文件超过 80MB');
    return this.ingestNative(nativeImage.createFromBuffer(fs.readFileSync(file)), source);
  }
  markCopied(image: NativeImage) {
    const { width, height } = image.getSize();
    this.lastClipboardHash = pixelHash(image.toBitmap(), width, height);
  }
  async stop() { this.stopped = true; clearInterval(this.timer); await this.watcher?.close(); }
}
