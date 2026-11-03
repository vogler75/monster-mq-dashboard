// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
// Virtual Topic Tree designer.
// All validity and routing decisions come from the broker (validate/preview);
// this page only edits the document and renders the answers.

const TREE_FIELDS = `id schemaVersion name rootPath description enabled revision
    nodes { id parentId segment description binding { kind target access } }`;
const ISSUE_FIELDS = 'code nodeId path message';

class VirtualTopicTreeDetailManager {
    constructor() {
        this.client = new GraphQLDashboardClient();
        this.tree = null;
        this.isNew = false;
        this.selectedId = null;           // null = tree root
        this.expanded = new Set();        // node ids, plus 'observed:<path>' keys
        this.observed = new Map();        // virtual path -> { loading, items, error }
        this.issues = [];                 // validation errors + warnings
        this.issuesByNode = new Map();
        this.validateTimer = null;
        this.validateSeq = 0;
        this.pickerGroup = null;
        this.pickerSeq = 0;
        this.nextId = 1;
        this.init();
    }

    // ------------------------------------------------------------- lifecycle

    async init() {
        this.$ = (id) => document.getElementById(id);
        this.bindStatic();
        const params = new URLSearchParams(window.location.search);
        this.isNew = params.get('new') === 'true';
        const id = params.get('id');

        ui.setLoading(true);
        try {
            const features = await this.client.getEnabledFeatures();
            if (Array.isArray(features) && features.length > 0 && !features.includes('VirtualTopicTrees')) {
                ui.showError('Virtual Topic Trees are not enabled on this broker.');
                return;
            }
            if (this.isNew) {
                this.tree = {
                    id: null, schemaVersion: 1, name: '', rootPath: '', description: '',
                    enabled: false, revision: null, nodes: []
                };
                this.$('page-title').textContent = 'Add Virtual Topic Tree';
                this.$('delete-btn').style.display = 'none';
                this.$('export-btn').style.display = 'none';
            } else if (id) {
                await this.loadTree(id);
            } else {
                ui.showError('No virtual topic tree specified');
                return;
            }
            this.$('designer').style.display = '';
            this.renderAll();
            await this.loadArchiveGroups();
            this.scheduleValidate();
        } catch (e) {
            console.error('Error initializing tree designer', e);
            ui.showError('Failed to load virtual topic tree: ' + e.message);
        } finally {
            ui.setLoading(false);
        }
    }

    async loadTree(id) {
        const result = await this.client.query(
            `query GetVirtualTopicTree($id: ID!) { virtualTopicTree(id: $id) { ${TREE_FIELDS} } }`, { id });
        const tree = result.virtualTopicTree;
        if (!tree) throw new Error('Virtual topic tree not found');
        this.tree = {
            ...tree,
            description: tree.description || '',
            nodes: (tree.nodes || []).map(n => ({
                id: n.id, parentId: n.parentId || null, segment: n.segment,
                description: n.description || '',
                binding: n.binding ? { kind: n.binding.kind, target: n.binding.target, access: n.binding.access } : null
            }))
        };
        this.$('page-title').textContent = tree.name;
        this.$('breadcrumb-name').textContent = tree.name;
        this.$('page-subtitle').textContent = `Virtual root: ${tree.rootPath}`;
        this.$('conflict-bar').style.display = 'none';
        ui.markPageSaved();
        this.expanded = new Set(this.tree.nodes.map(n => n.id));
    }

    bindStatic() {
        const on = (id, fn, evt = 'click') => { const el = this.$(id); if (el) el.addEventListener(evt, fn); };
        on('save-btn', () => this.save());
        on('delete-btn', () => this.deleteTree());
        on('export-btn', () => this.exportJson());
        on('reload-btn', () => this.discardAndReload());
        on('add-folder-btn', () => this.addNode('FOLDER'));
        on('add-link-btn', () => this.addNode('EXACT'));
        on('add-mount-btn', () => this.addNode('SUBTREE'));
        on('move-up-btn', () => this.shiftSibling(-1));
        on('move-down-btn', () => this.shiftSibling(1));
        on('indent-btn', () => this.indent());
        on('outdent-btn', () => this.outdent());
        on('remove-node-btn', () => this.removeSelected());
        on('preview-btn', () => this.runPreview());
        on('preview-op', () => this.updatePreviewLabel(), 'change');
        on('picker-refresh-btn', () => this.browsePickerRoot());
        on('picker-group', () => { this.pickerGroup = this.$('picker-group').value; this.browsePickerRoot(); }, 'change');

        const tv = this.$('tree-view');
        tv.addEventListener('click', (e) => this.onTreeClick(e));
        tv.addEventListener('keydown', (e) => this.onTreeKey(e));
        tv.addEventListener('dragstart', (e) => this.onNodeDragStart(e));
        tv.addEventListener('dragover', (e) => this.onNodeDragOver(e));
        tv.addEventListener('dragleave', (e) => this.clearDropMarks());
        tv.addEventListener('drop', (e) => this.onNodeDrop(e));
        this.$('picker-tree').addEventListener('click', (e) => this.onPickerClick(e));
        this.$('picker-tree').addEventListener('dragstart', (e) => {
            const row = e.target.closest('[data-topic]');
            if (!row) return;
            e.dataTransfer.setData('application/x-vt-topic', row.dataset.topic);
            e.dataTransfer.effectAllowed = 'copy';
        });
    }

    // ------------------------------------------------------------ tree model

    node(id) { return this.tree.nodes.find(n => n.id === id) || null; }
    children(parentId) { return this.tree.nodes.filter(n => (n.parentId || null) === (parentId || null)); }
    newId() { let id; do { id = 'n' + (this.nextId++) + Math.random().toString(36).slice(2, 6); } while (this.node(id)); return id; }

