export type { AppState, AppSettings, ScreenshotItem, CaptureShelfAPI, View } from '../electron/contracts';
import type { CaptureShelfAPI } from '../electron/contracts';
declare global { interface Window { captureShelf: CaptureShelfAPI } }
