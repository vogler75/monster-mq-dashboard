const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/js/data-catalog.js'), 'utf8');

function fixture() {
    const requests = [], effects = [];
    const request = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
    const ui = Object.fromEntries(['clearError', 'setLoading', 'showError', 'error', 'success'].map(name =>
        [name, (...args) => effects.push([name, ...args])]));
    const context = vm.createContext({ ui, window: {},
        document: { readyState: 'loading', addEventListener() {}, getElementById() { effects.push(['dom']); throw Error('Detached DOM accessed'); } },
        graphqlClient: { query: request, getEnabledFeatures: request } });
    vm.runInContext(source + '\nthis.manager = Object.create(DataCatalogManager.prototype);', context);
    const manager = context.manager;
    Object.assign(manager, { disposed: false, loadVersion: 0, listeners: [], types: [], instances: [], relations: [] });
    manager.renderNamespaceOptions = () => effects.push(['namespace']);
    manager.render = () => effects.push(['render']);
    return { manager, requests, effects };
}

for (const failure of [false, true]) {
    test(`navigation ignores late catalog ${failure ? 'failure' : 'success'}`, async () => {
        const { manager, requests, effects } = fixture();
        const loading = manager.load();
        manager.cleanup();
        const before = JSON.stringify(effects);
        if (failure) requests[0].reject(Error('Network failure'));
        else requests[0].resolve({ dataCatalogTypes: [{ id: 'old' }] });
        await loading;
        assert.equal(JSON.stringify(effects), before);
        assert.equal(manager.types.length, 0);
        await manager.load();
        assert.equal(requests.length, 1);
    });
}

test('older refresh cannot overwrite the newer result or its loading state', async () => {
    const { manager, requests, effects } = fixture();
    const older = manager.load(), newer = manager.load();
    requests[1].resolve({ dataCatalogTypes: [{ id: 'new' }] });
    await newer;
    const before = JSON.stringify(effects);
    requests[0].resolve({ dataCatalogTypes: [{ id: 'old' }] });
    await older;
    assert.equal(manager.types[0].id, 'new');
    assert.equal(JSON.stringify(effects), before);
});

test('feature response after navigation does not access detached DOM', async () => {
    const { manager, requests, effects } = fixture();
    const pending = manager.configureFeatures();
    manager.cleanup(); requests[0].resolve([]);
    await pending;
    assert.equal(effects.length, 0);
});

test('late discovery does not open a proposal on the next page', async () => {
    const { manager, requests, effects } = fixture();
    manager.required = () => '#'; manager.value = () => 'Default';
    manager.openProposal = () => effects.push(['proposal']);
    const pending = manager.discover({ close: () => effects.push(['close']) }, false);
    manager.cleanup(); requests[0].resolve({ inferDataCatalog: { types: [], instances: [], relations: [] } });
    await pending;
    assert.equal(effects.length, 0);
});

test('late mutation errors do not show a toast on the next page', async () => {
    const { manager, requests, effects } = fixture();
    const pending = manager.mutateDelete('query', {}, 'Deleted');
    manager.cleanup(); requests[0].reject(Error('Failure'));
    await pending;
    assert.equal(effects.length, 0);
});
