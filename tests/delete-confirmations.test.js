import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const cases = [
    ['archive-group-detail', 'showDeleteModal', [], 'groupName'],
    ['topic-namespaces', 'showConfirmDeleteModal', ['review-item']],
    ['genai-providers', 'deleteProvider', ['review-item']],
    ['topic-namespace-detail', 'showDeleteModal', [], 'namespaceName'],
    ['opcua-servers', 'deleteServer', ['review-item']],
    ['sparkplugb-decoders', 'deleteDecoder', ['review-item']],
    ['topic-schema-policy-detail', 'showDeleteModal', [], 'policyName'],
    ['kafka-groups', 'deleteGroup', ['review-item']],
    ['jdbc-logger-detail', 'showDeleteModal', [], 'loggerName'],
    ['influxdb-loggers', 'showConfirmDeleteModal', ['review-item']],
    ['jdbc-loggers', 'showConfirmDeleteModal', ['review-item']],
    ['kafka-server-detail', 'showDeleteModal', [], 'serverName'],
    ['topic-schema-policies', 'showConfirmDeleteModal', ['review-item']],
    ['timebase-loggers', 'showConfirmDeleteModal', ['review-item']],
    ['winccoa-client-detail', 'confirmDeleteQuery', [0]],
    ['winccua-client-detail', 'confirmDeleteAddress', [0]],
];
const success = new Proxy({}, { get: (_, key) => key === 'then' ? undefined : key === 'success' ? true : success });
for (const [page, method, args, field] of cases) {
    for (const approved of [false, true]) {
        test(`${page}: ${approved ? 'confirmed delete mutates the selected entity' : 'cancel never mutates'}`, async () => {
            const source = readFileSync(new URL(`../src/js/${page}.js`, import.meta.url), 'utf8');
            const indent = ['opcua-servers', 'sparkplugb-decoders'].includes(page) ? '' : '    ';
            const match = source.match(new RegExp(`^${indent}async (?:function )?${method}\\([^)]*\\) \\{[\\s\\S]*?^${indent}\\}`, 'm'));
            assert.ok(match, `Missing delete operation ${method}`);
            const operation = match[0].trim().replace(/^async (?!function)/, 'async function ');
            const queries = [];
            const errors = [];
            let confirmations = 0;
            const query = async (query, variables) => { queries.push({ query, variables }); return success; };
            const noop = () => {};
            const context = vm.createContext({
                ui: { markPageSaved: noop, confirmDelete: async name => { confirmations++; assert.equal(name, 'review-item'); return approved; } },
                window: { graphqlClient: { query }, spaLocation: {} },
                console: { log: noop, error: noop }, setTimeout: noop,
                loadServers: noop, loadDecoders: noop, showLoading: noop,
                showErrorMessage: e => errors.push(e), showSuccessMessage: noop,
                showError: e => errors.push(e), showSuccess: noop,
                graphqlClient: { query }
            });
            const fn = vm.runInContext(`(${operation})`, context);
            const manager = { client: { query }, groupName: 'review-item', [field || '_']: 'review-item',
                clientName: 'device', queries: [{ query: 'review-item' }], addresses: [{ topic: 'review-item' }],
                showSuccess: noop, showError: e => errors.push(e), showLoading: noop,
                loadData: noop, loadPolicies: noop, loadLoggers: noop, loadGroups: noop, loadProviders: noop, loadClient: noop
            };
            await fn.apply(manager, args);
            assert.equal(confirmations, 1);
            assert.equal(queries.length, approved ? 1 : 0, JSON.stringify(errors));
            assert.deepEqual(errors, []);
            if (approved) assert.ok(Object.values(queries[0].variables).includes('review-item'));
        });
    }
}
