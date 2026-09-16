// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;

/**
 * MJPEG Camera Detail Page Controller
 */
class RtspCameraDetailManager {
    constructor() {
        this.client = window.graphqlClient || new GraphQLDashboardClient();
        this.cameraName = null;
        this.isNew = false;
        this.clusterNodes = [];
        this.metricsTimer = null;
        this.metricsLoading = false;
        this.previewTimer = null;
        this.previewLoading = false;
        this.lastPreviewTimestamp = null;
        this.init();
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        this.cameraName = urlParams.get('name');
        this.isNew = urlParams.get('new') === 'true' || !this.cameraName;

        this.setupFormListeners();
        await this.loadClusterNodes();

        if (this.isNew) {
            this.setupNewCamera();
        } else {
            await this.loadCameraData();
            this.metricsTimer = setInterval(() => this.refreshMetrics(), 1000);
            this.previewTimer = setInterval(() => this.refreshLatestPicture(), 500);
        }

        const saveBtn = document.getElementById('save-camera-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveCamera());

        const deleteBtn = document.getElementById('delete-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteCamera());

        const triggerBtn = document.getElementById('trigger-btn');
        if (triggerBtn) triggerBtn.addEventListener('click', () => this.triggerSnapshot());
    }

    setupFormListeners() {
        const modeSelect = document.getElementById('camera-mode');
        const urlInput = document.getElementById('camera-url');

        if (urlInput) urlInput.addEventListener('input', () => this.updateTransportState());

        if (modeSelect) {
            modeSelect.addEventListener('change', (e) => {
                const mode = e.target.value;
                const intervalGroup = document.getElementById('interval-group');
                const triggerGroup = document.getElementById('trigger-group');
                if (intervalGroup) intervalGroup.style.display = mode === 'TRIGGERED' ? 'none' : '';
                if (triggerGroup) triggerGroup.style.display = mode === 'CONTINUOUS' ? 'none' : '';
            });
        }
    }

    updateTransportState() {
        const url = document.getElementById('camera-url')?.value.trim() || '';
        const transport = document.getElementById('camera-transport');
        const hint = document.getElementById('camera-transport-hint');
        const isHTTP = /^https?:\/\//i.test(url);
        if (transport) transport.disabled = isHTTP;
        if (hint) hint.textContent = isHTTP
            ? 'Not used for HTTP multipart MJPEG streams.'
            : 'Used only for RTSP URLs.';
    }

    async loadClusterNodes() {
        try {
            const query = `query GetBrokers { brokers { nodeId isCurrent } }`;
            const result = await this.client.query(query);
            this.clusterNodes = result?.brokers || [];
            const nodeSelect = document.getElementById('camera-node');
            if (nodeSelect) {
                nodeSelect.innerHTML = '<option value="">Select Node...</option>';
                this.clusterNodes.forEach(node => {
                    const opt = document.createElement('option');
                    opt.value = node.nodeId;
                    opt.textContent = node.nodeId + (node.isCurrent ? ' (Current)' : '');
                    if (node.isCurrent) opt.selected = true;
                    nodeSelect.appendChild(opt);
                });
            }
        } catch (e) {
            console.error('Failed to load nodes:', e);
        }
    }

    setupNewCamera() {
        document.getElementById('breadcrumb-name').textContent = 'New Camera';
        document.getElementById('page-title').textContent = 'New MJPEG Camera';
        document.getElementById('camera-status-badge').textContent = 'New';
        document.getElementById('camera-status-badge').className = 'status-badge';
        document.getElementById('delete-btn').style.display = 'none';
        document.getElementById('trigger-btn').style.display = 'none';
        document.getElementById('status-card').style.display = 'none';
        this.updateTransportState();
        ui.markPageSaved();
    }

    async loadCameraData() {
        ui.setLoading(true);
        ui.clearError();
        try {
            const query = `
                query GetRtspCamera($name: String!) {
                    rtspCamera(name: $name) {
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
                            lastSnapshotAt
                            lastError
                            timestamp
                        }
                    }
                }
            `;
            const result = await this.client.query(query, { name: this.cameraName });
            const camera = result?.rtspCamera;
            if (!camera) {
                ui.showError(`Camera "${this.cameraName}" not found`);
                return;
            }

            document.getElementById('breadcrumb-name').textContent = camera.name;
            document.getElementById('page-title').textContent = camera.name;

            const nameInput = document.getElementById('camera-name');
            nameInput.value = camera.name;
            nameInput.disabled = true; // Key cannot be edited on update

            const nodeSelect = document.getElementById('camera-node');
            if (nodeSelect) nodeSelect.value = camera.nodeId;

            const cfg = camera.config || {};
            document.getElementById('camera-url').value = cfg.url || '';
            document.getElementById('camera-transport').value = cfg.transport || 'TCP';
            this.updateTransportState();
            document.getElementById('camera-enabled').checked = camera.enabled;

            document.getElementById('camera-topic-prefix').value = cfg.topicPrefix || 'cameras/' + camera.name;
            document.getElementById('camera-mode').value = cfg.mode || 'CONTINUOUS';
            document.getElementById('camera-slots').value = cfg.slots || 5;
            document.getElementById('camera-interval').value = cfg.intervalMs || 1000;
            document.getElementById('camera-trigger-topic').value = cfg.triggerTopic || '';
            document.getElementById('camera-qos').value = cfg.qos ?? 0;
            document.getElementById('camera-retain').checked = cfg.retain ?? true;
            document.getElementById('camera-publish-meta').checked = cfg.publishMetadata ?? true;

            // Trigger topic visibility
            const mode = cfg.mode || 'CONTINUOUS';
            const intervalGroup = document.getElementById('interval-group');
            const triggerGroup = document.getElementById('trigger-group');
            if (intervalGroup) intervalGroup.style.display = mode === 'TRIGGERED' ? 'none' : '';
            if (triggerGroup) triggerGroup.style.display = mode === 'CONTINUOUS' ? 'none' : '';

            // Actions & status card
            document.getElementById('delete-btn').style.display = '';
            document.getElementById('trigger-btn').style.display = camera.enabled ? '' : 'none';
            document.getElementById('status-card').style.display = '';

            this.renderMetrics(camera);
            await this.refreshLatestPicture(true);
            ui.markPageSaved();
        } catch (e) {
            console.error('Error loading camera:', e);
            ui.showError(`Failed to load camera: ${e.message}`);
        } finally {
            ui.setLoading(false);
        }
    }

    renderMetrics(camera) {
        const m = (camera.metrics && camera.metrics.length > 0) ? camera.metrics[0] : null;
        const statusBadge = document.getElementById('camera-status-badge');
        const connVal = document.getElementById('metric-connected');
        const framesVal = document.getElementById('metric-frames');
        const snapsVal = document.getElementById('metric-snaps');
        const lastTimeVal = document.getElementById('metric-last-time');
        const errBox = document.getElementById('live-error-box');
        const errText = document.getElementById('live-error-text');

        if (!camera.enabled) {
            if (statusBadge) { statusBadge.textContent = 'Disabled'; statusBadge.className = 'status-badge badge-disabled'; }
            if (connVal) connVal.textContent = 'Disabled';
            return;
        }

        if (!m) return;

        if (m.connected) {
            if (statusBadge) { statusBadge.textContent = 'Connected'; statusBadge.className = 'status-badge badge-ok'; }
            if (connVal) connVal.innerHTML = '<span style="color:var(--status-ok, #22c55e);">&#9679; Connected</span>';
        } else if (m.lastError) {
            if (statusBadge) { statusBadge.textContent = 'Error'; statusBadge.className = 'status-badge badge-error'; }
            if (connVal) connVal.innerHTML = '<span style="color:var(--status-error, #ef4444);">&#9679; Error</span>';
        } else {
            if (statusBadge) { statusBadge.textContent = 'Connecting'; statusBadge.className = 'status-badge badge-warning'; }
            if (connVal) connVal.innerHTML = '<span style="color:var(--status-warning, #eab308);">&#9679; Connecting</span>';
        }

        if (framesVal) framesVal.textContent = Math.round(m.framesReceived || 0).toLocaleString();
        if (snapsVal) snapsVal.textContent = Math.round(m.snapshotsPublished || 0).toLocaleString();
        if (lastTimeVal) lastTimeVal.textContent = m.lastSnapshotAt ? new Date(m.lastSnapshotAt).toLocaleTimeString() : '—';

        if (m.lastError && errBox && errText) {
            errText.textContent = m.lastError;
            errBox.style.display = '';
        } else if (errBox) {
            errBox.style.display = 'none';
        }
    }

    async refreshMetrics() {
        if (this.isNew || !this.cameraName || this.metricsLoading) return;
        this.metricsLoading = true;
        try {
            const query = `
                query GetRtspCameraMetrics($name: String!) {
                    rtspCamera(name: $name) {
                        enabled
                        metrics {
                            connected
                            framesReceived
                            snapshotsPublished
                            lastSnapshotAt
                            lastError
                            timestamp
                        }
                    }
                }
            `;
            const result = await this.client.query(query, { name: this.cameraName });
            if (result?.rtspCamera) {
                this.renderMetrics(result.rtspCamera);
            }
        } catch (e) {
            console.debug('Failed to refresh metrics:', e);
        } finally {
            this.metricsLoading = false;
        }
    }

    async refreshLatestPicture(force = false) {
        const preview = document.getElementById('live-snap-box');
        if (!preview || this.previewLoading) return;

        const prefix = (document.getElementById('camera-topic-prefix')?.value || '').replace(/\/+$/, '');
        if (!prefix) return;

        this.previewLoading = true;
        try {
            const query = `
                query GetLatestCameraPicture($topic: String!) {
                    retained: retainedMessage(topic: $topic, format: BINARY) {
                        payload
                        format
                        timestamp
                        contentType
                    }
                    current: currentValue(topic: $topic, format: BINARY) {
                        payload
                        format
                        timestamp
                        contentType
                    }
                }
            `;
            const result = await this.client.query(query, { topic: `${prefix}/capture/latest/pic` });
            const candidates = [result?.retained, result?.current].filter(value => value?.payload);
            const picture = candidates.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
            if (!picture?.payload) {
                if (force) this.showPicturePlaceholder('No picture has been published yet.');
                return;
            }
            if (!force && picture.timestamp === this.lastPreviewTimestamp) return;

            const image = document.createElement('img');
            image.alt = `Latest picture from ${this.cameraName || 'camera'}`;
            image.src = `data:${picture.contentType || 'image/jpeg'};base64,${picture.payload}`;
            image.addEventListener('error', () => this.showPicturePlaceholder('The latest picture could not be displayed.'));
            preview.replaceChildren(image);
            this.lastPreviewTimestamp = picture.timestamp;
        } catch (e) {
            console.debug('Failed to load latest camera picture:', e);
            if (force) this.showPicturePlaceholder('Latest picture is unavailable.');
        } finally {
            this.previewLoading = false;
        }
    }

    showPicturePlaceholder(message) {
        const preview = document.getElementById('live-snap-box');
        if (!preview) return;
        const icon = document.createElement('ix-icon');
        icon.setAttribute('name', 'photo-camera');
        icon.setAttribute('size', '48');
        icon.style.opacity = '0.3';
        icon.style.marginBottom = '8px';
        const text = document.createElement('p');
        text.style.color = 'var(--text-muted)';
        text.style.fontSize = '0.875rem';
        text.textContent = message;
        preview.replaceChildren(icon, text);
    }

    async saveCamera() {
        ui.clearError();
        const name = document.getElementById('camera-name').value.trim();
        const nodeId = document.getElementById('camera-node').value;
        const url = document.getElementById('camera-url').value.trim();
        const transport = document.getElementById('camera-transport').value;
        const enabled = document.getElementById('camera-enabled').checked;

        const topicPrefix = document.getElementById('camera-topic-prefix').value.trim();
        const mode = document.getElementById('camera-mode').value;
        const slots = parseInt(document.getElementById('camera-slots').value, 10);
        const intervalMs = parseInt(document.getElementById('camera-interval').value, 10);
        const triggerTopic = document.getElementById('camera-trigger-topic').value.trim();
        const qos = parseInt(document.getElementById('camera-qos').value, 10);
        const retain = document.getElementById('camera-retain').checked;
        const publishMetadata = document.getElementById('camera-publish-meta').checked;

        if (!name) { ui.showError('Camera Name is required'); return; }
        if (!nodeId) { ui.showError('Cluster Node is required'); return; }
        if (!url) { ui.showError('MJPEG Stream URL is required'); return; }
        if (!/^(?:rtsps?|https?):\/\//i.test(url)) {
            ui.showError('Stream URL must begin with rtsp://, rtsps://, http://, or https://');
            return;
        }
        if (!topicPrefix) { ui.showError('Topic Prefix is required'); return; }

        const input = {
            name,
            nodeId,
            enabled,
            config: {
                url,
                transport,
                topicPrefix,
                mode,
                slots: isNaN(slots) ? 5 : slots,
                intervalMs: isNaN(intervalMs) ? 1000 : intervalMs,
                triggerTopic: triggerTopic || undefined,
                qos: isNaN(qos) ? 0 : qos,
                retain,
                publishMetadata,
            }
        };

        ui.setLoading(true);
        try {
            if (this.isNew) {
                const mutation = `
                    mutation CreateRtspCamera($input: RtspCameraInput!) {
                        rtspCamera {
                            create(input: $input) {
                                success
                                errors
                                camera { name }
                            }
                        }
                    }
                `;
                const result = await this.client.query(mutation, { input });
                const res = result?.rtspCamera?.create;
                if (res?.success) {
                    ui.markPageSaved();
                    ui.success(`Camera "${name}" created successfully`);
                    setTimeout(() => {
                        window.spaLocation.href = `/pages/rtsp-camera-detail.html?name=${encodeURIComponent(name)}`;
                    }, 600);
                } else {
                    ui.showError(res?.errors?.join(', ') || 'Failed to create camera');
                }
            } else {
                const mutation = `
                    mutation UpdateRtspCamera($name: String!, $input: RtspCameraInput!) {
                        rtspCamera {
                            update(name: $name, input: $input) {
                                success
                                errors
                                camera { name }
                            }
                        }
                    }
                `;
                const result = await this.client.query(mutation, { name: this.cameraName, input });
                const res = result?.rtspCamera?.update;
                if (res?.success) {
                    ui.markPageSaved();
                    ui.success(`Camera "${name}" updated successfully`);
                    await this.loadCameraData();
                } else {
                    ui.showError(res?.errors?.join(', ') || 'Failed to update camera');
                }
            }
        } catch (e) {
            ui.showError(`Save error: ${e.message}`);
        } finally {
            ui.setLoading(false);
        }
    }

    async deleteCamera() {
        const confirmed = await ui.confirm({
            title: 'Delete MJPEG Camera',
            message: `Are you sure you want to delete camera "${this.cameraName}"?`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger',
        });
        if (!confirmed) return;

        ui.setLoading(true);
        try {
            const mutation = `
                mutation DeleteRtspCamera($name: String!) {
                    rtspCamera {
                        delete(name: $name)
                    }
                }
            `;
            const result = await this.client.query(mutation, { name: this.cameraName });
            if (result?.rtspCamera?.delete) {
                ui.markPageSaved();
                ui.success(`Camera "${this.cameraName}" deleted`);
                setTimeout(() => {
                    window.spaLocation.href = '/pages/rtsp-cameras.html';
                }, 500);
            } else {
                ui.showError(`Failed to delete camera "${this.cameraName}"`);
            }
        } catch (e) {
            ui.showError(`Delete error: ${e.message}`);
        } finally {
            ui.setLoading(false);
        }
    }

    async triggerSnapshot() {
        const button = document.getElementById('trigger-btn');
        if (button) button.disabled = true;
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
            const result = await this.client.query(mutation, { name: this.cameraName });
            if (result?.rtspCamera?.triggerSnapshot?.success) {
                ui.success(`Snapshot triggered on "${this.cameraName}"`);
                await this.refreshLatestPicture(true);
                await this.refreshMetrics();
                setTimeout(() => this.refreshLatestPicture(true), 500);
            } else {
                ui.showError(result?.rtspCamera?.triggerSnapshot?.errors?.join(', ') || 'Trigger failed');
            }
        } catch (e) {
            ui.showError(`Trigger error: ${e.message}`);
        } finally {
            if (button) button.disabled = false;
        }
    }
}

new RtspCameraDetailManager();
}
