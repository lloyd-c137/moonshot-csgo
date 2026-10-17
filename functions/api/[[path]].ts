type ServiceBinding = { fetch(request: Request): Promise<Response> };

/** Keep account requests same-origin, then forward them to the existing authoritative room Worker. */
export const onRequest = ({ request, env }: { request: Request; env: { GAME_API: ServiceBinding } }) =>
    env.GAME_API.fetch(request);
