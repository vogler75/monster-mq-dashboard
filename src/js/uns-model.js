// UNS Modeler mapping document model for the dashboard editor
// (edge winccoa/dev/plans/plan-uns-modeler-design.md §4, §6.4, §7).
// Pure functions without DOM access; the editor page and the tests use them.
// Validation is done by the broker (unsModelerValidate); nothing here
// replaces it.

export const DIRECTION_A = 'winccoa_to_uns';
export const DIRECTION_B = 'mqtt_to_winccoa';

export const ISA95_LEVELS = [
    'enterprise', 'site', 'area',
    'workCenter', 'processCell', 'productionUnit', 'productionLine', 'storageZone',
    'workUnit', 'unit', 'workCell', 'storageUnit',
    'equipmentModule', 'controlModule'
];

export const PAYLOAD_FIELDS = ['value', 'time', 'unit', 'description', 'format', 'pvRange', 'status'];

export const BUILTIN_SEMANTICS = Object.freeze({
    retain: false, qos: 0, publishMode: 'onChange', timestamp: 'source', encoding: 'json',
    payload: ['value', 'time']
});

export function emptyDocument(direction = DIRECTION_A) {
    if (direction === DIRECTION_B) {
        return { schemaVersion: 1, direction, source: { mode: 'live', topicFilters: ['#'] }, types: [], datapoints: [] };
    }
    return { schemaVersion: 1, direction, tree: [] };
}

export function parseDocument(text, direction = DIRECTION_A) {
    if (!text) return { doc: emptyDocument(direction), error: null };
    try {
        const doc = JSON.parse(text);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { doc: null, error: 'document is not a JSON object' };
        if (doc.direction === DIRECTION_A && !Array.isArray(doc.tree)) doc.tree = [];
        return { doc, error: null };
    } catch (e) {
        return { doc: null, error: e.message };
    }
}

export function serialize(doc) {
    return JSON.stringify(doc, null, 2);
}

