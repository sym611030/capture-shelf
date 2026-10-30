import path from 'node:path';
const screenshotName = /^(screenshot|screen[ _-]?shot|screen[ _-]?capture|屏幕截图|螢幕截圖|截屏|截圖|スクリーンショット)/i;
export function isCaptureFile(file: string, onlyScreenshotNames: boolean) {
  return /\.(png|jpe?g|webp)$/i.test(file) && (!onlyScreenshotNames || screenshotName.test(path.basename(file)));
}
