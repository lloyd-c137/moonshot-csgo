type ServiceBinding = { fetch(request: Request): Promise<Response> };

/** Keep account requests same-origin, then forward them to the existing authoritative room Worker. */
export const onRequest = ({ request, env }: { request: Request; env: { GAME_API: ServiceBinding } }) => {
    // Browsers omit Origin on same-origin GETs. The Worker uses an origin allowlist, so without this
    // Pages-to-Worker hop the public leaderboard and authenticated profile reads are rejected as 403.
    const headers = new Headers(request.headers);
    if (!headers.has('Origin')) headers.set('Origin', new URL(request.url).origin);
    return env.GAME_API.fetch(new Request(request, { headers }));
};
