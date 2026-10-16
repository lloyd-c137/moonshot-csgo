import { DERIVED_GRID, MINIMAP_RESOLUTION, MINIMAP_URL } from '../config/presentation';

const VIEW_METRES = 36;

/**
 * Floor-plan map (no exploration fog). Drawn twice — a circular,
 * north-up dock in the HUD and a full-floor view (M). The base image comes from the offline-derived minimap.
 */
/** Things drawn on both maps: the golden disc (always) and 纪老师 with his view. */
export type MapMarkers = {
    gold: { x: number; z: number; held: boolean } | null;
    teacher: { x: number; z: number; yaw: number } | null;
};

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

    let markers: MapMarkers = { gold: null, teacher: null };
    /** A gold star (the golden disc) at canvas point (x, y). */
    const goldIcon = (g: CanvasRenderingContext2D, x: number, y: number, size: number, held: boolean) => {
        g.save();
        g.translate(x, y);
        g.beginPath();
        for (let i = 0; i < 10; i++) {
            const r = i % 2 ? size * 0.45 : size;
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath();
        g.fillStyle = held ? '#ff9f1a' : '#ffc21a';
        g.strokeStyle = '#3a2600';
        g.lineWidth = size * 0.22;
        g.shadowColor = 'rgba(255, 194, 26, 0.9)';
        g.shadowBlur = size;
        g.fill();
        g.stroke();
        g.restore();
    };
    /** 纪老师: a red dot with his view wedge. */
    const teacherIcon = (
        g: CanvasRenderingContext2D,
        x: number,
        y: number,
        yawDegrees: number,
        range: number,
        size: number
    ) => {
        // Map angle: yaw 0 looks toward -Z (up on the map); positive yaw turns toward -X (left).
        const centre = -Math.PI / 2 - (yawDegrees * Math.PI) / 180;
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, range, centre - 0.84, centre + 0.84);
        g.closePath();
        g.fillStyle = 'rgba(255, 70, 85, 0.25)';
        g.fill();
        g.beginPath();
        g.arc(x, y, size, 0, Math.PI * 2);
        g.fillStyle = '#ff4655';
        g.strokeStyle = '#fff';
        g.lineWidth = size * 0.35;
        g.fill();
        g.stroke();
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
        if (ready) {
            const scale = w / (VIEW_METRES / MINIMAP_RESOLUTION);
            const toDock = (mx: number, mz: number) => [
                w / 2 + ((mx - x) / MINIMAP_RESOLUTION) * scale,
                w / 2 + ((mz - z) / MINIMAP_RESOLUTION) * scale
            ];
            if (markers.teacher) {
                const [tx, ty] = toDock(markers.teacher.x, markers.teacher.z);
                const metre = scale / MINIMAP_RESOLUTION;
                if (Math.hypot(tx - w / 2, ty - w / 2) < w / 2 + 13 * metre)
                    teacherIcon(g, tx, ty, markers.teacher.yaw, 13 * metre, 4 * ratio);
            }
        }
        g.restore();
        // The golden disc is always shown: on the dock when near, pinned to its rim (pointing at it) when far.
        if (ready && markers.gold) {
            const scale = w / (VIEW_METRES / MINIMAP_RESOLUTION);
            let gx = w / 2 + ((markers.gold.x - x) / MINIMAP_RESOLUTION) * scale;
            let gy = w / 2 + ((markers.gold.z - z) / MINIMAP_RESOLUTION) * scale;
            const d = Math.hypot(gx - w / 2, gy - w / 2);
            const limit = w / 2 - 9 * ratio;
            if (d > limit) {
                gx = w / 2 + ((gx - w / 2) / d) * limit;
                gy = w / 2 + ((gy - w / 2) / d) * limit;
            }
            goldIcon(g, gx, gy, 7 * ratio, markers.gold.held);
        }
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
        if (markers.teacher) {
            const [tx, tz] = toPixel(markers.teacher.x, markers.teacher.z);
            teacherIcon(
                g,
                tx * scale * ratio,
                tz * scale * ratio,
                markers.teacher.yaw,
                (13 / MINIMAP_RESOLUTION) * scale * ratio,
                5 * ratio
            );
        }
        if (markers.gold) {
            const [gx, gz] = toPixel(markers.gold.x, markers.gold.z);
            goldIcon(g, gx * scale * ratio, gz * scale * ratio, 10 * ratio, markers.gold.held);
        }
        const [px, pz] = toPixel(x, z);
        arrow(g, px * scale * ratio, pz * scale * ratio, angle, 11 * ratio);
    };

    const last = { x: NaN, z: NaN, angle: NaN, ready: false, fullOpen: false, width: 0, height: 0, markers: '' };
    return {
        draw: (x: number, z: number, forwardX: number, forwardZ: number, fullOpen: boolean, next: MapMarkers) => {
            const angle = Math.atan2(forwardZ, forwardX);
            const key = `${next.gold ? `${next.gold.x.toFixed(1)},${next.gold.z.toFixed(1)},${next.gold.held}` : ''}|${
                next.teacher
                    ? `${next.teacher.x.toFixed(1)},${next.teacher.z.toFixed(1)},${Math.round(next.teacher.yaw)}`
                    : ''
            }`;
            const markersChanged = key !== last.markers;
            last.markers = key;
            markers = next;
            // Redraw only when something visible changed (moved ≥ 2 cm, turned ≥ 0.4°, map opened, image loaded):
            // standing still or holding a direction no longer repaints both canvases every frame.
            const changed =
                markersChanged ||
                ready !== last.ready ||
                fullOpen !== last.fullOpen ||
                Math.abs(x - last.x) > 0.02 ||
                Math.abs(z - last.z) > 0.02 ||
                Math.abs(angle - last.angle) > 0.007 ||
                window.innerWidth !== last.width ||
                window.innerHeight !== last.height;
            if (!changed) return;
            Object.assign(last, {
                x,
                z,
                angle,
                ready,
                fullOpen,
                width: window.innerWidth,
                height: window.innerHeight
            });
            drawDock(x, z, angle);
            if (fullOpen) drawFull(x, z, angle);
        }
    };
};
