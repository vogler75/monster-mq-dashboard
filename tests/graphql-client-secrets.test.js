import assert from 'node:assert/strict';
import { test } from 'node:test';

test('GraphQL requests carry credentials without writing them to the console', async () => {
    const previous = Object.fromEntries(['window', 'document', 'localStorage', 'fetch', 'console']
        .map(name => [name, globalThis[name]]));
    const logs = [];
    const token = 'session-token-secret';
    const variableSecret = 'private-key-password-secret';
    const literalSecret = 'inline-password-secret';
    const responseSecret = 'response-secret';
    let sent;

    try {
        const storage = { getItem: key => key === 'monstermq_token' ? token : null };
        globalThis.window = { safeStorage: storage };
        globalThis.localStorage = storage;
        globalThis.document = { addEventListener() {} };
        globalThis.console = Object.fromEntries(['log', 'warn', 'error']
            .map(level => [level, (...args) => logs.push([level, ...args])]));
        globalThis.fetch = async (_url, options) => {
            sent = options;
            return {
                ok: true, status: 200, statusText: 'OK',
                text: async () => JSON.stringify({ data: { value: responseSecret } })
            };
        };

        await import('../src/js/graphql-client.js');
        const query = `mutation SaveMqttClient($password: String!) { save(password: "${literalSecret}") }`;
        const result = await globalThis.window.graphqlClient.query(query, { tlsClientKeyPassword: variableSecret });

        assert.equal(result.value, responseSecret);
        assert.equal(sent.headers.Authorization, `Bearer ${token}`);
        assert.deepEqual(JSON.parse(sent.body), { query, variables: { tlsClientKeyPassword: variableSecret } });
        const output = JSON.stringify(logs);
        for (const secret of [token, variableSecret, literalSecret, responseSecret]) {
            assert.equal(output.includes(secret), false, `Console exposed ${secret}`);
        }
    } finally {
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[name];
            else globalThis[name] = value;
        }
    }
});
