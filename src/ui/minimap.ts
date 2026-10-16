import { DERIVED_GRID, MINIMAP_RESOLUTION, MINIMAP_URL } from '../config/presentation';

const VIEW_METRES = 36;

/**
 * Floor-plan map (no exploration fog). Drawn twice — a circular,
 * north-up dock in the HUD and a full-floor view (M). The base image comes from the offline-derived minimap.
 */
export const createMapRenderer = (dock: HTMLCanvasElement, full: HTMLCanvasElement) => {
    const image = new Image();
    let ready = false;
    const toPixel = (x: number, z: number): [number, number] => [
        (x - DERIVED_GRID.x0) / MINIMAP_RESOLUTION,
        (z - DERIVED_GRID.z0) / MINIMAP_RESOLUTION
    ];

    image.onload = () => {
        ready = true;
    };
    image.src = MINIMAP_URL;

    const sizeCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round(width * ratio);
        const h = Math.round(height * ratio);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        return ratio;
    };

    const arrow = (g: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) => {
        g.save();
        g.translate(x, y);
        g.rotate(angle);
        g.beginPath();
        g.moveTo(size, 0);
        g.lineTo(-size * 0.7, size * 0.62);
        g.lineTo(-size * 0.3, 0);
        g.lineTo(-size * 0.7, -size * 0.62);
        g.closePath();
        g.fillStyle = '#ffc21a';
        g.strokeStyle = '#1b2a3a';
        g.lineWidth = size * 0.22;
        g.fill();
        g.stroke();
        g.restore();
    };

    const drawDock = (x: number, z: number, angle: number) => {
        const css = dock.clientWidth || 150;
        const ratio = sizeCanvas(dock, css, css);
        const w = dock.width;
        const g = dock.getContext('2d')!;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, w, w);
        g.save();
        g.beginPath();
        g.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = '#1b2a3a';
        g.fillRect(0, 0, w, w);
        if (ready) {
            const [px, pz] = toPixel(x, z);
            const scale = w / (VIEW_METRES / MINIMAP_RESOLUTION);
            const sx = px - w / 2 / scale;
            const sy = pz - w / 2 / scale;
            g.drawImage(image, sx, sy, w / scale, w / scale, 0, 0, w, w);
        }
        g.restore();
        g.beginPath();
        g.arc(w / 2, w / 2, w / 2 - ratio, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(238, 242, 244, 0.6)';
        g.lineWidth = 2 * ratio;
        g.stroke();
        g.fillStyle = '#eef2f4';
        g.font = `800 ${11 * ratio}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText('北', w / 2, 5 * ratio);
        arrow(g, w / 2, w / 2, angle, 9 * ratio);
    };

    const drawFull = (x: number, z: number, angle: number) => {
        if (!ready) return;
        const maxW = window.innerWidth - 48;
        const maxH = window.innerHeight - 110;
        const scale = Math.min(maxW / image.width, maxH / image.height);
        const ratio = sizeCanvas(full, image.width * scale, image.height * scale);
        full.style.width = `${image.width * scale}px`;
        full.style.height = `${image.height * scale}px`;
        const g = full.getContext('2d')!;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = '#1b2a3a';
        g.fillRect(0, 0, full.width, full.height);
        g.drawImage(image, 0, 0, full.width, full.height);
        const [px, pz] = toPixel(x, z);
        arrow(g, px * scale * ratio, pz * scale * ratio, angle, 11 * ratio);
    };

    return {
        draw: (x: number, z: number, forwardX: number, forwardZ: number, fullOpen: boolean) => {
            const angle = Math.atan2(forwardZ, forwardX);
            drawDock(x, z, angle);
            if (fullOpen) drawFull(x, z, angle);
        }
    };
};