export function newNodeId() {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return 'n' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// walk calls fn(node, pointer, ancestors, siblings, index) depth-first.
export function walk(doc, fn) {
    const visit = (list, ptr, anc) => {
        (list || []).forEach((n, i) => {
            const p = `${ptr}/${i}`;
            fn(n, p, anc, list, i);
            visit(n.children, p + '/children', [...anc, n]);
        });
    };
    visit(doc.tree, '/tree', []);
}

export function findNode(doc, id) {
    let found = null;
    walk(doc, (n, ptr, anc, siblings, index) => {
        if (!found && n.id === id) found = { node: n, pointer: ptr, ancestors: anc, siblings, index };
    });
    return found;
}

// ensureIds gives every node without an id a fresh one (the server does the
// same on save; the editor needs ids to address nodes).
export function ensureIds(doc) {
    const used = new Set();
    walk(doc, n => { if (typeof n.id === 'string') used.add(n.id); });
    walk(doc, n => {
        if (typeof n.id !== 'string') {
            let id = newNodeId();
            while (used.has(id)) id = newNodeId();
            used.add(id);
            n.id = id;
        }
    });
    return doc;
}

// encodeLevel percent-encodes a DP or element name as a topic level, like
// winccoanative.EncodeName(name, false): %, /, +, # and control characters.
export function encodeLevel(name) {
    let out = '';
    for (const ch of String(name)) {
        const c = ch.codePointAt(0);
        if (ch === '%' || ch === '/' || ch === '+' || ch === '#' || c < 0x20 || c === 0x7f) {
            out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
        } else {
            out += ch;
        }
    }
    return out;
}

// validSegment approximates the schema's Segment for editor feedback; the
// server's validator is authoritative.
export function validSegment(name) {
    if (typeof name !== 'string' || name === '' || name === '..set' || name.length > 256) return false;
    if (/[/+#\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/.test(name)) return false;
    return name.trim() === name;
}

// uniqueName returns base, or base-2, base-3, ... not used by siblings.
export function uniqueName(siblings, base) {
    const names = new Set((siblings || []).map(n => n.name));
    let name = base || 'node';
    for (let i = 2; names.has(name); i++) name = `${base}-${i}`;
    return name;
}

// levelName turns an OA name into a valid topic level name for a node.
export function levelName(name) {
    const s = String(name || 'node').replace(/[/+#]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return s && s !== '..set' ? s : 'node';
}

function childrenOf(doc, parentId) {
    if (!parentId) return doc.tree;
    const f = findNode(doc, parentId);
    if (!f) return null;
    if (!Array.isArray(f.node.children)) f.node.children = [];
    return f.node.children;
}

export function addNode(doc, parentId, name, extra = {}) {
    const list = childrenOf(doc, parentId);
    if (!list) throw new Error('parent node not found');
    const node = { id: newNodeId(), name: uniqueName(list, levelName(name)), ...extra };
    list.push(node);
    return node;
}

export function renameNode(doc, id, name) {
    const f = findNode(doc, id);
    if (!f) throw new Error('node not found');
    if (f.siblings.some(s => s !== f.node && s.name === name)) throw new Error(`a sibling is already named "${name}"`);
    f.node.name = name;
    clearAi(f.node);
}

export function deleteNode(doc, id) {
    const f = findNode(doc, id);
    if (!f) return false;
    f.siblings.splice(f.index, 1);
    return true;
}

export function isDescendant(doc, ancestorId, id) {
    const f = findNode(doc, id);
    return !!f && f.ancestors.some(a => a.id === ancestorId);
}

// moveNode moves a node below newParentId (null: top level) at index.
export function moveNode(doc, id, newParentId, index = -1) {
    if (id === newParentId || (newParentId && isDescendant(doc, id, newParentId))) throw new Error('a node cannot be moved into its own subtree');
    const f = findNode(doc, id);
    if (!f) throw new Error('node not found');
    const target = childrenOf(doc, newParentId);
    if (!target) throw new Error('target node not found');
    f.siblings.splice(f.index, 1);
    if (target.some(s => s.name === f.node.name)) f.node.name = uniqueName(target, f.node.name);
    if (index < 0 || index > target.length) target.push(f.node);
    else target.splice(index, 0, f.node);
    clearAi(f.node);
    return f.node;
}

// clearAi marks a node as accepted once the user edits it.
export function clearAi(node) {
    if (node && node.aiGenerated) delete node.aiGenerated;
}

// Topics -------------------------------------------------------------------

export function nodeTopic(doc, id, unsRoot) {
    const f = findNode(doc, id);
    if (!f) return null;
    return [unsRoot, ...f.ancestors.map(a => a.name), f.node.name].filter(s => s !== '' && s != null).join('/');
}

export function elementRel(path, topic) {
    if (topic !== undefined && topic !== null) return topic;
    if (!path) return '';
    return path.split('.').map(encodeLevel).join('/');
}

function join(base, rel) {
    return rel ? `${base}/${rel}` : base;
}

// bindingTopics lists the topics of a binding. typeElements are the value
// element paths of the type (for a binding without element selection),
// matches the current datapoints of a pattern.
export function bindingTopics(topic, binding, { typeElements = [], matches = [] } = {}) {
    if (!binding) return [];
    const sys = binding.system || '';
    const dpe = (dp, path) => `${sys ? sys + ':' : ''}${dp}.${path || ''}`;
    if (binding.kind === 'element') return [{ topic, dpe: dpe(binding.datapoint, binding.element), path: binding.element }];
    const sels = Array.isArray(binding.elements) ? binding.elements : typeElements.map(p => ({ path: p }));
    if (binding.kind === 'datapoint') {
        return sels.map(s => ({ topic: join(topic, elementRel(s.path, s.topic)), dpe: dpe(binding.datapoint, s.path), path: s.path }));
    }
    const out = [];
    for (const dp of matches) {
        for (const s of sels) out.push({ topic: join(`${topic}/${encodeLevel(dp)}`, elementRel(s.path, s.topic)), dpe: dpe(dp, s.path), path: s.path, datapoint: dp });
    }
    return out;
}

// Semantics ----------------------------------------------------------------

export function applyOverrides(sem, o) {
    if (!o) return sem;
    const s = { ...sem };
    for (const k of ['retain', 'qos', 'timestamp', 'encoding']) if (o[k] !== undefined) s[k] = o[k];
    if (o.publishMode !== undefined) {
        s.publishMode = o.publishMode;
        delete s.deadband;
        delete s.intervalMs;
        if (o.deadband !== undefined) s.deadband = o.deadband;
        if (o.intervalMs !== undefined) s.intervalMs = o.intervalMs;
    }
    if (o.payload !== undefined) s.payload = o.payload.slice();
    return s;
}

export function parseJSONSetting(text) {
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return undefined; }
}

export function deviceSemantics(config) {
    let s = { ...BUILTIN_SEMANTICS, payload: BUILTIN_SEMANTICS.payload.slice() };
    s = applyOverrides(s, parseJSONSetting(config && config.topicDefaults));
    const pd = parseJSONSetting(config && config.payloadDefaults);
    if (Array.isArray(pd)) s.payload = pd;
    return s;
}

// effectiveSemantics follows the inheritance of §3.3: device, nodes from
// root to leaf, binding, element.
export function effectiveSemantics(doc, id, config, elementPath) {
    const f = findNode(doc, id);
    let s = deviceSemantics(config);
    if (!f) return s;
    for (const n of [...f.ancestors, f.node]) s = applyOverrides(s, n.overrides);
    const b = f.node.binding;
    if (b) {
        s = applyOverrides(s, b.overrides);
        if (elementPath !== undefined && Array.isArray(b.elements)) {
            const sel = b.elements.find(e => e.path === elementPath);
            if (sel) s = applyOverrides(s, sel.overrides);
        }
    }
    return s;
}

// payloadPreview renders the payload of a sample like the broker (§4.4).
export function payloadPreview(sem, info = {}) {
    const value = info.value !== undefined ? info.value : 42.7;
    if (sem.encoding === 'raw') return JSON.stringify(value);
    const out = {};
    for (const f of sem.payload || []) {
        if (typeof f === 'string') {
            switch (f) {
                case 'value': out.value = value; break;
                case 'time': out.time = (sem.timestamp === 'source' && info.stime) ? info.stime : new Date().toISOString(); break;
                case 'unit': out.unit = info.unit || ''; break;
                case 'description': out.description = info.description || ''; break;
                case 'format': out.format = info.format || ''; break;
                case 'pvRange': if (info.pvRange) out.pvRange = info.pvRange; break;
                case 'status': if (info.status != null) out.status = info.status; break;
            }
        } else if (f && f.name) {
            out[f.name] = `<${f.attribute}>`;
        }
    }
    return JSON.stringify(out, null, 2);
}

// Drag & drop -------------------------------------------------------------

// dropOnNode applies a drop from the WinCC OA browser (§4.1). items are
// { kind: 'element'|'datapoint'|'type', system, type, datapoint, path,
//   pattern, elements }. A dropped element binds the node unless it has a
// binding or children, then it becomes a new child leaf; a datapoint always
// becomes a child named after it; a type binds the node, or becomes a child
// when the node is bound already. Several items always become children.
// Returns the nodes that got a binding.
export function dropOnNode(doc, nodeId, items) {
    const f = nodeId ? findNode(doc, nodeId) : null;
    if (nodeId && !f) throw new Error('target node not found');
    const list = Array.isArray(items) ? items : [items];
    const out = [];
    const target = f ? f.node : null;
    const asChild = !target || list.length > 1 || !!target.binding;
    for (const it of list) {
        const binding = bindingFor(it);
        if (!asChild && it.kind !== 'datapoint' && !(it.kind === 'element' && Array.isArray(target.children) && target.children.length)) {
            target.binding = binding;
            clearAi(target);
            out.push(target);
            continue;
        }
        const name = it.kind === 'element' ? (it.path ? it.path.split('.').pop() : it.datapoint)
            : it.kind === 'datapoint' ? it.datapoint : (it.type + 's');
        out.push(addNode(doc, target ? target.id : null, name, { binding }));
    }
    return out;
}

export function bindingFor(it) {
    const b = { kind: it.kind === 'type' ? 'pattern' : it.kind, type: it.type };
    if (it.system) b.system = it.system;
    if (it.kind === 'element') {
        b.datapoint = it.datapoint;
        b.element = it.path || '';
    } else if (it.kind === 'datapoint') {
        b.datapoint = it.datapoint;
        if (Array.isArray(it.elements) && it.elements.length) b.elements = it.elements.map(p => ({ path: p }));
    } else {
        b.pattern = it.pattern || '*';
        if (Array.isArray(it.elements) && it.elements.length) b.elements = it.elements.map(p => ({ path: p }));
    }
    return b;
}

// Element selection editing of datapoint and pattern bindings.
export function setElementSelection(binding, paths) {
    if (!paths || !paths.length) delete binding.elements;
    else binding.elements = paths.map(p => {
        const old = (binding.elements || []).find(e => e.path === p);
        return old ? old : { path: p };
    });
}

// Diff and issues ---------------------------------------------------------

function nodeSignature(n, parentId) {
    return JSON.stringify({
        name: n.name, level: n.level || null, description: n.description || null, parent: parentId || null,
        binding: n.binding || null, overrides: n.overrides || null
    });
}

// diff compares the draft with the applied document by node id: new,
// changed (name, level, description, parent, binding or overrides) and
// removed nodes.
export function diff(draft, applied) {
    const status = new Map();
    const before = new Map();
    if (applied && Array.isArray(applied.tree)) {
        walk(applied, (n, ptr, anc) => { if (n.id) before.set(n.id, { node: n, sig: nodeSignature(n, anc.length ? anc[anc.length - 1].id : null) }); });
    }
    const seen = new Set();
    walk(draft, (n, ptr, anc) => {
        if (!n.id) return;
        seen.add(n.id);
        const b = before.get(n.id);
        if (!b) status.set(n.id, 'new');
        else if (b.sig !== nodeSignature(n, anc.length ? anc[anc.length - 1].id : null)) status.set(n.id, 'changed');
    });
    const removed = [];
    for (const [id, b] of before) if (!seen.has(id)) removed.push(b.node);
    return { status, removed };
}

// issuesByNode assigns issues to the node whose pointer is the longest
// prefix of the issue path; document-level issues go to ''.
export function issuesByNode(doc, issues) {
    const ptrs = [];
    walk(doc, (n, ptr) => ptrs.push([ptr, n.id]));
    ptrs.sort((a, b) => b[0].length - a[0].length);
    const out = new Map();
    for (const is of issues || []) {
        const p = is.path || '';
        let id = '';
        for (const [ptr, nid] of ptrs) {
            if (p === ptr || p.startsWith(ptr + '/')) {
                const rest = p.slice(ptr.length);
                if (rest.startsWith('/children/')) continue;
                id = nid;
                break;
            }
        }
        if (!out.has(id)) out.set(id, []);
        out.get(id).push(is);
    }
    return out;
}

export function hasErrors(issues) {
    return (issues || []).some(i => (i.severity || '').toUpperCase() === 'ERROR');
}

export function countBindings(doc) {
    let nodes = 0, bindings = 0, patterns = 0;
    walk(doc, n => {
        nodes++;
        if (n.binding) {
            bindings++;
            if (n.binding.kind === 'pattern') patterns++;
        }
    });
    return { nodes, bindings, patterns };
}
