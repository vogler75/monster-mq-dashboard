// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;

/**
 * MJPEG Camera Management
 */
class RtspCameraManager {
    constructor() {
        this.client = window.graphqlClient || new GraphQLDashboardClient();
        this.cameras = [];
        this.init();
    }

    async init() {
        await this.loadCameras();
        setInterval(() => this.loadCameras(), 15000);

        const refreshBtn = document.getElementById('refresh-cameras-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadCameras());
        }

        const searchInput = document.getElementById('camera-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterCameras(e.target.value));
        }
    }

    async loadCameras() {
        ui.setLoading(true);
        ui.clearError();
        try {
            const query = `
                query GetRtspCameras {
                    rtspCameras {
                        name
                        nodeId
                        enabled
                        isOnCurrentNode
                        createdAt
                        updatedAt
                        config {
                            url
                            transport
                            topicPrefix
                            mode
                            intervalMs
                            slots
                            triggerTopic
                            retain
                            qos
                            publishMetadata
                        }
                        metrics {
                            connected
                            framesReceived
                            snapshotsPublished
                            currentSlot
                            lastSnapshotAt
                            lastError
                            timestamp
                        }
                    }
                }
            `;
            const result = await this.client.query(query);
            if (!result || !result.rtspCameras) throw new Error('Invalid response structure');
            this.cameras = result.rtspCameras;
            this.updateMetrics();
            this.renderCamerasTable();
        } catch (e) {
            console.error('Error loading RTSP cameras:', e);
            ui.showError('Failed to load RTSP cameras: ' + e.message);
        } finally {
            ui.setLoading(false);
        }
    }

    updateMetrics() {
        const total = this.cameras.length;
        const enabled = this.cameras.filter(c => c.enabled).length;
        const local = this.cameras.filter(c => c.isOnCurrentNode).length;
        const totalSnaps = this.cameras.reduce((sum, c) => {
            const m = (c.metrics && c.metrics.length > 0) ? c.metrics[0] : null;
            return sum + (m ? (m.snapshotsPublished || 0) : 0);
        }, 0);

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('total-cameras', total);
        setVal('enabled-cameras', enabled);
        setVal('current-node-cameras', local);
        setVal('total-snapshots', totalSnaps);
    }

