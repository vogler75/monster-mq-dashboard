// Isolated browser fixtures: no real broker, credentials, or remote connections.
// Run npm run build first, then node tests/preview-server.js.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
// DASHBOARD_FIXTURE_DEV=1 exercises Vite HTML injection and module transforms too.
const dev = process.env.DASHBOARD_FIXTURE_DEV === '1';
const vite = dev ? await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'custom' }) : null;
const root = resolve(dev ? 'src' : 'dist');
const clients = ['Zulu', 'Alpha'].map((name, index) => ({ name, namespace: 'test', nodeId: 'fixture', enabled: !index, isOnCurrentNode: true,
    config: { host: 'localhost', port: 6379, addresses: [], servers: ['nats://localhost:4222'], clientId: name }, metrics: [{ messagesIn: index ? 2 : 10, messagesOut: 0 }] }));
const peerSource = (nodeId, state, extra = {}) => ({ nodeId, state, lagRecords: 0, injected: 18250, appliedBytes: 2405120, rttMs: 0.8,
    reconnects: 1, gapLostTotal: 0, dropped: {}, applyDelayMs: { p50: 2, p99: 7, p99_9: 15 }, lastError: '', ...extra });
const peerConsumer = (nodeId, state, extra = {}) => ({ nodeId, state, remote: '10.0.0.12:51544', lag: 0, servedRecords: 18110, servedBytes: 2388000,
    sessions: 1, lostTotal: 0, lastFetch: '2026-10-10T06:00:00Z', ...extra });
const peerLink = { enabled: true, nodeId: 'fixture', listen: '0.0.0.0:1890', tls: true,
    status: { enabled: true, nodeId: 'fixture', epoch: 42, log: { records: 1200, bytes: 180224, maxBytes: 268435456, appended: { client: 1180, inline: 20, will: 0 }, evictedUnread: 0, active: true } },
    peers: [
        { nodeId: 'main-1', address: 'main-1:1890', pull: true, serve: true, interest: 'INHERIT', pullState: 'STREAMING', serveState: 'CONNECTED', remote: '10.0.0.10:50122', lastError: null,
            source: peerSource('main-1', 'STREAMING', { lagRecords: 12 }), consumer: peerConsumer('main-1', 'CONNECTED') },
        { nodeId: 'edge-line-a', address: 'edge-line-a:1890', pull: true, serve: false, interest: 'INHERIT', pullState: 'STREAMING', serveState: null, remote: null, lastError: null,
            source: peerSource('edge-line-a', 'STREAMING'), consumer: null },
        { nodeId: 'edge-line-b', address: null, pull: false, serve: true, interest: 'OFF', pullState: null, serveState: 'CONNECTED', remote: '10.0.0.14:40210', lastError: null,
            source: null, consumer: peerConsumer('edge-line-b', 'CONNECTED', { lag: 3 }) },
        { nodeId: 'edge-yard', address: 'edge-yard:1890', pull: true, serve: true, interest: 'INHERIT', pullState: 'BACKOFF', serveState: 'NEVER_CONNECTED', remote: null, lastError: 'dial tcp 10.0.0.20:1890: connection refused',
            source: peerSource('edge-yard', 'BACKOFF', { lastError: 'dial tcp 10.0.0.20:1890: connection refused', reconnects: 7 }), consumer: peerConsumer('edge-yard', 'NEVER_CONNECTED', { remote: '', sessions: 0, servedRecords: 0, servedBytes: 0 }) }
    ] };
function response(query, variables = {}) {
    const base = { broker: { userManagementEnabled: false, anonymousEnabled: true }, currentUser: null,
        brokers: [{ nodeId: 'fixture', isCurrent: true }], retainedMessage: null, enabledFeatures: null, clusterNodes: [{ nodeId: 'fixture' }], redisClients: clients, natsClients: clients, mqttClients: clients,
        flowNodeTypes: [], flowClasses: [], flowInstances: [], agents: [], genAiProviders: [], sparkplugBDecoders: [], peerLink };
    if (/\bmutation\b/.test(query)) {
        // Only fixture-prefixed Redis records may be changed; everything stays in this process.
        const input = variables.input;
        if (/CreateRedisClient|UpdateRedisClient/.test(query) && input?.name?.startsWith('fixture-')) {
            const client = { ...input, config: { ...input.config }, isOnCurrentNode: true, metrics: [] };
            const index = clients.findIndex(item => item.name === (variables.name || input.name));
            if (index >= 0) clients[index] = client; else clients.push(client);
            const action = /UpdateRedisClient/.test(query) ? 'update' : 'create';
            return { data: { redisClient: { [action]: { success: true, errors: [], client: { name: input.name } } } } };
        }
        return { errors: [{ message: 'Fixture rejected this mutation; use a fixture-prefixed Redis client.' }] };
    }
    if (variables.name) base.redisClients = clients.filter(client => client.name === variables.name);
    if (variables.topic?.startsWith('a2a/v1/fixture/')) {
        base.retainedMessage = { topic: variables.topic, payload: JSON.stringify(variables.topic.endsWith('/health')
            ? { status: 'running', messagesProcessed: 120, llmCalls: 8, errors: 0, inputTokens: 2400, outputTokens: 600, totalTokens: 3000 }
            : { name: 'Fixture Agent', description: 'Monitor layout fixture', status: 'running', version: '1.0', provider: 'Fixture', model: 'Test' }) };
    }
    return { data: base };
}
http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/graphql') {
        let body = ''; for await (const chunk of req) body += chunk;
        res.setHeader('Content-Type', 'application/json');
        const request = JSON.parse(body || '{}');
        res.end(JSON.stringify(response(request.query || '', request.variables))); return;
    }
    if (path.startsWith('/config/') || path === '/api/brokers') {
        res.setHeader('Content-Type', 'application/json');
        res.end(path.endsWith('brokers.json') || path === '/api/brokers' ? '[]' : '{}'); return;
    }
    if (path === '/js/broker-manager.js' || path === '/js/log-viewer.js') {
        res.setHeader('Content-Type', 'application/javascript'); res.end(''); return;
    }
    const document = req.headers['sec-fetch-dest'] === 'document' && path !== '/pages/broker-config.html';
    if (dev && !document && path !== '/' && !path.endsWith('.html')) return vite.middlewares(req, res, () => res.writeHead(404).end());
    const file = resolve(root, '.' + (document || path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    try {
        let data = await readFile(file);
        if (file.endsWith('/index.html')) {
            data = data.toString().replace('<head>', `<head><script>sessionStorage.setItem('monstermq_token','null'); sessionStorage.setItem('monstermq_userManagementEnabled','false');</script>`);
        }
        if (dev && file.endsWith('.html')) data = await vite.transformIndexHtml(req.url, data.toString());
        res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' })[extname(file)] || 'application/octet-stream');
        res.end(data);
    } catch { res.writeHead(404).end(); }
}).listen(dev ? 5181 : 5180, '127.0.0.1', () => console.log(`Fixture dashboard: http://127.0.0.1:${dev ? 5181 : 5180}/pages/redis-clients.html`));
