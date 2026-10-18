import { DERIVED_GRID, MINIMAP_RESOLUTION, MINIMAP_URL } from '../config/presentation';

const VIEW_METRES = 36;

/**
 * Floor-plan map (no exploration fog). Drawn twice — a circular,
 * north-up dock in the HUD and a full-floor view (M). The base image comes from the offline-derived minimap.
 */
/** Things drawn on both maps: the golden disc (always) and 纪老师 with his view. */
export type MapMarkers = {
    gold: { x: number; z: number; held: boolean } | null;
    teacher: { x: number; z: number; yaw: number; range: number } | null;
    /** Other players, shown while the monitoring room's radar is on. */
    players: { x: number; z: number; colour: number }[];
    /** Authored campus interactions, always visible on the full map. */
    specialLocations: readonly { id: string; short: string; name: string; x: number; z: number; colour: string }[];
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
        g.strokeStyle = '#061a36';
        g.lineWidth = size * 0.22;
        g.fill();
        g.stroke();
        g.restore();
    };

    let markers: MapMarkers = { gold: null, teacher: null, players: [], specialLocations: [] };
    /** A player dot in their colour (monitoring-room radar). */
    const playerDot = (g: CanvasRenderingContext2D, x: number, y: number, size: number, hue: number) => {
        g.beginPath();
        g.arc(x, y, size, 0, Math.PI * 2);
        g.fillStyle = `hsl(${hue} 80% 55%)`;
        g.strokeStyle = '#061a36';
        g.lineWidth = size * 0.45;
        g.fill();
        g.stroke();
    };
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
    const specialPin = (
        g: CanvasRenderingContext2D,
        x: number,
        y: number,
        short: string,
        name: string,
        colour: string,
        size: number
    ) => {
        g.save();
        g.fillStyle = colour;
        g.strokeStyle = '#101817';
        g.lineWidth = size * 0.3;
        g.beginPath();
        g.arc(x, y, size, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#101817';
        g.font = `800 ${size * 1.05}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(short, x, y + 0.4);
        if (size >= 7) {
            const labelWidth = g.measureText(name).width + 12 * (size / 7);
            const labelHeight = 19 * (size / 7);
            g.fillStyle = 'rgba(12, 19, 17, 0.92)';
            g.beginPath();
            g.roundRect(x + size + 4, y - labelHeight / 2, labelWidth, labelHeight, 5 * (size / 7));
            g.fill();
            g.fillStyle = '#f3f2e9';
            g.font = `600 ${10 * (size / 7)}px system-ui, sans-serif`;
            g.textAlign = 'left';
            g.fillText(name, x + size + 10, y + 0.5);
        }
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
        g.arc(x, y, range, centre, centre + Math.PI * 2);
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
        g.fillStyle = '#061a36';
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
                if (Math.hypot(tx - w / 2, ty - w / 2) < w / 2 + markers.teacher.range * metre)
                    teacherIcon(g, tx, ty, markers.teacher.yaw, markers.teacher.range * metre, 4 * ratio);
            }
            for (const location of markers.specialLocations) {
                const [lx, ly] = toDock(location.x, location.z);
                if (Math.hypot(lx - w / 2, ly - w / 2) <= w / 2 - 5 * ratio)
                    specialPin(g, lx, ly, location.short, location.name, location.colour, 5 * ratio);
            }
        }
        g.restore();
        // Radar (monitoring room): every player, pinned to the rim when off the dock.
        if (ready) {
            const scale = w / (VIEW_METRES / MINIMAP_RESOLUTION);
            for (const other of markers.players) {
                let ox = w / 2 + ((other.x - x) / MINIMAP_RESOLUTION) * scale;
                let oy = w / 2 + ((other.z - z) / MINIMAP_RESOLUTION) * scale;
                const d = Math.hypot(ox - w / 2, oy - w / 2);
                const limit = w / 2 - 6 * ratio;
                if (d > limit) {
                    ox = w / 2 + ((ox - w / 2) / d) * limit;
                    oy = w / 2 + ((oy - w / 2) / d) * limit;
                }
                playerDot(g, ox, oy, 3.5 * ratio, other.colour);
            }
        }
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
        g.fillStyle = '#061a36';
        g.fillRect(0, 0, full.width, full.height);
        g.drawImage(image, 0, 0, full.width, full.height);
        for (const location of markers.specialLocations) {
            const [lx, lz] = toPixel(location.x, location.z);
            specialPin(
                g,
                lx * scale * ratio,
                lz * scale * ratio,
                location.short,
                location.name,
                location.colour,
                8 * ratio
            );
        }
        if (markers.teacher) {
            const [tx, tz] = toPixel(markers.teacher.x, markers.teacher.z);
            teacherIcon(
                g,
                tx * scale * ratio,
                tz * scale * ratio,
                markers.teacher.yaw,
                (markers.teacher.range / MINIMAP_RESOLUTION) * scale * ratio,
                5 * ratio
            );
        }
        for (const other of markers.players) {
            const [ox, oz] = toPixel(other.x, other.z);
            playerDot(g, ox * scale * ratio, oz * scale * ratio, 5 * ratio, other.colour);
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
            }|${next.players.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(';')}|${next.specialLocations
                .map((p) => `${p.id}:${p.x.toFixed(1)},${p.z.toFixed(1)}`)
                .join(';')}`;
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
