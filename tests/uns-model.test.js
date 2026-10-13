import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../src/js/uns-model.js';

function sample() {
    return M.ensureIds({ schemaVersion: 1, direction: M.DIRECTION_A, tree: [
        { name: 'line1', level: 'productionLine', children: [
            { name: 'pump', binding: { kind: 'datapoint', type: 'PumpType', datapoint: 'P101', elements: [{ path: 'flow' }, { path: 'motor.speed', topic: 'speed' }] } },
            { name: 'pumps', binding: { kind: 'pattern', type: 'PumpType', pattern: 'P*', elements: [{ path: 'flow' }] } }
        ] }
    ] });
}

test('every node gets a unique id', () => {
    const doc = sample();
    const ids = new Set();
    M.walk(doc, n => ids.add(n.id));
    assert.equal(ids.size, 3);
});

test('add, rename, move and delete nodes', () => {
    const doc = sample();
    const line = doc.tree[0];
    const a = M.addNode(doc, line.id, 'tank');
    const b = M.addNode(doc, line.id, 'tank');
    assert.equal(b.name, 'tank-2');
    M.renameNode(doc, a.id, 'tank-1');
    assert.throws(() => M.renameNode(doc, a.id, 'pump'));
    M.moveNode(doc, a.id, null);
    assert.equal(doc.tree[1].id, a.id);
    assert.throws(() => M.moveNode(doc, line.id, line.children[0].id), /own subtree/);
    assert.ok(M.deleteNode(doc, b.id));
    assert.equal(M.findNode(doc, b.id), null);
});

test('drops create bindings like the editor rules of §4.1', () => {
    const doc = sample();
    const line = doc.tree[0];
    const empty = M.addNode(doc, line.id, 'empty');
    // An element on an unbound leaf binds the node itself.
    M.dropOnNode(doc, empty.id, { kind: 'element', type: 'PumpType', datapoint: 'P102', path: 'motor.speed' });
    assert.deepEqual(empty.binding, { kind: 'element', type: 'PumpType', datapoint: 'P102', element: 'motor.speed' });
    // An element on a node with children becomes a new leaf named after it.
    const [leaf] = M.dropOnNode(doc, line.id, { kind: 'element', type: 'PumpType', datapoint: 'P103', path: 'motor.speed', system: 'Sys2' });
    assert.equal(leaf.name, 'speed');
    assert.equal(leaf.binding.system, 'Sys2');
    // A datapoint on a bound node becomes a child; all elements by default.
    const [dp] = M.dropOnNode(doc, empty.id, { kind: 'datapoint', type: 'PumpType', datapoint: 'P104' });
    assert.equal(dp.name, 'P104');
    assert.equal(dp.binding.elements, undefined);
    // A type becomes a pattern binding.
    const tgt = M.addNode(doc, null, 'all');
    M.dropOnNode(doc, tgt.id, { kind: 'type', type: 'PumpType', pattern: 'Hall2_*', elements: ['flow'] });
    assert.deepEqual(tgt.binding, { kind: 'pattern', type: 'PumpType', pattern: 'Hall2_*', elements: [{ path: 'flow' }] });
    // Several items always become children.
    const multi = M.addNode(doc, null, 'multi');
    const out = M.dropOnNode(doc, multi.id, [
        { kind: 'element', type: 'PumpType', datapoint: 'P1', path: 'flow' },
        { kind: 'element', type: 'PumpType', datapoint: 'P2', path: 'flow' }
    ]);
    assert.deepEqual(out.map(n => n.name), ['flow', 'flow-2']);
    assert.equal(multi.binding, undefined);
});

test('topics follow the binding kinds and encode names', () => {
    const doc = sample();
    const pump = doc.tree[0].children[0];
    const topic = M.nodeTopic(doc, pump.id, 'acme/hall2');
    assert.equal(topic, 'acme/hall2/line1/pump');
    assert.deepEqual(M.bindingTopics(topic, pump.binding).map(t => t.topic), ['acme/hall2/line1/pump/flow', 'acme/hall2/line1/pump/speed']);
    const pumps = doc.tree[0].children[1];
    const t2 = M.nodeTopic(doc, pumps.id, 'acme/hall2');
    assert.deepEqual(M.bindingTopics(t2, pumps.binding, { matches: ['P1', 'a/b'] }).map(t => t.topic),
        ['acme/hall2/line1/pumps/P1/flow', 'acme/hall2/line1/pumps/a%2Fb/flow']);
    assert.equal(M.encodeLevel('50%+#'), '50%25%2B%23');
    assert.equal(M.elementRel('a.set._x'), 'a/set/_x');
    assert.ok(!M.validSegment('..set'));
    assert.ok(!M.validSegment('a/b'));
    assert.ok(!M.validSegment(' a'));
});

test('effective semantics inherit device, nodes, binding and element', () => {
    const doc = sample();
    doc.tree[0].overrides = { retain: true, publishMode: 'deadband', deadband: 1 };
    const pump = doc.tree[0].children[0];
    pump.binding.overrides = { qos: 1 };
    pump.binding.elements[0].overrides = { publishMode: 'cyclic', intervalMs: 500 };
    const sem = M.effectiveSemantics(doc, pump.id, { topicDefaults: '{"timestamp":"publish"}', payloadDefaults: '["value"]' }, 'flow');
    assert.deepEqual(sem, { retain: true, qos: 1, publishMode: 'cyclic', intervalMs: 500, timestamp: 'publish', encoding: 'json', payload: ['value'] });
    const p = JSON.parse(M.payloadPreview({ ...M.BUILTIN_SEMANTICS, payload: ['value', 'unit', 'pvRange'] }, { value: 3, unit: 'bar' }));
    assert.deepEqual(p, { value: 3, unit: 'bar' });
    assert.equal(M.payloadPreview({ ...M.BUILTIN_SEMANTICS, encoding: 'raw' }, { value: true }), 'true');
});

test('diff identifies nodes by id; issues map to nodes', () => {
    const applied = sample();
    const draft = JSON.parse(JSON.stringify(applied));
    const pump = draft.tree[0].children[0];
    pump.name = 'pump-renamed';
    const moved = draft.tree[0].children.splice(1, 1)[0];
    draft.tree.push(moved);
    const added = M.addNode(draft, null, 'new');
    const d = M.diff(draft, applied);
    assert.equal(d.status.get(pump.id), 'changed');
    assert.equal(d.status.get(moved.id), 'changed');
    assert.equal(d.status.get(added.id), 'new');
    assert.equal(d.status.get(draft.tree[0].id), undefined);
    M.deleteNode(draft, added.id);
    M.deleteNode(draft, moved.id);
    assert.deepEqual(M.diff(draft, applied).removed.map(n => n.id), [moved.id]);
    const issues = [
        { severity: 'ERROR', path: '/tree/0/children/0/binding/datapoint', message: 'x' },
        { severity: 'WARNING', path: '/tree/0/name', message: 'y' },
        { severity: 'ERROR', path: '', message: 'z' }
    ];
    const map = M.issuesByNode(draft, issues);
    assert.equal(map.get(pump.id).length, 1);
    assert.equal(map.get(draft.tree[0].id).length, 1);
    assert.equal(map.get('').length, 1);
    assert.ok(M.hasErrors(issues));
});
