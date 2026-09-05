import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('all page modules can be imported without a DOM and expose an explicit mount function', async () => {
    const root = new URL('../src/js/', import.meta.url);
    const modules = readdirSync(root).filter(name => readFileSync(new URL(name, root), 'utf8').includes('export function mount(page)'));
    assert.equal(modules.length, 76);
    for (const file of modules) {
        const module = await import(new URL(file, root));
        assert.equal(typeof module.mount, 'function', file);
    }
});
