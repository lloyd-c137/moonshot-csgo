export const originAllowed = (origin: string | null, allowed: string) => {
    if (!origin) return false;
    let host: string;
    try {
        host = new URL(origin).hostname;
    } catch {
        return false;
    }
    return allowed.split(',').some((pattern) => {
        const rule = pattern.trim();
        if (rule.startsWith('*.')) return host.endsWith(rule.slice(1)) || host === rule.slice(2);
        return host === rule;
    });
};

/** Origin is absent on some same-origin GETs; only those read-only requests may omit it. */
export const requestOriginAllowed = (request: Request, allowed: string) =>
    (!request.headers.has('Origin') && request.method === 'GET') ||
    originAllowed(request.headers.get('Origin'), allowed);
