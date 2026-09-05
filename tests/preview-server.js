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
function response(query, variables = {}) {
    const base = { broker: { userManagementEnabled: false, anonymousEnabled: true }, currentUser: null,
        brokers: [{ nodeId: 'fixture', isCurrent: true }], retainedMessage: null, enabledFeatures: null, clusterNodes: [{ nodeId: 'fixture' }], redisClients: clients, natsClients: clients, mqttClients: clients,
        flowNodeTypes: [], flowClasses: [], flowInstances: [], agents: [], genAiProviders: [], sparkplugBDecoders: [] };
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
