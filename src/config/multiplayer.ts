// Shared-world server address. Production routes through the Pages origin so browsers on networks that block
// workers.dev can still reach the room via the Pages Service Binding. Development stays offline unless a server is
// given explicitly (?server=ws://127.0.0.1:8787/ws), so local runs and tests never join the live room.
// ?offline=1 forces offline practice in any build; a production build served from localhost stays offline too.
export const PRODUCTION_SERVER = 'wss://moonshot-csgo-multiplayer.lloyd666.workers.dev/ws';

export const multiplayerUrl = (search: string, production: boolean, hostname = ''): string | null => {
    const params = new URLSearchParams(search);
    if (params.get('offline') === '1') return null;
    const explicit = params.get('server');
    if (explicit && /^wss?:\/\//.test(explicit)) return explicit;
    // A production build previewed locally (CI smoke test) is not an allowed origin; stay offline quietly.
    if (/^(localhost|127\.0\.0\.1)$/.test(hostname)) return null;
    return production ? (hostname ? `wss://${hostname}/ws` : PRODUCTION_SERVER) : null;
};