    pathOf(n) {
        const parts = [];
        for (let cur = n, guard = 0; cur && guard < 1000; cur = this.node(cur.parentId), guard++) parts.unshift(cur.segment);
        return [this.tree.rootPath, ...parts].filter(p => p !== '').join('/');
    }

    isDescendant(id, ancestorId) {
        for (let cur = this.node(id), guard = 0; cur && guard < 1000; cur = this.node(cur.parentId), guard++) {
            if (cur.id === ancestorId) return true;
        }
        return false;
    }

    inheritedMount(n) {
        for (let cur = this.node(n.parentId), guard = 0; cur && guard < 1000; cur = this.node(cur.parentId), guard++) {
            if (cur.binding && cur.binding.kind === 'SUBTREE') return cur;
        }
        return null;
    }

    descendants(id) {
        const out = [];
        const walk = (pid) => this.children(pid).forEach(c => { out.push(c); walk(c.id); });
        walk(id);
        return out;
    }

    touch() {
        ui.markPageDirty();
        this.renderAll();
        this.scheduleValidate();
    }

    // -------------------------------------------------------------- mutation

    uniqueSegment(parentId, base) {
        const taken = new Set(this.children(parentId).map(c => c.segment));
        if (!taken.has(base)) return base;
        let i = 2;
        while (taken.has(`${base}-${i}`)) i++;
        return `${base}-${i}`;
    }

    addNode(kind, init = {}) {
        const parentId = this.selectedId;
        const base = init.segment || (kind === 'FOLDER' ? 'folder' : kind === 'EXACT' ? 'topic' : 'mount');
        const n = {
            id: this.newId(), parentId,
            segment: this.uniqueSegment(parentId, base),
            description: '',
            binding: kind === 'FOLDER' ? null : { kind, target: init.target || '', access: 'READ_ONLY' }
        };
        this.tree.nodes.push(n);
        if (parentId) this.expanded.add(parentId);
        this.selectedId = n.id;
        this.touch();
        const seg = this.$('insp-segment');
        if (seg) { seg.focus(); seg.select(); }
        return n;
    }

    async removeSelected() {
        const n = this.selectedId && this.node(this.selectedId);
        if (!n) return;
        const doomed = [n, ...this.descendants(n.id)];
        if (doomed.length > 1 || n.binding) {
            const ok = await ui.confirmDelete(n.segment, {
                title: 'Delete node',
                message: `Delete “${this.pathOf(n)}”` +
                    (doomed.length > 1 ? ` and its ${doomed.length - 1} descendant node(s)` : '') +
                    '?\nThe change only takes effect when you save the tree.'
            });
            if (!ok) return;
        }
        const ids = new Set(doomed.map(d => d.id));
        this.tree.nodes = this.tree.nodes.filter(x => !ids.has(x.id));
        this.selectedId = n.parentId || null;
        this.touch();
    }

    shiftSibling(delta) {
        const n = this.selectedId && this.node(this.selectedId);
        if (!n) return;
        const sibs = this.children(n.parentId);
        const i = sibs.indexOf(n);
        const other = sibs[i + delta];
        if (!other) return;
        const a = this.tree.nodes.indexOf(n), b = this.tree.nodes.indexOf(other);
        [this.tree.nodes[a], this.tree.nodes[b]] = [this.tree.nodes[b], this.tree.nodes[a]];
        this.touch();
    }

    indent() {
        const n = this.selectedId && this.node(this.selectedId);
        if (!n) return;
        const sibs = this.children(n.parentId);
        const prev = sibs[sibs.indexOf(n) - 1];
        if (prev) this.moveNode(n.id, prev.id);
    }

    outdent() {
        const n = this.selectedId && this.node(this.selectedId);
        const parent = n && this.node(n.parentId);
        if (parent) this.moveNode(n.id, parent.parentId || null);
    }

    /** Preview every changed virtual path, then reparent after confirmation. */
    async moveNode(id, newParentId) {
        const n = this.node(id);
        if (!n || (n.parentId || null) === (newParentId || null)) return;
        if (newParentId && (newParentId === id || this.isDescendant(newParentId, id))) {
            ui.error('A node cannot be moved into itself or one of its descendants.');
            return;
        }
        const affected = [n, ...this.descendants(id)];
        const before = new Map(affected.map(a => [a.id, this.pathOf(a)]));
        const oldParent = n.parentId;
        n.parentId = newParentId || null;
        n.segment = this.uniqueSegmentExcluding(n);
        const changes = affected.map(a => ({ from: before.get(a.id), to: this.pathOf(a), binding: a.binding }));
        n.parentId = oldParent;
        const oldSegment = n.segment;

        const list = changes.slice(0, 40).map(c =>
            `<li>${ui.escapeHtml(c.from)} &rarr; ${ui.escapeHtml(c.to)}${c.binding ? ` <em>(${ui.escapeHtml(c.binding.kind === 'SUBTREE' ? 'mount' : 'link')} of ${ui.escapeHtml(c.binding.target || '?')})</em>` : ''}</li>`).join('');
        const more = changes.length > 40 ? `<li>… and ${changes.length - 40} more</li>` : '';
        const ok = await ui.confirm({
            title: 'Move node',
            message: `<p>These virtual paths change. Subscribers follow the new paths once the tree is saved.</p><ul class="vt-move-list">${list}${more}</ul>`,
            confirmLabel: 'Move'
        });
        if (!ok) return;
        n.parentId = newParentId || null;
        n.segment = oldSegment === n.segment ? this.uniqueSegmentExcluding(n) : n.segment;
        if (newParentId) this.expanded.add(newParentId);
        this.touch();
    }

