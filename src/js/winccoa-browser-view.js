// WinCC OA browser component (UNS Modeler §4.1, §7 A2): systems, datapoint
// types with their datapoints and element trees, a flat datapoint search,
// filters, multi-selection, element details, and a drag source for the UNS
// editor. Built on GraphQL Query.winccoa. Used by the UNS Modeler detail
// page and the stand-alone WinCC OA browser page.

export const DRAG_TYPE = 'application/x-uns-items';

const PAGE = 100;

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class WinCCOaBrowserView {
    // opts: { document, gql, onSelectionChange(items), onDetails(info) }
    constructor(container, opts) {
        this.root = container;
        this.doc = opts.document;
        this.gql = opts.gql;
        this.onSelectionChange = opts.onSelectionChange || (() => {});
        this.onDetails = opts.onDetails || (() => {});
        this.setTimeout = opts.setTimeout || setTimeout;
        this.clearTimeout = opts.clearTimeout || clearTimeout;
        this.systems = [];
        this.local = '';
        this.system = '';
        this.mode = 'types';
        this.typePattern = '*';
        this.dpPattern = '*';
        this.elementType = '';
        this.expanded = new Set();
        this.cache = new Map(); // key -> data
        this.selected = new Map(); // key -> item
        this.render();
    }

    async init() {
        try {
            const r = await this.gql.query('query { winccoa { systems { name local connected } } }');
            if (!r.winccoa) {
                this.list.innerHTML = '<div class="um-empty">The broker does not run embedded in WinCC OA.</div>';
                return false;
            }
            this.systems = r.winccoa.systems;
            const local = this.systems.find(s => s.local);
            this.local = local ? local.name : '';
            this.system = this.local;
            this.sysSelect.innerHTML = this.systems.map(s =>
                `<option value="${esc(s.name)}"${s.connected ? '' : ' disabled'}>${esc(s.name)}${s.local ? ' (local)' : ''}${s.connected ? '' : ' (disconnected)'}</option>`).join('');
            this.sysSelect.value = this.system;
            await this.reload();
            return true;
        } catch (e) {
            this.list.innerHTML = `<div class="um-empty">${esc(e.message)}</div>`;
            return false;
        }
    }

    render() {
        this.root.innerHTML = `
            <div class="um-browser-filters">
                <select class="form-control" data-role="system" aria-label="System" data-ignore-dirty></select>
                <select class="form-control" data-role="mode" aria-label="View" data-ignore-dirty>
                    <option value="types">Types</option>
                    <option value="search">Datapoint search</option>
                </select>
                <input type="search" class="form-control" data-role="type-pattern" placeholder="Type pattern (*)" aria-label="Type pattern" data-ignore-dirty>
                <input type="search" class="form-control" data-role="dp-pattern" placeholder="Datapoint pattern (*)" aria-label="Datapoint pattern" data-ignore-dirty>
                <select class="form-control" data-role="element-type" aria-label="Element type" data-ignore-dirty>
                    <option value="">All element types</option>
                    <option>float</option><option>int</option><option>uint</option><option>bool</option>
                    <option>string</option><option>time</option><option>bit32</option><option>long</option>
                    <option>langString</option><option>blob</option>
                </select>
            </div>
            <div class="um-browser-selection"><span data-role="sel-count">0 selected</span>
                <button type="button" class="btn btn-secondary btn-sm" data-role="select-all">Select all results</button>
                <button type="button" class="btn btn-secondary btn-sm" data-role="clear">Clear</button></div>
            <div class="um-tree" data-role="list" role="tree"></div>`;
        const q = r => this.root.querySelector(`[data-role="${r}"]`);
        this.sysSelect = q('system');
        this.list = q('list');
        this.selCount = q('sel-count');
        q('system').addEventListener('change', e => { this.system = e.target.value; this.reset(); });
        q('mode').addEventListener('change', e => { this.mode = e.target.value; this.reset(); });
        let t1, t2;
        q('type-pattern').addEventListener('input', e => { this.clearTimeout(t1); t1 = this.setTimeout(() => { this.typePattern = e.target.value || '*'; this.reset(); }, 300); });
        q('dp-pattern').addEventListener('input', e => { this.clearTimeout(t2); t2 = this.setTimeout(() => { this.dpPattern = e.target.value || '*'; this.reset(true); }, 300); });
        q('element-type').addEventListener('change', e => { this.elementType = e.target.value; this.paint(); });
        q('select-all').addEventListener('click', () => this.selectAllVisible());
        q('clear').addEventListener('click', () => { this.selected.clear(); this.paint(); this.emitSelection(); });
    }

    reset(keepTypes) {
        if (!keepTypes) this.expanded.clear();
        for (const k of [...this.cache.keys()]) if (!keepTypes || !k.startsWith('types|')) this.cache.delete(k);
        this.reload();
    }

    sysArg() { return this.system === this.local ? null : this.system; }

    async reload() {
        try {
            if (this.mode === 'types') await this.loadTypes();
            else await this.loadDatapoints('search', null, 0);
            for (const key of this.expanded) await this.ensureExpanded(key);
        } catch (e) {
            this.list.innerHTML = `<div class="um-empty">${esc(e.message)}</div>`;
            return;
        }
        this.paint();
    }

    async loadTypes() {
        const key = `types|${this.system}|${this.typePattern}`;
        if (this.cache.has(key)) return;
        const r = await this.gql.query('query($s: String, $p: String) { winccoa { types(system: $s, pattern: $p) } }', { s: this.sysArg(), p: this.typePattern });
        this.cache.set(key, r.winccoa.types);
    }

    async loadDatapoints(scope, type, offset) {
        const key = `dps|${this.system}|${scope}|${type || ''}|${this.dpPattern}`;
        const cur = this.cache.get(key) || { items: [], total: 0 };
        if (offset > 0 && offset < cur.items.length) return;
        const r = await this.gql.query(`query($s: String, $p: String, $t: String, $o: Int) { winccoa { datapoints(system: $s, pattern: $p, type: $t, limit: ${PAGE}, offset: $o) { total items { name system type } } } }`,
            { s: this.sysArg(), p: this.dpPattern, t: type, o: offset });
        const page = r.winccoa.datapoints;
        this.cache.set(key, { items: offset ? cur.items.concat(page.items) : page.items, total: page.total });
    }

    async loadStructure(type) {
        const key = `struct|${this.system}|${type}`;
        if (this.cache.has(key)) return this.cache.get(key);
        const r = await this.gql.query('query($s: String, $t: String!) { winccoa { typeStructure(system: $s, type: $t) { elements { path name depth elementType valueElement childCount } } } }', { s: this.sysArg(), t: type });
        const els = r.winccoa.typeStructure.elements;
        this.cache.set(key, els);
        return els;
    }

    async ensureExpanded(key) {
        const [kind, a] = key.split('|');
        if (kind === 'type') await this.loadDatapoints('type', a, 0);
        if (kind === 'dp') {
            const dp = this.findDp(a);
            if (dp) await this.loadStructure(dp.type);
        }
    }

    findDp(name) {
        for (const [k, v] of this.cache) if (k.startsWith('dps|') && v.items) {
            const d = v.items.find(i => i.name === name);
            if (d) return d;
        }
        return null;
    }

    systemOf(item) { return item.system && item.system !== this.local ? item.system : undefined; }

    // Items: type, datapoint and element entries as drop payloads.
    typeItem(type) { return { kind: 'type', type, system: this.sysArg() || undefined, pattern: this.dpPattern !== '*' ? this.dpPattern : '*' }; }
    dpItem(dp) { return { kind: 'datapoint', type: dp.type, datapoint: dp.name, system: this.systemOf(dp) }; }
    elementItem(dp, el) { return { kind: 'element', type: dp.type, datapoint: dp.name, path: el.path, elementType: el.elementType, system: this.systemOf(dp) }; }

    paint() {
        const rows = [];
        const add = (key, depth, label, opts = {}) => rows.push({ key, depth, label, ...opts });
        if (this.mode === 'types') {
            const types = this.cache.get(`types|${this.system}|${this.typePattern}`) || [];
            for (const t of types) {
                const tk = `type|${t}`;
                add(tk, 0, t, { icon: 'tree', expandable: true, item: this.typeItem(t), kind: 'DPT' });
                if (this.expanded.has(tk)) this.paintDps(rows, 'type', t, 1);
            }
            if (!types.length) rows.push({ empty: 'No datapoint types match.' });
        } else {
            this.paintDps(rows, 'search', null, 0);
        }
        this.list.innerHTML = rows.map(r => r.empty ? `<div class="um-empty">${esc(r.empty)}</div>`
            : r.more ? `<div class="um-row um-more" style="padding-left:${0.5 + r.depth * 1.1}rem" data-more="${esc(r.more)}">Load more (${r.count} of ${r.total})</div>`
            : `<div class="um-row${this.selected.has(r.key) ? ' selected' : ''}" role="treeitem" draggable="true" data-key="${esc(r.key)}" style="padding-left:${0.5 + r.depth * 1.1}rem">
                <span class="um-chevron${r.expandable ? (this.expanded.has(r.key) ? ' expanded' : '') : ' hidden'}" data-toggle="1">&#9656;</span>
                <input type="checkbox" class="um-check" ${this.selected.has(r.key) ? 'checked' : ''} aria-label="Select ${esc(r.label)}" data-ignore-dirty>
                <span class="um-kind">${esc(r.kind || '')}</span>
                <span class="um-label">${esc(r.label)}</span>
                ${r.meta ? `<span class="um-meta">${esc(r.meta)}</span>` : ''}
            </div>`).join('');
        this.rows = new Map(rows.filter(r => r.key).map(r => [r.key, r]));
        this.bindRows();
        this.selCount.textContent = `${this.selected.size} selected`;
    }

    paintDps(rows, scope, type, depth) {
        const data = this.cache.get(`dps|${this.system}|${scope}|${type || ''}|${this.dpPattern}`);
        if (!data) return;
        for (const dp of data.items) {
            const dk = `dp|${dp.name}`;
            rows.push({ key: dk, depth, label: dp.name, icon: 'document', expandable: true, item: this.dpItem(dp), kind: 'DP', meta: scope === 'search' ? dp.type : '' });
            if (this.expanded.has(dk)) {
                const els = this.cache.get(`struct|${this.system}|${dp.type}`) || [];
                for (const el of els) {
                    if (el.depth === 0 && !el.valueElement) continue;
                    if (this.elementType && el.valueElement && el.elementType !== this.elementType) continue;
                    if (this.elementType && !el.valueElement) continue;
                    const label = el.path === '' ? '(root)' : (this.elementType ? el.path : el.name);
                    rows.push({
                        key: `el|${dp.name}|${el.path}`, depth: depth + 1 + (this.elementType ? 0 : Math.max(el.depth - 1, 0)), label,
                        item: el.valueElement ? this.elementItem(dp, el) : null, kind: el.valueElement ? 'DPE' : '', meta: el.elementType,
                        struct: !el.valueElement, dp, el
                    });
                }
            }
        }
        if (data.items.length < data.total) rows.push({ more: `${scope}|${type || ''}|${data.items.length}`, depth, count: data.items.length, total: data.total });
        if (!data.items.length) rows.push({ empty: 'No datapoints match.' });
    }

    bindRows() {
        this.list.querySelectorAll('.um-row[data-key]').forEach(rowEl => {
            const key = rowEl.dataset.key;
            const r = this.rows.get(key);
            rowEl.querySelector('[data-toggle]').addEventListener('click', async e => {
                e.stopPropagation();
                if (!r.expandable) return;
                if (this.expanded.has(key)) this.expanded.delete(key);
                else {
                    this.expanded.add(key);
                    try { await this.ensureExpanded(key); } catch (err) { this.onDetails({ error: err.message }); }
                }
                this.paint();
            });
            const cb = rowEl.querySelector('.um-check');
            if (!r.item) cb.disabled = true;
            cb.addEventListener('click', e => {
                e.stopPropagation();
                this.toggle(key, r, cb.checked);
            });
            rowEl.addEventListener('click', () => this.details(r));
            rowEl.addEventListener('dragstart', e => {
                if (!r.item) { e.preventDefault(); return; }
                const items = this.selected.has(key) ? [...this.selected.values()] : [r.item];
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(items));
                e.dataTransfer.setData('text/plain', items.map(i => i.datapoint ? `${i.datapoint}${i.path ? '.' + i.path : ''}` : i.type).join('\n'));
                e.dataTransfer.effectAllowed = 'copy';
            });
        });
        this.list.querySelectorAll('.um-more').forEach(m => m.addEventListener('click', async () => {
            const [scope, type, off] = m.dataset.more.split('|');
            await this.loadDatapoints(scope, type || null, Number(off));
            this.paint();
        }));
    }

    toggle(key, r, on) {
        if (!r.item) return;
        if (on) this.selected.set(key, r.item);
        else this.selected.delete(key);
        this.paint();
        this.emitSelection();
    }

    selectAllVisible() {
        for (const [key, r] of this.rows) if (r.item) this.selected.set(key, r.item);
        this.paint();
        this.emitSelection();
    }

    emitSelection() { this.onSelectionChange([...this.selected.values()]); }

    selection() { return [...this.selected.values()]; }

    async details(r) {
        if (!r) return;
        if (r.el) {
            const dpe = `${r.dp.system}:${r.dp.name}.${r.el.path}`;
            try {
                const res = await this.gql.query('query($d: [String!]!) { winccoa { elementInfo(dpes: $d) { dpe exists error type elementType valueElement unit description format value stime status } } }', { d: [dpe] });
                this.onDetails(res.winccoa.elementInfo[0]);
            } catch (e) { this.onDetails({ dpe, error: e.message }); }
        } else if (r.item && r.item.kind === 'datapoint') {
            this.onDetails({ dpe: `${r.item.system || this.local}:${r.item.datapoint}`, type: r.item.type, kindLabel: 'Datapoint' });
        } else if (r.item && r.item.kind === 'type') {
            this.onDetails({ type: r.item.type, kindLabel: 'Datapoint type' });
        }
    }
}