    filterCameras(filterText) {
        const query = (filterText || '').toLowerCase().trim();
        const rows = document.querySelectorAll('#rtsp-cameras-table-body tr');
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(query) ? '' : 'none';
        });
    }

    renderCamerasTable() {
        const tbody = document.getElementById('rtsp-cameras-table-body');
        if (!tbody) return;

        if (this.cameras.length === 0) {
            tbody.innerHTML = ui.emptyRow(9, 'No MJPEG cameras configured',
                'Click “Add Camera” to capture an MJPEG stream over RTSP or HTTP and publish snapshots to MQTT.');
            return;
        }

        tbody.innerHTML = '';
        this.cameras.forEach(c => {
            const cfg = c.config || {};
            const m = (c.metrics && c.metrics.length > 0) ? c.metrics[0] : { connected: false, snapshotsPublished: 0, currentSlot: 0 };
            const node = ui.escapeHtml(c.nodeId || '');

            let statusLabel = 'Disabled';
            let statusVariant = 'disabled';
            if (c.enabled) {
                if (m.connected) {
                    statusLabel = 'Connected';
                    statusVariant = 'ok';
                } else if (m.lastError) {
                    statusLabel = 'Error';
                    statusVariant = 'error';
                } else {
                    statusLabel = 'Connecting';
                    statusVariant = 'warning';
                }
            }

            const activeSlotDisplay = m.currentSlot > 0 ? `Slot ${m.currentSlot}` : '—';
            const isHTTP = /^https?:\/\//i.test(cfg.url || '');
            const protocolLabel = isHTTP ? 'HTTP' : (cfg.transport || 'RTSP');
            const transportBadge = `<span class="status-badge badge-info" style="font-size:10px;margin-left:4px;">${ui.escapeHtml(protocolLabel)}</span>`;

            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => this.viewCamera(c.name));

            row.innerHTML = `
                <td><strong>${ui.escapeHtml(c.name)}</strong></td>
                <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${ui.escapeHtml(cfg.url || '')}">
                    ${ui.escapeHtml(cfg.url || '')}${transportBadge}
                </td>
                <td><code>${ui.escapeHtml(cfg.topicPrefix || '')}</code></td>
                <td><span class="status-badge">${ui.escapeHtml(cfg.mode || 'CONTINUOUS')}</span></td>
                <td class="num">${cfg.slots || 5} (1..${cfg.slots || 5})</td>
                <td class="num">${cfg.intervalMs || 1000} ms</td>
                <td>${ui.statusBadge(statusLabel, statusVariant)}</td>
                <td class="num"><strong>${activeSlotDisplay}</strong></td>
                <td>
                    <div class="action-buttons">
                        <ix-icon-button icon="photo-camera" variant="subtle-tertiary" size="24" title="Trigger immediate snapshot" class="btn-snap" data-requires-auth></ix-icon-button>
                        <ix-icon-button icon="pen" variant="subtle-tertiary" size="24" title="Edit camera" class="btn-edit"></ix-icon-button>
                        <ix-icon-button icon="${c.enabled ? 'pause' : 'play'}" variant="subtle-tertiary" size="24" title="${c.enabled ? 'Disable' : 'Enable'}" data-requires-auth class="btn-toggle"></ix-icon-button>
                        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete camera" data-requires-auth></ix-icon-button>
                    </div>
                </td>
            `;

            const snapBtn = row.querySelector('.btn-snap');
            if (snapBtn) snapBtn.addEventListener('click', (e) => { e.stopPropagation(); this.triggerSnapshot(c.name); });
            const editBtn = row.querySelector('.btn-edit');
            if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.viewCamera(c.name); });
            const toggleBtn = row.querySelector('.btn-toggle');
            if (toggleBtn) toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleCamera(c.name, !c.enabled); });
            const deleteBtn = row.querySelector('.btn-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteCamera(c.name); });

            tbody.appendChild(row);
        });
    }

    viewCamera(name) {
        window.spaLocation.href = `/pages/rtsp-camera-detail.html?name=${encodeURIComponent(name)}`;
    }

    async triggerSnapshot(name) {
        try {
            const mutation = `
                mutation TriggerRtspCameraSnapshot($name: String!) {
                    rtspCamera {
                        triggerSnapshot(name: $name) {
                            success
                            errors
                        }
                    }
                }
            `;
            const result = await this.client.query(mutation, { name });
            if (result?.rtspCamera?.triggerSnapshot?.success) {
                ui.success(`Snapshot triggered on "${name}"`);
                await this.loadCameras();
            } else {
                const errs = result?.rtspCamera?.triggerSnapshot?.errors?.join(', ') || 'Unknown error';
                ui.showError(`Failed to trigger snapshot: ${errs}`);
            }
        } catch (e) {
            ui.showError(`Trigger error: ${e.message}`);
        }
    }

    async toggleCamera(name, enabled) {
        try {
            const mutation = `
                mutation ToggleRtspCamera($name: String!, $enabled: Boolean!) {
                    rtspCamera {
                        toggle(name: $name, enabled: $enabled) {
                            success
                            errors
                        }
                    }
                }
            `;
            const result = await this.client.query(mutation, { name, enabled });
            if (result?.rtspCamera?.toggle?.success) {
                ui.success(`Camera "${name}" ${enabled ? 'enabled' : 'disabled'}`);
                await this.loadCameras();
            } else {
                const errs = result?.rtspCamera?.toggle?.errors?.join(', ') || 'Unknown error';
                ui.showError(`Failed to update camera: ${errs}`);
            }
        } catch (e) {
            ui.showError(`Toggle error: ${e.message}`);
        }
    }

    async deleteCamera(name) {
        const confirmed = await ui.confirm({
            title: 'Delete MJPEG Camera',
            message: `Are you sure you want to delete camera "${name}"? This action cannot be undone.`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger',
        });
        if (!confirmed) return;

        try {
            const mutation = `
                mutation DeleteRtspCamera($name: String!) {
                    rtspCamera {
                        delete(name: $name)
                    }
                }
            `;
            const result = await this.client.query(mutation, { name });
            if (result?.rtspCamera?.delete) {
                ui.success(`Camera "${name}" deleted successfully`);
                await this.loadCameras();
            } else {
                ui.showError(`Failed to delete camera "${name}"`);
            }
        } catch (e) {
            ui.showError(`Delete error: ${e.message}`);
        }
    }
}

new RtspCameraManager();
}