    uniqueSegmentExcluding(n) {
        const taken = new Set(this.children(n.parentId).filter(c => c !== n).map(c => c.segment));
        if (!taken.has(n.segment)) return n.segment;
        let i = 2;
        while (taken.has(`${n.segment}-${i}`)) i++;
        return `${n.segment}-${i}`;
    }

    applyBinding(nodeId, kind, target) {
        const n = this.node(nodeId);
        if (!n) return;
        n.binding = { kind, target, access: n.binding ? n.binding.access : 'READ_ONLY' };
        this.selectedId = n.id;
        this.touch();
    }

    // ------------------------------------------------------------ rendering

    renderAll() {
        this.renderTree();
        this.renderInspector();
        this.updateToolbar();
        this.updatePreviewLabel();
    }

    updateToolbar() {
        const n = this.selectedId && this.node(this.selectedId);
        const sibs = n ? this.children(n.parentId) : [];
        const i = n ? sibs.indexOf(n) : -1;
        const set = (id, disabled) => { const el = this.$(id); if (el) el.disabled = !!disabled; };
        set('remove-node-btn', !n);
        set('move-up-btn', !n || i <= 0);
        set('move-down-btn', !n || i >= sibs.length - 1);
        set('indent-btn', !n || i <= 0);
        set('outdent-btn', !n || !n.parentId);
    }

    kindInfo(n) {
        if (!n.binding) return { icon: 'folder', label: 'Folder', cls: '' };
        return n.binding.kind === 'SUBTREE'
            ? { icon: 'hierarchy', label: 'Mount', cls: 'badge-info' }
            : { icon: 'link', label: 'Link', cls: 'badge-ok' };
    }

    renderTree() {
        const t = this.tree;
        const rootSel = this.selectedId === null;
        const rootIssue = (this.issuesByNode.get('') || []).length > 0;
        let html = `<li role="none"><div class="vt-row${rootSel ? ' is-selected' : ''}${rootIssue ? ' has-issue' : ''}" role="treeitem" tabindex="0" data-root="1" aria-selected="${rootSel}" aria-expanded="true">
            <span class="vt-twisty" hidden></span>
            <ix-icon name="tree" size="16"></ix-icon>
            <span class="vt-label"><strong>${ui.escapeHtml(t.rootPath || '(root path)')}</strong></span>
            <span class="status-badge ${t.enabled ? 'badge-ok' : 'badge-warn'}">${t.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>${this.renderChildren(null)}</li>`;
        this.$('tree-view').innerHTML = html;
        if (this._focusAfterRender) {
            const sel = this.$('tree-view').querySelector(this.selectedId ? `[data-id="${CSS.escape(this.selectedId)}"]` : '[data-root]');
            if (sel) sel.focus();
            this._focusAfterRender = false;
        }
    }

    renderChildren(parentId) {
        const kids = this.children(parentId);
        if (kids.length === 0) return '';
        return '<ul role="group">' + kids.map(n => this.renderNode(n)).join('') + '</ul>';
    }

    renderNode(n) {
        const info = this.kindInfo(n);
        const kids = this.children(n.id);
        const isMount = n.binding && n.binding.kind === 'SUBTREE';
        const expandable = kids.length > 0 || isMount;
        const open = this.expanded.has(n.id);
        const selected = this.selectedId === n.id;
        const issue = (this.issuesByNode.get(n.id) || []).some(i => i.level === 'error');
        const inherited = !n.binding && this.inheritedMount(n);
        const badges = [
            `<span class="status-badge ${info.cls}">${info.label}</span>`,
            n.binding && n.binding.access === 'READ_WRITE' ? '<span class="status-badge badge-warn" title="Virtual publishes are routed to the physical topic">Read/write</span>' : '',
            inherited ? '<span class="status-badge badge-info" title="Folder beneath a mount: the mount still applies here">Inherited</span>' : ''
        ].join(' ');
        const target = n.binding && n.binding.target
            ? `<span class="vt-hint">&rarr; ${ui.escapeHtml(n.binding.target)}${isMount ? '/#' : ''}</span>` : '';
        let inner = '';
        if (open) {
            inner = this.renderChildren(n.id);
            if (isMount) inner += this.renderObserved(this.pathOf(n), n.id);
        }
        return `<li role="none"><div class="vt-row${selected ? ' is-selected' : ''}${issue ? ' has-issue' : ''}" role="treeitem" tabindex="0" draggable="true"
            data-id="${ui.escapeHtml(n.id)}" aria-selected="${selected}" ${expandable ? `aria-expanded="${open}"` : ''}>
            <button type="button" class="vt-twisty" data-twisty="1" tabindex="-1" aria-label="${open ? 'Collapse' : 'Expand'}" ${expandable ? '' : 'hidden'}><ix-icon name="${open ? 'chevron-down-small' : 'chevron-right-small'}" size="16"></ix-icon></button>
            <ix-icon name="${info.icon}" size="16"></ix-icon>
            <span class="vt-label">${ui.escapeHtml(n.segment)} ${target}</span>
            ${badges}
        </div>${inner}</li>`;
    }

