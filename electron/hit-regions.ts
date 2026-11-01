export interface HitRegion { x: number; y: number; width: number; height: number }

// Window shape coordinates are DIPs, just like renderer CSS pixels. Round outward
// and clip at the native client bounds, so fractional/negative DOM bounds remain safe.
export function sanitizeHitRegions(regions: unknown, bounds: { width: number; height: number }): HitRegion[] {
  if (!Array.isArray(regions) || regions.length > 1024) return [];
  const result: HitRegion[] = [];
  for (const region of regions) {
    if (!region || typeof region !== 'object') continue;
    const { x, y, width, height } = region as HitRegion;
    if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value)) || width <= 0 || height <= 0) continue;
    const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
    const right = Math.min(bounds.width, Math.ceil(x + width)), bottom = Math.min(bounds.height, Math.ceil(y + height));
    if (right > left && bottom > top) result.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return result;
}
