import { Camera, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { AppState } from './types';
export function Onboarding({ state, run }: { state: AppState; run: (operation: () => Promise<unknown>) => Promise<void> }) {
  const [clipboardEnabled, setClipboardEnabled] = useState(state.settings.clipboardCaptureEnabled);
  const [directoryEnabled, setDirectoryEnabled] = useState(state.settings.directoryCaptureEnabled);
  return <div className="modal-backdrop onboarding-backdrop"><section className="dialog onboarding" role="dialog" aria-modal="true" aria-labelledby="welcome-title"><div className="dialog-icon"><Camera size={29} strokeWidth={1.5} /></div><h2 id="welcome-title">让截图，随手可用</h2><p>系统截图后自动收集，拖进聊天窗口或上传区域。第一次启用前，选择你要收集的来源。</p><label className="onboarding-option"><input type="checkbox" checked={clipboardEnabled} onChange={(event) => setClipboardEnabled(event.target.checked)} /><span><strong>收集剪贴板图片</strong><small>系统无法区分截图和其他复制的图片。开启后两者都会保存在本机，可随时关闭。</small></span></label><label className="onboarding-option"><input type="checkbox" checked={directoryEnabled} onChange={(event) => setDirectoryEnabled(event.target.checked)} /><span><strong>收集截图目录新文件</strong><small>不会批量读取旧文件。macOS 可能提示允许访问桌面；拒绝后仍可手动导入。</small></span></label><div className="privacy-line"><ShieldCheck size={15} />无账号、无云同步，截图仅在本机保存</div><button className="primary-button" onClick={() => run(() => window.captureShelf.updateSettings({ clipboardCaptureEnabled: clipboardEnabled, directoryCaptureEnabled: directoryEnabled, onboardingComplete: true }))}>开始使用</button></section></div>;
}
