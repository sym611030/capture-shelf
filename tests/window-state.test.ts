import { describe, expect, it } from 'vitest';
import { clampBounds } from '../electron/window-state';
describe('window positioning in DIP coordinates', () => {
  it('brings an offscreen window back onto the current monitor', () => {
    expect(clampBounds({ x: 4000, y: -200, width: 880, height: 660 }, { x: 0, y: 0, width: 1920, height: 1040 })).toEqual({ x: 1040, y: 0, width: 880, height: 660 });
  });
  it('supports a monitor left of the primary screen', () => {
    expect(clampBounds({ x: -1800, y: 50, width: 880, height: 660 }, { x: -1920, y: 0, width: 1920, height: 1080 }).x).toBe(-1800);
  });
  it('clamps size to a smaller work area without multiplying DPI', () => {
    expect(clampBounds({ x: 0, y: 0, width: 1500, height: 1200 }, { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});
