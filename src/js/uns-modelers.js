// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval } = page;
// UNS Modeler device list

const DEVICE_QUERY = `
    query GetUnsModelers {
        unsModelers {
            name nodeId enabled isOnCurrentNode
            config { direction unsRoot oaPrefix allowWrite aiProvider }
            status { running active topics published errors }
        }
    }
`;

class UnsModelerListManager {
    constructor() {
        this.client = new GraphQLDashboardClient();
        this.devices = [];
        this.init();
    }

    async init() {
        await this.load();
        setInterval(() => this.load(), 15000);
    }

    async load() {
        ui.setLoading(true);
        ui.clearError();
        try {
            const result = await this.client.query(DEVICE_QUERY);
            this.devices = (result && result.unsModelers) || [];
            this.updateMetrics();
            this.render();
            this.renderAnalyse();
        } catch (e) {
            ui.showError('Failed to load UNS Modelers: ' + e.message);
        } finally {
            ui.setLoading(false);
        }
    }

    renderAnalyse() {
        const params = new URLSearchParams(window.location.search);
        const filter = params.get('analyse');
        if (!filter) return;
        const mode = params.get('mode') || 'live';
        const q = new URLSearchParams({ topics: filter, mode });
        document.getElementById('analyse-banner').style.display = '';
        document.getElementById('analyse-text').textContent = `Topics ${filter} (${mode}). Open a Direction B device to analyse them, or create a new one.`;
        const box = document.getElementById('analyse-devices');
        const devs = this.devices.filter(d => d.config.direction === 'MQTT_TO_WINCCOA');
        box.innerHTML = devs.map(d => `<a class="btn btn-secondary" href="/pages/uns-modeler-detail.html?name=${encodeURIComponent(d.name)}&${q}">${ui.escapeHtml(d.name)}</a>`).join('') +
            `<a class="btn btn-primary" href="/pages/uns-modeler-detail.html?new=true&direction=MQTT_TO_WINCCOA&${q}" data-requires-auth><ix-icon name="add-circle" size="16"></ix-icon> New Direction B Device</a>`;
    }

    updateMetrics() {
        const sum = f => this.devices.reduce((n, d) => n + Number((d.status && d.status[f]) || 0), 0);
        document.getElementById('total-devices').textContent = this.devices.length;
        document.getElementById('running-devices').textContent = this.devices.filter(d => d.status && d.status.running).length;
        document.getElementById('total-topics').textContent = sum('topics');
        document.getElementById('total-errors').textContent = sum('errors');
    }

    render() {
        const tbody = document.getElementById('devices-table-body');
        if (!tbody) return;
        if (!this.devices.length) {
            tbody.innerHTML = ui.emptyRow(9, 'No UNS Modelers configured',
                'Use “Add UNS Modeler” to map WinCC OA datapoints into the UNS or to onboard MQTT topics into WinCC OA.');
            return;
        }
        tbody.innerHTML = '';
        for (const d of this.devices) {
            const cfg = d.config || {};
            const st = d.status || {};
            const dirA = cfg.direction === 'WINCCOA_TO_UNS';
            const state = !d.enabled ? ui.statusBadge('Disabled', 'disabled')
                : st.running ? ui.statusBadge(st.active ? 'Running' : 'Standby', st.active ? 'ok' : 'warn')
                : ui.statusBadge('Idle', 'neutral');
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${ui.escapeHtml(d.name)}</strong></td>
                <td>${dirA ? 'WinCC OA &#8594; UNS' : 'MQTT &#8594; WinCC OA'}</td>
                <td><code>${ui.escapeHtml(dirA ? (cfg.unsRoot || '') : (cfg.oaPrefix || ''))}</code>${dirA && cfg.allowWrite ? ' <span class="status-badge badge-warn">..set</span>' : ''}</td>
                <td>${ui.escapeHtml(d.nodeId || '')}${d.isOnCurrentNode ? ' <span class="status-badge badge-info">this node</span>' : ''}</td>
                <td>${state}</td>
                <td class="num">${st.topics || 0}</td>
                <td class="num">${st.published || 0}</td>
                <td class="num">${st.errors || 0}</td>
                <td>
                    <div class="action-buttons">
                        <ix-icon-button icon="pen" variant="subtle-tertiary" size="24" title="Open device" class="btn-edit"></ix-icon-button>
                        <ix-icon-button icon="${d.enabled ? 'pause' : 'play'}" variant="subtle-tertiary" size="24" title="${d.enabled ? 'Disable' : 'Enable'}" data-requires-auth class="btn-toggle"></ix-icon-button>
                        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete" data-requires-auth></ix-icon-button>
                    </div>
                </td>`;
            row.querySelector('.btn-edit').addEventListener('click', e => { e.stopPropagation(); this.open(d.name); });
            row.querySelector('.btn-toggle').addEventListener('click', e => { e.stopPropagation(); this.toggle(d.name, !d.enabled); });
            row.querySelector('.btn-delete').addEventListener('click', e => { e.stopPropagation(); this.remove(d.name); });
            row.addEventListener('dblclick', () => this.open(d.name));
            tbody.appendChild(row);
        }
    }

    open(name) {
        window.spaLocation.href = `/pages/uns-modeler-detail.html?name=${encodeURIComponent(name)}`;
    }

    async toggle(name, enabled) {
        try {
            const r = await this.client.query(`mutation($n: String!, $e: Boolean!) { unsModeler { toggle(name: $n, enabled: $e) { success errors } } }`, { n: name, e: enabled });
            const res = r.unsModeler.toggle;
            if (!res.success) throw new Error(res.errors.join(', '));
            ui.success(`UNS Modeler “${name}” ${enabled ? 'enabled' : 'disabled'}`);
            await this.load();
        } catch (e) {
            ui.error('Failed to toggle UNS Modeler: ' + e.message);
        }
    }

    async remove(name) {
        const ok = await ui.confirmDelete(name, {
            title: 'Delete UNS Modeler',
            message: `Delete the UNS Modeler “${name}”?\nIts draft and applied mapping are deleted and it stops publishing. ` +
                'Datapoints and types it created in WinCC OA are not removed. This action cannot be undone.'
        });
        if (!ok) return;
        try {
            const r = await this.client.query(`mutation($n: String!) { unsModeler { delete(name: $n) } }`, { n: name });
            if (!r.unsModeler.delete) throw new Error('not deleted');
            ui.success(`UNS Modeler “${name}” deleted`);
            await this.load();
        } catch (e) {
            ui.error('Failed to delete UNS Modeler: ' + e.message);
        }
    }
}

var unsModelerListManager;

function refreshUnsModelers() {
    if (unsModelerListManager) unsModelerListManager.load();
}

document.addEventListener('DOMContentLoaded', () => {
    unsModelerListManager = new UnsModelerListManager();
});

page.expose({
    get refreshUnsModelers() { return refreshUnsModelers; }
});
page.ready();
return () => page.dispose();
}
