// Vérification rapide du relais contre `npx wrangler dev` (http://127.0.0.1:8787) : node test.mjs
import assert from 'node:assert/strict';

const BASE = process.env.LIVE_URL || 'http://127.0.0.1:8787';
const headers = { Origin: 'http://localhost:8000' };

function open(path) {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + path, { headers });
    ws.inbox = [];
    ws.waiters = [];
    ws.onmessage = e => { ws.inbox.push(e.data === 'pong' ? 'pong' : JSON.parse(e.data)); ws.waiters.forEach(w => w()); };
    ws.closed = new Promise(r => { ws.onclose = e => r(e.code); });
    return ws;
}

// Attend (et retire) le premier message qui satisfait `pred`.
function next(ws, pred = () => true) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout ' + pred + ' ' + JSON.stringify(ws.inbox))), 3000);
        const check = () => {
            const i = ws.inbox.findIndex(pred);
            if (i >= 0) { clearTimeout(t); ws.waiters = ws.waiters.filter(w => w !== check); resolve(ws.inbox.splice(i, 1)[0]); }
        };
        ws.waiters.push(check);
        check();
    });
}
const opened = ws => new Promise(r => ws.addEventListener('open', r, { once: true }));
const type = t => Object.assign(m => m.type === t, { toString: () => t });

assert.equal((await fetch(BASE + '/room', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
const { code, key } = await (await fetch(BASE + '/room', { method: 'POST', headers })).json();
assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);

const host = open(`/room/${code}?key=${key}`);
await opened(host);
host.send(JSON.stringify({ type: 'state', liveNow: null, queue: [{ qid: 'q1' }] }));

const guest = open(`/room/${code}?cid=abc`);
assert.equal((await next(guest, type('youAre'))).id, 1);
assert.equal((await next(guest, type('state'))).queue[0].qid, 'q1'); // état gardé pour l'arrivant

guest.send(JSON.stringify({ type: 'hello', name: 'Marie' }));
assert.deepEqual(await next(host, type('hello')), { type: 'hello', name: 'Marie', _from: 1 });

host.send(JSON.stringify({ type: 'chat', fromName: 'Hôte', text: 'salut', _to: 1 }));
assert.deepEqual(await next(guest, type('chat')), { type: 'chat', fromName: 'Hôte', text: 'salut' });

guest.send('ping');
assert.equal(await next(guest, m => m === 'pong'), 'pong');

// Reconnexion de l'invité : même id, pas de « bye » pour l'hôte.
const guest2 = open(`/room/${code}?cid=abc`);
assert.equal((await next(guest2, type('youAre'))).id, 1);
assert.equal(await guest.closed, 4000);
guest2.send(JSON.stringify({ type: 'hello', name: 'Marie' })); // le client le renvoie à chaque connexion

// Reconnexion de l'hôte : le relais lui rejoue les invités présents.
host.close();
const host2 = open(`/room/${code}?key=${key}`);
assert.equal((await next(host2, type('hello'))).name, 'Marie');

guest2.close();
assert.equal((await next(host2, type('bye')))._from, 1);

// Fin du salon par l'hôte, puis code inconnu.
const guest3 = open(`/room/${code}?cid=def`);
await next(guest3, type('youAre'));
host2.send(JSON.stringify({ type: 'end' }));
assert.equal(await guest3.closed, 4001);
assert.equal(await open(`/room/${code}?cid=x`).closed, 4404);

console.log('OK');
