// Notices a newer deployment while the game is open: polls /version.json (written at build time) and calls back
// once when its build id differs from the running one. Production builds only.
const POLL_MS = 60_000;

export const watchForUpdates = (current: string, onUpdate: () => void) => {
    let notified = false;
    const check = async () => {
        if (notified) return;
        try {
            const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) return;
            const { build } = (await response.json()) as { build?: string };
            if (build && build !== current) {
                notified = true;
                onUpdate();
            }
        } catch {
            /* offline: try again later */
        }
    };
    window.setInterval(() => void check(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void check();
    });
    return check;
};
