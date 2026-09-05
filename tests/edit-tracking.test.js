import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/js/ui.js', import.meta.url), 'utf8');
function fixture(core = true) {
    const document = new EventTarget();
    document.body = {};
    const root = { contains: target => target.primary === true };
    const context = vm.createContext({ document, window: {}, AbortController, Set,
        MutationObserver: class { observe() {} disconnect() {} }
    });
    vm.runInContext(source.slice(source.indexOf('    var pageEdits ='), source.indexOf('    function initManagementTables')) + '\nthis.api = { trackPageEdits, markPageSaved, markPageDirty };', context);
    const dispose = context.api.trackPageEdits(root, { core });
    function edit(options = {}) {
        const event = new Event('input');
        const target = { primary: true, closest: () => options.group || null, matches: () => options.search || false, ...options };
        Object.defineProperty(event, 'target', { value: target });
        document.dispatchEvent(event);
    }
    return { edit, dispose, ...context.api };
}

test('primary and programmatic edits persist until a successful save is acknowledged', () => {
    const f = fixture();
    assert.equal(f.dispose.isDirty(), false);
    f.edit();
    assert.equal(f.dispose.isDirty(), true);
    // Failed validation/request does not acknowledge a save and must retain the guard.
    assert.equal(f.dispose.isDirty(), true);
    f.markPageSaved();
    assert.equal(f.dispose.isDirty(), false);
    f.markPageDirty();
    assert.equal(f.dispose.isDirty(), true);
    f.dispose();
});

test('search, readonly, and disabled controls do not dirty a detail page', () => {
    const f = fixture();
    f.edit({ search: true }); f.edit({ readOnly: true }); f.edit({ disabled: true });
    assert.equal(f.dispose.isDirty(), false);
    f.dispose();
});

test('list filters are ignored, but an open editor is guarded until it closes', () => {
    const f = fixture(false);
    f.edit();
    assert.equal(f.dispose.isDirty(), false);
    let open = true;
    const group = { isConnected: true, getClientRects: () => open ? [{}] : [] };
    f.edit({ group });
    assert.equal(f.dispose.isDirty(), true);
    open = false;
    assert.equal(f.dispose.isDirty(), false);
    open = true;
    assert.equal(f.dispose.isDirty(), false);
    f.dispose();
});

test('disposed page tracking does not observe later input events', () => {
    const f = fixture();
    f.dispose(); f.edit();
    assert.equal(f.dispose.isDirty(), false);
});
