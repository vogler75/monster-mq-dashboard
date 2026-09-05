import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PageLifecycle } from '../src/js/page-lifecycle.js';
function fixture() {
    let id = 0;
    const active = new Map();
    const host = new EventTarget();
    host.setTimeout = host.setInterval = (fn, delay) => { active.set(++id, fn); return id; };
    host.clearTimeout = host.clearInterval = id => active.delete(id);
    host.requestAnimationFrame = fn => { active.set(++id, fn); return id; };
    host.cancelAnimationFrame = id => active.delete(id);
    const dom = new EventTarget();
    dom.createElement = () => ({ isConnected: true, remove() { this.isConnected = false; } });
    host.MutationObserver = class { disconnect() { this.disconnected = true; } };
    host.WebSocket = class { close() { this.closed = true; } };
    return { host, dom, active, scope: new PageLifecycle(host, dom) };
}

test('disposal clears all owned timers and frames, while shared shell timers survive', () => {
    const { scope, host, active } = fixture();
    const shellTimer = host.setInterval(() => {}, 10);
    for (let i = 0; i < 3; i++) {
        scope.setInterval(() => {}, 10);
        scope.window.setTimeout(() => {}, 10);
        scope.requestAnimationFrame(() => {});
    }
    scope.dispose();
    assert.deepEqual([...active.keys()], [shellTimer]);
    assert.equal(scope.setInterval(() => {}, 10), 0);
    assert.equal(scope.setTimeout(() => {}, 10), 0);
});

test('document and window listeners are removed when a page is left', () => {
    const { scope, host, dom } = fixture();
    let pageCalls = 0, shellCalls = 0;
    host.addEventListener('click', () => shellCalls++);
    scope.window.addEventListener('click', () => pageCalls++);
    scope.document.addEventListener('click', () => pageCalls++);
    host.dispatchEvent(new Event('click')); dom.dispatchEvent(new Event('click'));
    assert.equal(pageCalls, 2);
    scope.dispose();
    host.dispatchEvent(new Event('click')); dom.dispatchEvent(new Event('click'));
    assert.equal(pageCalls, 2);
    assert.equal(shellCalls, 2);
});

test('explicit bindings retain live local values and restore previous bindings in reverse module order', () => {
    const { scope, host, dom } = fixture();
    const old = () => 'shell'; host.refresh = old;
    let manager = null;
    scope.expose({ get manager() { return manager; }, refresh: () => 'first' });
    manager = { name: 'loaded' };
    assert.equal(host.manager.name, 'loaded');
    const second = new PageLifecycle(host, dom);
    second.expose({ refresh: () => 'second' });
    assert.equal(host.refresh(), 'second');
    second.dispose();
    assert.equal(host.refresh(), 'first');
    scope.dispose();
    assert.equal(host.refresh, old);
    assert.equal('manager' in host, false);
});

test('page assignments, observers, sockets, and injected elements are cleaned up', () => {
    const { scope, host } = fixture();
    scope.window.manager = { name: 'page' };
    const element = scope.document.createElement('div');
    const observer = new scope.MutationObserver(() => {});
    const socket = new scope.WebSocket('fixture');
    scope.dispose(); scope.dispose();
    assert.equal('manager' in host, false);
    assert.equal(element.isConnected, false);
    assert.equal(observer.disconnected, true);
    assert.equal(socket.closed, true);
});

test('ready callbacks run once without patching the real document', () => {
    const { scope, dom } = fixture();
    const original = dom.addEventListener;
    let called = 0;
    scope.document.addEventListener('DOMContentLoaded', () => called++);
    assert.equal(called, 0);
    scope.ready(); scope.ready();
    assert.equal(called, 1);
    assert.equal(dom.addEventListener, original);
});

test('HTML-inserted helper overlays are removed on disposal', () => {
    const { scope } = fixture();
    const overlay = { isConnected: true, remove() { this.isConnected = false; } };
    scope.own(overlay);
    scope.dispose();
    assert.equal(overlay.isConnected, false);
});

test('late page responses cannot clear a new page error or query its controls', () => {
    const { scope, host, dom } = fixture();
    let cleared = false;
    host.ui = { markPageSaved: () => { cleared = true; } };
    const late = new PageLifecycle(host, dom);
    late.dispose();
    late.ui.markPageSaved();
    assert.equal(cleared, false);
    assert.equal(late.document.getElementById('client-name'), null);
});
