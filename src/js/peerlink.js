// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, ResizeObserver } = page;
// PeerLink overview: the brokers linked to this node, the direction messages flow, link details

const PEERLINK_QUERY = `
    query PeerLinkOverview {
        peerLink {
            enabled nodeId listen tls brokerType brokerVersion protocolVersion status
            peers {
                nodeId address pull serve interest pullState serveState remote lastError
                brokerType brokerVersion protocolVersion source consumer
            }
        }
    }
`;

const LOCAL_ID = '__local__';

// Link states grouped into the four semantic tones of the design system.
function linkTone(state) {
    switch (state) {
        case 'STREAMING':
        case 'CONNECTED':
            return 'ok';
        case 'DIALING':
        case 'HANDSHAKE':
        case 'SNAPSHOT':
            return 'warn';
        case 'BACKOFF':
        case 'STOPPED':
        case 'DISCONNECTED':
            return 'err';
        default:
            return 'neutral';
    }
}

// The worst tone of a peer's links decides its node colour.
function peerTone(peer) {
    const tones = [];
    if (peer.pull) tones.push(linkTone(peer.pullState));
    if (peer.serve) tones.push(linkTone(peer.serveState));
    for (const tone of ['err', 'warn', 'ok']) {
        if (tones.includes(tone)) return tone;
    }
    return 'neutral';
}

function direction(peer) {
    if (peer.pull && peer.serve) return { label: 'Both ways', icon: 'refresh' };
    if (peer.pull) return { label: 'Receives from', icon: 'import' };
    if (peer.serve) return { label: 'Sends to', icon: 'export' };
    return { label: 'None', icon: 'link-break' };
}

const BROKER_TYPES = { FULL: 'Full (Java)', EDGE: 'Edge (Go)' };
const BROKER_SHORT = { FULL: 'Full', EDGE: 'Edge' };

// "Edge (Go) 1.2.3"; null while the peer has not announced itself.
function brokerText(type, version) {
    if (!type && !version) return null;
    return [BROKER_TYPES[type] || type, version].filter(Boolean).join(' ');
}

function protocolMajor(version) {
    return version ? String(version).split('.')[0] : null;
}

// A peer on another protocol minor version still links; another major version is refused.
function protocolBadge(peerVersion, ownVersion) {
    if (!peerVersion) return '<span class="peerlink-muted">&ndash;</span>';
    const tone = peerVersion === ownVersion ? 'neutral' : (protocolMajor(peerVersion) === protocolMajor(ownVersion) ? 'info' : 'err');
    return ui.statusBadge(peerVersion, tone);
}

// Peer labels sit on the outside of the ring, away from the links.
function labelPosition(angle) {
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'bottom' : 'top';
}

const SHORT_STATE = { NEVER_CONNECTED: 'idle', DISCONNECTED: 'down', STOPPED: 'stopped' };

function stateText(state) {
    return state ? state.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : '';
}

function badge(state) {
    return state ? ui.statusBadge(stateText(state), linkTone(state)) : '<span class="peerlink-muted">&ndash;</span>';
}

function num(value) {
    if (value === null || value === undefined || value === '') return '–';
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : String(value);
}

