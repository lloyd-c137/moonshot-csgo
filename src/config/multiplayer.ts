// Campus builds connect back to the origin serving this page. Explicit ?server= and ?offline=1 remain available for QA.
export const multiplayerUrl = (search: string, production: boolean, hostname = '', protocol = 'https:'): string | null => {
    const params = new URLSearchParams(search);
    if (params.get('offline') === '1') return null;
    const explicit = params.get('server');
    if (explicit && /^wss?:\/\//.test(explicit)) return explicit;
    // A production build previewed locally (CI smoke test) is not an allowed origin; stay offline quietly.
    let hostOnly = hostname;
    try {
        hostOnly = new URL(`${protocol}//${hostname}`).hostname;
    } catch {
        // Keep the caller value so invalid hosts still fail through normal connection handling.
    }
    if (/^(localhost|127\.0\.0\.1)$/.test(hostOnly)) return null;
    if (!production || !hostname) return null;
    const scheme = protocol === 'http:' ? 'ws' : 'wss';
    return `${scheme}://${hostname}/ws`;
};
