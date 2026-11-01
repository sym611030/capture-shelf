import { describe, expect, it } from 'vitest';
import { sanitizeHitRegions } from '../electron/hit-regions';

describe('native input regions', () => {
  it('clips fractional and negative DOM bounds without expanding their original right edge', () => {
    expect(sanitizeHitRegions([{ x: -5.2, y: -2, width: 15, height: 9 }, { x: 715.5, y: 75.1, width: 50, height: 25 }], { width: 720, height: 80 })).toEqual([
      { x: 0, y: 0, width: 10, height: 7 }, { x: 715, y: 75, width: 5, height: 5 },
    ]);
  });
  it('rejects invalid, zero-size and fully offscreen regions', () => {
    expect(sanitizeHitRegions([null, { x: NaN, y: 0, width: 2, height: 2 }, { x: 0, y: 0, width: 0, height: 5 }, { x: 800, y: 0, width: 10, height: 10 }], { width: 720, height: 80 })).toEqual([]);
  });
});
