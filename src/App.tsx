import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Camera, Pin, PinOff, Settings2, X, Copy, Trash2, RotateCcw, ImagePlus, Pause, Play, Check, ExternalLink, MoreHorizontal, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AppState, ScreenshotItem, View } from './types';
import { SettingsPanel } from './SettingsPanel';
import { Onboarding } from './Onboarding';
import { RealisticRope, ropeHeightAt } from './RealisticRope';

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmation, setConfirmation] = useState<'single' | 'all' | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [ropeWidth, setRopeWidth] = useState(window.innerWidth - 16);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const shelfRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const items = state ? view === 'active' ? state.active : state.recycled : [];
  const run = useCallback(async (operation: () => Promise<unknown>, success?: string) => {
    try {
      const result = await operation();
      if (result && typeof result === 'object' && 'active' in result) setState(result as AppState);
      if (success) setMessage(success);
    } catch (error) { setMessage((error as Error).message); }
  }, []);
  useEffect(() => {
    if (!window.captureShelf) { setLoadError('请使用桌面应用打开截图板。'); return; }
    window.captureShelf.getState().then(setState).catch((error: Error) => setLoadError(error.message));
    const removeState = window.captureShelf.onStateChange(setState);
    const removeView = window.captureShelf.onViewChange((next) => { setView(next); setSettingsOpen(false); });
    const removeNotice = window.captureShelf.onNotice(setMessage);
    return () => { removeState(); removeView(); removeNotice(); };
  }, []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 3500); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { setSelectedId(null); setMenu(null); cardsRef.current?.scrollTo({ left: 0 }); }, [view]);
  useEffect(() => {
    if (!window.captureShelf || !state) return;
    const compactHeight = items.length ? Math.round(state.settings.thumbnailSize * .65 + 98) : 80;
    window.captureShelf.setPanelExpanded(settingsOpen || !state.settings.onboardingComplete || panelMenuOpen || Boolean(confirmation), compactHeight);
  }, [settingsOpen, state?.settings.onboardingComplete, state?.settings.thumbnailSize, items.length, panelMenuOpen, confirmation]);
  useLayoutEffect(() => {
    const shelf = shelfRef.current, cards = cardsRef.current;
    if (!shelf) return;
    let frame = 0;
    const align = () => {
      const width = shelf.clientWidth;
      setRopeWidth(width);
      if (!cards) return;
      for (const card of cards.querySelectorAll<HTMLElement>('.rope-card')) {
        const centre = card.offsetLeft - cards.scrollLeft + card.offsetWidth / 2;
        card.style.setProperty('--hang-y', `${ropeHeightAt(centre, width)}px`);
      }
      setCanScroll({ left: cards.scrollLeft > 2, right: cards.scrollLeft + cards.clientWidth < cards.scrollWidth - 2 });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(align); };
    const wheel = (event: WheelEvent) => {
      if (cards && Math.abs(event.deltaY) > Math.abs(event.deltaX) && cards.scrollWidth > cards.clientWidth) {
        event.preventDefault(); cards.scrollLeft += event.deltaY;
      }
    };
    align();
    const observer = new ResizeObserver(schedule); observer.observe(shelf);
    cards?.addEventListener('scroll', schedule); cards?.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); cards?.removeEventListener('scroll', schedule); cards?.removeEventListener('wheel', wheel); };
  }, [items.length, state?.settings.thumbnailSize, settingsOpen]);
  useEffect(() => {
    const clear = () => setDropActive(false);
    const afterDrop = (event: MouseEvent) => { if (event.buttons === 0) clear(); };
    window.addEventListener('dragend', clear); window.addEventListener('drop', clear); window.addEventListener('mousemove', afterDrop);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); window.removeEventListener('mousemove', afterDrop); };
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setConfirmation(null); setSettingsOpen(false); setPanelMenuOpen(false); setDropActive(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedId && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault(); void run(() => window.captureShelf.copyImage(selectedId), '图片已复制，可直接粘贴');
      }
    };
    document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener);
  }, [selectedId, run]);
  if (!state) return <div className="loading"><Camera size={20} /><p>{loadError || '正在打开截图板…'}</p></div>;
  const menuItem = items.find((item) => item.id === menu?.id);
  const copy = (id: string) => run(() => window.captureShelf.copyImage(id), '图片已复制，可直接粘贴');
  const recycle = (id: string) => run(() => window.captureShelf.recycleImage(id), '已移入回收区');
  const restore = (id: string) => run(() => window.captureShelf.restoreImage(id), '已恢复到绳子');
  const menuAction = (action: () => void) => { setPanelMenuOpen(false); action(); };
  const contextMenu = (event: React.MouseEvent, item: ScreenshotItem) => {
    event.preventDefault(); event.stopPropagation(); setSelectedId(item.id); setPanelMenuOpen(false);
    setMenu({ id: item.id, x: Math.max(8, Math.min(event.clientX, innerWidth - 195)), y: Math.max(7, Math.min(event.clientY, innerHeight - 190)) });
  };
  const hint = state.preview ? '示例预览 · 不自动收集' : view === 'recycled' ? '回收区 · 单击复制，右键恢复 · 保留 7 天' : `${state.captureStatus === 'paused' ? '自动收集已暂停' : '截图自动挂好'} · 单击复制，拖出发送`;
  return <main className={`app-shell rope-app-shell ${settingsOpen ? 'show-settings' : ''}`} style={{ '--thumb-size': `${state.settings.thumbnailSize}px` } as CSSProperties} onClick={() => { setMenu(null); setPanelMenuOpen(false); }}>
    <section ref={shelfRef} className={`rope-shelf ${dropActive ? 'is-drop-active' : ''}`} aria-label={view === 'active' ? '绳子上的最近截图' : '绳子上的回收区截图'}
      onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropActive(true); } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
      onDrop={(event) => { event.preventDefault(); setDropActive(false); for (const file of Array.from(event.dataTransfer.files)) void run(() => window.captureShelf.ingestDroppedImage(file), '图片已挂到绳子上'); }}>
      <div className="rope-caption">
        {view === 'recycled' && <button className="rope-back" aria-label="返回最近截图" title="返回最近截图" onClick={() => setView('active')}><ArrowLeft size={13} /></button>}
        <p className="rope-drag-handle" title="拖动这行文字移动绳子">{hint}</p>
        <span className="rope-count" title="截图数量">{items.length}{view === 'active' ? ` / ${state.settings.activeLimit}` : ' 张'}</span>
        <button className="rope-menu-button" aria-label="更多选项" title="更多选项" aria-expanded={panelMenuOpen} onClick={(event) => { event.stopPropagation(); setPanelMenuOpen(!panelMenuOpen); setMenu(null); }}><MoreHorizontal size={19} /></button>
      </div>
      <RealisticRope width={ropeWidth} />
      <div className="rope-end-handle" title="拖动绳结移动" />
      {settingsOpen ? <SettingsPanel state={state} run={run} close={() => setSettingsOpen(false)} /> : <>
        {items.length > 0 && <div className="rope-cards" ref={cardsRef}>{items.map((item, index) => <article className={`rope-card ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} data-id={item.id} style={{ '--tilt': `${[-2.2, 1.5, -.8, 2, -1.5, .7][index % 6]}deg` } as CSSProperties}>
          <span className="clothespin" aria-hidden="true"><span /></span>
          <div className="hanging-photo">
            <button className="rope-card-surface" draggable onDragStart={(event) => { event.preventDefault(); setSelectedId(item.id); setDropActive(false); window.captureShelf.startDrag(item.id); }} onClick={() => { setSelectedId(item.id); void copy(item.id); }} onDoubleClick={() => run(() => window.captureShelf.openImage(item.id))} onContextMenu={(event) => contextMenu(event, item)} aria-label={`截图 ${new Date(item.createdAt).toLocaleTimeString()}，${item.width} × ${item.height}`} title="单击复制 · 双击打开 · 拖动发送"><img src={item.thumbnailUrl} alt="截图缩略图" draggable={false} /><span className="thumb-hover">拖出发送</span></button>
            <div className="rope-card-meta"><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{item.width} × {item.height}</span><button title={view === 'active' ? '取下并回收' : '恢复到绳子'} aria-label={view === 'active' ? '取下并回收' : '恢复到绳子'} onClick={() => view === 'active' ? recycle(item.id) : restore(item.id)}>{view === 'active' ? <Trash2 size={12} /> : <RotateCcw size={12} />}</button></div>
          </div>
        </article>)}</div>}
        {canScroll.left && <button className="rope-scroll left" aria-label="查看前面的截图" onClick={(event) => { event.stopPropagation(); cardsRef.current?.scrollBy({ left: -380, behavior: 'smooth' }); }}><ChevronLeft size={16} /></button>}
        {canScroll.right && <button className="rope-scroll right" aria-label="查看后面的截图" onClick={(event) => { event.stopPropagation(); cardsRef.current?.scrollBy({ left: 380, behavior: 'smooth' }); }}><ChevronRight size={16} /></button>}
      </>}
      {dropActive && <div className="rope-drop-hint">松开，把图片挂到绳子上</div>}
    </section>
    {panelMenuOpen && <div className="context-menu rope-menu" role="menu" aria-label="绳子选项" onClick={(event) => event.stopPropagation()}>
      <button role="menuitem" onClick={() => menuAction(() => setView(view === 'active' ? 'recycled' : 'active'))}><RotateCcw size={15} />{view === 'active' ? '打开回收区' : '返回最近截图'}<span className="menu-count">{view === 'active' ? state.recycled.length : state.active.length}</span></button>
      <button role="menuitem" onClick={() => menuAction(() => { void run(() => window.captureShelf.importImages()); })}><ImagePlus size={15} />挂一张图片</button>
      <div className="menu-separator" />
      <button role="menuitem" onClick={() => menuAction(() => { void run(() => window.captureShelf.updateSettings({ capturePaused: !state.settings.capturePaused })); })}>{state.settings.capturePaused ? <Play size={15} /> : <Pause size={15} />}{state.settings.capturePaused ? '继续捕获' : '暂停全部捕获'}</button>
      <button role="menuitem" aria-label="切换置顶" onClick={() => menuAction(() => { void run(() => window.captureShelf.updateSettings({ alwaysOnTop: !state.settings.alwaysOnTop })); })}>{state.settings.alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}窗口置顶<span className="menu-count">{state.settings.alwaysOnTop ? '已开启' : '已关闭'}</span></button>
      <button role="menuitem" onClick={() => menuAction(() => setSettingsOpen(true))}><Settings2 size={15} />设置</button>
      {view === 'recycled' && <button role="menuitem" className="danger-action" disabled={!items.length} onClick={() => menuAction(() => setConfirmation('all'))}><Trash2 size={15} />清空回收区</button>}
      <div className="menu-separator" />
      <button role="menuitem" onClick={() => menuAction(() => { void run(() => window.captureShelf.hideWindow()); })}><X size={15} />隐藏到托盘</button>
      <p className="menu-shortcut">{state.platform === 'darwin' ? '⌘ ⇧ Space' : 'Ctrl + Shift + Space'} 显示 / 隐藏</p>
    </div>}
    {state.warnings.length > 0 && <button className="capture-warning" title={state.warnings.at(-1)} onClick={() => setSettingsOpen(true)}>捕获遇到问题 · 查看设置</button>}
    {menu && menuItem && <div className="context-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
      <button role="menuitem" onClick={() => { setMenu(null); void copy(menuItem.id); }}><Copy size={15} />复制图片</button>
      <button role="menuitem" onClick={() => { setMenu(null); void run(() => window.captureShelf.openImage(menuItem.id)); }}><ExternalLink size={15} />查看原图</button>
      {view === 'active' ? <button role="menuitem" onClick={() => { setMenu(null); void recycle(menuItem.id); }}><Trash2 size={15} />取下并回收</button> : <><button role="menuitem" onClick={() => { setMenu(null); void restore(menuItem.id); }}><RotateCcw size={15} />恢复到绳子</button><button role="menuitem" className="danger-action" onClick={() => { setMenu(null); setConfirmation('single'); }}><Trash2 size={15} />永久删除</button></>}
    </div>}
    {message && <div className="toast" role="status"><Check size={14} />{message}</div>}
    {confirmation && <div className="modal-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-label="确认永久删除"><div className="dialog-icon"><Trash2 size={25} /></div><h2>{confirmation === 'all' ? '清空回收区？' : '永久删除这张截图？'}</h2><p>这里只删除截图板的副本，不影响原始截图文件。删除后无法从截图板恢复。</p><div className="dialog-actions"><button onClick={() => setConfirmation(null)}>取消</button><button className="danger-button" onClick={() => { const all = confirmation === 'all'; setConfirmation(null); void run(() => all ? window.captureShelf.emptyRecycle() : window.captureShelf.permanentlyDeleteImage(selectedId!)); }}>永久删除</button></div></section></div>}
    {!state.settings.onboardingComplete && <Onboarding state={state} run={run} />}
  </main>;
}
