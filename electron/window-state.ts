export interface Bounds { x: number; y: number; width: number; height: number }
export function clampBounds(saved: Bounds | undefined, workArea: Bounds): Bounds {
  const width = Math.min(Math.max(saved?.width ?? 1180, 720), workArea.width);
  const height = Math.min(Math.max(saved?.height ?? 230, 80), workArea.height);
  return {
    width, height,
    x: Math.round(Math.max(workArea.x, Math.min(saved?.x ?? workArea.x + (workArea.width - width) / 2, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(saved?.y ?? workArea.y + 22, workArea.y + workArea.height - height))),
  };
}
