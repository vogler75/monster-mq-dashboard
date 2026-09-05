// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
class TopicSchemaPoliciesManager {
    constructor() {
        this.policies = [];

        this.init();
    }

    init() {
        if (!this.isLoggedIn()) {
            window.location.href = '/pages/login.html';
            return;
        }

        this.loadPolicies();
    }

    isLoggedIn() {
        return window.isLoggedIn();
    }

    async loadPolicies() {
        try {
            console.log('Loading topic schema policies...');
            const result = await window.graphqlClient.query(`
                query GetTopicSchemaPolicies {
                    topicSchemaPolicies {
                        name
                        payloadType
                        version
                        description
                        jsonSchema
                        contentType
                        examples
                        createdAt
                        updatedAt
                    }
                }
            `);

            this.policies = result.topicSchemaPolicies || [];
            this.renderPolicies();
            this.updateMetrics();
        } catch (error) {
            console.error('Error loading topic schema policies:', error);
            this.showError('Failed to load topic schema policies: ' + error.message);
        }
    }

    updateMetrics() {
        const el = document.getElementById('total-policies');
        if (el) el.textContent = this.policies.length;
    }

    renderPolicies() {
        const tbody = document.getElementById('policies-table-body');

        if (this.policies.length === 0) {
            tbody.innerHTML = ui.emptyRow(5, 'No topic schema policies found',
                'Create your first policy to get started.');
            return;
        }

        tbody.innerHTML = this.policies.map(policy => {
            return `
            <tr>
                <td><strong>${this.escapeHtml(policy.name)}</strong></td>
                <td>${this.escapeHtml(policy.payloadType || 'JSON')}</td>
                <td>${this.escapeHtml(policy.version || '-')}</td>
                <td style="color: var(--text-secondary); max-width: 300px;">${this.escapeHtml(policy.description || '-')}</td>
                <td>
                    <div class="action-buttons">
                        <a href="/pages/topic-schema-policy-detail.html?name=${encodeURIComponent(policy.name)}"><ix-icon-button icon="highlight" variant="subtle-tertiary" size="24" title="Edit policy"></ix-icon-button></a>
                        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete policy" onclick="policiesManager.showConfirmDeleteModal('${this.escapeHtml(policy.name)}')"></ix-icon-button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    async showConfirmDeleteModal(name) {
        const entityName = name;
        if (!await ui.confirmDelete(entityName)) return;

        if (!entityName) return;

        try {
            console.log('Deleting policy:', name);

            const result = await window.graphqlClient.query(`
                mutation DeletePolicy($name: String!) {
                    topicSchemaPolicy {
                        delete(name: $name)
                    }
                }
            `, { name });

            if (result.topicSchemaPolicy.delete) {
                console.log('Policy deleted successfully');
                await this.loadPolicies();
            } else {
                this.showError('Failed to delete policy');
            }
        } catch (error) {
            console.error('Error deleting policy:', error);
            this.showError('Failed to delete policy: ' + error.message);
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
window.refreshPolicies = () => policiesManager.loadPolicies();

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.policiesManager = new TopicSchemaPoliciesManager();
});

page.expose({
    get TopicSchemaPoliciesManager() { return TopicSchemaPoliciesManager; }
});
page.ready();
return () => page.dispose();
}