    /** Observed descendants of a mount: lazy projections, never persisted. */
    renderObserved(path) {
        const entry = this.observed.get(path);
        if (!entry) { this.loadObserved(path); return this.observedRow('Loading observed topics…', path); }
        if (entry.loading) return this.observedRow('Loading observed topics…', path);
        if (entry.error) return this.observedRow('Observed topics unavailable', path);
        if (entry.items.length === 0) return this.observedRow('No observed topics yet', path);
        return '<ul role="group">' + entry.items.map(item => {
            const key = 'observed:' + item.path;
            const open = this.expanded.has(key);
            return `<li role="none"><div class="vt-row is-observed" role="treeitem" tabindex="0" data-observed="${ui.escapeHtml(item.path)}" ${item.hasChildren ? `aria-expanded="${open}"` : ''}>
                <button type="button" class="vt-twisty" data-twisty="1" tabindex="-1" aria-label="${open ? 'Collapse' : 'Expand'}" ${item.hasChildren ? '' : 'hidden'}><ix-icon name="${open ? 'chevron-down-small' : 'chevron-right-small'}" size="16"></ix-icon></button>
                <ix-icon name="topic" size="16"></ix-icon>
                <span class="vt-label">${ui.escapeHtml(item.name)}</span>
                <span class="status-badge">Observed</span>
            </div>${open && item.hasChildren ? this.renderObserved(item.path) : ''}</li>`;
        }).join('') + '</ul>';
    }

    observedRow(text) {
        return `<ul role="group"><li role="none"><div class="vt-row is-observed"><span class="vt-twisty" hidden></span><span class="vt-label">${ui.escapeHtml(text)}</span></div></li></ul>`;
    }

    async loadObserved(path) {
        if (this.observed.has(path)) return;
        this.observed.set(path, { loading: true, items: [] });
        try {
            const group = this.pickerGroup || 'Default';
            const res = await this.client.query(
                `query BrowseVirtual($topic: String!, $archiveGroup: String!) { browseTopics(topic: $topic, archiveGroup: $archiveGroup) { name } }`,
                { topic: path + '/+', archiveGroup: group });
            const levels = path.split('/').length;
            const grouped = new Map();
            (res.browseTopics || []).forEach(t => {
                const parts = t.name.split('/');
                if (parts.length <= levels) return;
                const name = parts[levels];
                const g = grouped.get(name) || { name, path: parts.slice(0, levels + 1).join('/'), hasChildren: false };
                if (parts.length > levels + 1) g.hasChildren = true;
                grouped.set(name, g);
            });
            this.observed.set(path, { loading: false, items: [...grouped.values()] });
        } catch (e) {
            this.observed.set(path, { loading: false, items: [], error: e.message });
        }
        this.renderTree();
    }

    // -------------------------------------------------------- tree events

    onTreeClick(e) {
        const row = e.target.closest('.vt-row');
        if (!row) return;
        if (row.dataset.observed) {
            if (e.target.closest('[data-twisty]')) this.toggleObserved(row.dataset.observed);
            return;
        }
        if (e.target.closest('[data-twisty]') && row.dataset.id) {
            this.toggleExpanded(row.dataset.id);
            return;
        }
        this.select(row.dataset.root ? null : row.dataset.id);
    }

    toggleExpanded(id) {
        if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
        this.renderTree();
    }

