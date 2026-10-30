import { useEffect, useRef } from 'react';

export function ropeHeightAt(x: number, width: number) {
  const t = Math.max(0, Math.min(1, (x - 21) / Math.max(1, width - 42)));
  return 31 + 14 * 4 * t * (1 - t);
}

// Three helically laid cylinders, fine longitudinal fibres, and natural sag.
export function RealisticRope({ width }: { width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 1) return;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(70 * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(scale, scale);
    context.save(); context.beginPath();
    for (let x = 21; x <= width - 21; x += 2) {
      const y = ropeHeightAt(x, width) + 2;
      if (x === 21) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = 'rgba(34, 24, 14, .28)'; context.lineWidth = 7;
    context.shadowColor = 'rgba(0, 0, 0, .28)'; context.shadowBlur = 4; context.shadowOffsetY = 2;
    context.stroke(); context.restore();
    const pixels = context.createImageData(canvas.width, canvas.height);
    const hash = (x: number, y: number) => { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); };
    for (let px = Math.ceil(19 * scale); px < (width - 19) * scale; px++) {
      const x = px / scale, centre = ropeHeightAt(x, width), phase = x * Math.PI * 2 / 13;
      for (let py = Math.floor((centre - 5) * scale); py <= (centre + 5) * scale; py++) {
        const y = py / scale - centre;
        let front = -Infinity, light = 0, fibrePhase = 0, edge = 0;
        for (let strand = 0; strand < 3; strand++) {
          const angle = phase + strand * Math.PI * 2 / 3, delta = y - Math.sin(angle) * 2.05;
          if (Math.abs(delta) > 1.9) continue;
          const depth = Math.sqrt(1.9 ** 2 - delta ** 2), z = Math.cos(angle) * 2.05 + depth;
          if (z < front) continue;
          front = z; light = .56 + .32 * (-delta / 1.9) + .38 * depth / 1.9;
          fibrePhase = delta * 14 + Math.sin(angle) * 2 + x * .24;
          edge = Math.min(1, (1.9 - Math.abs(delta)) * scale * 2);
        }
        if (!Number.isFinite(front)) continue;
        const fibres = Math.sin(fibrePhase) * 7 + Math.sin(fibrePhase * 2.8) * 3, grain = (hash(px, py) - .5) * 13;
        const index = (py * canvas.width + px) * 4;
        pixels.data[index] = Math.min(255, 180 * light + fibres + grain);
        pixels.data[index + 1] = Math.min(255, 145 * light + fibres + grain);
        pixels.data[index + 2] = Math.min(255, 98 * light + fibres + grain);
        pixels.data[index + 3] = edge * 255;
      }
    }
    const material = document.createElement('canvas'); material.width = canvas.width; material.height = canvas.height;
    material.getContext('2d')!.putImageData(pixels, 0, 0); context.drawImage(material, 0, 0, width, 70);
    context.lineWidth = .45;
    for (let x = 25; x < width - 25; x += 5.7) {
      const y = ropeHeightAt(x, width) + (hash(x, 8) - .5) * 8;
      context.beginPath(); context.moveTo(x, y); context.quadraticCurveTo(x + 2, y - 1.5, x + 4.5, y - 1 + hash(x, 2) * 2);
      context.strokeStyle = `rgba(217, 187, 140, ${.24 + hash(x, 3) * .25})`; context.stroke();
    }
    for (const x of [21, width - 21]) {
      context.save(); context.translate(x, ropeHeightAt(x, width));
      const material = context.createLinearGradient(-6, -6, 5, 6);
      material.addColorStop(0, '#dfc49a'); material.addColorStop(.4, '#b28d59'); material.addColorStop(1, '#755333');
      context.shadowColor = 'rgba(0,0,0,.25)'; context.shadowBlur = 2; context.shadowOffsetY = 2;
      context.fillStyle = material; context.beginPath(); context.ellipse(0, 0, 5, 7, -.4, 0, Math.PI * 2); context.fill();
      context.shadowBlur = 0; context.shadowOffsetY = 0;
      for (let n = -2; n < 4; n++) {
        context.beginPath(); context.moveTo(-3, n * 1.8 - 2); context.lineTo(3, n * 1.8 + 1);
        context.strokeStyle = n % 2 ? '#e2c598' : '#8d693f'; context.lineWidth = .8; context.stroke();
      }
      context.restore();
    }
  }, [width]);
  return <canvas className="realistic-rope" ref={canvasRef} aria-hidden="true" />;
}
