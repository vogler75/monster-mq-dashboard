import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renameType, renameDatapoint, setExcluded, assignments, typeColors, topicMatches, readablePayload } from '../src/js/uns-onboarding.js';

function doc() {
    return {
        schemaVersion: 1, direction: 'mqtt_to_winccoa', source: { mode: 'live', topicFilters: ['plant/#'] },
        types: [{ name: 'UNS_Pump', elements: [{ path: 'flow', elementType: 'float' }] }, { name: 'UNS_Tank', elements: [{ path: 'level', elementType: 'float' }] }],
        datapoints: [
            { name: 'UNS_P1', type: 'UNS_Pump', bindings: [{ element: 'flow', topic: 'plant/p1/flow' }] },
            { name: 'UNS_P2', type: 'UNS_Pump', bindings: [{ element: 'flow', topic: 'plant/p2/flow' }] },
            { name: 'UNS_T1', type: 'UNS_Tank', bindings: [{ element: 'level', topic: 'plant/t1/level' }] }
        ]
    };
}

test('renaming a type updates its datapoints', () => {
    const d = doc();
    renameType(d, 'UNS_Pump', 'UNS_Pump2');
    assert.deepEqual(d.datapoints.map(x => x.type), ['UNS_Pump2', 'UNS_Pump2', 'UNS_Tank']);
    assert.throws(() => renameType(d, 'UNS_Tank', 'UNS_Pump2'), /already named/);
    renameDatapoint(d, 'UNS_P1', 'UNS_PA');
    assert.equal(d.datapoints[0].name, 'UNS_PA');
    assert.throws(() => renameDatapoint(d, 'UNS_P2', 'UNS_PA'));
});

test('exclude and include types and datapoints', () => {
    const d = doc();
    setExcluded(d, 'type', 'UNS_Tank', true);
    setExcluded(d, 'datapoint', 'UNS_P2', true);
    assert.equal(d.types[1].excluded, true);
    assert.equal(d.datapoints[1].excluded, true);
    setExcluded(d, 'datapoint', 'UNS_P2', false);
    assert.equal('excluded' in d.datapoints[1], false);
});

test('topics are coloured by the type of their datapoint', () => {
    const d = doc();
    const a = assignments(d);
    assert.equal(a.get('plant/p1/flow')[0].type, 'UNS_Pump');
    assert.equal(a.get('plant/x'), undefined);
    const c = typeColors(d);
    assert.notEqual(c.get('UNS_Pump'), c.get('UNS_Tank'));
    assert.ok(topicMatches('plant/#', 'plant/p1/flow'));
    assert.ok(topicMatches('plant/+/flow', 'plant/p1/flow'));
    assert.ok(!topicMatches('plant/+', 'plant/p1/flow'));
    assert.equal(readablePayload(Buffer.from('ON').toString('base64'), 'BINARY'), 'ON');
    assert.equal(readablePayload('{"a":1}', 'JSON'), '{"a":1}');
});
