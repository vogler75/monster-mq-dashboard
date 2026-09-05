// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
class TopicNamespacesManager {
    constructor() {
        this.namespaces = [];

        this.init();
    }

    init() {
        if (!this.isLoggedIn()) {
            window.location.href = '/pages/login.html';
            return;
        }

        this.loadData();
    }

    isLoggedIn() {
        return window.isLoggedIn();
    }

    async loadData() {
        try {
            console.log('Loading topic namespaces...');
            const result = await window.graphqlClient.query(`
                query GetTopicNamespaces {
                    topicNamespaces {
                        name
                        topicFilter
                        schemaPolicyName
                        enabled
                        enforcementMode
                        description
                        tags
                        createdAt
                        updatedAt
                    }
                }
            `);

            this.namespaces = result.topicNamespaces || [];
            this.renderNamespaces();
        } catch (error) {
            console.error('Error loading topic namespaces:', error);
            this.showError('Failed to load topic namespaces: ' + error.message);
        }
    }

    renderNamespaces() {
        const tbody = document.getElementById('namespaces-table-body');

        if (this.namespaces.length === 0) {
            tbody.innerHTML = ui.emptyRow(6, 'No topic namespaces found',
                'Create your first namespace to bind a topic filter to a schema policy.');
            return;
        }

        tbody.innerHTML = this.namespaces.map(ns => {
            const enforcementClass = ns.enforcementMode === 'REJECT' ? 'enforcement-reject' : 'enforcement-reject';

            return `
            <tr>
                <td>
                    <strong>${this.escapeHtml(ns.name)}</strong>
                    ${ns.description ? `<br><small style="color: var(--text-secondary);">${this.escapeHtml(ns.description)}</small>` : ''}
                </td>
                <td><span class="topic-filter-tag">${this.escapeHtml(ns.topicFilter || '-')}</span></td>
                <td>${this.escapeHtml(ns.schemaPolicyName || '-')}</td>
                <td><span class="enforcement-badge ${enforcementClass}">${this.escapeHtml(ns.enforcementMode || 'REJECT')}</span></td>
                <td>
                    <span class="status-badge ${ns.enabled ? 'status-enabled' : 'status-disabled'}" style="cursor: pointer;" onclick="namespacesManager.toggleNamespace('${this.escapeHtml(ns.name)}', ${!ns.enabled})">
                        <span class="status-indicator"></span>${ns.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <a href="/pages/topic-namespace-detail.html?name=${encodeURIComponent(ns.name)}"><ix-icon-button icon="highlight" variant="subtle-tertiary" size="24" title="Edit namespace"></ix-icon-button></a>
                        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete namespace" onclick="namespacesManager.showConfirmDeleteModal('${this.escapeHtml(ns.name)}')"></ix-icon-button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    async toggleNamespace(name, enabled) {
        try {
            console.log(`${enabled ? 'Enabling' : 'Disabling'} namespace:`, name);

            const result = await window.graphqlClient.query(`
                mutation ToggleNamespace($name: String!, $enabled: Boolean!) {
                    topicNamespace {
                        toggle(name: $name, enabled: $enabled) {
                            success
                            namespace {
                                name
                            }
                            errors
                        }
                    }
                }
            `, { name, enabled });

            if (result.topicNamespace.toggle.success) {
                console.log(`Namespace ${enabled ? 'enabled' : 'disabled'} successfully`);
                await this.loadData();
            } else {
                const errors = result.topicNamespace.toggle.errors || [];
                this.showError(errors.length > 0 ? errors.join(', ') : `Failed to ${enabled ? 'enable' : 'disable'} namespace`);
            }
        } catch (error) {
            console.error('Error toggling namespace:', error);
            this.showError('Failed to toggle namespace: ' + error.message);
        }
    }

    async showConfirmDeleteModal(name) {
        const entityName = name;
        if (!await ui.confirmDelete(entityName)) return;

        if (!entityName) return;

        try {
            console.log('Deleting namespace:', name);

            const result = await window.graphqlClient.query(`
                mutation DeleteNamespace($name: String!) {
                    topicNamespace {
                        delete(name: $name)
                    }
                }
            `, { name });

            if (result.topicNamespace.delete) {
                console.log('Namespace deleted successfully');
                await this.loadData();
            } else {
                this.showError('Failed to delete namespace');
            }
        } catch (error) {
            console.error('Error deleting namespace:', error);
            this.showError('Failed to delete namespace: ' + error.message);
        }

    }

    showError(message) { ui.showError(message); }

    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// Global functions for onclick handlers
window.refreshNamespaces = () => namespacesManager.loadData();

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.namespacesManager = new TopicNamespacesManager();
});

page.expose({
    get TopicNamespacesManager() { return TopicNamespacesManager; }
});
page.ready();
return () => page.dispose();
}
