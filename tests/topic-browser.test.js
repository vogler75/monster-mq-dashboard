import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/js/topic-browser.js', import.meta.url), 'utf8');

function fixture() {
    const value = { topic: 'plant/sensor', payload: '42', format: 'TEXT', timestamp: 1000, qos: 1 };
    const element = () => ({
        children: [], style: {}, classList: { add() {} },
        appendChild(child) { this.children.push(child); },
        addEventListener() {}
    });
    const context = vm.createContext({
        window: { graphqlClient: { query: async () => ({
            browseTopics: [{ name: value.topic, value }],
            currentValue: value,
            currentValues: [value]
        }) } },
        document: { createElement: element, createDocumentFragment: element },
        console, ui: { toast(message) { throw new Error(message); } }
    });
    vm.runInContext(source.slice(source.indexOf('class TopicExplorer'), source.indexOf('// Instantiate and register disposal'))
        + '\nthis.TopicExplorer = TopicExplorer;', context);
    const explorer = Object.create(context.TopicExplorer.prototype);
    Object.assign(explorer, {
        treeNodes: new Map(), subscriptionValues: new Map(), liveTopics: new Map(),
        expandedPaths: new Set(), historyMessages: [], messageIdCounter: 0,
        selectedArchiveGroup: 'Default', selectedTopic: null,
        renderTree() {}, renderTableRows() {}, renderDetailContent() {},
        highlightSelectedTableRow() {}, updateAiContextDesc() {}, updateTreeBadgeAndFlash() {},
        scheduleRenderTree() {}
    });
    return { explorer, prototype: context.TopicExplorer.prototype, element, value };
}

test('every archive loading route leaves messages unretained', async t => {
    const cases = [
        ['browse tree', explorer => explorer.loadTopicLevel('+')],
        ['current value', explorer => explorer.fetchTopicCurrentValue('plant/sensor')],
        ['descendants', explorer => explorer.fetchDeepSubnodes('plant')],
        ['select direct children', explorer => {
            explorer.ensureTreeNode('plant/sensor', true);
            explorer.treeNodes.get('plant').childrenLoaded = true;
            return explorer.handleTopicSelected('plant');
        }],
        ['refresh all', explorer => explorer.refreshArchiveValues()],
        ['refresh selected topic', explorer => {
            explorer.selectedTopic = 'plant';
            return explorer.refreshArchiveValues();
        }],
        ['refresh descendants and self', explorer => {
            explorer.selectedTopic = 'plant';
            explorer.fetchSubnodes = true;
            return explorer.refreshArchiveValues();
        }]
    ];
    for (const [name, load] of cases) {
        await t.test(name, async () => {
            const { explorer } = fixture();
            await load(explorer);
            const messages = [...explorer.treeNodes.values()].map(node => node.lastMessage)
                .concat([...explorer.liveTopics.values()], explorer.historyMessages).filter(Boolean);
            assert.ok(messages.length > 0);
            for (const message of messages) {
                assert.equal(message.source, 'archive');
                assert.equal(message.retain, false);
            }
        });
    }
});

test('archive messages keep their source badge without R in the table and detail pane', async () => {
    const { explorer, prototype, element } = fixture();
    await explorer.fetchTopicCurrentValue('plant/sensor');
    explorer.tableBody = element();
    explorer.detailBody = element();
    explorer.detailSourceBadge = element();
    explorer.detailRetainBadge = element();
    explorer.viewMode = 'live';
    explorer.activeTab = 'raw';
    prototype.renderTableRows.call(explorer);
    prototype.renderDetailContent.call(explorer);
    const row = explorer.tableBody.children[0].children[0];
    assert.equal(row.children[2].children[0].textContent, 'ARC');
    assert.equal(row.children[4].innerHTML, '');
    assert.equal(explorer.detailSourceBadge.textContent, 'Archive LastVal');
    assert.equal(explorer.detailRetainBadge.style.display, 'none');
});

test('live subscription messages preserve the broker retained flag', () => {
    const { explorer, prototype, element, value } = fixture();
    explorer.tableBody = element();
    explorer.detailBody = element();
    explorer.detailRetainBadge = element();
    explorer.viewMode = 'live';
    explorer.activeTab = 'raw';
    for (const retained of [true, false]) {
        explorer.handleIncomingMessage({ ...value, retained });
        const message = explorer.subscriptionValues.get(value.topic);
        assert.equal(message.source, 'subscription');
        assert.equal(message.retain, retained);
        explorer.selectedMessage = message;
        explorer.tableBody.children = [];
        prototype.renderTableRows.call(explorer);
        prototype.renderDetailContent.call(explorer);
        const row = explorer.tableBody.children[0].children[0];
        assert.equal(row.children[2].children[0].textContent, 'SUB');
        assert.equal(row.children[4].innerHTML, retained ? '<span class="badge-retain">R</span>' : '');
        assert.equal(explorer.detailRetainBadge.style.display, retained ? 'inline' : 'none');
    }
});
