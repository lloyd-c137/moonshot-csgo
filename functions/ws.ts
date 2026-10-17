type ServiceBinding = { fetch(request: Request): Promise<Response> };

/** Proxy the multiplayer WebSocket handshake through Pages without changing the room protocol. */
export const onRequest = ({ request, env }: { request: Request; env: { GAME_API: ServiceBinding } }) =>
    env.GAME_API.fetch(request);
