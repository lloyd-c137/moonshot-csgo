// Cloudflare Worker + Durable Object hosting the shared campus world. Every player joins the single room
// "campus" over a WebSocket at /ws. State is in memory only: no accounts, no logging of addresses, nothing stored.
// eslint-disable-next-line import-x/no-unresolved -- provided by the Workers runtime
import { DurableObject } from 'cloudflare:workers';

import { SPAWN_POINTS } from '../src/config/spawns.ts';
import { parseClientMessage, SNAPSHOT_HZ } from '../src/net/protocol.ts';
import type { ServerMessage } from '../src/net/protocol.ts';

import { Room } from './room.ts';

type Env = { WORLD: DurableObjectNamespace<World>; ALLOWED_ORIGINS: string };

const originAllowed = (origin: string | null, allowed: string) => {
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

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/health') return new Response('ok', { headers: { 'cache-control': 'no-store' } });
        if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
        if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
            return new Response('Origin not allowed', { status: 403 });
        }
        return env.WORLD.get(env.WORLD.idFromName('campus')).fetch(request);
    }
};

export class World extends DurableObject<Env> {
    private sockets = new Map<string, WebSocket>();
    private room: Room;
    private timer: ReturnType<typeof setInterval> | null = null;
    private counter = 0;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        const send = (socket: WebSocket | undefined, message: ServerMessage) => {
            try {
                socket?.send(JSON.stringify(message));
            } catch {
                /* closed */
            }
        };
        this.room = new Room(
            {
                to: (id, message) => send(this.sockets.get(id), message),
                all: (message, except) => {
                    const text = JSON.stringify(message);
                    for (const [id, socket] of this.sockets) {
                        if (id === except) continue;
                        try {
                            socket.send(text);
                        } catch {
                            /* closed */
                        }
                    }
                },
                close: (id) => {
                    try {
                        this.sockets.get(id)?.close(1008, 'rejected');
                    } catch {
                        /* closed */
                    }
                }
            },
            SPAWN_POINTS.length
        );
    }

    async fetch(): Promise<Response> {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        const id = `${Date.now().toString(36)}${(this.counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        this.sockets.set(id, server);
        this.room.connect(id);
        let budget = 60;
        let budgetAt = Date.now();
        server.addEventListener('message', (event) => {
            // Simple flood guard: at most 60 messages per second per connection.
            const now = Date.now();
            if (now - budgetAt > 1000) {
                budget = 60;
                budgetAt = now;
            }
            if (--budget < 0) return;
            const text = typeof event.data === 'string' ? event.data : '';
            this.room.message(id, parseClientMessage(text), now);
        });
        const drop = () => {
            if (!this.sockets.delete(id)) return;
            this.room.disconnect(id);
            if (!this.sockets.size && this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        };
        server.addEventListener('close', drop);
        server.addEventListener('error', drop);
        if (!this.timer) this.timer = setInterval(() => this.room.tick(Date.now()), 1000 / SNAPSHOT_HZ);
        return new Response(null, { status: 101, webSocket: client });
    }
}
