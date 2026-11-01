import { useLayoutEffect } from 'react';
import { ropeHeightAt } from './RealisticRope';

// Keep transparent window space outside the Windows native input region.
// This is a static native shape during drags; no mouse-ignore polling is needed.
export function useWindowHitRegions(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled || !window.captureShelf) return;
    let frame = 0, signature = '';
    const update = () => {
      frame = 0;
      const regions: Array<{ x: number; y: number; width: number; height: number }> = [];
      const add = (rect: { left: number; top: number; width: number; height: number }, padding: number) => {
        const left = Math.max(0, rect.left - padding), top = Math.max(0, rect.top - padding);
        const right = Math.min(innerWidth, rect.left + rect.width + padding), bottom = Math.min(innerHeight, rect.top + rect.height + padding);
        if (right > left && bottom > top) regions.push({ x: left, y: top, width: right - left, height: bottom - top });
      };
      // A visible modal backdrop intentionally owns its complete dimmed area.
      const modal = document.querySelector('.modal-backdrop');
      if (modal) add(modal.getBoundingClientRect(), 0);
      else {
        for (const element of document.querySelectorAll('[data-hit-region], .hanging-photo, .clothespin, .rope-scroll, .context-menu, .settings-view, .capture-warning, .toast, .rope-drop-hint')) {
          if (element.getClientRects().length) add(element.getBoundingClientRect(), element.matches('.hanging-photo') ? 8 : 2);
        }
        const canvas = document.querySelector('.realistic-rope');
        if (canvas) {
          const rope = canvas.getBoundingClientRect();
          for (let x = 21; x < rope.width - 21; x += 12) {
            const end = Math.min(x + 12, rope.width - 21);
            const a = ropeHeightAt(x, rope.width), b = ropeHeightAt(end, rope.width);
            add({ left: rope.left + x, top: rope.top + Math.min(a, b) - 7, width: end - x, height: Math.abs(b - a) + 14 }, 0);
          }
          for (const x of [21, rope.width - 21]) add({ left: rope.left + x - 7, top: rope.top + ropeHeightAt(x, rope.width) - 9, width: 14, height: 18 }, 0);
        }
      }
      const next = JSON.stringify(regions);
      if (next !== signature) { signature = next; window.captureShelf.setInteractiveRegions(regions); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const changes = new MutationObserver(schedule);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const size = new ResizeObserver(schedule);
    size.observe(document.body);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('transitionend', schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame); changes.disconnect(); size.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
    };
  }, [enabled]);
}