function bytes(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '–';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

function sumValues(map) {
    if (!map || typeof map !== 'object') return 0;
    return Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

class PeerLinkOverview {
    constructor() {
        this.client = new GraphQLDashboardClient();
        this.info = null;
        this.selected = LOCAL_ID;
        this.chart = null;
        this.loading = false;
        this.init();
    }

    async init() {
        document.getElementById('peerlink-refresh')?.addEventListener('click', () => this.load());
        await this.load();
        setInterval(() => this.load(), 5000);
    }

    async load() {
        if (this.loading) return;
        this.loading = true;
        if (!this.info) ui.setLoading(true);
        try {
            const result = await this.client.query(PEERLINK_QUERY);
            if (!result || !result.peerLink) throw new Error('Invalid response structure');
            ui.clearError();
            this.info = result.peerLink;
            this.render();
        } catch (e) {
            console.error('Error loading PeerLink status:', e);
            if (/peerLink/.test(e.message || '') && /undefined|validation|Cannot query/i.test(e.message || '')) {
                this.showDisabled('This broker does not report PeerLink', 'The broker version is older than the peerLink GraphQL query.');
            } else {
                ui.showError('Failed to load PeerLink status: ' + e.message);
            }
        } finally {
            this.loading = false;
            ui.setLoading(false);
        }
    }

    showDisabled(title, hint) {
        document.getElementById('peerlink-content').style.display = 'none';
        document.getElementById('peerlink-disabled').style.display = '';
        document.getElementById('peerlink-disabled-title').textContent = title;
        document.getElementById('peerlink-disabled-hint').textContent = hint;
    }

    render() {
        const info = this.info;
        if (!info.enabled) {
            this.showDisabled(`PeerLink is not enabled on ${info.nodeId}`,
                'Enable the PeerLink section in the broker configuration to link brokers.');
            return;
        }
        document.getElementById('peerlink-disabled').style.display = 'none';
        document.getElementById('peerlink-content').style.display = '';
        document.getElementById('peerlink-subtitle').textContent =
            `Brokers linked to ${info.nodeId} and the direction their messages flow`;

        if (this.selected !== LOCAL_ID && !info.peers.some(p => p.nodeId === this.selected)) {
            this.selected = LOCAL_ID;
        }
        this.renderMetrics();
        this.renderGraph();
        this.renderTable();
        this.renderDetails();
    }

    renderMetrics() {
        const peers = this.info.peers;
        const pulls = peers.filter(p => p.pull);
        const serves = peers.filter(p => p.serve);
        const down = peers.reduce((n, p) =>
            n + (p.pull && linkTone(p.pullState) === 'err' ? 1 : 0) + (p.serve && linkTone(p.serveState) === 'err' ? 1 : 0), 0);
        document.getElementById('metric-peers').textContent = peers.length;
        document.getElementById('metric-pull').textContent = `${pulls.filter(p => p.pullState === 'STREAMING').length} / ${pulls.length}`;
        document.getElementById('metric-serve').textContent = `${serves.filter(p => p.serveState === 'CONNECTED').length} / ${serves.length}`;
        document.getElementById('metric-down').textContent = down;
        document.getElementById('metric-down-icon').className = 'metric-icon ' + (down > 0 ? 'is-err' : 'is-ok');
        const nodeBadge = document.getElementById('peerlink-node-badge');
        nodeBadge.textContent = this.info.listen ? `Listening ${this.info.listen}${this.info.tls ? ' · TLS' : ''}` : 'Pull only';
    }

    // ===================== Graph =====================

    colors() {
        const css = getComputedStyle(document.documentElement);
        const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
        return {
            ok: v('--monster-green', '#10B981'),
            warn: v('--monster-orange', '#F97316'),
            err: v('--monster-red', '#EF4444'),
            neutral: v('--text-muted', '#617d91'),
            accent: v('--monster-purple', '#7C3AED'),
            text: v('--text-primary', '#f0f6fc'),
            muted: v('--text-muted', '#617d91'),
            surface: v('--dark-surface', '#18262d')
        };
    }

    ensureChart() {
        if (this.chart || typeof echarts === 'undefined') return;
        const container = document.getElementById('peerlink-graph');
        if (!container) return;
        this.chart = echarts.init(container, null, { renderer: 'canvas' });
        this.chart.on('click', params => {
            if (params.dataType === 'node' && params.data) this.select(params.data.id);
            if (params.dataType === 'edge' && params.data) this.select(params.data.peer);
        });
        new ResizeObserver(() => this.chart && this.chart.resize()).observe(container);
        page.addCleanup(() => { if (this.chart) { this.chart.dispose(); this.chart = null; } });
    }

    renderGraph() {
        this.ensureChart();
        if (!this.chart) return;
        const c = this.colors();
        const info = this.info;
        const peers = info.peers;
        const radius = 160;

        const nodes = [{
            id: LOCAL_ID,
            name: info.nodeId,
            x: 0,
            y: 0,
            symbolSize: 72,
            itemStyle: {
                color: c.accent,
                borderColor: this.selected === LOCAL_ID ? c.text : c.accent,
                borderWidth: this.selected === LOCAL_ID ? 3 : 0
            },
            label: {
                show: true, position: 'inside', color: '#fff', fontWeight: 600,
                formatter: `{b}\n${BROKER_SHORT[info.brokerType] || 'this node'}`
            }
        }];
        const links = [];
        peers.forEach((peer, i) => {
            const angle = (2 * Math.PI * i) / Math.max(peers.length, 1) - Math.PI / 2;
            const tone = peerTone(peer);
            const isSelected = this.selected === peer.nodeId;
            nodes.push({
                id: peer.nodeId,
                name: peer.nodeId,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                symbolSize: 48,
                itemStyle: {
                    color: c[tone],
                    borderColor: isSelected ? c.text : c.surface,
                    borderWidth: isSelected ? 3 : 2
                },
                label: {
                    show: true, position: labelPosition(angle), color: c.text, fontWeight: isSelected ? 700 : 500,
                    formatter: peer.brokerType ? `{b}\n{type|${BROKER_SHORT[peer.brokerType] || peer.brokerType}}` : '{b}',
                    rich: { type: { color: c.muted, fontSize: 11, fontWeight: 400 } }
                }
            });
            const curve = peer.pull && peer.serve ? 0.18 : 0;
            if (peer.pull) links.push(this.link(peer.nodeId, LOCAL_ID, peer, 'pull', peer.pullState, curve, c));
            if (peer.serve) links.push(this.link(LOCAL_ID, peer.nodeId, peer, 'serve', peer.serveState, curve, c));
        });

        this.chart.setOption({
            animation: false,
            tooltip: {
                trigger: 'item',
                formatter: params => this.tooltip(params)
            },
            series: [{
                type: 'graph',
                layout: 'none',
                // Room for the two-line labels outside the ring.
                top: 56,
                bottom: 40,
                left: 90,
                right: 90,
                roam: true,
                draggable: false,
                edgeSymbol: ['none', 'arrow'],
                edgeSymbolSize: [0, 11],
                data: nodes,
                links,
                emphasis: { focus: 'adjacency' },
                edgeLabel: { show: true, fontSize: 11, color: c.muted, formatter: params => params.data.caption }
            }]
        }, true);
    }

    link(source, target, peer, kind, state, curve, c) {
        const tone = linkTone(state);
        const active = state === 'STREAMING' || state === 'CONNECTED';
        let caption = kind === 'pull' ? 'pull' : 'serve';
        if (active) {
            const lag = kind === 'pull' ? peer.source?.lagRecords : peer.consumer?.lag;
            if (Number(lag) > 0) caption += ` · lag ${num(lag)}`;
        } else {
            caption += ` · ${SHORT_STATE[state] || stateText(state).toLowerCase()}`;
        }
        return {
            source,
            target,
            peer: peer.nodeId,
            kind,
            state,
            caption,
            lineStyle: {
                color: c[tone],
                width: active ? 2.5 : 1.5,
                type: active ? 'solid' : 'dashed',
                curveness: curve,
                opacity: 0.9
            }
        };
    }

    tooltip(params) {
        if (params.dataType === 'edge') {
            const d = params.data;
            const from = d.source === LOCAL_ID ? this.info.nodeId : d.source;
            const to = d.target === LOCAL_ID ? this.info.nodeId : d.target;
            return `${escapeHtml(from)} &rarr; ${escapeHtml(to)}<br>${d.kind === 'pull' ? 'Pull' : 'Serve'} link: ${escapeHtml(stateText(d.state))}`;
        }
        if (params.data.id === LOCAL_ID) {
            const own = brokerText(this.info.brokerType, this.info.brokerVersion);
            return `${escapeHtml(this.info.nodeId)} (this node)${own ? '<br>' + escapeHtml(own) : ''}`;
        }
        const peer = this.peer(params.data.id);
        if (!peer) return '';
        const broker = brokerText(peer.brokerType, peer.brokerVersion);
        return `${escapeHtml(peer.nodeId)}<br>${direction(peer).label}${broker ? '<br>' + escapeHtml(broker) : ''}`;
    }

    // ===================== Table =====================

    renderTable() {
        const tbody = document.getElementById('peers-table-body');
        const peers = this.info.peers;
        if (peers.length === 0) {
            tbody.innerHTML = ui.emptyRow(10, 'No peers configured', 'Add entries to PeerLink.Peers in the broker configuration.');
            return;
        }
        tbody.innerHTML = peers.map(peer => {
            const dir = direction(peer);
            return `
                <tr data-peer="${escapeHtml(peer.nodeId)}" class="${this.selected === peer.nodeId ? 'is-selected' : ''}">
                    <td><strong>${escapeHtml(peer.nodeId)}</strong></td>
                    <td>${escapeHtml(brokerText(peer.brokerType, peer.brokerVersion) ?? '–')}</td>
                    <td>${protocolBadge(peer.protocolVersion, this.info.protocolVersion)}</td>
                    <td><span class="peerlink-direction"><ix-icon name="${dir.icon}" size="12"></ix-icon> ${dir.label}</span></td>
                    <td>${peer.address ? escapeHtml(peer.address) : (peer.remote ? escapeHtml(peer.remote) + ' <span class="peerlink-muted">(inbound)</span>' : '–')}</td>
                    <td>${peer.pull ? badge(peer.pullState) : '–'}</td>
                    <td>${peer.serve ? badge(peer.serveState) : '–'}</td>
                    <td class="num">${peer.pull ? num(peer.source?.lagRecords) : '–'}</td>
                    <td class="num">${peer.serve ? num(peer.consumer?.lag) : '–'}</td>
                    <td>${peer.lastError && peer.pullState !== 'STREAMING' ? escapeHtml(peer.lastError) : ''}</td>
                </tr>`;
        }).join('');
        tbody.querySelectorAll('tr[data-peer]').forEach(row => {
            row.addEventListener('click', () => this.select(row.dataset.peer));
        });
    }

    // ===================== Details =====================

    peer(id) {
        return this.info.peers.find(p => p.nodeId === id) || null;
    }

    select(id) {
        if (!id) return;
        this.selected = id;
        this.renderGraph();
        this.renderTable();
        this.renderDetails();
    }

    items(rows) {
        return '<div class="info-grid">' + rows.filter(Boolean).map(([label, value]) =>
            `<div class="info-item"><div class="info-label">${escapeHtml(label)}</div><div class="info-value">${value}</div></div>`
        ).join('') + '</div>';
    }

    group(title, icon, body) {
        return `<div class="peerlink-detail-group"><h3 class="peerlink-detail-heading"><ix-icon name="${icon}" size="12"></ix-icon> ${escapeHtml(title)}</h3>${body}</div>`;
    }

    raw(doc) {
        return `<details><summary class="peerlink-raw-toggle">Raw status</summary><pre class="peerlink-raw">${escapeHtml(JSON.stringify(doc, null, 2))}</pre></details>`;
    }

    renderDetails() {
        const title = document.getElementById('detail-title');
        const badgeEl = document.getElementById('detail-badge');
        const content = document.getElementById('detail-content');
        const openRaw = content.querySelector('details')?.open;

        if (this.selected === LOCAL_ID) {
            const info = this.info;
            const st = info.status || {};
            const log = st.log || {};
            title.textContent = info.nodeId;
            badgeEl.innerHTML = ui.statusBadge('This node', 'info');
            content.innerHTML =
                this.group('Node', 'project-server', this.items([
                    ['NodeId', escapeHtml(info.nodeId)],
                    ['Broker', escapeHtml(brokerText(info.brokerType, info.brokerVersion) ?? '–')],
                    ['PeerLink protocol', escapeHtml(info.protocolVersion ?? '–')],
                    ['Listener', info.listen ? escapeHtml(info.listen) : 'Pull only'],
                    ['TLS', info.tls ? 'Yes' : 'No'],
                    ['Peers', num(info.peers.length)]
                ])) +
                this.group('Log', 'list', this.items([
                    ['Records', num(log.records)],
                    ['Size', `${bytes(log.bytes)} / ${bytes(log.maxBytes)}`],
                    ['Appended', num(sumValues(log.appended))],
                    ['Evicted unread', num(log.evictedUnread)],
                    ['Capture', log.active ? 'Active' : 'Inactive'],
                    ['Interest routing', st.interest ? 'On' : 'Off']
                ])) +
                this.raw(st);
            if (openRaw) content.querySelector('details').open = true;
            return;
        }

        const peer = this.peer(this.selected);
        if (!peer) return;
        const dir = direction(peer);
        title.textContent = peer.nodeId;
        badgeEl.innerHTML = ui.statusBadge(dir.label, peerTone(peer));

        let html = this.group('Configuration', 'cogwheel', this.items([
            ['Direction', `<span class="peerlink-direction"><ix-icon name="${dir.icon}" size="12"></ix-icon> ${dir.label}</span>`],
            ['Address', peer.address ? escapeHtml(peer.address) : '–'],
            ['Interest routing', escapeHtml(peer.interest)],
            peer.remote ? ['Inbound from', escapeHtml(peer.remote)] : null
        ]));

        html += this.group('Broker', 'project-server', peer.protocolVersion ? this.items([
            ['Type', escapeHtml(BROKER_TYPES[peer.brokerType] || peer.brokerType || 'Not announced')],
            ['Version', escapeHtml(peer.brokerVersion || 'Not announced')],
            ['PeerLink protocol', protocolBadge(peer.protocolVersion, this.info.protocolVersion)]
        ]) : '<p class="peerlink-muted">Known after the first handshake with this peer.</p>');

        if (peer.pull) {
            const s = peer.source || {};
            const delay = s.applyDelayMs || {};
            html += this.group(`Pull link · ${peer.nodeId} → ${this.info.nodeId}`, 'import', this.items([
                ['State', badge(peer.pullState)],
                ['Lag', `${num(s.lagRecords)} records`],
                ['Injected', num(s.injected)],
                ['Applied', bytes(s.appliedBytes)],
                ['RTT', s.rttMs !== undefined ? `${Number(s.rttMs).toFixed(1)} ms` : '–'],
                ['Apply delay p50 / p99', delay.p50 !== undefined && delay.p50 >= 0 ? `${delay.p50} / ${delay.p99} ms` : '–'],
                ['Reconnects', num(s.reconnects)],
                ['Lost (gaps)', num(s.gapLostTotal)],
                ['Dropped', num(sumValues(s.dropped))],
                peer.lastError && peer.pullState !== 'STREAMING' ? ['Last error', escapeHtml(peer.lastError)] : null
            ]));
        }
        if (peer.serve) {
            const s = peer.consumer || {};
            html += this.group(`Serve link · ${this.info.nodeId} → ${peer.nodeId}`, 'export', this.items([
                ['State', badge(peer.serveState)],
                ['Lag', `${num(s.lag)} records`],
                ['Served', num(s.servedRecords)],
                ['Served bytes', bytes(s.servedBytes)],
                ['Sessions', num(s.sessions)],
                ['Lost', num(s.lostTotal)],
                s.lastFetch ? ['Last fetch', escapeHtml(s.lastFetch)] : null
            ]));
        }
        html += this.raw({ source: peer.source, consumer: peer.consumer });
        content.innerHTML = html;
        if (openRaw) content.querySelector('details').open = true;
    }
}

let peerLinkOverview;

document.addEventListener('DOMContentLoaded', () => {
    peerLinkOverview = new PeerLinkOverview();
});

page.expose({
    get peerLinkOverview() { return peerLinkOverview; }
});
page.ready();
return () => page.dispose();
}
