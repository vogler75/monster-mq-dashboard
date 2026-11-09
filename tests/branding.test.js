import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/js/branding.js', import.meta.url), 'utf8');

function element(tag) {
    const attrs = new Map();
    return {
        tagName: tag.toUpperCase(),
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
        remove() {},
        attrs
    };
}

// Run branding.js against a stubbed document; `served` is what
// /config/branding.json returns (undefined = 404).
async function load(served, { cached } = {}) {
    const links = [];
    const store = new Map(cached ? [['monstermq_branding_v1', JSON.stringify(cached)]] : []);
    const document = {
        readyState: 'loading',
        title: 'MonsterMQ - Sessions',
        head: {
            querySelector(sel) {
                const key = /data-brand-icon="([^"]+)"/.exec(sel)?.[1];
                if (key) return links.find(l => l.getAttribute('data-brand-icon') === key) || null;
                if (sel.includes('data-brand-css')) return links.find(l => l.getAttribute('data-brand-css')) || null;
                return null;
            },
            appendChild(el) { links.push(el); }
        },
        documentElement: element('html'),
        body: null,
        createElement: element,
        addEventListener() {}
    };
    const fetch = async () => served === undefined
        ? { ok: false, headers: new Map(), json: async () => null }
        : { ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => served };
    const window = {};
    const context = vm.createContext({
        window, document, fetch, AbortController, setTimeout, clearTimeout,
        sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
        Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_NODE: 9 }
    });
    vm.runInContext(source, context);
    const cachedProductName = window.branding.productName;
    await window.branding.ready;
    const href = rel => links.find(l => l.getAttribute('data-brand-icon') === rel)?.getAttribute('href');
    return { branding: window.branding, document, href, store, cachedProductName };
}

test('without branding.json the dashboard stays MonsterMQ', async () => {
    const { branding, document, href } = await load(undefined);
    assert.equal(branding.productName, 'MonsterMQ');
    assert.equal(branding.dashboardName, 'MonsterMQ Dashboard');
    assert.equal(branding.logo, '/assets/logo.png');
    assert.equal(href('icon'), '/favicon.ico');
    assert.equal(document.title, 'MonsterMQ - Sessions');
    assert.equal(branding.text('About MonsterMQ'), 'About MonsterMQ');
});

test('nexusmq pack with a custom product name', async () => {
    const { branding, document, href } = await load({ brand: 'nexusmq', productName: 'WinCCMQ' });
    assert.equal(branding.productName, 'WinCCMQ');
    assert.equal(branding.dashboardName, 'WinCCMQ Dashboard');
    assert.equal(branding.logo, '/brands/nexusmq/logo.svg');
    assert.equal(href('icon'), '/brands/nexusmq/favicon.ico');
    assert.equal(href('icon:32x32'), '/brands/nexusmq/favicon-32x32.png');
    assert.equal(href('apple-touch-icon:180x180'), '/brands/nexusmq/apple-touch-icon.png');
    assert.equal(document.title, 'WinCCMQ - Sessions');
    assert.equal(document.documentElement.getAttribute('data-brand'), 'nexusmq');
});

test('every MonsterMQ occurrence is replaced, including product variants', async () => {
    const { branding } = await load({ productName: 'WinCCMQ' });
    assert.equal(branding.text('Sign in to access your MonsterMQ dashboard'),
        'Sign in to access your WinCCMQ dashboard');
    assert.equal(branding.text('MonsterMQ Edge and MonsterMQ Core'), 'WinCCMQ Edge and WinCCMQ Core');
});

test('explicit asset overrides win over the pack, unknown packs fall back', async () => {
    const { branding } = await load({ brand: 'nexusmq', logo: '/custom/logo.png' });
    assert.equal(branding.logo, '/custom/logo.png');
    assert.equal(branding.config.favicon, '/brands/nexusmq/favicon.ico');

    const unknown = await load({ brand: 'does-not-exist' });
    assert.equal(unknown.branding.config.brand, 'monstermq');
    assert.equal(unknown.branding.logo, '/assets/logo.png');
});

test('cached branding applies before the fetch and is refreshed from the live file', async () => {
    const { cachedProductName, branding, store } = await load({ productName: 'Live' }, { cached: { productName: 'Cached' } });
    assert.equal(cachedProductName, 'Cached');
    assert.equal(branding.productName, 'Live');
    assert.deepEqual(JSON.parse(store.get('monstermq_branding_v1')), { productName: 'Live' });
});
