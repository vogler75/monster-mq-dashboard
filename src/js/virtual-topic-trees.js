// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
// Virtual Topic Trees - list page

class VirtualTopicTreesManager {
    constructor() {
        this.client = new GraphQLDashboardClient();
        this.trees = [];
        this.init();
    }

    async init() {
        const refresh = document.getElementById('refresh-btn');
        if (refresh) refresh.addEventListener('click', () => this.loadTrees());
        await this.loadTrees();
    }

    bindingCount(tree) {
        return (tree.nodes || []).filter(n => n.binding).length;
    }

    async loadTrees() {
        ui.setLoading(true);
        ui.clearError();
        try {
            const result = await this.client.query(`
                query GetVirtualTopicTrees {
                    virtualTopicTrees {
                        id name rootPath description enabled revision
                        nodes { id binding { kind } }
                    }
                }
            `);
            if (!result || !result.virtualTopicTrees) throw new Error('Invalid response structure');
            this.trees = result.virtualTopicTrees;
            this.updateMetrics();
            this.renderTable();
        } catch (e) {
            console.error('Error loading virtual topic trees:', e);
            ui.showError('Failed to load virtual topic trees: ' + e.message);
        } finally {
            ui.setLoading(false);
        }
    }

    updateMetrics() {
        document.getElementById('total-trees').textContent = this.trees.length;
        document.getElementById('enabled-trees').textContent = this.trees.filter(t => t.enabled).length;
        document.getElementById('total-bindings').textContent =
            this.trees.reduce((sum, t) => sum + this.bindingCount(t), 0);
    }

    renderTable() {
        const tbody = document.getElementById('trees-table-body');
        if (!tbody) return;
        if (this.trees.length === 0) {
            tbody.innerHTML = ui.emptyRow(6, 'No virtual topic trees configured',
                'Use “Add Tree” to design a virtual hierarchy over your physical topics.');
            return;
        }
        tbody.innerHTML = '';
        this.trees.forEach(t => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${ui.escapeHtml(t.name)}</strong></td>
                <td><code>${ui.escapeHtml(t.rootPath)}</code></td>
                <td>${ui.statusBadge(t.enabled ? 'Enabled' : 'Disabled', t.enabled ? 'ok' : 'disabled')}</td>
                <td class="num">${this.bindingCount(t)}</td>
                <td>${ui.escapeHtml(t.description || '')}</td>
                <td>
                    <div class="action-buttons">
                        <ix-icon-button icon="pen" variant="subtle-tertiary" size="24" title="Edit tree" class="btn-edit"></ix-icon-button>
                        <ix-icon-button icon="${t.enabled ? 'pause' : 'play'}" variant="subtle-tertiary" size="24" title="${t.enabled ? 'Disable' : 'Enable'}" data-requires-auth class="btn-toggle"></ix-icon-button>
                        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete" data-requires-auth></ix-icon-button>
                    </div>
                </td>
            `;
            row.querySelector('.btn-edit').addEventListener('click', () => this.openTree(t.id));
            row.querySelector('.btn-toggle').addEventListener('click', () => this.toggleTree(t));
            row.querySelector('.btn-delete').addEventListener('click', () => this.deleteTree(t));
            tbody.appendChild(row);
        });
    }

    openTree(id) {
        window.spaLocation.href = `/pages/virtual-topic-tree-detail.html?id=${encodeURIComponent(id)}`;
    }

    issueText(errors) {
        return (errors || []).map(e => (e.path ? e.path + ': ' : '') + e.message).join('; ');
    }

    async toggleTree(summary) {
        // Enable/disable uses the normal save operation, so load the full document first.
        try {
            const full = await this.client.query(`
                query GetVirtualTopicTree($id: ID!) {
                    virtualTopicTree(id: $id) {
                        id schemaVersion name rootPath description enabled revision
                        nodes { id parentId segment description binding { kind target access } }
                    }
                }`, { id: summary.id });
            const tree = full.virtualTopicTree;
            if (!tree) throw new Error('Tree no longer exists');
            const { revision, ...input } = tree;
            input.enabled = !tree.enabled;
            const result = await this.client.query(`
                mutation SaveVirtualTopicTree($input: VirtualTopicTreeInput!, $rev: String) {
                    saveVirtualTopicTree(input: $input, expectedRevision: $rev) {
                        success errors { code nodeId path message }
                    }
                }`, { input, rev: revision });
            const r = result.saveVirtualTopicTree;
            if (r && r.success) {
                ui.success(`Tree “${tree.name}” ${input.enabled ? 'enabled' : 'disabled'}`);
                await this.loadTrees();
            } else {
                ui.error('Failed to toggle: ' + this.issueText(r && r.errors));
            }
        } catch (e) {
            ui.error('Failed to toggle tree: ' + e.message);
        }
    }

    async deleteTree(tree) {
        const confirmed = await ui.confirmDelete(tree.name, {
            title: 'Delete virtual topic tree',
            message: `Delete the tree “${tree.name}”?\n` +
                `Its root “${tree.rootPath}” is released and virtual subscriptions through it stop receiving data. ` +
                'Physical topics and stored data are not affected. This action cannot be undone.'
        });
        if (!confirmed) return;
        try {
            const result = await this.client.query(`
                mutation DeleteVirtualTopicTree($id: ID!, $rev: String!) {
                    deleteVirtualTopicTree(id: $id, expectedRevision: $rev) {
                        success errors { code nodeId path message }
                    }
                }`, { id: tree.id, rev: tree.revision });
            const r = result.deleteVirtualTopicTree;
            if (r && r.success) {
                ui.success(`Tree “${tree.name}” deleted`);
                await this.loadTrees();
            } else {
                ui.error('Failed to delete tree: ' + this.issueText(r && r.errors));
            }
        } catch (e) {
            ui.error('Failed to delete tree: ' + e.message);
        }
    }
}

new VirtualTopicTreesManager();

page.ready();
return () => page.dispose();
}
