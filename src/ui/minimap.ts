import { DERIVED_GRID, MINIMAP_RESOLUTION, MINIMAP_URL } from '../config/presentation';

import './minimap.css';

const VIEW_METRES = 36;
const COMPACT_SIZE = 150;

/**
 * North-up minimap in the top-right corner, drawn from the offline-derived map image. M toggles a full-floor view.
 * Heading is passed as the camera's forward direction projected onto X/Z.
 */
export const createMinimap = () => {
    document.body.insertAdjacentHTML(
        'beforeend',
        '<figure id="minimap" data-active="false" data-expanded="false" aria-label="小地图"><canvas width="150" height="150"></canvas><figcaption>M 展开地图</figcaption></figure>'
    );
    const figure = document.querySelector<HTMLElement>('#minimap')!;
    const canvas = figure.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    const image = new Image();
    let ready = false;
    image.onload = () => (ready = true);
    image.src = MINIMAP_URL;

    const toPixel = (x: number, z: number): [number, number] => [
        (x - DERIVED_GRID.x0) / MINIMAP_RESOLUTION,
        (z - DERIVED_GRID.z0) / MINIMAP_RESOLUTION
    ];

    let accumulated = 0;
    const draw = (x: number, z: number, forwardX: number, forwardZ: number) => {
        const expanded = figure.dataset.expanded === 'true';
        const size = expanded ? Math.min(window.innerWidth, window.innerHeight) * 0.8 : COMPACT_SIZE;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(size * ratio)) {
            canvas.width = Math.round(size * ratio);
            canvas.height = Math.round(size * ratio);
            canvas.style.width = `${size}px`;
            canvas.style.height = `${size}px`;
        }
        const w = canvas.width;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, w, w);
        context.save();
        if (!expanded) {
            // Compact view is a disc: clip the map to a circle.
            context.beginPath();
            context.arc(w / 2, w / 2, w / 2 - ratio, 0, Math.PI * 2);
            context.clip();
        }
        context.fillStyle = 'rgba(18, 26, 38, 0.82)';
        context.fillRect(0, 0, w, w);
        if (!ready) {
            context.restore();
            return;
        }
        const [px, pz] = toPixel(x, z);
        let scale: number;
        let cx: number;
        let cy: number;
        if (expanded) {
            scale = w / Math.max(image.width, image.height);
            context.drawImage(image, 0, 0, image.width * scale, image.height * scale);
            cx = px * scale;
            cy = pz * scale;
        } else {
            scale = w / (VIEW_METRES / MINIMAP_RESOLUTION);
            context.imageSmoothingEnabled = true;
            context.drawImage(image, px - w / 2 / scale, pz - w / 2 / scale, w / scale, w / scale, 0, 0, w, w);
            cx = w / 2;
            cy = w / 2;
        }
        context.restore();
        if (!expanded) {
            context.beginPath();
            context.arc(w / 2, w / 2, w / 2 - ratio, 0, Math.PI * 2);
            context.strokeStyle = 'rgba(255,255,255,0.55)';
            context.lineWidth = 2 * ratio;
            context.stroke();
            context.fillStyle = '#ffffff';
            context.font = `700 ${11 * ratio}px Inter, system-ui, sans-serif`;
            context.textAlign = 'center';
            context.textBaseline = 'top';
            context.fillText('N', w / 2, 5 * ratio);
        }
        const angle = Math.atan2(forwardZ, forwardX);
        const arrow = 9 * ratio;
        context.translate(cx, cy);
        context.rotate(angle);
        context.beginPath();
        context.moveTo(arrow, 0);
        context.lineTo(-arrow * 0.7, arrow * 0.6);
        context.lineTo(-arrow * 0.35, 0);
        context.lineTo(-arrow * 0.7, -arrow * 0.6);
        context.closePath();
        context.fillStyle = '#ff5a36';
        context.strokeStyle = '#fff';
        context.lineWidth = 2 * ratio;
        context.fill();
        context.stroke();
    };

    window.addEventListener('keydown', (event) => {
        if (event.code === 'KeyM' && figure.dataset.active === 'true') {
            figure.dataset.expanded = figure.dataset.expanded === 'true' ? 'false' : 'true';
        }
    });

    return {
        setActive: (active: boolean) => {
            figure.dataset.active = String(active);
            if (!active) figure.dataset.expanded = 'false';
        },
        /** Redraws at most ~20 times per second. */
        update: (deltaTime: number, x: number, z: number, forwardX: number, forwardZ: number) => {
            accumulated += deltaTime;
            if (accumulated < 0.05) return;
            accumulated = 0;
            draw(x, z, forwardX, forwardZ);
        },
        get expanded() {
            return figure.dataset.expanded === 'true';
        }
    };
};
