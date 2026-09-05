import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/js/sidebar.js', import.meta.url), 'utf8');
function fixture() {
    const cleared = [];
    let nextId = 0;
    const window = {
        setInterval: () => ++nextId, setTimeout: () => ++nextId,
        clearInterval: id => cleared.push(id), clearTimeout: id => cleared.push(id),
        location: { replace() { throw new Error('Unexpected navigation fallback'); } }
    };
    const context = vm.createContext({ window, console, history: {},
        ui: { confirm: async () => false }, fetch: () => { throw new Error('Unexpected fetch'); }
    });
    vm.runInContext(source.slice(0, source.indexOf('// ===================== Page cleanup registration')) + '\nthis.SidebarManager = SidebarManager;', context);
    const manager = Object.create(context.SidebarManager.prototype);
    Object.assign(manager, { _pageCleanups: [], _pageDirtyChecks: [], _currentHref: '/pages/first.html' });
    return { window, manager, context, cleared };
}

test('declining discard preserves the current page without fetching or disposing it', async () => {
    const { manager } = fixture();
    manager._pageDirtyChecks.push(() => true);
    assert.equal(await manager.navigateTo('/pages/second.html'), false);
    assert.equal(manager._currentHref, '/pages/first.html');
    assert.equal(manager._pageDirtyChecks.length, 1);
    assert.equal(manager._navigationPending, false);
});

test('same-page navigation never prompts or disposes the page', async () => {
    const { manager, context } = fixture();
    context.ui.confirm = () => { throw new Error('Unexpected confirmation'); };
    manager._pageDirtyChecks.push(() => true);
    assert.equal(await manager.navigateTo('/pages/first.html'), true);
});

test('a pending discard prompt prevents overlapping navigation', async () => {
    const { manager, context } = fixture();
    let resolvePrompt;
    context.ui.confirm = () => new Promise(resolve => { resolvePrompt = resolve; });
    manager._pageDirtyChecks.push(() => true);
    const first = manager.navigateTo('/pages/second.html');
    assert.equal(await manager.navigateTo('/pages/third.html'), false);
    resolvePrompt(false);
    assert.equal(await first, false);
});

test('Vite runtime scripts are not treated as mounted page modules', () => {
    const { manager } = fixture();
    assert.equal(manager.isPageModuleSource('/@vite/client'), false);
    assert.equal(manager.isPageModuleSource('/@id/__x00__vite-browser-external'), false);
    assert.equal(manager.isPageModuleSource('/js/vendor/chart.umd.js'), false);
    assert.equal(manager.isPageModuleSource('/js/dashboard.js'), true);
});

test('replacing a detail URL preserves the browser history index', () => {
    const { manager, context, window } = fixture();
    context.URL = URL;
    window.location.href = 'http://localhost/pages/first.html';
    context.history.state = { dashboardIndex: 4, retained: true };
    manager._historyIndex = 4;
    let replacement;
    context.history.replaceState = (state, title, url) => { replacement = { state, url }; };
    manager.replaceCurrentUrl('/pages/first.html?name=renamed');
    assert.equal(manager._currentHref, '/pages/first.html?name=renamed');
    assert.equal(replacement.state.dashboardIndex, 4);
    assert.equal(replacement.state.retained, true);
    assert.equal(replacement.state.page, manager._currentHref);
    assert.equal(replacement.url, manager._currentHref);
});

test('navigation failure reports an error without reloading into a redirect loop', async () => {
    const { manager, context } = fixture();
    const messages = [];
    context.fetch = async () => { throw new Error('Page unavailable'); };
    context.ui.showError = message => messages.push(message);
    context.console = { error() {} };
    assert.equal(await manager.navigateTo('/pages/second.html'), false);
    assert.equal(manager._navigationPending, false);
    assert.equal(manager._currentHref, '/pages/first.html');
    assert.deepEqual(messages, ['Unable to open page: Page unavailable']);
});