    toggleObserved(path) {
        const key = 'observed:' + path;
        if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key);
        this.renderTree();
    }

    select(id) {
        this.selectedId = id;
        this._focusAfterRender = true;
        this.renderAll();
    }

    onTreeKey(e) {
        const row = e.target.closest('.vt-row');
        if (!row) return;
        const rows = [...this.$('tree-view').querySelectorAll('.vt-row[tabindex]')];
        const i = rows.indexOf(row);
        const id = row.dataset.id;
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); if (rows[i + 1]) rows[i + 1].focus(); break;
            case 'ArrowUp': e.preventDefault(); if (rows[i - 1]) rows[i - 1].focus(); break;
            case 'ArrowRight':
                e.preventDefault();
                if (row.dataset.observed) { if (row.getAttribute('aria-expanded') === 'false') this.toggleObserved(row.dataset.observed); }
                else if (id && row.getAttribute('aria-expanded') === 'false') { this.toggleExpanded(id); }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (row.dataset.observed) { if (row.getAttribute('aria-expanded') === 'true') this.toggleObserved(row.dataset.observed); }
                else if (id && row.getAttribute('aria-expanded') === 'true') { this.toggleExpanded(id); }
                break;
            case 'Enter': case ' ':
                e.preventDefault();
                if (!row.dataset.observed) this.select(row.dataset.root ? null : id);
                break;
            case 'Delete':
                if (id) { e.preventDefault(); this.selectedId = id; this.removeSelected(); }
                break;
            case 'F2': {
                e.preventDefault();
                const f = this.$('insp-segment') || this.$('insp-name');
                if (f) f.focus();
                break;
            }
        }
    }

    // --------------------------------------------------------- drag and drop

    onNodeDragStart(e) {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        e.dataTransfer.setData('application/x-vt-node', row.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
    }

    onNodeDragOver(e) {
        const row = e.target.closest('.vt-row');
        if (!row || row.dataset.observed) return;
        const types = [...e.dataTransfer.types];
        if (!types.includes('application/x-vt-node') && !types.includes('application/x-vt-topic')) return;
        e.preventDefault();
        this.clearDropMarks();
        row.classList.add('is-drop');
    }

    clearDropMarks() {
        this.$('tree-view').querySelectorAll('.is-drop').forEach(r => r.classList.remove('is-drop'));
    }

    onNodeDrop(e) {
        const row = e.target.closest('.vt-row');
        this.clearDropMarks();
        if (!row || row.dataset.observed) return;
        e.preventDefault();
        const targetId = row.dataset.root ? null : row.dataset.id;
        const nodeId = e.dataTransfer.getData('application/x-vt-node');
        const topic = e.dataTransfer.getData('application/x-vt-topic');
        if (nodeId) {
            this.moveNode(nodeId, targetId);
        } else if (topic && targetId) {
            this.applyBinding(targetId, 'EXACT', topic);
        } else if (topic) {
            this.selectedId = null;
            this.addNode('EXACT', { segment: topic.split('/').pop() || 'topic', target: topic });
        }
    }

    // ------------------------------------------------------------- inspector

    renderInspector() {
        const box = this.$('inspector');
        if (!box) return;
        const badge = this.$('inspector-badge');
        const n = this.selectedId && this.node(this.selectedId);
        if (!n) {
            this.$('inspector-title').textContent = 'Tree settings';
            badge.textContent = ''; badge.className = 'status-badge';
            box.innerHTML = `
                <div class="form-grid is-single">
                    <div class="form-group"><label for="insp-name">Name *</label>
                        <input type="text" id="insp-name" class="form-control" value="${ui.escapeHtml(this.tree.name)}"></div>
                    <div class="form-group"><label for="insp-root">Virtual root *</label>
                        <input type="text" id="insp-root" class="form-control" value="${ui.escapeHtml(this.tree.rootPath)}" placeholder="enterprise">
                        <small>The namespace this tree reserves. Folders and bindings live below it.</small></div>
                    <div class="form-group"><label for="insp-desc">Description</label>
                        <textarea id="insp-desc" class="form-control" rows="2">${ui.escapeHtml(this.tree.description || '')}</textarea></div>
                    <div class="form-group"><label class="checkbox-group"><input type="checkbox" id="insp-enabled" ${this.tree.enabled ? 'checked' : ''}> Enabled</label>
                        <small>A disabled tree keeps its root reserved but routes nothing. Virtual publishes are rejected.</small></div>
                </div>`;
            const bind = (id, fn, evt = 'input') => { const el = this.$(id); if (el) el.addEventListener(evt, fn); };
            bind('insp-name', (e) => { this.tree.name = e.target.value; this.afterRootEdit(); });
            bind('insp-root', (e) => { this.tree.rootPath = e.target.value; this.afterRootEdit(); });
            bind('insp-desc', (e) => { this.tree.description = e.target.value; ui.markPageDirty(); });
            bind('insp-enabled', (e) => { this.tree.enabled = e.target.checked; this.afterRootEdit(); }, 'change');
            return;
        }
        const info = this.kindInfo(n);
        this.$('inspector-title').textContent = n.segment;
        badge.textContent = info.label; badge.className = 'status-badge ' + info.cls;
        const kind = n.binding ? n.binding.kind : 'FOLDER';
        const parentOpts = ['<option value="">(tree root)</option>'].concat(
            this.tree.nodes.filter(o => o.id !== n.id && !this.isDescendant(o.id, n.id))
                .map(o => `<option value="${ui.escapeHtml(o.id)}" ${n.parentId === o.id ? 'selected' : ''}>${ui.escapeHtml(this.pathOf(o))}</option>`)).join('');
        const issues = (this.issuesByNode.get(n.id) || []).map(i =>
            `<li class="${i.level === 'error' ? 'is-error' : 'is-warn'}">${ui.escapeHtml(i.message)}</li>`).join('');
        box.innerHTML = `
            <div class="form-grid is-single">
                <div class="form-group"><label>Virtual path</label><div class="vt-path" id="insp-path">${ui.escapeHtml(this.pathOf(n))}</div></div>
                <div class="form-group"><label for="insp-segment">Segment *</label>
                    <input type="text" id="insp-segment" class="form-control" value="${ui.escapeHtml(n.segment)}"></div>
                <div class="form-group"><label for="insp-parent">Parent</label>
                    <select id="insp-parent" class="form-control" data-ignore-dirty>${parentOpts}</select>
                    <small>Changing the parent previews every affected virtual path first.</small></div>
                <div class="form-group"><label for="insp-kind">Type</label>
                    <select id="insp-kind" class="form-control">
                        <option value="FOLDER" ${kind === 'FOLDER' ? 'selected' : ''}>Folder (structure only)</option>
                        <option value="EXACT" ${kind === 'EXACT' ? 'selected' : ''}>Exact link (one topic)</option>
                        <option value="SUBTREE" ${kind === 'SUBTREE' ? 'selected' : ''}>Mount (prefix and all descendants)</option>
                    </select></div>
                <div class="form-group" id="insp-binding-group" ${n.binding ? '' : 'hidden'}>
                    <label for="insp-target">Physical target</label>
                    <input type="text" id="insp-target" class="form-control" placeholder="plc1/#" value="${ui.escapeHtml(n.binding ? n.binding.target + (kind === 'SUBTREE' && n.binding.target ? '/#' : '') : '')}">
                    <div class="vt-hint" id="insp-target-hint"></div>
                    <label for="insp-access" style="margin-top:0.75rem;">Access</label>
                    <select id="insp-access" class="form-control">
                        <option value="READ_ONLY" ${n.binding && n.binding.access === 'READ_ONLY' ? 'selected' : ''}>Read-only</option>
                        <option value="READ_WRITE" ${n.binding && n.binding.access === 'READ_WRITE' ? 'selected' : ''}>Read/write (virtual publishes allowed)</option>
                    </select>
                </div>
                <div class="form-group"><label for="insp-node-desc">Description</label>
                    <textarea id="insp-node-desc" class="form-control" rows="2">${ui.escapeHtml(n.description || '')}</textarea></div>
                ${issues ? `<ul class="vt-issues">${issues}</ul>` : ''}
            </div>`;
        this.updateTargetHint(n);

        const bind = (id, fn, evt = 'input') => { const el = this.$(id); if (el) el.addEventListener(evt, fn); };
        bind('insp-segment', (e) => {
            n.segment = e.target.value;
            this.$('insp-path').textContent = this.pathOf(n);
            this.$('inspector-title').textContent = n.segment;
            ui.markPageDirty(); this.renderTree(); this.scheduleValidate();
        });
        bind('insp-parent', (e) => { this.moveNode(n.id, e.target.value || null).then(() => this.renderInspector()); }, 'change');
        bind('insp-kind', (e) => this.changeKind(n, e.target.value), 'change');
        bind('insp-target', (e) => this.editTarget(n, e.target.value));
        bind('insp-access', (e) => { n.binding.access = e.target.value; ui.markPageDirty(); this.renderTree(); this.scheduleValidate(); }, 'change');
        bind('insp-node-desc', (e) => { n.description = e.target.value; ui.markPageDirty(); });
    }

    afterRootEdit() {
        ui.markPageDirty();
        this.renderTree();
        this.$('page-subtitle').textContent = this.tree.rootPath ? `Virtual root: ${this.tree.rootPath}` : '';
        this.scheduleValidate();
    }

    changeKind(n, kind) {
        if (kind === 'FOLDER') {
            n.binding = null;
        } else if (n.binding) {
            n.binding.kind = kind;
        } else {
            n.binding = { kind, target: '', access: 'READ_ONLY' };
        }
        ui.markPageDirty();
        this.renderAll();
        this.scheduleValidate();
    }

    /** `plc1/#` is source-picker syntax for a mount of `plc1`; `+` templates are not supported. */
    editTarget(n, raw) {
        let value = raw;
        if (/\/#$/.test(value) || value === '#') {
            value = value.replace(/\/?#$/, '');
            n.binding.kind = 'SUBTREE';
            this.$('insp-kind').value = 'SUBTREE';
        }
        n.binding.target = value;
        ui.markPageDirty();
        this.updateTargetHint(n);
        this.renderTree();
        this.scheduleValidate();
    }

    updateTargetHint(n) {
        const hint = this.$('insp-target-hint');
        if (!hint || !n.binding) return;
        const t = n.binding.target;
        hint.classList.remove('is-error');
        if (/[+#]/.test(t)) {
            hint.classList.add('is-error');
            hint.textContent = 'Wildcards (+ or #) inside a target are not supported in this version. Use a fixed prefix; “plc1/#” selects a mount of “plc1”.';
        } else if (n.binding.kind === 'SUBTREE') {
            hint.textContent = t
                ? `Mount: ${t}/values/v1  →  ${this.pathOf(n)}/values/v1 (suffix preserved)`
                : 'Mount a fixed physical prefix. Type “plc1/#” or “plc1”.';
        } else {
            hint.textContent = t
                ? `Link: ${t}  →  ${this.pathOf(n)} (descendants are not covered)`
                : 'Link exactly one physical topic.';
        }
    }

    // --------------------------------------------------------- validation

    toInput() {
        const t = this.tree;
        const input = {
            schemaVersion: t.schemaVersion || 1,
            name: t.name,
            rootPath: t.rootPath,
            description: t.description || null,
            enabled: !!t.enabled,
            nodes: t.nodes.map(n => ({
                id: n.id, parentId: n.parentId || null, segment: n.segment,
                description: n.description || null,
                binding: n.binding ? { kind: n.binding.kind, target: n.binding.target, access: n.binding.access } : null
            }))
        };
        // The issue says id is optional on create, but a broker may declare it ID!.
        // A client-generated id works with both; the broker treats a save without
        // expectedRevision as a create.
        if (!t.id && !this.draftId) this.draftId = 'vtt-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        input.id = t.id || this.draftId;
        return input;
    }

    scheduleValidate() {
        if (this.validateTimer) clearTimeout(this.validateTimer);
        this.validateTimer = setTimeout(() => this.validate(), 500);
    }

    async validate() {
        const seq = ++this.validateSeq;
        const badge = this.$('validation-badge');
        if (!this.tree.rootPath.trim()) {
            // Nothing meaningful to validate yet; the server would only say the root is empty.
            this.setIssues([]);
            this.$('validation-list').innerHTML = '<li>Enter a virtual root to start validating.</li>';
            badge.textContent = 'Not checked';
            badge.className = 'status-badge';
            return;
        }
        try {
            const res = await this.client.query(`
                query ValidateVirtualTopicTree($input: VirtualTopicTreeInput!) {
                    validateVirtualTopicTree(input: $input) {
                        valid errors { ${ISSUE_FIELDS} } warnings { ${ISSUE_FIELDS} }
                    }
                }`, { input: this.toInput() });
            if (seq !== this.validateSeq) return; // a newer edit superseded this answer
            const v = res.validateVirtualTopicTree;
            this.setIssues(
                (v.errors || []).map(i => ({ ...i, level: 'error' })).concat((v.warnings || []).map(i => ({ ...i, level: 'warning' }))));
            badge.textContent = v.valid ? 'Valid' : `${(v.errors || []).length} error(s)`;
            badge.className = 'status-badge ' + (v.valid ? 'badge-ok' : 'badge-err');
        } catch (e) {
            if (seq !== this.validateSeq) return;
            badge.textContent = 'Unavailable';
            badge.className = 'status-badge badge-warn';
            this.setIssues([{ level: 'warning', code: 'VALIDATION_UNAVAILABLE', message: 'Server validation failed: ' + e.message }]);
        }
    }

    setIssues(issues) {
        this.issues = issues;
        this.issuesByNode = new Map();
        issues.forEach(i => {
            const key = i.nodeId || '';
            if (!this.issuesByNode.has(key)) this.issuesByNode.set(key, []);
            this.issuesByNode.get(key).push(i);
        });
        const list = this.$('validation-list');
        list.innerHTML = issues.length === 0
            ? '<li>No problems found.</li>'
            : issues.map(i => `<li class="${i.level === 'error' ? 'is-error' : 'is-warn'}">${i.code ? `<code>${ui.escapeHtml(i.code)}</code> ` : ''}${i.path ? `<span class="vt-path">${ui.escapeHtml(i.path)}</span>: ` : ''}${ui.escapeHtml(i.message)}</li>`).join('');
        this.renderTree();
        const n = this.selectedId && this.node(this.selectedId);
        if (n && !document.activeElement?.closest?.('#inspector')) this.renderInspector();
    }

    // ------------------------------------------------------------- preview

    updatePreviewLabel() {
        const op = this.$('preview-op').value;
        const label = this.$('preview-topic-label');
        const input = this.$('preview-topic');
        if (op === 'PROJECT') { label.textContent = 'Physical topic'; input.placeholder = 'plc1/values/v1'; }
        else if (op === 'SUBSCRIBE') { label.textContent = 'Virtual filter'; input.placeholder = `${this.tree.rootPath || 'enterprise'}/+/#`; }
        else { label.textContent = 'Virtual topic'; input.placeholder = `${this.tree.rootPath || 'enterprise'}/area/values/v1`; }
    }

    async runPreview() {
        const topic = this.$('preview-topic').value.trim();
        const body = this.$('preview-body');
        const errs = this.$('preview-errors');
        errs.innerHTML = '';
        if (!topic) { body.innerHTML = ui.emptyRow(4, 'Enter a topic or filter to preview'); return; }
        try {
            const res = await this.client.query(`
                query PreviewVirtualTopicTree($input: VirtualTopicTreeInput!, $topic: String!, $op: VirtualTopicPreviewOperation!) {
                    previewVirtualTopicTree(input: $input, topicOrFilter: $topic, operation: $op) {
                        routes { nodeId virtualPath canonicalPath access } errors { ${ISSUE_FIELDS} }
                    }
                }`, { input: this.toInput(), topic, op: this.$('preview-op').value });
            const r = res.previewVirtualTopicTree;
            const routes = r.routes || [];
            body.innerHTML = routes.length === 0
                ? ui.emptyRow(4, 'No route', 'The topic does not resolve through this tree.')
                : routes.map(x => {
                    const node = x.nodeId ? this.node(x.nodeId) : null;
                    return `<tr><td class="vt-path">${ui.escapeHtml(x.virtualPath)}</td><td class="vt-path">${ui.escapeHtml(x.canonicalPath)}</td>
                        <td>${ui.escapeHtml(x.access === 'READ_WRITE' ? 'Read/write' : 'Read-only')}</td>
                        <td>${node ? ui.escapeHtml(node.segment) : ''}</td></tr>`;
                }).join('');
            errs.innerHTML = (r.errors || []).map(i => `<li class="is-error">${i.code ? `<code>${ui.escapeHtml(i.code)}</code> ` : ''}${ui.escapeHtml(i.message)}</li>`).join('');
        } catch (e) {
            body.innerHTML = '';
            errs.innerHTML = `<li class="is-error">Preview failed: ${ui.escapeHtml(e.message)}</li>`;
        }
    }

    // ---------------------------------------------------------------- save

    issueText(errors) {
        return (errors || []).map(e => (e.path ? e.path + ': ' : '') + e.message).join('; ');
    }

    async save() {
        if (!this.tree.name.trim() || !this.tree.rootPath.trim()) {
            this.select(null);
            ui.error('Name and virtual root are required.');
            return;
        }
        const btn = this.$('save-btn');
        btn.disabled = true;
        try {
            const res = await this.client.query(`
                mutation SaveVirtualTopicTree($input: VirtualTopicTreeInput!, $rev: String) {
                    saveVirtualTopicTree(input: $input, expectedRevision: $rev) {
                        success appliedRevision tree { id } errors { ${ISSUE_FIELDS} }
                    }
                }`, { input: this.toInput(), rev: this.isNew ? null : this.tree.revision });
            const r = res.saveVirtualTopicTree;
            if (r && r.success) {
                ui.markPageSaved();
                const id = (r.tree && r.tree.id) || this.tree.id;
                if (this.isNew) {
                    ui.success(`Tree “${this.tree.name}” created successfully`);
                    setTimeout(() => { window.spaLocation.href = `/pages/virtual-topic-tree-detail.html?id=${encodeURIComponent(id)}`; }, 800);
                } else {
                    ui.success('Virtual topic tree updated successfully');
                    await this.loadTree(id);
                    this.observed.clear();
                    this.renderAll();
                    this.scheduleValidate();
                }
            } else {
                const errors = (r && r.errors) || [];
                if (errors.some(e => e.code === 'REVISION_CONFLICT')) {
                    this.$('conflict-bar').style.display = 'flex';
                    ui.error('Revision conflict: the tree was changed elsewhere.');
                } else {
                    this.setIssues(errors.map(i => ({ ...i, level: 'error' })));
                    ui.error('Save rejected: ' + this.issueText(errors));
                }
            }
        } catch (e) {
            ui.error('Failed to save tree: ' + e.message);
        } finally {
            btn.disabled = false;
        }
    }

    async discardAndReload() {
        const ok = await ui.confirm({
            title: 'Discard edits', message: 'Discard your unsaved edits and load the latest revision?',
            confirmLabel: 'Discard and reload', danger: true
        });
        if (!ok) return;
        await this.loadTree(this.tree.id);
        this.observed.clear();
        this.selectedId = null;
        this.renderAll();
        this.scheduleValidate();
    }

    async deleteTree() {
        const t = this.tree;
        const ok = await ui.confirmDelete(t.name, {
            title: 'Delete virtual topic tree',
            message: `Delete the tree “${t.name}”?\nIts root “${t.rootPath}” is released and virtual subscriptions through it stop receiving data. Physical topics are not affected. This action cannot be undone.`
        });
        if (!ok) return;
        try {
            const res = await this.client.query(`
                mutation DeleteVirtualTopicTree($id: ID!, $rev: String!) {
                    deleteVirtualTopicTree(id: $id, expectedRevision: $rev) { success errors { ${ISSUE_FIELDS} } }
                }`, { id: t.id, rev: t.revision });
            const r = res.deleteVirtualTopicTree;
            if (r && r.success) {
                ui.markPageSaved();
                ui.success(`Tree “${t.name}” deleted`);
                setTimeout(() => { window.spaLocation.href = '/pages/virtual-topic-trees.html'; }, 800);
            } else {
                if ((r && r.errors || []).some(e => e.code === 'REVISION_CONFLICT')) this.$('conflict-bar').style.display = 'flex';
                ui.error('Failed to delete tree: ' + this.issueText(r && r.errors));
            }
        } catch (e) {
            ui.error('Failed to delete tree: ' + e.message);
        }
    }

    exportJson() {
        const doc = { ...this.toInput() };
        if (this.tree.revision) doc.revision = this.tree.revision;
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(this.tree.id || this.tree.name || 'virtual-topic-tree').replace(/[^\w.-]+/g, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // --------------------------------------------------- physical topic picker

    async loadArchiveGroups() {
        const sel = this.$('picker-group');
        try {
            const res = await this.client.query(`query GetArchiveGroups { archiveGroups(enabled: true) { name } }`);
            const groups = (res.archiveGroups || []).map(g => g.name);
            sel.innerHTML = groups.map(g => `<option value="${ui.escapeHtml(g)}">${ui.escapeHtml(g)}</option>`).join('');
            this.pickerGroup = groups.includes('Default') ? 'Default' : groups[0] || 'Default';
            sel.value = this.pickerGroup;
        } catch (e) {
            sel.innerHTML = '<option value="Default">Default</option>';
            this.pickerGroup = 'Default';
        }
        this.browsePickerRoot();
    }

    browsePickerRoot() {
        const tree = this.$('picker-tree');
        tree.innerHTML = '';
        this.pickerSeq++;
        this.loadPickerLevel('+', tree, '');
    }

    async loadPickerLevel(pattern, container, parentPath) {
        const seq = this.pickerSeq;
        const loading = document.createElement('li');
        loading.className = 'vt-hint';
        loading.textContent = 'Loading topics…';
        container.appendChild(loading);
        try {
            const res = await this.client.query(
                `query BrowsePhysical($topic: String!, $archiveGroup: String!) { browseTopics(topic: $topic, archiveGroup: $archiveGroup) { name } }`,
                { topic: pattern, archiveGroup: this.pickerGroup || 'Default' });
            if (seq !== this.pickerSeq) return;
            loading.remove();
            const levels = parentPath ? parentPath.split('/').length : 0;
            const grouped = new Map();
            (res.browseTopics || []).forEach(t => {
                const parts = t.name.split('/');
                if (parts.length <= levels) return;
                const name = parts[levels];
                const g = grouped.get(name) || { name, leaf: false, deeper: false };
                if (parts.length === levels + 1) g.leaf = true; else g.deeper = true;
                grouped.set(name, g);
            });
            if (grouped.size === 0) {
                const empty = document.createElement('li');
                empty.className = 'vt-hint';
                empty.textContent = 'No topics found';
                container.appendChild(empty);
                return;
            }
            [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(g => {
                const full = parentPath ? `${parentPath}/${g.name}` : g.name;
                const li = document.createElement('li');
                li.innerHTML = `<div class="vt-row" draggable="true" data-topic="${ui.escapeHtml(full)}">
                    <button type="button" class="vt-twisty" data-picker-twisty="1" aria-label="Expand ${ui.escapeHtml(full)}" ${g.deeper ? '' : 'hidden'}><ix-icon name="chevron-right-small" size="16"></ix-icon></button>
                    <ix-icon name="${g.deeper ? 'folder' : 'topic'}" size="16"></ix-icon>
                    <span class="vt-label">${ui.escapeHtml(g.name)}</span>
                    <button type="button" class="btn btn-secondary btn-sm" data-pick="SUBTREE" title="Mount ${ui.escapeHtml(full)}/# on the selected node" data-requires-auth>Mount</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-pick="EXACT" title="Link ${ui.escapeHtml(full)} to the selected node" data-requires-auth>Link</button>
                </div>`;
                container.appendChild(li);
            });
        } catch (e) {
            if (seq !== this.pickerSeq) return;
            loading.textContent = 'Topic discovery unavailable. Type the target in the inspector instead.';
        }
    }

    onPickerClick(e) {
        const row = e.target.closest('[data-topic]');
        if (!row) return;
        const topic = row.dataset.topic;
        const pick = e.target.closest('[data-pick]');
        if (pick) {
            if (this.selectedId) this.applyBinding(this.selectedId, pick.dataset.pick, topic);
            else this.addNode(pick.dataset.pick, { segment: topic.split('/').pop(), target: topic });
            return;
        }
        const tw = e.target.closest('[data-picker-twisty]');
        if (!tw) return;
        const li = row.parentElement;
        const existing = li.querySelector(':scope > ul');
        if (existing) { existing.remove(); tw.querySelector('ix-icon').setAttribute('name', 'chevron-right-small'); return; }
        tw.querySelector('ix-icon').setAttribute('name', 'chevron-down-small');
        const ul = document.createElement('ul');
        li.appendChild(ul);
        this.loadPickerLevel(topic + '/+', ul, topic);
    }
}

new VirtualTopicTreeDetailManager();

page.ready();
return () => page.dispose();
}
