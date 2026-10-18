import { ArchiveTopicBrowser } from './archive-topic-browser.js';

// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
// MonsterMQ Dashboard — Archive Explorer

var ArchiveExplorerManager = class ArchiveExplorerManager {
    constructor() {
        this.messages = [];
        this.selectedIndex = -1;
        this.visibleColumns = new Set(['timestamp', 'topic', 'payload', 'qos']);
        this.columnWidths = { timestamp: 210, qos: 50 };
        this.allColumns = [
            { key: 'timestamp', label: 'Timestamp' },
            { key: 'topic', label: 'Topic' },
            { key: 'payload', label: 'Payload' },
            { key: 'qos', label: 'QoS' },
            { key: 'clientId', label: 'Client ID' },
            { key: 'contentType', label: 'Content Type' },
            { key: 'responseTopic', label: 'Response Topic' },
            { key: 'payloadFormatIndicator', label: 'Format Indicator' },
            { key: 'userProperties', label: 'User Properties' }
        ];
    }

    init() {
        if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
            window.location.href = '/pages/login.html';
            return;
        }

        this.setDefaultTimeRange();
        this.loadArchiveGroups();
        this.buildColumnsMenu();
        this.renderTableHeader();
        this.setupEventListeners();
        this.setupDropTarget();
    }

    setDefaultTimeRange() {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        document.getElementById('from-time').value = this.toLocalISOString(oneHourAgo);
        document.getElementById('to-time').value = this.toLocalISOString(now);
    }

    toLocalISOString(date) {
        const pad = n => String(n).padStart(2, '0');
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
            'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    async loadArchiveGroups() {
        const select = document.getElementById('archive-group-select');
        const panelSelect = document.getElementById('topic-panel-archive-group');
        try {
            const result = await graphqlClient.query('{ archiveGroups { name enabled } }');
            const groups = result?.archiveGroups || [];
            select.innerHTML = '';
            panelSelect.innerHTML = '';
            if (groups.length === 0) {
                select.innerHTML = '<option value="">No archive groups</option>';
                panelSelect.innerHTML = '<option value="">No archive groups</option>';
                return;
            }
            groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.name;
                opt.textContent = g.name + (g.enabled ? '' : ' (disabled)');
                select.appendChild(opt);
                panelSelect.appendChild(opt.cloneNode(true));
            });
        } catch (e) {
            console.error('Failed to load archive groups:', e);
            select.innerHTML = '<option value="">Error loading</option>';
            panelSelect.innerHTML = '<option value="">Error loading</option>';
        }
    }

    setupDropTarget() {
        const topicInput = document.getElementById('topic-filter');
        topicInput.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            topicInput.classList.add('drag-over');
        });
        topicInput.addEventListener('dragleave', () => {
            topicInput.classList.remove('drag-over');
        });
        topicInput.addEventListener('drop', (e) => {
            e.preventDefault();
            topicInput.classList.remove('drag-over');
            const topic = e.dataTransfer.getData('text/plain');
            if (topic) {
                topicInput.value = topic;
            }
        });
    }

    buildColumnsMenu() {
        const menu = document.getElementById('columns-menu');
        menu.innerHTML = '';
        this.allColumns.forEach(col => {
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = this.visibleColumns.has(col.key);
            cb.dataset.col = col.key;
            cb.addEventListener('change', () => this.toggleColumn(col.key, cb.checked));
            label.appendChild(cb);
            label.appendChild(document.createTextNode(col.label));
            menu.appendChild(label);
        });
    }

    setupEventListeners() {
        document.getElementById('btn-query').addEventListener('click', () => this.executeQuery());
        document.getElementById('btn-back').addEventListener('click', () => this.navigateTime(-1));
        document.getElementById('btn-forward').addEventListener('click', () => this.navigateTime(1));
        document.getElementById('detail-close').addEventListener('click', () => this.closeDetail());

        // Columns dropdown toggle
        const colToggle = document.getElementById('columns-toggle');
        const colMenu = document.getElementById('columns-menu');
        colToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            colMenu.classList.toggle('open');
        });
        document.addEventListener('click', () => colMenu.classList.remove('open'));
        colMenu.addEventListener('click', (e) => e.stopPropagation());

        // Enter key on topic filter
        document.getElementById('topic-filter').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.executeQuery();
        });

        // Close detail on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeDetail();
        });

        document.getElementById('btn-export-csv').addEventListener('click', () => this.exportCSV());
    }

    async executeQuery() {
        const archiveGroup = document.getElementById('archive-group-select').value;
        const topicFilter = document.getElementById('topic-filter').value || '#';
        const fromTime = document.getElementById('from-time').value;
        const toTime = document.getElementById('to-time').value;
        const maxRows = parseInt(document.getElementById('max-rows').value);
        const format = document.getElementById('format-select').value;

        const tbody = document.getElementById('table-body');
        tbody.innerHTML = '<tr class="loading-row"><td colspan="' + this.visibleColumns.size + '"><div class="loading-spinner"></div> Loading...</td></tr>';

        const query = `query ArchivedMessages($topicFilter: String!, $startTime: String, $endTime: String, $format: DataFormat, $limit: Int, $archiveGroup: String) {
            archivedMessages(
                topicFilter: $topicFilter
                startTime: $startTime
                endTime: $endTime
                format: $format
                limit: $limit
                archiveGroup: $archiveGroup
            ) {
                topic timestamp payload format qos clientId
                contentType responseTopic payloadFormatIndicator
                userProperties { key value }
            }
        }`;

        const variables = {
            topicFilter,
            limit: maxRows,
            format
        };
        if (archiveGroup) variables.archiveGroup = archiveGroup;
        if (fromTime) variables.startTime = new Date(fromTime).toISOString();
        if (toTime) variables.endTime = new Date(toTime).toISOString();

        try {
            const result = await graphqlClient.query(query, variables);
            this.messages = result?.archivedMessages || [];
            this.selectedIndex = -1;
            this.closeDetail();
            this.renderTable();
            document.getElementById('result-count').textContent =
                this.messages.length + ' message' + (this.messages.length !== 1 ? 's' : '') + ' returned';
            document.getElementById('btn-export-csv').disabled = this.messages.length === 0;
        } catch (e) {
            console.error('Archive query failed:', e);
            tbody.innerHTML = '<tr><td colspan="' + this.visibleColumns.size + '" class="empty-state">Query failed: ' + this.escapeHtml(e.message) + '</td></tr>';
            document.getElementById('result-count').textContent = '';
        }
    }

    renderTableHeader() {
        const row = document.getElementById('table-header-row');
        row.innerHTML = '';
        const visibleCols = this.allColumns.filter(c => this.visibleColumns.has(c.key));
        visibleCols.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label;
            if (col.key === 'timestamp') th.className = 'timestamp-cell';
            th.dataset.col = col.key;

            // Apply saved width
            if (this.columnWidths && this.columnWidths[col.key]) {
                th.style.width = this.columnWidths[col.key] + 'px';
            }

            // Add resize handle
            const handle = document.createElement('div');
            handle.className = 'col-resize-handle';
            th.appendChild(handle);

            this.setupColumnResize(handle, th, col.key);
            row.appendChild(th);
        });
    }

    setupColumnResize(handle, th, colKey) {
        let startX, startWidth;

        const onMouseDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startWidth = th.offsetWidth;
            handle.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            const newWidth = Math.max(40, startWidth + (e.clientX - startX));
            th.style.width = newWidth + 'px';
        };

        const onMouseUp = () => {
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Save width
            if (!this.columnWidths) this.columnWidths = {};
            this.columnWidths[colKey] = th.offsetWidth;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', onMouseDown);
    }

    renderTable() {
        this.renderTableHeader();
        const tbody = document.getElementById('table-body');

        if (this.messages.length === 0) {
            tbody.innerHTML = ui.emptyRow(this.visibleColumns.size, 'No messages found',
                'Adjust the filters and try again.');
            return;
        }

        tbody.innerHTML = '';
        this.messages.forEach((msg, idx) => {
            const tr = document.createElement('tr');
            if (idx === this.selectedIndex) tr.classList.add('selected');
            tr.addEventListener('click', () => this.selectRow(idx));

            this.allColumns.forEach(col => {
                if (!this.visibleColumns.has(col.key)) return;
                const td = document.createElement('td');
                switch (col.key) {
                    case 'timestamp':
                        td.textContent = this.formatTimestamp(msg.timestamp);
                        td.className = 'timestamp-cell';
                        td.title = msg.timestamp;
                        break;
                    case 'topic':
                        td.textContent = msg.topic || '';
                        td.className = 'topic-cell';
                        td.title = msg.topic || '';
                        break;
                    case 'payload':
                        td.textContent = this.truncate(msg.payload || '', 100);
                        td.className = 'payload-cell';
                        td.title = msg.payload || '';
                        break;
                    case 'qos':
                        td.innerHTML = '<span class="qos-badge qos-' + (msg.qos || 0) + '">' + (msg.qos || 0) + '</span>';
                        break;
                    case 'clientId':
                        td.textContent = msg.clientId || '';
                        break;
                    case 'contentType':
                        td.textContent = msg.contentType || '';
                        break;
                    case 'responseTopic':
                        td.textContent = msg.responseTopic || '';
                        break;
                    case 'payloadFormatIndicator':
                        td.textContent = msg.payloadFormatIndicator != null ? msg.payloadFormatIndicator : '';
                        break;
                    case 'userProperties':
                        const ups = msg.userProperties || [];
                        td.textContent = ups.length > 0 ? ups.map(p => p.key + '=' + p.value).join(', ') : '';
                        td.title = td.textContent;
                        break;
                }
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
    }

    selectRow(index) {
        this.selectedIndex = index;
        const msg = this.messages[index];

        // Highlight row
        document.querySelectorAll('#table-body tr').forEach((tr, i) => {
            tr.classList.toggle('selected', i === index);
        });

        // Build detail content
        const body = document.getElementById('detail-body');
        let html = '';

        // Timestamp
        html += this.detailField('Timestamp', this.formatTimestampFull(msg.timestamp) +
            '<br><span style="color:var(--text-muted);font-size:0.75rem;">' + this.relativeTime(msg.timestamp) + '</span>');

        // Topic
        html += this.detailField('Topic', '<span class="mono">' + this.escapeHtml(msg.topic || '') + '</span>');

        // QoS
        html += this.detailField('QoS', '<span class="qos-badge qos-' + (msg.qos || 0) + '">' + (msg.qos || 0) + '</span>');

        // Client ID
        if (msg.clientId) {
            html += this.detailField('Client ID', this.escapeHtml(msg.clientId));
        }

        // Payload with Copy Action
        let payloadDisplay = msg.payload || '';
        try {
            const parsed = JSON.parse(payloadDisplay);
            payloadDisplay = JSON.stringify(parsed, null, 2);
        } catch (_) { /* not JSON, show raw */ }
        
        html += `
            <div class="detail-field">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <div class="detail-field-label" style="margin-bottom: 0;">Payload</div>
                    <button class="btn-nav" id="btn-copy-payload" onclick="window.archiveExplorer.copyPayloadToClipboard()" style="padding: 0.25rem 0.6rem; font-size: 0.72rem; border-radius: 6px; background: rgba(34, 50, 64, 0.8); gap: 0.25rem; min-height: auto; height: 26px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy</span>
                    </button>
                </div>
                <div class="detail-payload" id="detail-payload-content">${this.escapeHtml(payloadDisplay)}</div>
            </div>
        `;

        // MQTT v5 fields
        if (msg.contentType) {
            html += this.detailField('Content Type', this.escapeHtml(msg.contentType));
        }
        if (msg.responseTopic) {
            html += this.detailField('Response Topic', '<span class="mono">' + this.escapeHtml(msg.responseTopic) + '</span>');
        }
        if (msg.payloadFormatIndicator != null) {
            html += this.detailField('Payload Format Indicator', msg.payloadFormatIndicator);
        }

        // User Properties
        if (msg.userProperties && msg.userProperties.length > 0) {
            let propsHtml = '<table class="detail-user-props">';
            msg.userProperties.forEach(p => {
                propsHtml += '<tr><td>' + this.escapeHtml(p.key) + '</td><td>' + this.escapeHtml(p.value) + '</td></tr>';
            });
            propsHtml += '</table>';
            html += '<div class="detail-field"><div class="detail-field-label">User Properties</div>' + propsHtml + '</div>';
        }

        // Format
        if (msg.format) {
            html += this.detailField('Format', msg.format);
        }

        body.innerHTML = html;

        // Open panel
        document.getElementById('detail-panel').classList.add('open');
    }

    copyPayloadToClipboard() {
        const msg = this.messages[this.selectedIndex];
        if (!msg) return;
        let payloadDisplay = msg.payload || '';
        try {
            const parsed = JSON.parse(payloadDisplay);
            payloadDisplay = JSON.stringify(parsed, null, 2);
        } catch (_) {}

        navigator.clipboard.writeText(payloadDisplay).then(() => {
            const btn = document.getElementById('btn-copy-payload');
            if (btn) {
                btn.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--monster-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span style="color: var(--monster-green)">Copied!</span>
                `;
                btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                setTimeout(() => {
                    btn.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy</span>
                    `;
                    btn.style.borderColor = '';
                }, 2000);
            }
        }).catch(err => {
            console.error('Failed to copy payload:', err);
        });
    }

    closeDetail() {
        document.getElementById('detail-panel').classList.remove('open');
        this.selectedIndex = -1;
        document.querySelectorAll('#table-body tr.selected').forEach(tr => tr.classList.remove('selected'));
    }

    toggleColumn(col, visible) {
        if (visible) {
            this.visibleColumns.add(col);
        } else {
            this.visibleColumns.delete(col);
        }
        if (this.messages.length > 0) {
            this.renderTable();
        } else {
            this.renderTableHeader();
        }
    }

    navigateTime(direction) {
        const fromInput = document.getElementById('from-time');
        const toInput = document.getElementById('to-time');
        const from = new Date(fromInput.value);
        const to = new Date(toInput.value);

        if (isNaN(from.getTime()) || isNaN(to.getTime())) return;

        const duration = to.getTime() - from.getTime();
        const shift = duration * direction;

        fromInput.value = this.toLocalISOString(new Date(from.getTime() + shift));
        toInput.value = this.toLocalISOString(new Date(to.getTime() + shift));

        this.executeQuery();
    }

    // --- Helpers ---

    formatTimestamp(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return ts;
        const pad = n => String(n).padStart(2, '0');
        const ms = String(d.getMilliseconds()).padStart(3, '0');
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + ms;
    }

    formatTimestampFull(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return this.escapeHtml(ts);
        const pad = n => String(n).padStart(2, '0');
        return this.escapeHtml(pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0'));
    }

    relativeTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return '';
        const diff = Date.now() - d.getTime();
        if (diff < 0) return 'in the future';
        if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return Math.floor(diff / 86400000) + 'd ago';
    }

    truncate(str, max) {
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    detailField(label, value) {
        return '<div class="detail-field"><div class="detail-field-label">' + label +
            '</div><div class="detail-field-value">' + value + '</div></div>';
    }

    exportCSV() {
        if (this.messages.length === 0) return;
        const csvField = (v) => {
            const s = v == null ? '' : String(v);
            return '"' + s.replace(/"/g, '""') + '"';
        };
        const headers = ['timestamp', 'topic', 'payload', 'qos', 'clientId', 'format',
            'contentType', 'responseTopic', 'payloadFormatIndicator', 'userProperties'];
        const rows = [headers.join(',')];
        for (const msg of this.messages) {
            const ups = (msg.userProperties || []).map(p => p.key + '=' + p.value).join(';');
            rows.push([
                csvField(msg.timestamp),
                csvField(msg.topic),
                csvField(msg.payload),
                csvField(msg.qos),
                csvField(msg.clientId),
                csvField(msg.format),
                csvField(msg.contentType),
                csvField(msg.responseTopic),
                csvField(msg.payloadFormatIndicator),
                csvField(ups)
            ].join(','));
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const blob = new Blob([rows.join('\r\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'archive-messages-' + ts + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

// --- Init ---
let archiveExplorer;
let explorerTopicBrowser;

function init() {
    if (archiveExplorer) return;
    archiveExplorer = new ArchiveExplorerManager();
    window.archiveExplorer = archiveExplorer;
    archiveExplorer.init();
    explorerTopicBrowser = new ArchiveTopicBrowser({
        document,
        gql: window.graphqlClient,
        onSelectTopic: (topic) => {
            const filter = document.getElementById('topic-filter');
            if (filter) {
                filter.value = topic;
                filter.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });
    window.explorerTopicBrowser = explorerTopicBrowser;
    ArchiveTopicBrowser.instance = explorerTopicBrowser;
}

document.addEventListener('DOMContentLoaded', init);
init();

page.expose({
    get ArchiveExplorerManager() { return ArchiveExplorerManager; },
    get ExplorerTopicBrowser() { return ArchiveTopicBrowser; },
    get ArchiveTopicBrowser() { return ArchiveTopicBrowser; },
    get archiveExplorer() { return archiveExplorer; },
    get explorerTopicBrowser() { return explorerTopicBrowser; }
});
page.ready();
return () => {
    if (explorerTopicBrowser?.isOpen) explorerTopicBrowser.close();
    page.dispose();
};
}
