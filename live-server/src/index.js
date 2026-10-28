// Relais du Mode Live de Cantus : un Durable Object (SQLite, API WebSocket Hibernation) par salon.
//
// L'hôte reste l'unique source de vérité (file, chant en direct, leaders) : le relais ne fait que
// transporter les messages.
// - Message d'un invité → transmis à l'hôte seul, avec `_from: <id de l'invité>`.
// - Message de l'hôte   → à tous les invités, ou à un seul si `_to: <id>` est présent.
// - Le dernier `state` et la dernière `presence` diffusés sont gardés pour les arrivants.
// - Le relais signale à l'hôte les départs (`bye`) et lui rejoue les `hello` à sa (re)connexion.
import { DurableObject } from 'cloudflare:workers';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 signes, ni 0/O ni 1/I
const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
const IDLE_MS = 2 * 60 * 60 * 1000; // salon vide depuis 2 h → effacé
const MAX_MSG = 64 * 1024;
const ORIGIN_RE = /^(https:\/\/(www\.)?cantus-app\.fr|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function cors(origin) {
    return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
}

function randomCode() {
    return [...crypto.getRandomValues(new Uint8Array(5))].map(b => ALPHABET[b % 32]).join('');
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        if (!ORIGIN_RE.test(origin)) return new Response('Origine refusée', { status: 403 });
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

        const { pathname } = new URL(request.url);
        // Passerelle vers l'API AELF, qui n'envoie plus d'en-tête CORS (octobre 2026) : le
        // navigateur bloquait la réponse. Mise en cache 6 h côté Cloudflare.
        const aelf = pathname.match(/^\/aelf\/messes\/(\d{4}-\d{2}-\d{2})\/([a-z]+)$/);
        if (request.method === 'GET' && aelf) {
            const r = await fetch(`https://api.aelf.org/v1/messes/${aelf[1]}/${aelf[2]}`, { cf: { cacheTtl: 21600, cacheEverything: true } });
            return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
        }
        if (request.method === 'POST' && pathname === '/room') {
            for (let i = 0; i < 5; i++) {
                const code = randomCode();
                const key = await env.ROOMS.get(env.ROOMS.idFromName(code)).create();
                if (key) return Response.json({ code, key }, { headers: cors(origin) });
            }
            return new Response('Réessayez', { status: 503, headers: cors(origin) });
        }

        const m = pathname.match(/^\/room\/([A-Z0-9]+)$/);
        if (m && CODE_RE.test(m[1]) && request.headers.get('Upgrade') === 'websocket') {
            return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
        }
        return new Response('Introuvable', { status: 404, headers: cors(origin) });
    }
};

export class Room extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        // Répondu par Cloudflare sans réveiller l'objet (ni durée facturée).
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    async create() {
        if (await this.ctx.storage.get('key')) return null; // code déjà pris
        const key = crypto.randomUUID();
        await this.ctx.storage.put('key', key);
        await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
        return key;
    }

    sockets(role, id) {
        return this.ctx.getWebSockets().filter(ws => {
            const a = ws.deserializeAttachment();
            return a && a.role === role && (id === undefined || a.id === id);
        });
    }

    async fetch(request) {
        const params = new URL(request.url).searchParams;
        const [client, ws] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(ws);
        const roomKey = await this.ctx.storage.get('key');
        if (!roomKey) {
            ws.close(4404, 'Salon inconnu');
            return new Response(null, { status: 101, webSocket: client });
        }

        if (params.get('key') === roomKey) {
            this.sockets('host').forEach(old => old.close(4000, 'Remplacé'));
            ws.serializeAttachment({ role: 'host' });
            // L'hôte (re)connecté apprend qui est déjà là.
            for (const g of this.sockets('guest')) {
                const a = g.deserializeAttachment();
                if (a.name !== null) ws.send(JSON.stringify({ type: 'hello', name: a.name, _from: a.id }));
            }
        } else {
            // Identifiant stable par appareil (cid) : un invité qui se reconnecte garde son id,
            // donc son statut de leader chez l'hôte.
            const cid = (params.get('cid') || crypto.randomUUID()).slice(0, 64);
            let id = await this.ctx.storage.get('cid:' + cid);
            if (!id) {
                id = (await this.ctx.storage.get('next')) || 1;
                await this.ctx.storage.put({ next: id + 1, ['cid:' + cid]: id });
            }
            this.sockets('guest', id).forEach(old => old.close(4000, 'Remplacé'));
            ws.serializeAttachment({ role: 'guest', id, name: null });
            ws.send(JSON.stringify({ type: 'youAre', id }));
            const cached = await this.ctx.storage.get(['state', 'presence']);
            for (const v of cached.values()) ws.send(v);
        }
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, data) {
        if (typeof data !== 'string' || data.length > MAX_MSG) return;
        let msg;
        try { msg = JSON.parse(data); } catch (e) { return; }
        if (!msg || typeof msg !== 'object') return;
        const a = ws.deserializeAttachment();

        if (a.role === 'host') {
            if (msg.type === 'end') return this.end();
            const to = msg._to;
            delete msg._to;
            const out = JSON.stringify(msg);
            if (to === undefined && (msg.type === 'state' || msg.type === 'presence')) {
                await this.ctx.storage.put(msg.type, out);
            }
            this.sockets('guest', to).forEach(g => { try { g.send(out); } catch (e) {} });
        } else {
            if (msg.type === 'hello') {
                a.name = String(msg.name || '').slice(0, 40);
                ws.serializeAttachment(a);
            }
            msg._from = a.id;
            this.sockets('host').forEach(h => { try { h.send(JSON.stringify(msg)); } catch (e) {} });
        }
    }

    async webSocketClose(ws, code, reason) {
        try { ws.close(code, reason); } catch (e) {}
        const a = ws.deserializeAttachment();
        const others = this.ctx.getWebSockets().filter(s => s !== ws);
        if (a && a.role === 'guest' && !others.some(s => s.deserializeAttachment()?.id === a.id)) {
            this.sockets('host').forEach(h => { try { h.send(JSON.stringify({ type: 'bye', _from: a.id })); } catch (e) {} });
        }
        if (others.length === 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    }

    async webSocketError(ws) {
        await this.webSocketClose(ws, 1011, 'Erreur');
    }

    async alarm() {
        if (this.ctx.getWebSockets().length === 0) await this.ctx.storage.deleteAll();
        else await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    }

    async end() {
        this.ctx.getWebSockets().forEach(s => { try { s.close(4001, 'Salon fermé'); } catch (e) {} });
        await this.ctx.storage.deleteAll();
    }
}
