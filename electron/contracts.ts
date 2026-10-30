export type View = 'active' | 'recycled';
export type CaptureSource = 'clipboard' | 'directory' | 'manual';
export interface ScreenshotItem {
  id: string;
  contentHash: string;
  source: CaptureSource;
  width: number;
  height: number;
  createdAt: string;
  recycledAt: string | null;
  state: View;
  thumbnailUrl: string;
}
export interface AppSettings {
  clipboardCaptureEnabled: boolean;
  directoryCaptureEnabled: boolean;
  capturePaused: boolean;
  alwaysOnTop: boolean;
  opacity: number;
  thumbnailSize: number;
  activeLimit: number;
  recycleLimit: number;
  recycleDays: number;
  launchAtLogin: boolean;
  watchedDirectories: string[];
  onboardingComplete: boolean;
}
export const DEFAULT_SETTINGS: AppSettings = {
  clipboardCaptureEnabled: true, directoryCaptureEnabled: true, capturePaused: false,
  alwaysOnTop: true, opacity: 1, thumbnailSize: 180,
  activeLimit: 30, recycleLimit: 100, recycleDays: 7, launchAtLogin: false,
  watchedDirectories: [], onboardingComplete: false,
};
export interface AppState {
  preview: boolean;
  active: ScreenshotItem[];
  recycled: ScreenshotItem[];
  settings: AppSettings;
  captureStatus: 'running' | 'paused';
  watchedDirectories: string[];
  warnings: string[];
  platform: string;
}
export type SettingsPatch = Partial<Omit<AppSettings, 'watchedDirectories'>>;
export interface CaptureShelfAPI {
  getState(): Promise<AppState>;
  updateSettings(patch: SettingsPatch): Promise<AppState>;
  addDirectory(): Promise<AppState>;
  removeDirectory(directory: string): Promise<AppState>;
  importImages(): Promise<AppState>;
  ingestDroppedImage(file: unknown): Promise<AppState>;
  setInteractiveRegions(regions: Array<{ x: number; y: number; width: number; height: number }>): void;
  setPanelExpanded(expanded: boolean, compactHeight?: number): void;
  copyImage(id: string): Promise<void>;
  openImage(id: string): Promise<void>;
  recycleImage(id: string): Promise<AppState>;
  restoreImage(id: string): Promise<AppState>;
  permanentlyDeleteImage(id: string): Promise<AppState>;
  emptyRecycle(): Promise<AppState>;
  startDrag(id: string): void;
  openDataFolder(): Promise<void>;
  hideWindow(): Promise<void>;
  quit(): Promise<void>;
  onStateChange(callback: (state: AppState) => void): () => void;
  onViewChange(callback: (view: View) => void): () => void;
  onNotice(callback: (message: string) => void): () => void;
}
