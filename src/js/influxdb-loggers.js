// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
class InfluxDBLoggersManager {
    constructor() {
        this.loggers = [];

        this.init();
    }

    init() {
        if (!this.isLoggedIn()) {
            window.location.href = '/pages/login.html';
            return;
        }
        this.loadLoggers();
    }

    isLoggedIn() {
        return window.isLoggedIn && window.isLoggedIn();
    }

    async loadLoggers() {
        try {
            const result = await window.graphqlClient.query(`
                query GetInfluxDBLoggers {
                    influxdbLoggers {
                        name
                        namespace
                        nodeId
                        enabled
                        isLocal
                        config {
                            endpointUrl
                            authType
                            topicFilters
                            tableName
                        }
                        metrics {
                            messagesIn
                            messagesWritten
                            connected
                        }
                    }
                }
            `);

            this.loggers = result.influxdbLoggers || [];
            this.renderLoggers();
            this.updateMetrics();
        } catch (error) {
            console.error('Error loading InfluxDB loggers:', error);
            this.showError('Failed to load InfluxDB loggers: ' + error.message);
        }
    }

    updateMetrics() {
        const total = this.loggers.length;
        const enabled = this.loggers.filter(l => l.enabled).length;
        const local = this.loggers.filter(l => l.isLocal).length;
        const rate = this.loggers.reduce((acc, l) => acc + (l.metrics?.messagesIn || 0), 0);

        document.getElementById('total-loggers').textContent = total;
        document.getElementById('enabled-loggers').textContent = enabled;
        document.getElementById('current-node-loggers').textContent = local;
        document.getElementById('messages-rate').textContent = Math.round(rate);
    }

    renderLoggers() {
        const tbody = document.getElementById('loggers-table-body');
        if (this.loggers.length === 0) {
            tbody.innerHTML = ui.emptyRow(8, 'No InfluxDB loggers found',
                'Create your first logger to get started.');
            return;
        }

        this.loggers.forEach(logger => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${logger.name}</strong></td>
                <td><small>${logger.config.endpointUrl}</small></td>
                <td>${logger.config.topicFilters.join(', ')}</td>
                <td>${logger.config.authType}</td>
                <td>${logger.nodeId} ${logger.isLocal ? '(Local)' : ''}</td>
                <td>
                    <span class="status-badge ${logger.enabled ? 'status-enabled' : 'status-disabled'}">
                        ${logger.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                </td>
                <td>${Math.round(logger.metrics?.messagesIn || 0)}</td>
                <td>
                    <div class="action-buttons">
                        <a href="/pages/influxdb-logger-detail.html?name=${encodeURIComponent(logger.name)}"><ix-icon-button icon="pen" variant="subtle-tertiary" size="24" title="Edit logger"></ix-icon-button></a>
                        ${logger.enabled ?
                            `<ix-icon-button icon="pause" variant="subtle-tertiary" size="24" title="Stop logger" onclick="influxdbLoggersManager.toggleLogger('${logger.name}', false)"></ix-icon-button>` :
                            `<ix-icon-button icon="play" variant="subtle-tertiary" size="24" title="Start logger" onclick="influxdbLoggersManager.toggleLogger('${logger.name}', true)"></ix-icon-button>`
                        }
                        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete logger" onclick="influxdbLoggersManager.showConfirmDeleteModal('${logger.name}')"></ix-icon-button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async toggleLogger(name, enabled) {
        try {
            await window.graphqlClient.query(`
                mutation ToggleInfluxDBLogger($name: String!, $enabled: Boolean!) {
                    influxdbLogger {
                        toggle(name: $name, enabled: $enabled)
                    }
                }
            `, { name, enabled });
            this.loadLoggers();
        } catch (error) {
            this.showError('Failed to toggle logger: ' + error.message);
        }
    }

    async showConfirmDeleteModal(name) {
        const entityName = name;
        if (!await ui.confirmDelete(entityName)) return;

        if (!entityName) return;
        try {
            await window.graphqlClient.query(`
                mutation DeleteInfluxDBLogger($name: String!) {
                    influxdbLogger {
                        delete(name: $name)
                    }
                }
            `, { name: entityName });

            this.loadLoggers();
        } catch (error) {
            this.showError('Failed to delete logger: ' + error.message);
        }

    }

    showError(msg) { ui.showError(msg); }
}

window.influxdbLoggersManager = new InfluxDBLoggersManager();
window.refreshLoggers = () => window.influxdbLoggersManager.loadLoggers();

page.expose({
    get InfluxDBLoggersManager() { return InfluxDBLoggersManager; }
});
page.ready();
return () => page.dispose();
}
