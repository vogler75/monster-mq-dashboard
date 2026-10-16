// Mounted by the SPA router; resources and handler bindings belong to this visit.
import * as M from './uns-model.js';
import { WinCCOaBrowserView, DRAG_TYPE } from './winccoa-browser-view.js';
import { OnboardingView } from './uns-onboarding.js';

export function mount(page) {
const { window, document, ui, setInterval, setTimeout, clearTimeout, WebSocket } = page;
// UNS Modeler device: configuration (A1), UNS editor (A2), live monitor (A3).

const NODE_DRAG = 'application/x-uns-node';
const esc = s => ui.escapeHtml(s == null ? '' : String(s));

const DEVICE_QUERY = `
    query GetUnsModeler($name: String!) {
        unsModelers(name: $name) {
            name namespace nodeId enabled isOnCurrentNode createdAt updatedAt
            config { direction approvalMode systemPrompt aiMaxSteps aiTimeoutSec aiTokenBudget redundancy
                     unsRoot allowWrite topicDefaults payloadDefaults oaPrefix flowEnabled }
            status { running active topics dpes published writes errors lastApplied applyError }
            draft applied
        }
    }
`;

class UnsModelerDetail {
    constructor() {
        this.gql = new GraphQLDashboardClient();
        const params = new URLSearchParams(window.location.search);
        this.name = params.get('name');
        this.isNew = params.get('new') === 'true' || !this.name;
        this.device = null;
        this.doc = null;
        this.savedText = '';
        this.applied = null;
        this.issues = [];
        this.issueMap = new Map();
        this.selectedId = null;
        this.collapsed = new Set();
        this.expandedDerived = new Set();
        this.matches = new Map();
        this.structures = new Map();
        this.liveLast = new Map();
        this.validateTimer = null;
        this.init();
    }

    // Setup --------------------------------------------------------------

    async init() {
        this.bindStatic();
        // A new device shows its direction fields at once, not after the node and feature queries.
        if (this.isNew) this.showNew();
        await Promise.all([this.loadNodes(), this.loadGenAi()]);
        if (this.isNew) return;
        await this.load();
        setInterval(() => this.refreshStatus(), 5000);
    }

    bindStatic() {
        document.getElementById('dev-direction').addEventListener('change', () => this.showDirection());
        document.getElementById('add-root-btn').addEventListener('click', () => this.addNodePrompt(null));
        document.getElementById('save-draft-btn').addEventListener('click', () => this.saveDraft());
        document.getElementById('discard-btn').addEventListener('click', () => this.discard());
        document.getElementById('apply-btn').addEventListener('click', () => this.apply());
        document.getElementById('raw-apply-btn').addEventListener('click', () => this.loadRaw());
        document.getElementById('ai-btn').addEventListener('click', () => this.aiPropose());
        document.querySelectorAll('.um-tab[data-tab]').forEach(t => t.addEventListener('click', () => this.showTab(t.dataset.tab)));
        const rootDrop = document.getElementById('root-drop');
        this.makeDropTarget(rootDrop, null);
    }

    async loadNodes() {
        try {
            const r = await this.gql.query('query { brokers { nodeId isCurrent } }');
            const sel = document.getElementById('dev-node');
            sel.innerHTML = (r.brokers || []).map(b => `<option value="${esc(b.nodeId)}"${b.isCurrent ? ' selected' : ''}>${esc(b.nodeId)}${b.isCurrent ? ' (current)' : ''}</option>`).join('');
        } catch (e) { /* node list is optional */ }
    }

    // AI runs use the broker's GenAI assistant provider.
    async loadGenAi() {
        try {
            const features = await this.gql.getEnabledFeatures();
            this.genAi = features.includes('GenAi');
        } catch (e) { this.genAi = false; }
    }

    showNew() {
        document.getElementById('page-title').textContent = 'Add UNS Modeler';
        document.getElementById('page-subtitle').textContent = 'Choose the direction; it cannot be changed later.';
        document.getElementById('delete-btn').style.display = 'none';
        document.getElementById('dev-maxsteps').value = 30;
        document.getElementById('dev-timeout').value = 600;
        document.getElementById('dev-tokens').value = 500000;
        document.getElementById('dev-oaprefix').value = 'UNS_';
        const params = new URLSearchParams(window.location.search);
        if (params.get('direction')) document.getElementById('dev-direction').value = params.get('direction');
        this.showDirection();
        this.renderDefaults();
        this.renderPayloadPreview();
    }

    async load() {
        ui.setLoading(true);
        ui.clearError();
        try {
            const r = await this.gql.query(DEVICE_QUERY, { name: this.name });
            const dev = r.unsModelers && r.unsModelers[0];
            if (!dev) throw new Error(`UNS Modeler “${this.name}” not found`);
            this.device = dev;
            this.fillForm();
            if (dev.config.direction === 'WINCCOA_TO_UNS') {
                await this.initEditor(dev);
            } else if (!this.onboarding) {
                this.onboarding = new OnboardingView({
                    document, window, ui, esc, setTimeout, clearTimeout, WebSocket, gql: this.gql, name: this.name,
                    prompt: (t, l, v, o) => this.prompt(t, l, v, o), genAi: this.genAi, sevTag: s => this.sevTag(s), renderAiInto: (el, run) => this.renderAiInto(el, run)
                });
                await this.onboarding.init(dev);
                this.loadAiRuns();
            }
            document.getElementById('live-section').style.display = '';
            this.liveColumns(dev.config.direction);
            this.refreshLive();
        } catch (e) {
            ui.showError(e.message);
        } finally {
            ui.setLoading(false);
        }
    }

    fillForm() {
        const d = this.device, c = d.config;
        document.getElementById('page-title').textContent = d.name;
        document.getElementById('page-subtitle').textContent = c.direction === 'WINCCOA_TO_UNS'
            ? `WinCC OA → UNS below ${c.unsRoot || ''}` : `MQTT → WinCC OA with prefix ${c.oaPrefix || ''}`;
        document.getElementById('breadcrumb-name').textContent = d.name;
        const set = (id, v) => { document.getElementById(id).value = v == null ? '' : v; };
        set('dev-name', d.name);
        document.getElementById('dev-name').disabled = true;
        set('dev-direction', c.direction);
        document.getElementById('dev-direction').disabled = true;
        set('dev-node', d.nodeId);
        document.getElementById('dev-enabled').checked = d.enabled;
        set('dev-unsroot', c.unsRoot);
        document.getElementById('dev-allowwrite').checked = c.allowWrite;
        set('dev-oaprefix', c.oaPrefix);
        document.getElementById('dev-flow').checked = c.flowEnabled;
        set('dev-approval', c.approvalMode);
        set('dev-redundancy', c.redundancy);
        set('dev-maxsteps', c.aiMaxSteps);
        set('dev-timeout', c.aiTimeoutSec);
        set('dev-tokens', c.aiTokenBudget);
        set('dev-topicdefaults', c.topicDefaults || '');
        set('dev-payloaddefaults', c.payloadDefaults || '');
        set('dev-prompt', c.systemPrompt || '');
        this.showDirection();
        this.renderStatus();
        this.renderDefaults();
        this.renderPayloadPreview();
    }

    direction() { return document.getElementById('dev-direction').value; }

    showDirection() {
        const dir = this.direction();
        document.querySelectorAll('.um-direction-only').forEach(el => el.classList.toggle('um-shown', el.dataset.direction === dir));
    }

    formConfig() {
        const v = id => document.getElementById(id).value;
        const num = id => { const n = parseInt(v(id), 10); return Number.isFinite(n) ? n : null; };
        const cfg = {
            direction: v('dev-direction'),
            approvalMode: v('dev-approval'),
            systemPrompt: v('dev-prompt'),
            redundancy: v('dev-redundancy'),
            aiMaxSteps: num('dev-maxsteps'), aiTimeoutSec: num('dev-timeout'), aiTokenBudget: num('dev-tokens')
        };
        if (cfg.direction === 'WINCCOA_TO_UNS') {
            cfg.unsRoot = v('dev-unsroot').trim();
            cfg.allowWrite = document.getElementById('dev-allowwrite').checked;
            cfg.topicDefaults = v('dev-topicdefaults').trim();
            cfg.payloadDefaults = v('dev-payloaddefaults').trim();
        } else {
            cfg.oaPrefix = v('dev-oaprefix').trim();
            cfg.flowEnabled = document.getElementById('dev-flow').checked;
        }
        for (const k of Object.keys(cfg)) if (cfg[k] === null) delete cfg[k];
        return cfg;
    }

    // Device topic and payload defaults: controls that write the JSON settings
    // into the hidden dev-topicdefaults / dev-payloaddefaults inputs.
    renderDefaults() {
        const tdInput = document.getElementById('dev-topicdefaults');
        const pdInput = document.getElementById('dev-payloaddefaults');
        const td = M.parseJSONSetting(tdInput.value) || {};
        const pd = M.parseJSONSetting(pdInput.value);
        const payload = Array.isArray(pd) ? pd : M.BUILTIN_SEMANTICS.payload.slice();
        const B = M.BUILTIN_SEMANTICS;
        // Device defaults are the last level before the built-in values: the lists
        // show the effective value, and only values that differ from it are stored.
        const opt = (v, cur, label) => `<option value="${v}"${String(cur) === v ? ' selected' : ''}>${label || v}</option>`;
        const eff = k => td[k] ?? B[k];
        const usesParam = ['deadband', 'minInterval', 'cyclic'].includes(td.publishMode);
        const field = (label, control) => `<div class="form-group"><label>${label}</label>${control}</div>`;
        document.getElementById('topic-defaults').innerHTML = `<div class="um-defaults">
            ${field('Retain', `<select class="form-control" data-d="retain">${opt('false', eff('retain'))}${opt('true', eff('retain'))}</select>`)}
            ${field('QoS', `<select class="form-control" data-d="qos">${opt('0', eff('qos'))}${opt('1', eff('qos'))}${opt('2', eff('qos'))}</select>`)}
            ${field('Publish Mode', `<select class="form-control" data-d="publishMode">${['onChange', 'deadband', 'minInterval', 'cyclic'].map(m => opt(m, eff('publishMode'))).join('')}</select>`)}
            ${field(td.publishMode === 'deadband' ? 'Deadband' : 'Interval (ms)', `<input class="form-control" type="number" data-d="param" value="${esc(td.publishMode === 'deadband' ? (td.deadband ?? '') : (td.intervalMs ?? ''))}" ${usesParam ? '' : 'disabled placeholder="—"'}>`)}
            ${field('Timestamp', `<select class="form-control" data-d="timestamp">${opt('source', eff('timestamp'), 'source time')}${opt('publish', eff('timestamp'), 'publish time')}</select>`)}
            ${field('Encoding', `<select class="form-control" data-d="encoding">${opt('json', eff('encoding'), 'json fields')}${opt('raw', eff('encoding'), 'raw value')}</select>`)}
        </div>`;
        const attrs = payload.filter(f => typeof f === 'object' && f);
        const raw = (td.encoding || B.encoding) === 'raw';
        document.getElementById('payload-defaults').innerHTML = `
            <div class="um-fields">${M.PAYLOAD_FIELDS.map(f => `<div class="checkbox-group"><input type="checkbox" id="pd-${f}" data-f="${f}"${payload.includes(f) ? ' checked' : ''}${f === 'value' || raw ? ' disabled' : ''}><label for="pd-${f}">${f}</label></div>`).join('')}</div>
            ${attrs.map((a, i) => `<div class="um-attr"><input class="form-control" data-a="name" data-i="${i}" value="${esc(a.name)}" placeholder="Payload key" ${raw ? 'disabled' : ''}>
                <input class="form-control" data-a="attribute" data-i="${i}" value="${esc(a.attribute)}" placeholder="_alert_hdl.2._u_limit" ${raw ? 'disabled' : ''}>
                <button type="button" class="btn btn-secondary btn-sm" data-a="remove" data-i="${i}" title="Remove attribute">✕</button></div>`).join('')}
            <button type="button" class="btn btn-secondary btn-sm" data-a="add" style="margin-top:0.35rem;" ${raw ? 'disabled' : ''}>+ Config attribute</button>
            ${raw ? '<div class="um-small">Encoding raw publishes the value only.</div>' : ''}`;

        const store = (input, v, empty) => { input.value = empty ? '' : JSON.stringify(v); this.renderDefaults(); this.renderPayloadPreview(); };
        document.querySelectorAll('#topic-defaults [data-d]').forEach(inp => inp.addEventListener('change', () => {
            const cur = { ...td }, v = inp.value, k = inp.dataset.d;
            switch (k) {
                case 'retain': case 'qos': case 'timestamp': case 'encoding': {
                    const val = k === 'retain' ? v === 'true' : k === 'qos' ? Number(v) : v;
                    if (val === B[k]) delete cur[k]; else cur[k] = val;
                    break;
                }
                case 'publishMode':
                    delete cur.deadband; delete cur.intervalMs;
                    if (v === B.publishMode) delete cur.publishMode;
                    else {
                        cur.publishMode = v;
                        if (v === 'deadband') cur.deadband = 1;
                        if (v === 'minInterval' || v === 'cyclic') cur.intervalMs = 1000;
                    }
                    break;
                case 'param':
                    if (cur.publishMode === 'deadband') cur.deadband = Number(v);
                    else cur.intervalMs = Number(v);
                    break;
            }
            store(tdInput, cur, !Object.keys(cur).length);
        }));
        // The built-in field list is stored as no setting.
        const storePayload = list => store(pdInput, list, JSON.stringify(list) === JSON.stringify(B.payload));
        document.querySelectorAll('#payload-defaults [data-f]').forEach(cb => cb.addEventListener('change', () => {
            const f = cb.dataset.f;
            storePayload(cb.checked ? [...payload, f] : payload.filter(x => x !== f));
        }));
        document.querySelectorAll('#payload-defaults [data-a]').forEach(el => el.addEventListener(el.tagName === 'BUTTON' ? 'click' : 'change', () => {
            const i = Number(el.dataset.i);
            const list = payload.slice();
            const at = list.indexOf(attrs[i]);
            if (el.dataset.a === 'add') list.push({ name: `attr${attrs.length + 1}`, attribute: '' });
            else if (el.dataset.a === 'remove') list.splice(at, 1);
            else list[at] = { ...attrs[i], [el.dataset.a]: el.value.trim() };
            storePayload(list);
        }));
    }

    configForSemantics() {
        return { topicDefaults: document.getElementById('dev-topicdefaults').value, payloadDefaults: document.getElementById('dev-payloaddefaults').value };
    }

    renderPayloadPreview() {
        const el = document.getElementById('payload-preview');
        if (!el) return;
        const sem = M.deviceSemantics(this.configForSemantics());
        el.textContent = M.payloadPreview(sem, { value: 42.7, unit: 'm³/h', description: 'Outlet flow', format: '%.1f', pvRange: { min: 0, max: 200 }, status: 257, stime: new Date().toISOString() });
    }

    renderStatus() {
        const st = (this.device && this.device.status) || {};
        const badge = document.getElementById('device-status');
        if (!this.device) return;
        const label = !this.device.enabled ? 'Disabled' : st.running ? (st.active ? 'Running' : 'Standby') : 'Idle';
        badge.className = 'status-badge ' + (!this.device.enabled ? 'status-disabled' : st.running ? (st.active ? 'status-enabled' : 'status-pending') : 'status-unknown');
        badge.textContent = label + (st.running ? ` · ${st.topics} topics · ${st.errors} errors` : '');
        const ws = document.getElementById('write-state');
        if (ws) {
            ws.textContent = this.device.config.allowWrite ? 'Write-through on' : 'Write-through off';
            ws.className = 'status-badge ' + (this.device.config.allowWrite ? 'badge-warn' : 'badge-neutral');
        }
    }

    async saveDevice() {
        const name = document.getElementById('dev-name').value.trim();
        if (!name) { ui.error('Name is required'); return; }
        const config = this.formConfig();
        if (config.direction === 'WINCCOA_TO_UNS' && !config.unsRoot) {
            ui.error('UNS Root is required for Direction A, e.g. acme/vienna/hall2');
            document.getElementById('dev-unsroot').focus();
            return;
        }
        if (config.direction === 'MQTT_TO_WINCCOA' && !config.oaPrefix) {
            ui.error('WinCC OA Prefix is required for Direction B');
            document.getElementById('dev-oaprefix').focus();
            return;
        }
        const input = {
            name, nodeId: document.getElementById('dev-node').value || null,
            enabled: document.getElementById('dev-enabled').checked, config
        };
        const fields = 'success errors issues { severity path message }';
        try {
            const r = this.isNew
                ? await this.gql.query(`mutation($input: UnsModelerDeviceInput!) { unsModeler { create(input: $input) { ${fields} } } }`, { input })
                : await this.gql.query(`mutation($name: String!, $input: UnsModelerDeviceInput!) { unsModeler { update(name: $name, input: $input) { ${fields} } } }`, { name, input });
            const res = this.isNew ? r.unsModeler.create : r.unsModeler.update;
            this.renderSettingsIssues(res.issues);
            if (!res.success) { ui.error((res.errors || []).join(', ') || 'Save failed'); return; }
            ui.markPageSaved();
            if (this.isNew) {
                ui.success(`UNS Modeler “${name}” created`);
                const keep = new URLSearchParams(window.location.search);
                const extra = keep.get('topics') ? `&topics=${encodeURIComponent(keep.get('topics'))}&mode=${encodeURIComponent(keep.get('mode') || 'live')}` : '';
                setTimeout(() => { window.spaLocation.href = `/pages/uns-modeler-detail.html?name=${encodeURIComponent(name)}${extra}`; }, 800);
            } else {
                ui.success('Device saved');
                await this.load();
            }
        } catch (e) {
            ui.error('Save failed: ' + e.message);
        }
    }

    renderSettingsIssues(issues) {
        const el = document.getElementById('settings-issues');
        el.innerHTML = (issues || []).map(i => `<div class="um-issue">${this.sevTag(i.severity)}<code>${esc(i.path)}</code><span>${esc(i.message)}</span></div>`).join('');
    }

    async deleteDevice() {
        if (!this.name) return;
        const ok = await ui.confirmDelete(this.name, { title: 'Delete UNS Modeler', message: `Delete the UNS Modeler “${this.name}” with its draft and applied mapping? Created WinCC OA objects are not removed.` });
        if (!ok) return;
        try {
            await this.gql.query('mutation($n: String!) { unsModeler { delete(name: $n) } }', { n: this.name });
            ui.success('UNS Modeler deleted');
            window.spaLocation.href = '/pages/uns-modelers.html';
        } catch (e) {
            ui.error('Delete failed: ' + e.message);
        }
    }

    // Editor -------------------------------------------------------------

    async initEditor(dev) {
        document.getElementById('editor-section').style.display = '';
        document.getElementById('tree-title').textContent = dev.config.unsRoot || 'UNS';
        const parsed = M.parseDocument(dev.draft || dev.applied || '', M.DIRECTION_A);
        if (parsed.error) {
            ui.showError('The stored draft is not valid JSON: ' + parsed.error);
            this.doc = M.emptyDocument();
        } else {
            this.doc = M.ensureIds(parsed.doc);
        }
        this.savedText = dev.draft || '';
        const ap = M.parseDocument(dev.applied || '', M.DIRECTION_A);
        this.applied = dev.applied && !ap.error ? ap.doc : null;
        if (!this.browser) {
            this.browser = new WinCCOaBrowserView(document.getElementById('oa-browser'), {
                document, gql: this.gql, setTimeout, clearTimeout,
                onDetails: info => this.showElementDetails(info)
            });
            this.browser.init();
        }
        this.renderTree();
        this.renderDetails();
        this.validateSoon(0);
        document.getElementById('ai-btn').style.display = this.genAi ? '' : 'none';
        this.pollAi(true);
        this.loadAiRuns();
    }

    // AI assist (M4) ----------------------------------------------------

    async aiPropose() {
        const items = this.browser ? this.browser.selection() : [];
        if (!items.length) { ui.error('Select datapoint types, datapoints or elements in the WinCC OA browser first (checkboxes).'); return; }
        if (this.isDirty() && !await this.saveDraft(true)) return;
        const body = document.createElement('div');
        body.innerHTML = `<p class="form-hint">${items.length} selected item(s) are the scope of the analysis. The AI proposes a complete document; it opens here as the draft.</p>
            <div class="form-group"><label for="ai-prompt">Prompt</label><textarea id="ai-prompt" class="form-control" rows="5" placeholder="Describe the plant structure, e.g. following ISA-95 …"></textarea></div>
            <div class="form-group"><label for="ai-doc">Context document (text, Markdown, PDF, DOCX)</label><input type="file" id="ai-doc" class="form-control" accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></div>
            <div class="checkbox-group"><input type="checkbox" id="ai-beyond"><label for="ai-beyond">Allow browsing beyond the selection (bindings stay inside it)</label></div>`;
        const start = async close => {
            const file = body.querySelector('#ai-doc').files[0];
            const input = { prompt: body.querySelector('#ai-prompt').value, allowBeyondSelection: body.querySelector('#ai-beyond').checked,
                selection: items.map(i => ({ kind: i.kind, system: i.system || null, type: i.type, datapoint: i.datapoint || null, path: i.path ?? null, pattern: i.pattern || null })) };
            if (file) {
                if (file.size > 8 * 1024 * 1024) { ui.error('The document is larger than 8 MiB'); return; }
                const buf = new Uint8Array(await file.arrayBuffer());
                let bin = '';
                for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
                input.documentBase64 = btoa(bin);
                input.documentName = file.name;
            }
            try {
                const r = await this.gql.query('mutation($n: String!, $i: UnsModelerAiRunInput!) { unsModeler { startAiRun(name: $n, input: $i) { success errors run { id status } } } }', { n: this.name, i: input });
                const res = r.unsModeler.startAiRun;
                if (!res.success) { ui.error('AI run not started: ' + res.errors.join(', ')); return; }
                close();
                ui.success('AI run started');
                this.showTab('ai');
                this.pollAi();
            } catch (e) { ui.error('AI run not started: ' + e.message); }
        };
        ui.modal({ title: 'Propose UNS for selection', body, size: 'md', footer: [
            { label: 'Cancel', variant: 'secondary' },
            { label: 'Start AI run', variant: 'primary', onClick: close => start(close) }
        ] });
    }

    async pollAi(once) {
        clearTimeout(this.aiTimer);
        try {
            const r = await this.gql.query('query($n: String!) { unsModelers(name: $n) { aiRun { id status provider model startedAt finishedAt steps toolCalls inputTokens outputTokens error applied issues { severity path message } events { time kind name detail error } } } }', { n: this.name });
            const run = r.unsModelers[0] && r.unsModelers[0].aiRun;
            const wasRunning = this.aiRunning;
            this.aiRunning = !!run && run.status === 'RUNNING';
            this.renderAi(run);
            if (this.aiRunning) { this.aiTimer = setTimeout(() => this.pollAi(), 2000); return; }
            if (wasRunning && run) {
                if (run.status === 'SUCCEEDED') {
                    ui.success(run.applied ? 'AI proposal applied' : 'AI proposal loaded into the editor; review and apply it');
                    ui.markPageSaved();
                    await this.load();
                } else {
                    ui.error('AI run failed: ' + (run.error || 'unknown error'));
                }
                this.loadAiRuns();
            }
        } catch (e) { if (!once) this.aiTimer = setTimeout(() => this.pollAi(), 5000); }
    }

    renderAi(run) {
        const state = document.getElementById('ai-state');
        if (!run) { state.textContent = ''; return; }
        state.textContent = `(${run.status.toLowerCase()})`;
        this.renderAiInto(document.getElementById('ai-panel'), run);
    }

    renderAiInto(panel, run) {
        const head = `<dl class="um-kv"><dt>Run</dt><dd>${esc(run.id)} · ${esc(run.status)}</dd><dt>Provider</dt><dd>${esc(run.provider)} ${esc(run.model || '')}</dd>
            <dt>Started</dt><dd>${esc(run.startedAt)}${run.finishedAt ? ' → ' + esc(run.finishedAt) : ''}</dd>
            <dt>Steps / tool calls</dt><dd>${run.steps} / ${run.toolCalls}</dd><dt>Tokens</dt><dd>${run.inputTokens} in, ${run.outputTokens} out</dd>
            ${run.error ? `<dt>Error</dt><dd>${esc(run.error)}</dd>` : ''}${run.applied ? '<dt>Applied</dt><dd>yes (approval mode auto)</dd>' : ''}</dl>`;
        const rows = (run.events || []).map(e => `<tr><td>${esc((e.time || '').slice(11, 19))}</td><td>${esc(e.kind)}</td><td>${esc(e.name || '')}</td>
            <td class="detail">${esc(e.detail || '')}${e.error ? `\n<span class="um-tag err">${esc(e.error)}</span>` : ''}</td></tr>`).join('');
        panel.innerHTML = head + `<table class="um-log"><thead><tr><th>Time</th><th>Event</th><th>Tool</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    async loadAiRuns() {
        const box = document.getElementById('ai-runs');
        if (!box || !this.name) return;
        try {
            const r = await this.gql.query('query { systemLogs(logger: "UnsModeler", message: "uns ai run", limit: 500) { timestamp level message parameters } }');
            const mine = (r.systemLogs || []).filter(l => (l.parameters || []).some(p => p === `device=${this.name}` || p === `device: ${this.name}` || p.endsWith(`=${this.name}`) && p.startsWith('device')));
            if (!mine.length) { box.innerHTML = '<div class="um-empty">No AI runs in the log (the log keeps the last entries since the broker started).</div>'; return; }
            box.innerHTML = `<table class="um-log"><thead><tr><th>Time</th><th>Level</th><th>Event</th><th>Details</th></tr></thead><tbody>${mine.slice(0, 30).map(l =>
                `<tr><td>${esc(l.timestamp)}</td><td>${esc(l.level)}</td><td>${esc(l.message)}</td><td class="detail">${esc((l.parameters || []).filter(p => !p.startsWith('device')).join(' '))}</td></tr>`).join('')}</tbody></table>`;
        } catch (e) { /* log access is optional */ }
    }

    isDirty() {
        return M.serialize(this.doc) !== (this.savedText ? M.serialize(M.parseDocument(this.savedText).doc || {}) : M.serialize(M.emptyDocument()));
    }

    changed(opts = {}) {
        ui.markPageDirty();
        this.renderTree();
        if (!opts.keepDetails) this.renderDetails();
        this.validateSoon();
    }

    updateDraftState() {
        const el = document.getElementById('draft-state');
        const dirty = this.isDirty();
        el.textContent = dirty ? 'Unsaved changes' : 'Saved';
        el.className = 'status-badge ' + (dirty ? 'badge-warn' : 'badge-neutral');
        const errors = M.hasErrors(this.issues);
        const apply = document.getElementById('apply-btn');
        apply.disabled = errors;
        apply.title = errors ? 'The mapping has validation errors' : (dirty ? 'Saves the draft, then applies it' : 'Apply the draft');
    }

    validateSoon(delay = 600) {
        clearTimeout(this.validateTimer);
        this.validateTimer = setTimeout(() => this.validate(), delay);
    }

    async validate() {
        if (!this.doc) return;
        try {
            const r = await this.gql.query('query($n: String!, $d: String!) { unsModelerValidate(name: $n, document: $d) { severity path message } }', { n: this.name, d: JSON.stringify(this.doc) });
            this.issues = r.unsModelerValidate || [];
        } catch (e) {
            this.issues = [{ severity: 'ERROR', path: '', message: 'Validation failed: ' + e.message }];
        }
        this.issueMap = M.issuesByNode(this.doc, this.issues);
        this.renderIssues();
        this.renderTree();
        this.updateDraftState();
    }

    sevTag(sev) {
        const s = (sev || '').toLowerCase();
        const cls = s === 'error' ? 'err' : s === 'warning' ? 'warn' : 'info';
        return `<span class="um-tag ${cls}">${esc(s)}</span>`;
    }

    renderIssues() {
        const panel = document.getElementById('validation-panel');
        const n = { ERROR: 0, WARNING: 0, INFO: 0 };
        this.issues.forEach(i => { n[i.severity] = (n[i.severity] || 0) + 1; });
        document.getElementById('issue-count').textContent = this.issues.length ? `(${n.ERROR} errors, ${n.WARNING} warnings, ${n.INFO} info)` : '';
        if (!this.issues.length) {
            panel.innerHTML = '<div class="um-empty">No issues. The mapping can be applied.</div>';
            return;
        }
        panel.innerHTML = this.issues.map((i, k) => `<div class="um-issue" data-k="${k}">${this.sevTag(i.severity)}<code>${esc(i.path || '/')}</code><span>${esc(i.message)}</span></div>`).join('');
        panel.querySelectorAll('.um-issue').forEach(el => el.addEventListener('click', () => {
            const is = this.issues[Number(el.dataset.k)];
            for (const [id, list] of this.issueMap) if (id && list.includes(is)) { this.select(id); break; }
        }));
    }

    renderChanges(d) {
        const panel = document.getElementById('changes-panel');
        if (!this.applied) { panel.innerHTML = '<div class="um-empty">No mapping applied yet; every node is new.</div>'; return; }
        const counts = { new: 0, changed: 0 };
        for (const v of d.status.values()) counts[v]++;
        panel.innerHTML = `<div class="um-issue"><span class="um-tag new">new</span>${counts.new}<span class="um-tag changed">changed</span>${counts.changed}<span class="um-tag err">removed</span>${d.removed.length}</div>` +
            d.removed.map(n => `<div class="um-issue"><span class="um-tag err">removed</span><code>${esc(n.id)}</code><span>${esc(n.name)}</span></div>`).join('');
    }

    showTab(tab) {
        document.querySelectorAll('.um-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.um-tabpanel[data-panel]').forEach(p => { p.style.display = p.dataset.panel === tab ? '' : 'none'; });
        if (tab === 'json') document.getElementById('raw-json').value = M.serialize(this.doc);
    }

    loadRaw() {
        const parsed = M.parseDocument(document.getElementById('raw-json').value);
        if (parsed.error) { ui.error('Invalid JSON: ' + parsed.error); return; }
        if (parsed.doc.direction !== M.DIRECTION_A) { ui.error('The document must have direction winccoa_to_uns'); return; }
        this.doc = M.ensureIds(parsed.doc);
        this.changed();
        ui.success('JSON loaded into the editor');
    }

    // Tree rendering

    renderTree() {
        const tree = document.getElementById('uns-tree');
        const d = M.diff(this.doc, this.applied);
        this.renderChanges(d);
        const counts = M.countBindings(this.doc);
        document.getElementById('tree-summary').textContent = `${counts.nodes} nodes · ${counts.bindings} bindings`;
        const rows = [];
        const visit = (list, depth) => {
            for (const n of list || []) {
                rows.push(this.nodeRow(n, depth, d));
                if (!this.collapsed.has(n.id)) {
                    if (n.binding && this.expandedDerived.has(n.id)) rows.push(...this.derivedRows(n, depth + 1));
                    visit(n.children, depth + 1);
                }
            }
        };
        visit(this.doc.tree, 0);
        tree.innerHTML = rows.join('') || '<div class="um-empty">No nodes yet. Add a node, then drag datapoint types, datapoints or elements from the WinCC OA browser onto it.</div>';
        tree.querySelectorAll('.um-row[data-id]').forEach(el => this.bindNodeRow(el));
        this.updateDraftState();
    }

    bindingLabel(b) {
        const sys = b.system ? b.system + ':' : '';
        if (b.kind === 'element') return `${sys}${b.datapoint}.${b.element}`;
        const obj = b.layout === 'object' ? ', JSON object' : '';
        if (b.kind === 'datapoint') return `${sys}${b.datapoint} (${b.elements ? b.elements.length : 'all'} el.${obj})`;
        return `${sys}${b.type} ${b.pattern} (${b.elements ? b.elements.length : 'all'} el.${obj})`;
    }

    nodeRow(n, depth, d) {
        const issues = this.issueMap.get(n.id) || [];
        const errs = issues.filter(i => i.severity === 'ERROR').length;
        const warns = issues.filter(i => i.severity === 'WARNING').length;
        const others = issues.filter(i => i.severity === 'INFO' && /also published/.test(i.message));
        const hasKids = (n.children && n.children.length) || (n.binding && n.binding.kind !== 'element');
        const expanded = !this.collapsed.has(n.id);
        const st = d.status.get(n.id);
        return `<div class="um-row${this.selectedId === n.id ? ' selected' : ''}${n.aiGenerated ? ' ai' : ''}" role="treeitem" data-id="${esc(n.id)}" draggable="true" style="padding-left:${0.3 + depth * 1.1}rem">
            <span class="um-chevron${hasKids ? (expanded ? ' expanded' : '') : ' hidden'}" data-toggle="1">&#9656;</span>
            <span class="um-label">${esc(n.name)}</span>
            ${n.level ? `<span class="um-tag level">${esc(n.level)}</span>` : ''}
            ${n.binding ? `<span class="um-tag bind" title="${esc(this.bindingLabel(n.binding))}">${esc(n.binding.kind)}</span>` : ''}
            ${n.aiGenerated ? '<span class="um-tag aitag">AI</span>' : ''}
            ${st ? `<span class="um-tag ${st}">${st}</span>` : ''}
            ${others.length ? `<span class="um-tag info" title="${esc(others.map(o => o.message).join('\n'))}">shared</span>` : ''}
            ${errs ? `<span class="um-tag err" title="${esc(issues.filter(i => i.severity === 'ERROR').map(i => i.message).join('\n'))}">${errs}</span>` : ''}
            ${warns ? `<span class="um-tag warn" title="${esc(issues.filter(i => i.severity === 'WARNING').map(i => i.message).join('\n'))}">${warns}</span>` : ''}
            <span class="um-meta">${n.binding ? esc(this.bindingLabel(n.binding)) : ''}</span>
        </div>`;
    }

    // derivedRows lists the topics of a datapoint or pattern binding below
    // its node (pattern: current matches), marked as derived.
    derivedRows(n, depth) {
        const b = n.binding;
        const topic = M.nodeTopic(this.doc, n.id, '');
        const struct = this.structures.get(`${b.system || ''}|${b.type}`);
        const typeElements = struct ? struct.filter(e => e.valueElement && e.elementType !== 'unknown').map(e => e.path) : [];
        const matches = this.matches.get(n.id) || [];
        const list = M.bindingTopics(topic, b, { typeElements, matches });
        if (!list.length) return [`<div class="um-row derived" style="padding-left:${0.3 + depth * 1.1}rem">${b.kind === 'pattern' ? 'no current match' : 'loading…'}</div>`];
        const shown = list.slice(0, 200);
        const rows = shown.map(t => `<div class="um-row derived" style="padding-left:${0.3 + depth * 1.1}rem" title="${esc(t.dpe)}">
            <span class="um-chevron hidden"></span><span class="um-label">${esc(t.topic.replace(topic + '/', '') || '(node)')}</span>
            <span class="um-tag">${t.object ? 'JSON object' : b.kind === 'pattern' ? 'from pattern' : 'element'}</span><span class="um-meta">${esc(t.object ? `${t.dpe} (${t.paths.length} el.)` : t.dpe)}</span></div>`);
        if (list.length > shown.length) rows.push(`<div class="um-row derived" style="padding-left:${0.3 + depth * 1.1}rem">… ${list.length - shown.length} more</div>`);
        return rows;
    }

    async loadDerived(n) {
        const b = n.binding;
        if (!b) return;
        const key = `${b.system || ''}|${b.type}`;
        try {
            if (!this.structures.has(key)) {
                const r = await this.gql.query('query($s: String, $t: String!) { winccoa { typeStructure(system: $s, type: $t) { elements { path valueElement elementType } } } }', { s: b.system || null, t: b.type });
                this.structures.set(key, r.winccoa.typeStructure.elements);
            }
            if (b.kind === 'pattern') {
                const r = await this.gql.query('query($s: String, $p: String, $t: String) { winccoa { datapoints(system: $s, pattern: $p, type: $t, limit: 1000) { items { name } } } }', { s: b.system || null, p: b.pattern, t: b.type });
                this.matches.set(n.id, r.winccoa.datapoints.items.map(i => i.name));
            }
        } catch (e) {
            this.matches.set(n.id, []);
        }
        this.renderTree();
    }

    bindNodeRow(el) {
        const id = el.dataset.id;
        el.addEventListener('click', () => this.select(id));
        el.addEventListener('dblclick', () => this.renamePrompt(id));
        el.querySelector('[data-toggle]').addEventListener('click', e => {
            e.stopPropagation();
            const f = M.findNode(this.doc, id);
            if (!f) return;
            const derivedOpen = this.expandedDerived.has(id);
            if (this.collapsed.has(id)) {
                this.collapsed.delete(id);
                if (f.node.binding && f.node.binding.kind !== 'element') { this.expandedDerived.add(id); this.loadDerived(f.node); }
            } else if (f.node.binding && f.node.binding.kind !== 'element' && !derivedOpen) {
                this.expandedDerived.add(id);
                this.loadDerived(f.node);
            } else {
                this.collapsed.add(id);
                this.expandedDerived.delete(id);
            }
            this.renderTree();
        });
        el.addEventListener('dragstart', e => {
            e.dataTransfer.setData(NODE_DRAG, id);
            e.dataTransfer.effectAllowed = 'move';
        });
        this.makeDropTarget(el, id);
    }

    makeDropTarget(el, id) {
        el.addEventListener('dragover', e => {
            const types = e.dataTransfer.types;
            if (types.includes(DRAG_TYPE) || types.includes(NODE_DRAG)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = types.includes(NODE_DRAG) ? 'move' : 'copy';
                el.classList.add('drop-target');
            }
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', e => {
            e.preventDefault();
            el.classList.remove('drop-target');
            const nodeId = e.dataTransfer.getData(NODE_DRAG);
            if (nodeId) {
                if (nodeId === id) return;
                try {
                    M.moveNode(this.doc, nodeId, id);
                    this.changed({ keepDetails: true });
                } catch (err) { ui.error(err.message); }
                return;
            }
            const raw = e.dataTransfer.getData(DRAG_TYPE);
            if (raw) this.dropItems(id, JSON.parse(raw));
        });
    }

    async dropItems(nodeId, items) {
        const types = items.filter(i => i.kind === 'type');
        for (const t of types) {
            const opts = await this.askPattern(t);
            if (!opts) return;
            t.pattern = opts.pattern;
            t.elements = opts.elements;
        }
        try {
            const bound = M.dropOnNode(this.doc, nodeId, items);
            if (nodeId) this.collapsed.delete(nodeId);
            this.changed();
            if (bound.length === 1) this.select(bound[0].id);
            ui.success(`${bound.length} binding${bound.length === 1 ? '' : 's'} added`);
        } catch (err) {
            ui.error(err.message);
        }
    }

    // askPattern asks for the name pattern and the elements of a dropped type.
    async askPattern(item) {
        let structure = [];
        try {
            const r = await this.gql.query('query($s: String, $t: String!) { winccoa { typeStructure(system: $s, type: $t) { elements { path elementType valueElement } } } }', { s: item.system || null, t: item.type });
            structure = r.winccoa.typeStructure.elements.filter(e => e.valueElement);
        } catch (e) { /* elements stay "all" */ }
        return new Promise(resolve => {
            const body = document.createElement('div');
            body.innerHTML = `<div class="form-group"><label for="pat-input">Datapoint name pattern</label>
                <input id="pat-input" class="form-control" value="${esc(item.pattern || '*')}">
                <span class="form-hint">dpNames syntax: * and ? wildcards, {a,b} alternatives. Datapoints created later that match are published too.</span></div>
                <div class="form-group"><label>Elements (none checked: all value elements)</label>
                <div style="max-height:240px;overflow:auto;">${structure.map(e => `<div class="checkbox-group"><input type="checkbox" id="pe-${esc(e.path)}" value="${esc(e.path)}"><label for="pe-${esc(e.path)}">${esc(e.path || '(root)')} <span class="um-meta">${esc(e.elementType)}</span></label></div>`).join('')}</div></div>`;
            let done = false;
            const finish = (v, close) => { if (done) return; done = true; if (close) close(); resolve(v); };
            ui.modal({
                title: `Bind datapoint type ${item.type}`, body, size: 'md',
                onClose: () => finish(null),
                footer: [
                    { label: 'Cancel', variant: 'secondary', onClick: close => finish(null, close) },
                    { label: 'Add pattern binding', variant: 'primary', onClick: close => finish({
                        pattern: body.querySelector('#pat-input').value.trim() || '*',
                        elements: [...body.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value)
                    }, close) }
                ]
            });
        });
    }

    select(id) {
        this.selectedId = id;
        this.renderTree();
        this.renderDetails();
    }

    async addNodePrompt(parentId) {
        const name = await this.prompt('Add node', 'Node name (one topic level)', '');
        if (name == null) return;
        if (!M.validSegment(name)) { ui.error('Not a valid topic level'); return; }
        try {
            const n = M.addNode(this.doc, parentId, name);
            if (parentId) this.collapsed.delete(parentId);
            this.selectedId = n.id;
            this.changed();
        } catch (e) { ui.error(e.message); }
    }

    async renamePrompt(id) {
        const f = M.findNode(this.doc, id);
        if (!f) return;
        const name = await this.prompt('Rename node', 'Node name (one topic level)', f.node.name);
        if (name == null || name === f.node.name) return;
        if (!M.validSegment(name)) { ui.error('Not a valid topic level'); return; }
        try { M.renameNode(this.doc, id, name); this.changed(); } catch (e) { ui.error(e.message); }
    }

    // opts.multiline: a textarea; Enter adds a line, Ctrl+Enter confirms.
    prompt(title, label, value, opts = {}) {
        return new Promise(resolve => {
            const body = document.createElement('div');
            const field = opts.multiline
                ? `<textarea id="um-prompt-input" class="form-control" rows="6">${esc(value)}</textarea>`
                : `<input id="um-prompt-input" class="form-control" value="${esc(value)}">`;
            body.innerHTML = `<div class="form-group"><label for="um-prompt-input">${esc(label)}</label>${field}</div>`;
            let done = false;
            const finish = (v, close) => { if (done) return; done = true; if (close) close(); resolve(v); };
            const m = ui.modal({
                title, body, size: opts.multiline ? 'md' : 'sm', onClose: () => finish(null),
                footer: [
                    { label: 'Cancel', variant: 'secondary', onClick: close => finish(null, close) },
                    { label: 'OK', variant: 'primary', onClick: close => finish(body.querySelector('#um-prompt-input').value.trim(), close) }
                ]
            });
            const input = body.querySelector('#um-prompt-input');
            input.addEventListener('keydown', e => { if (e.key === 'Enter' && (!opts.multiline || e.ctrlKey || e.metaKey)) finish(input.value.trim(), m.close); });
        });
    }

    // Details pane

    renderDetails() {
        const pane = document.getElementById('node-details');
        const f = this.selectedId ? M.findNode(this.doc, this.selectedId) : null;
        if (!f) {
            pane.innerHTML = '<div class="um-empty">Select a node, or an element in the WinCC OA browser.</div>';
            return;
        }
        const n = f.node;
        const unsRoot = this.device.config.unsRoot || '';
        const topic = M.nodeTopic(this.doc, n.id, unsRoot);
        const issues = this.issueMap.get(n.id) || [];
        pane.innerHTML = `
            <h3>Node</h3>
            <div class="um-ovr">
                <label class="wide">Name<input class="form-control" data-f="name" value="${esc(n.name)}"></label>
                <label>ISA-95 level<select class="form-control" data-f="level"><option value="">–</option>${M.ISA95_LEVELS.map(l => `<option${n.level === l ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
                <label>Id<input class="form-control" value="${esc(n.id)}" disabled></label>
                <label class="wide">Description<input class="form-control" data-f="description" value="${esc(n.description || '')}"></label>
            </div>
            <dl class="um-kv" style="margin-top:0.4rem;"><dt>Topic</dt><dd>${esc(topic)}</dd></dl>
            <div style="display:flex;gap:0.35rem;margin-top:0.5rem;flex-wrap:wrap;">
                <button type="button" class="btn btn-secondary btn-sm" data-a="child" data-requires-auth>Add child</button>
                ${n.binding ? '<button type="button" class="btn btn-secondary btn-sm" data-a="unbind" data-requires-auth>Remove binding</button>' : ''}
                ${n.aiGenerated ? '<button type="button" class="btn btn-secondary btn-sm" data-a="accept" data-requires-auth>Accept AI proposal</button>' : ''}
                <button type="button" class="btn btn-danger btn-sm" data-a="delete" data-requires-auth>Delete node</button>
            </div>
            ${issues.length ? `<h3>Issues</h3>${issues.map(i => `<div class="um-issue">${this.sevTag(i.severity)}<span>${esc(i.message)}</span></div>`).join('')}` : ''}
            ${n.binding ? this.bindingDetails(n, topic) : '<h3>Binding</h3><div class="um-empty">Drag a datapoint type, datapoint or element from the WinCC OA browser onto this node.</div>'}
            <h3>Node overrides</h3>
            <div data-ovr="node"></div>
            ${n.binding ? '<h3>Binding overrides</h3><div data-ovr="binding"></div>' : ''}
            <h3>Effective semantics</h3>
            <pre class="um-pre" data-role="sem"></pre>
            <h3>Payload preview</h3>
            <pre class="um-pre" data-role="preview"></pre>`;
        pane.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => this.setNodeField(n, inp.dataset.f, inp.value)));
        pane.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => this.nodeAction(n, b.dataset.a)));
        this.renderOverrides(pane.querySelector('[data-ovr="node"]'), n, 'overrides');
        if (n.binding) {
            this.renderOverrides(pane.querySelector('[data-ovr="binding"]'), n.binding, 'overrides');
            this.bindBindingDetails(pane, n);
        }
        this.renderEffective(pane, n);
    }

    bindingDetails(n, topic) {
        const b = n.binding;
        const rows = [`<dt>Kind</dt><dd>${esc(b.kind)}</dd>`, `<dt>Type</dt><dd>${esc(b.type)}</dd>`];
        if (b.system) rows.push(`<dt>System</dt><dd>${esc(b.system)}</dd>`);
        if (b.datapoint) rows.push(`<dt>Datapoint</dt><dd>${esc(b.datapoint)}</dd>`);
        if (b.kind === 'element') rows.push(`<dt>Element</dt><dd>${esc(b.element || '(root)')}</dd>`);
        if (b.kind === 'pattern') rows.push(`<dt>Pattern</dt><dd><input class="form-control" data-b="pattern" value="${esc(b.pattern)}"></dd>`);
        if (b.kind !== 'element') {
            const obj = b.layout === 'object';
            rows.push(`<dt>Publish as</dt><dd><select class="form-control" data-b="layout">
                <option value="elements"${obj ? '' : ' selected'}>One topic per element</option>
                <option value="object"${obj ? ' selected' : ''}>One JSON topic per datapoint</option></select></dd>`);
        }
        let elements = '';
        if (b.kind !== 'element') {
            elements = `<h3>Elements</h3><div data-role="elements"><div class="um-empty">Loading type structure…</div></div>`;
        }
        return `<h3>Binding</h3><dl class="um-kv">${rows.join('')}</dl><div data-role="current"></div>${elements}`;
    }

    async bindBindingDetails(pane, n) {
        const b = n.binding;
        const pat = pane.querySelector('[data-b="pattern"]');
        if (pat) pat.addEventListener('change', () => { b.pattern = pat.value.trim() || '*'; this.matches.delete(n.id); this.changed({ keepDetails: true }); });
        const layout = pane.querySelector('[data-b="layout"]');
        if (layout) layout.addEventListener('change', () => {
            if (layout.value === 'object') b.layout = 'object'; else delete b.layout;
            M.clearAi(n);
            this.changed({ keepDetails: true });
            this.renderElementTable(pane, n);
            this.renderEffective(pane, n);
        });
        // Current value of the first DPE.
        const sys = b.system ? b.system + ':' : '';
        let dpe = null;
        if (b.kind === 'element') dpe = `${sys}${b.datapoint}.${b.element || ''}`;
        else if (b.kind === 'datapoint') dpe = `${sys}${b.datapoint}.${(b.elements && b.elements[0] && b.elements[0].path) || ''}`;
        if (dpe) this.loadCurrent(pane, n, dpe);
        if (b.kind === 'element') return;
        const key = `${b.system || ''}|${b.type}`;
        try {
            if (!this.structures.has(key)) {
                const r = await this.gql.query('query($s: String, $t: String!) { winccoa { typeStructure(system: $s, type: $t) { elements { path valueElement elementType } } } }', { s: b.system || null, t: b.type });
                this.structures.set(key, r.winccoa.typeStructure.elements);
            }
        } catch (e) {
            const box = pane.querySelector('[data-role="elements"]');
            if (box) box.innerHTML = `<div class="um-empty">${esc(e.message)}</div>`;
            return;
        }
        if (this.selectedId !== n.id) return;
        this.renderElementTable(pane, n);
        this.renderEffective(pane, n);
    }

    renderElementTable(pane, n) {
        const b = n.binding;
        const box = pane.querySelector('[data-role="elements"]');
        if (!box) return;
        const struct = (this.structures.get(`${b.system || ''}|${b.type}`) || []).filter(e => e.valueElement);
        const sels = b.elements || null;
        const selected = p => !sels || sels.some(s => s.path === p);
        const topicOf = p => { const s = sels && sels.find(x => x.path === p); return s && s.topic !== undefined ? s.topic : ''; };
        // An object topic has no element topics: the checked elements are the leaves of its JSON.
        const obj = b.layout === 'object';
        box.innerHTML = `<table class="um-elements"><thead><tr><th></th><th>Element</th><th>Type</th>${obj ? '' : '<th>Topic override</th>'}<th></th></tr></thead><tbody>
            ${struct.map(e => `<tr data-path="${esc(e.path)}"><td><input type="checkbox" ${selected(e.path) ? 'checked' : ''} aria-label="Select ${esc(e.path)}"></td>
                <td>${esc(e.path || '(root)')}</td><td>${esc(e.elementType)}</td>
                ${obj ? '' : `<td><input type="text" class="form-control" value="${esc(topicOf(e.path))}" placeholder="${esc(M.elementRel(e.path))}" ${selected(e.path) ? '' : 'disabled'}></td>`}
                <td>${sels && sels.some(s => s.path === e.path) ? '<button type="button" class="btn btn-secondary btn-sm" data-ovr-el="1">Overrides</button>' : ''}</td></tr>`).join('')}
            </tbody></table><span class="form-hint">${obj
                ? 'The checked elements are connected together and published as one JSON object; all checked: also elements added to the type later (next apply).'
                : 'All checked and no topic override: the binding publishes all value elements, also elements added to the type later (next apply).'}</span>
            <div data-role="el-ovr"></div>`;
        box.querySelectorAll('tr[data-path]').forEach(tr => {
            const path = tr.dataset.path;
            const [cb, , , ] = tr.querySelectorAll('input');
            const topicInput = tr.querySelector('input[type="text"]');
            cb.addEventListener('change', () => {
                const checked = [...box.querySelectorAll('tr[data-path]')].filter(r => r.querySelector('input[type="checkbox"]').checked).map(r => r.dataset.path);
                if (checked.length === struct.length && !(b.elements || []).some(s => s.topic !== undefined || s.overrides)) M.setElementSelection(b, []);
                else M.setElementSelection(b, checked);
                M.clearAi(n);
                this.changed({ keepDetails: true });
                this.renderElementTable(pane, n);
                this.renderEffective(pane, n);
            });
            if (topicInput) topicInput.addEventListener('change', () => {
                if (!b.elements) M.setElementSelection(b, struct.map(e => e.path));
                const sel = b.elements.find(s => s.path === path);
                if (!sel) return;
                if (topicInput.value === '' && topicInput.placeholder) delete sel.topic;
                else sel.topic = topicInput.value;
                M.clearAi(n);
                this.changed({ keepDetails: true });
            });
            const ob = tr.querySelector('[data-ovr-el]');
            if (ob) ob.addEventListener('click', () => {
                const sel = b.elements.find(s => s.path === path);
                const holder = box.querySelector('[data-role="el-ovr"]');
                holder.innerHTML = `<h3>Overrides of ${esc(path || '(root)')}</h3><div></div>`;
                this.renderOverrides(holder.lastElementChild, sel, 'overrides', n);
            });
        });
    }

    async loadCurrent(pane, n, dpe) {
        try {
            const r = await this.gql.query('query($d: [String!]!) { winccoa { elementInfo(dpes: $d) { dpe exists error type elementType unit description format value stime status } } }', { d: [dpe] });
            const info = r.winccoa.elementInfo[0];
            if (this.selectedId !== n.id) return;
            const box = pane.querySelector('[data-role="current"]');
            if (!box) return;
            box.innerHTML = info.exists
                ? `<dl class="um-kv" style="margin-top:0.3rem;"><dt>DPE</dt><dd>${esc(info.dpe)}</dd><dt>Element type</dt><dd>${esc(info.elementType)}</dd>
                   <dt>Unit</dt><dd>${esc(info.unit)}</dd><dt>Description</dt><dd>${esc(info.description)}</dd><dt>Value</dt><dd>${esc(info.value)}</dd><dt>Source time</dt><dd>${esc(info.stime)}</dd></dl>`
                : `<div class="um-issue"><span class="um-tag err">missing</span><span>${esc(info.dpe)}: ${esc(info.error || 'not found')}</span></div>`;
            this.currentInfo = info;
            this.renderEffective(pane, n);
        } catch (e) { /* the editor works without values */ }
    }

    renderEffective(pane, n) {
        const b = n.binding;
        const firstPath = b && b.kind !== 'element' && b.elements && b.elements[0] ? b.elements[0].path : undefined;
        const sem = M.effectiveSemantics(this.doc, n.id, this.configForSemantics(), firstPath);
        const semEl = pane.querySelector('[data-role="sem"]');
        if (semEl) semEl.textContent = JSON.stringify(sem, null, 2);
        const prev = pane.querySelector('[data-role="preview"]');
        if (prev && b && b.layout === 'object' && b.kind !== 'element') {
            // The object topic: one leaf per selected element, sample values.
            const struct = this.structures.get(`${b.system || ''}|${b.type}`) || [];
            const paths = b.elements ? b.elements.map(e => e.path)
                : struct.filter(e => e.valueElement && e.elementType !== 'unknown').map(e => e.path);
            const config = this.configForSemantics();
            prev.textContent = paths.length
                ? M.objectPreview(paths, p => M.effectiveSemantics(this.doc, n.id, config, p), p => ({ value: p === firstPath && this.currentInfo ? this.currentValue() : 42.7 }))
                : 'Loading type structure…';
        } else if (prev) {
            const info = this.currentInfo && this.selectedId === n.id ? this.currentInfo : {};
            prev.textContent = M.payloadPreview(sem, { ...info, value: this.currentValue(info) });
        }
    }

    currentValue(info = this.currentInfo || {}) {
        if (info.value == null) return 42.7;
        try { return JSON.parse(info.value); } catch { return info.value; }
    }

    // renderOverrides edits obj[key] (an Overrides object) in place.
    renderOverrides(box, obj, key, owner) {
        if (!box) return;
        const o = obj[key] || {};
        const opt = (v, cur, label) => `<option value="${v}"${String(cur) === v ? ' selected' : ''}>${label || v}</option>`;
        box.innerHTML = `<div class="um-ovr">
            <label>Retain<select class="form-control" data-o="retain">${opt('', o.retain, 'inherit')}${opt('true', o.retain)}${opt('false', o.retain)}</select></label>
            <label>QoS<select class="form-control" data-o="qos">${opt('', o.qos, 'inherit')}${opt('0', o.qos)}${opt('1', o.qos)}${opt('2', o.qos)}</select></label>
            <label>Publish mode<select class="form-control" data-o="publishMode">${opt('', o.publishMode, 'inherit')}${['onChange', 'deadband', 'minInterval', 'cyclic'].map(m => opt(m, o.publishMode)).join('')}</select></label>
            <label>${o.publishMode === 'deadband' ? 'Deadband' : 'Interval ms'}<input class="form-control" type="number" data-o="param" value="${esc(o.publishMode === 'deadband' ? (o.deadband ?? '') : (o.intervalMs ?? ''))}" ${['deadband', 'minInterval', 'cyclic'].includes(o.publishMode) ? '' : 'disabled'}></label>
            <label>Timestamp<select class="form-control" data-o="timestamp">${opt('', o.timestamp, 'inherit')}${opt('source', o.timestamp)}${opt('publish', o.timestamp)}</select></label>
            <label>Encoding<select class="form-control" data-o="encoding">${opt('', o.encoding, 'inherit')}${opt('json', o.encoding)}${opt('raw', o.encoding)}</select></label>
            <label class="wide">Payload fields (JSON, empty: inherit)<input class="form-control" data-o="payload" value="${esc(o.payload ? JSON.stringify(o.payload) : '')}" placeholder='["value","time","unit"]'></label>
        </div>`;
        const node = owner || M.findNode(this.doc, this.selectedId)?.node;
        box.querySelectorAll('[data-o]').forEach(inp => inp.addEventListener('change', () => {
            const cur = { ...(obj[key] || {}) };
            const v = inp.value;
            switch (inp.dataset.o) {
                case 'retain': if (v === '') delete cur.retain; else cur.retain = v === 'true'; break;
                case 'qos': if (v === '') delete cur.qos; else cur.qos = Number(v); break;
                case 'timestamp': case 'encoding': if (v === '') delete cur[inp.dataset.o]; else cur[inp.dataset.o] = v; break;
                case 'publishMode':
                    delete cur.deadband; delete cur.intervalMs;
                    if (v === '') delete cur.publishMode;
                    else {
                        cur.publishMode = v;
                        if (v === 'deadband') cur.deadband = 1;
                        if (v === 'minInterval' || v === 'cyclic') cur.intervalMs = 1000;
                    }
                    break;
                case 'param':
                    if (cur.publishMode === 'deadband') cur.deadband = Number(v);
                    else cur.intervalMs = Number(v);
                    break;
                case 'payload':
                    if (v.trim() === '') delete cur.payload;
                    else { try { cur.payload = JSON.parse(v); } catch { ui.error('Payload fields must be a JSON array'); return; } }
                    break;
            }
            if (Object.keys(cur).length) obj[key] = cur; else delete obj[key];
            if (node) M.clearAi(node);
            this.changed({ keepDetails: true });
            this.renderOverrides(box, obj, key, owner);
            const pane = document.getElementById('node-details');
            if (node) this.renderEffective(pane, node);
        }));
    }

    setNodeField(n, field, value) {
        if (field === 'name') {
            if (!M.validSegment(value)) { ui.error('Not a valid topic level'); this.renderDetails(); return; }
            try { M.renameNode(this.doc, n.id, value); } catch (e) { ui.error(e.message); this.renderDetails(); return; }
        } else if (value === '') {
            delete n[field];
        } else {
            n[field] = value;
        }
        M.clearAi(n);
        this.changed({ keepDetails: field !== 'name' });
        if (field === 'name') this.renderDetails();
    }

    async nodeAction(n, action) {
        switch (action) {
            case 'child': return this.addNodePrompt(n.id);
            case 'unbind': delete n.binding; M.clearAi(n); this.changed(); return;
            case 'accept': M.clearAi(n); this.changed(); return;
            case 'delete': {
                const ok = await ui.confirm({ title: 'Delete node', message: `Delete “${n.name}” and its ${(n.children || []).length} child nodes?`, danger: true });
                if (!ok) return;
                M.deleteNode(this.doc, n.id);
                this.selectedId = null;
                this.changed();
            }
        }
    }

    showElementDetails(info) {
        if (!info) return;
        this.selectedId = null;
        this.renderTree();
        const pane = document.getElementById('node-details');
        if (info.error && !info.dpe) { pane.innerHTML = `<div class="um-empty">${esc(info.error)}</div>`; return; }
        const rows = [['DPE', info.dpe], ['Kind', info.kindLabel], ['Datapoint type', info.type], ['Element type', info.elementType], ['Unit', info.unit],
            ['Description', info.description], ['Format', info.format], ['Value', info.value], ['Source time', info.stime], ['Status', info.status], ['Error', info.error]]
            .filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '');
        pane.innerHTML = `<h3>WinCC OA</h3><dl class="um-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
            <div class="um-empty">Drag it onto a UNS node to bind it.</div>`;
    }

    // Save and apply

    async saveDraft(silent) {
        try {
            const r = await this.gql.query('mutation($n: String!, $d: String!) { unsModeler { saveDraft(name: $n, document: $d) { success stored document errors issues { severity path message } } } }', { n: this.name, d: JSON.stringify(this.doc) });
            const res = r.unsModeler.saveDraft;
            if (!res.stored) { ui.error('Draft not stored: ' + [...res.errors, ...res.issues.map(i => i.message)].join(', ')); return false; }
            const parsed = M.parseDocument(res.document);
            if (!parsed.error) this.doc = M.ensureIds(parsed.doc);
            this.savedText = res.document;
            this.issues = res.issues;
            this.issueMap = M.issuesByNode(this.doc, this.issues);
            ui.markPageSaved();
            this.renderIssues();
            this.renderTree();
            if (!silent) ui.success(M.hasErrors(res.issues) ? 'Draft saved with validation errors' : 'Draft saved');
            return true;
        } catch (e) {
            ui.error('Save failed: ' + e.message);
            return false;
        }
    }

    async discard() {
        if (this.isDirty() && !await ui.confirm({ title: 'Discard changes', message: 'Discard the unsaved editor changes and reload the stored draft?' })) return;
        ui.markPageSaved();
        await this.load();
    }

    async apply() {
        if (this.isDirty() && !await this.saveDraft(true)) return;
        if (M.hasErrors(this.issues)) { ui.error('The mapping has validation errors'); return; }
        try {
            const r = await this.gql.query('mutation($n: String!) { unsModeler { apply(name: $n) { success errors issues { severity path message } } } }', { n: this.name });
            const res = r.unsModeler.apply;
            if (!res.success) {
                this.issues = res.issues || this.issues;
                this.issueMap = M.issuesByNode(this.doc, this.issues);
                this.renderIssues();
                this.renderTree();
                ui.error('Not applied: ' + res.errors.join(', '));
                return;
            }
            ui.success('Mapping applied; the device publishes it now');
            this.applied = JSON.parse(JSON.stringify(this.doc));
            this.renderTree();
            this.refreshStatus();
            this.refreshLive();
        } catch (e) {
            ui.error('Apply failed: ' + e.message);
        }
    }

    // Status and live monitor

    async refreshStatus() {
        if (!this.name || this.isNew) return;
        try {
            const r = await this.gql.query('query($n: String!) { unsModelers(name: $n) { enabled config { allowWrite } status { running active topics dpes published writes errors lastApplied applyError } } }', { n: this.name });
            const d = r.unsModelers[0];
            if (!d || !this.device) return;
            this.device.status = d.status;
            this.device.enabled = d.enabled;
            this.device.config.allowWrite = d.config.allowWrite;
            this.renderStatus();
            this.refreshLive();
        } catch (e) { /* keep the last state */ }
    }

    // Direction B writes MQTT payloads into WinCC OA: the table shows the
    // source topic, the last written value and write time, no status bits.
    liveColumns(direction) {
        const b = direction === 'MQTT_TO_WINCCOA';
        document.getElementById('live-th-topic').textContent = b ? 'MQTT Topic' : 'UNS Topic';
        document.getElementById('live-th-status').style.display = b ? 'none' : '';
        document.getElementById('live-th-count').textContent = b ? 'Messages' : 'Published';
        document.getElementById('live-th-last').textContent = b ? 'Last Write' : 'Last Publish';
        document.getElementById('live-th-stime').style.display = b ? '' : 'none';
        document.getElementById('write-state').style.display = b ? 'none' : '';
    }

    async refreshLive() {
        if (!this.name) return;
        try {
            const r = await this.gql.query('query($n: String!) { unsModelers(name: $n) { liveTopics { topic dpe value status published lastPublish sourceTime lastError lastErrorAt } } }', { n: this.name });
            const list = (r.unsModelers[0] && r.unsModelers[0].liveTopics) || [];
            const now = Date.now();
            const body = document.getElementById('live-body');
            const b = this.device && this.device.config.direction === 'MQTT_TO_WINCCOA';
            if (!list.length) {
                body.innerHTML = b ? ui.emptyRow(8, 'No value flow yet', 'Create the datapoints in WinCC OA to start the value flow.')
                    : ui.emptyRow(8, 'Nothing published yet', 'Apply a mapping to start the live data flow.');
                return;
            }
            body.innerHTML = list.map(t => {
                const prev = this.liveLast.get(t.topic);
                const rate = prev ? ((t.published - prev.n) / Math.max((now - prev.at) / 1000, 0.001)) : 0;
                this.liveLast.set(t.topic, { n: t.published, at: now });
                const value = t.value || '';
            return `<tr><td><code>${esc(t.topic)}</code></td><td>${esc(t.dpe)}</td><td><code title="${esc(value)}">${esc(value.length > 80 ? value.slice(0, 80) + '…' : value)}</code></td>
                    ${b ? '' : `<td class="num">${t.status == null ? '' : '0x' + Number(t.status).toString(16)}</td>`}<td class="num">${rate.toFixed(2)}</td>
                    <td class="num">${t.published}</td><td>${esc(b && t.lastPublish ? new Date(t.lastPublish).toLocaleString() : t.lastPublish || '')}</td>${b
                    ? `<td>${t.sourceTime ? esc(new Date(t.sourceTime).toLocaleString()) : (t.lastPublish ? '<span class="um-small">receive time</span>' : '')}</td>` : ''}<td>${t.lastError ? `<span class="um-tag err" title="${esc(t.lastErrorAt)}">${esc(t.lastError)}</span>` : ''}</td></tr>`;
            }).join('');
        } catch (e) {
            // Keep the rows of the last good poll; show the error only instead of an empty table.
            const body = document.getElementById('live-body');
            if (body && !body.querySelector('tr td code')) body.innerHTML = ui.emptyRow(8, 'Live monitor unavailable', e.message);
        }
    }
}

let detail;
document.addEventListener('DOMContentLoaded', () => { detail = new UnsModelerDetail(); });

page.expose({
    get saveDevice() { return () => detail && detail.saveDevice(); },
    get deleteDevice() { return () => detail && detail.deleteDevice(); },
    get refreshLive() { return () => detail && detail.refreshLive(); }
});
page.ready();
return () => page.dispose();
}
