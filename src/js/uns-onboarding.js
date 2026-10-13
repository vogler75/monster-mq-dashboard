// UNS Modeler Direction B view (B1, plan-uns-modeler-design.md §5, §7 B1):
// source topic tree, proposed datapoint types and datapoints with rename and
// exclude, JSON import, AI run, and Create in WinCC OA with a summary.
// Validation comes from the broker (unsModelerValidate).

const PALETTE = ['#38bdf8', '#10b981', '#f59e0b', '#a78bfa', '#f472b6', '#22d3ee', '#84cc16', '#fb923c'];

export function topicMatches(filter, topic) {
    const f = filter.split('/');
    const t = topic.split('/');
    for (let i = 0; i < f.length; i++) {
        if (f[i] === '#') return true;
        if (i >= t.length) return false;
        if (f[i] !== '+' && f[i] !== t[i]) return false;
    }
    return f.length === t.length;
}

// renameType renames a type and every datapoint that uses it.
export function renameType(doc, from, to) {
    if ((doc.types || []).some(t => t.name === to)) throw new Error(`a type is already named "${to}"`);
    const t = (doc.types || []).find(x => x.name === from);
    if (!t) throw new Error('type not found');
    t.name = to;
    for (const d of doc.datapoints || []) if (d.type === from) d.type = to;
}

export function renameDatapoint(doc, from, to) {
    if ((doc.datapoints || []).some(d => d.name === to)) throw new Error(`a datapoint is already named "${to}"`);
    const d = (doc.datapoints || []).find(x => x.name === from);
    if (!d) throw new Error('datapoint not found');
    d.name = to;
}

// setExcluded excludes or includes a type (with its datapoints) or a datapoint.
export function setExcluded(doc, kind, name, excluded) {
    const list = kind === 'type' ? doc.types : doc.datapoints;
    const it = (list || []).find(x => x.name === name);
    if (!it) throw new Error(`${kind} not found`);
    if (excluded) it.excluded = true; else delete it.excluded;
}

// assignments maps each bound topic to the types and datapoints that use it.
export function assignments(doc) {
    const out = new Map();
    for (const d of doc.datapoints || []) {
        for (const b of d.bindings || []) {
            if (!out.has(b.topic)) out.set(b.topic, []);
            out.get(b.topic).push({ datapoint: d.name, type: d.type, element: b.element, excluded: !!d.excluded });
        }
    }
    return out;
}

export function typeColors(doc) {
    const m = new Map();
    (doc.types || []).forEach((t, i) => m.set(t.name, PALETTE[i % PALETTE.length]));
    return m;
}

// readablePayload decodes a base64 payload when it is printable text.
export function readablePayload(payload, format) {
    if (format === 'JSON' || payload == null) {
        try { JSON.parse(payload); return payload; } catch { /* maybe base64 */ }
    }
    try {
        const bin = atob(payload);
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!/[\u0000-\u0008\u000e-\u001f]/.test(text)) return text;
    } catch { /* binary */ }
    return payload;
}

export class OnboardingView {
    // host: the detail page controller (gql, ui, document, name, esc, setTimeout, clearTimeout)
    constructor(host) {
        this.h = host;
        this.d = host.document;
        this.doc = null;
        this.saved = '';
        this.issues = [];
        this.expanded = new Set(['']);
        this.children = new Map();
        this.values = new Map();
    }

    $(id) { return this.d.getElementById(id); }

    async init(dev) {
        this.dev = dev;
        this.$('onboarding-section').style.display = '';
        const parsed = dev.draft ? JSON.parse(dev.draft) : null;
        this.doc = parsed || { schemaVersion: 1, direction: 'mqtt_to_winccoa', source: { mode: 'live', topicFilters: [] }, types: [], datapoints: [] };
        this.saved = dev.draft || '';
        const params = new URLSearchParams(this.h.window.location.search);
        const preset = params.get('topics');
        const filters = preset ? preset.split(',') : (this.doc.source && this.doc.source.topicFilters) || [];
        this.$('b-filters').value = filters.join(', ');
        if (params.get('mode')) this.$('b-mode').value = params.get('mode').toUpperCase();
        else if (this.doc.source && this.doc.source.mode === 'archive') this.$('b-mode').value = 'ARCHIVE';
        await this.loadArchiveGroups();
        this.$('b-ai-btn').style.display = dev.config.aiProvider ? '' : 'none';
        this.$('b-ai-btn').addEventListener('click', () => this.aiRun());
        this.$('b-import-btn').addEventListener('click', () => this.importJson());
        this.$('b-save-btn').addEventListener('click', () => this.save());
        this.$('b-create-btn').addEventListener('click', () => this.create());
        this.$('b-raw-apply-btn').addEventListener('click', () => this.loadRaw());
        this.$('b-filters').addEventListener('change', () => this.renderSource());
        this.d.querySelectorAll('[data-btab]').forEach(t => t.addEventListener('click', () => this.showTab(t.dataset.btab)));
        await this.loadChildren('');
        this.render();
        this.validate();
        this.pollAi(true);
    }

    filters() {
        return this.$('b-filters').value.split(',').map(s => s.trim()).filter(Boolean);
    }

    archiveGroup() { return this.$('b-archive').value || 'Default'; }

    async loadArchiveGroups() {
        try {
            const r = await this.h.gql.query('query { archiveGroups { name } }');
            const sel = this.$('b-archive');
            sel.innerHTML = (r.archiveGroups || []).map(g => `<option>${this.h.esc(g.name)}</option>`).join('') || '<option>Default</option>';
            if (this.doc.source && this.doc.source.archiveGroup) sel.value = this.doc.source.archiveGroup;
        } catch (e) { this.$('b-archive').innerHTML = '<option>Default</option>'; }
    }

    // Source tree (lazy browseTopics, like the topic browser)

    async loadChildren(topic) {
        try {
            const r = await this.h.gql.query('query($t: String!, $a: String!) { browseTopics(topic: $t, archiveGroup: $a) { name } }', { t: topic ? topic + '/+' : '+', a: this.archiveGroup() });
            const names = (r.browseTopics || []).map(t => t.name).sort();
            this.children.set(topic, names);
        } catch (e) { this.children.set(topic, []); }
    }

    async loadValues(topic) {
        try {
            const r = await this.h.gql.query('query($f: String!, $a: String!) { currentValues(topicFilter: $f, archiveGroup: $a, limit: 200) { topic payload format } }', { f: topic + '/#', a: this.archiveGroup() });
            for (const v of r.currentValues || []) this.values.set(v.topic, readablePayload(v.payload, v.format));
        } catch (e) { /* values are optional */ }
    }

    renderSource() {
        const esc = this.h.esc;
        const assign = assignments(this.doc);
        const colors = typeColors(this.doc);
        const filters = this.filters();
        const rows = [];
        let assigned = 0, unassigned = 0;
        const visit = (topic, depth) => {
            for (const child of this.children.get(topic) || []) {
                const kids = this.children.get(child);
                const open = this.expanded.has(child);
                const a = assign.get(child);
                const selected = filters.some(f => topicMatches(f, child) || f === child + '/#');
                const inScope = filters.some(f => topicMatches(f, child));
                if (inScope && kids && kids.length === 0) { if (a) assigned++; else unassigned++; }
                const sw = a ? `<span class="um-swatch" style="background:${colors.get(a[0].type) || '#64748b'}" title="${esc(a.map(x => x.datapoint + '.' + x.element).join(', '))}"></span>` : '';
                const val = this.values.get(child);
                rows.push(`<div class="um-row" data-topic="${esc(child)}" style="padding-left:${0.3 + depth * 1.1}rem">
                    <span class="um-chevron${open ? ' expanded' : ''}" data-toggle="1">&#9656;</span>
                    <input type="checkbox" class="um-check" ${selected ? 'checked' : ''} aria-label="Analyse ${esc(child)}" data-ignore-dirty>
                    ${sw}<span class="um-label">${esc(child.split('/').pop())}</span>
                    ${a ? `<span class="um-tag bind">${esc(a.map(x => x.datapoint).join(','))}</span>` : (inScope && kids && kids.length === 0 ? '<span class="um-tag">unassigned</span>' : '')}
                    ${val != null ? `<span class="um-meta">${esc(String(val).slice(0, 40))}</span>` : ''}</div>`);
                if (open) visit(child, depth + 1);
            }
        };
        visit('', 0);
        const box = this.$('b-source');
        box.innerHTML = rows.join('') || '<div class="um-empty">No topics in the archive group.</div>';
        this.$('b-source-summary').textContent = `${assigned} assigned · ${unassigned} unassigned (expanded)`;
        box.querySelectorAll('.um-row[data-topic]').forEach(r => {
            const topic = r.dataset.topic;
            r.querySelector('[data-toggle]').addEventListener('click', async e => {
                e.stopPropagation();
                if (this.expanded.has(topic)) this.expanded.delete(topic);
                else {
                    this.expanded.add(topic);
                    if (!this.children.has(topic)) await this.loadChildren(topic);
                    await this.loadValues(topic);
                }
                this.renderSource();
            });
            r.querySelector('.um-check').addEventListener('change', e => {
                const f = topic + '/#';
                let list = this.filters().filter(x => x !== f && x !== topic);
                if (e.target.checked) list.push(f);
                this.$('b-filters').value = list.join(', ');
                this.renderSource();
            });
        });
    }

    // Proposal panes

    issuesAt(prefix) {
        return this.issues.filter(i => i.path === prefix || (i.path || '').startsWith(prefix + '/'));
    }

    issueTags(list) {
        const esc = this.h.esc;
        const e = list.filter(i => i.severity === 'ERROR');
        const w = list.filter(i => i.severity === 'WARNING');
        const n = list.filter(i => i.severity === 'INFO');
        return (e.length ? `<span class="um-tag err" title="${esc(e.map(i => i.message).join('\n'))}">${e.length}</span>` : '') +
            (w.length ? `<span class="um-tag warn" title="${esc(w.map(i => i.message).join('\n'))}">${w.length}</span>` : '') +
            (n.length ? `<span class="um-tag info" title="${esc(n.map(i => i.message).join('\n'))}">${n.length}</span>` : '');
    }

    metaText(e) {
        const parts = [];
        if (e.unit) parts.push(`unit ${e.unit}`);
        if (e.format) parts.push(`format ${e.format}`);
        if (e.description) parts.push(`“${e.description}”`);
        if (e.pvRange) parts.push(`_pv_range ${e.pvRange.min}..${e.pvRange.max}`);
        if (e.alert) parts.push(e.alert.kind === 'binary' ? `_alert_hdl binary (${e.alert.class})` :
            `_alert_hdl ${e.alert.limits.map(l => (l.when === 'above' ? '>' : '<') + l.limit + ' ' + l.class).join(', ')}`);
        return parts.join(' · ');
    }

    render() {
        const esc = this.h.esc;
        const colors = typeColors(this.doc);
        const types = this.doc.types || [];
        const dps = this.doc.datapoints || [];
        this.$('b-types').innerHTML = types.map((t, i) => {
            const iss = this.issuesAt(`/types/${i}`);
            const conflict = iss.some(x => x.severity === 'ERROR');
            return `<div class="um-card${t.excluded ? ' excluded' : ''}${conflict ? ' conflict' : ''}" data-type="${esc(t.name)}">
                <div class="um-card-head"><span class="um-swatch" style="background:${colors.get(t.name)}"></span><strong>${esc(t.name)}</strong>
                ${t.reuse ? '<span class="um-tag info">reuse</span>' : ''}${t.excluded ? '<span class="um-tag">excluded</span>' : ''}${this.issueTags(iss)}
                <button type="button" class="btn btn-secondary btn-sm" data-a="rename" data-requires-auth>Rename</button>
                <button type="button" class="btn btn-secondary btn-sm" data-a="exclude" data-requires-auth>${t.excluded ? 'Include' : 'Exclude'}</button></div>
                ${(t.elements || []).map(e => `<div><code>${esc(e.path)}</code> <span class="um-small">${esc(e.elementType)}</span> <span class="um-small">${esc(this.metaText(e))}</span></div>`).join('') || '<div class="um-small">existing type, used as is</div>'}
                ${iss.map(x => `<div class="um-small">${esc(x.severity.toLowerCase())}: ${esc(x.message)}</div>`).join('')}
            </div>`;
        }).join('') || '<div class="um-empty">No types yet. Run the AI analysis or import a proposal.</div>';
        this.$('b-dps').innerHTML = dps.map((d, i) => {
            const iss = this.issuesAt(`/datapoints/${i}`);
            const t = types.find(x => x.name === d.type);
            const excluded = d.excluded || (t && t.excluded);
            return `<div class="um-card${excluded ? ' excluded' : ''}${iss.some(x => x.severity === 'ERROR') ? ' conflict' : ''}" data-dp="${esc(d.name)}">
                <div class="um-card-head"><span class="um-swatch" style="background:${colors.get(d.type) || '#64748b'}"></span><strong>${esc(d.name)}</strong>
                <span class="um-small">${esc(d.type)}</span>${d.excluded ? '<span class="um-tag">excluded</span>' : ''}${this.issueTags(iss)}
                <button type="button" class="btn btn-secondary btn-sm" data-a="rename" data-requires-auth>Rename</button>
                <button type="button" class="btn btn-secondary btn-sm" data-a="exclude" data-requires-auth>${d.excluded ? 'Include' : 'Exclude'}</button></div>
                ${(d.bindings || []).map(b => `<div><code>${esc(b.topic)}</code>${b.jsonPath ? ` <span class="um-small">${esc(b.jsonPath)}</span>` : ''} &#8594; <code>${esc(b.element || '(root)')}</code></div>`).join('')}
                ${(d.elements || []).map(e => `<div class="um-small">${esc(e.path)}: ${esc(this.metaText(e))}</div>`).join('')}
                ${iss.map(x => `<div class="um-small">${esc(x.severity.toLowerCase())}: ${esc(x.message)}</div>`).join('')}
            </div>`;
        }).join('') || '<div class="um-empty">No datapoints yet.</div>';
        this.$('b-types-summary').textContent = `${types.filter(t => !t.excluded).length} of ${types.length}`;
        this.$('b-dps-summary').textContent = `${dps.filter(d => !d.excluded).length} of ${dps.length}`;
        this.$('b-types').querySelectorAll('[data-type]').forEach(c => this.bindCard(c, 'type', c.dataset.type));
        this.$('b-dps').querySelectorAll('[data-dp]').forEach(c => this.bindCard(c, 'datapoint', c.dataset.dp));
        this.renderSource();
        this.renderIssues();
        this.updateState();
    }

    bindCard(card, kind, name) {
        card.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', async () => {
            try {
                if (b.dataset.a === 'rename') {
                    const to = await this.h.prompt(`Rename ${kind}`, 'New name (must start with the device prefix for new objects)', name);
                    if (!to || to === name) return;
                    if (kind === 'type') renameType(this.doc, name, to); else renameDatapoint(this.doc, name, to);
                } else {
                    const list = kind === 'type' ? this.doc.types : this.doc.datapoints;
                    const it = list.find(x => x.name === name);
                    setExcluded(this.doc, kind, name, !it.excluded);
                }
                this.changed();
            } catch (e) { this.h.ui.error(e.message); }
        }));
    }

    changed() {
        this.h.ui.markPageDirty();
        this.render();
        this.h.clearTimeout(this.vt);
        this.vt = this.h.setTimeout(() => this.validate(), 500);
    }

    dirty() { return JSON.stringify(this.doc) !== (this.saved ? JSON.stringify(JSON.parse(this.saved)) : JSON.stringify(this.doc)); }

    updateState() {
        const el = this.$('b-draft-state');
        const dirty = this.saved && this.dirty();
        el.textContent = dirty ? 'Unsaved changes' : 'Saved';
        el.className = 'status-badge ' + (dirty ? 'badge-warn' : 'badge-neutral');
        const errors = this.issues.some(i => i.severity === 'ERROR');
        const btn = this.$('b-create-btn');
        btn.disabled = errors || !(this.doc.datapoints || []).length;
        btn.title = errors ? 'Resolve the conflicts first (rename or exclude)' : '';
    }

    async validate() {
        try {
            const r = await this.h.gql.query('query($n: String!, $d: String!) { unsModelerValidate(name: $n, document: $d) { severity path message } }', { n: this.h.name, d: JSON.stringify(this.doc) });
            this.issues = r.unsModelerValidate || [];
        } catch (e) {
            this.issues = [{ severity: 'ERROR', path: '', message: 'Validation failed: ' + e.message }];
        }
        this.render();
    }

    renderIssues() {
        const esc = this.h.esc;
        const panel = this.$('b-validation');
        const n = sev => this.issues.filter(i => i.severity === sev).length;
        this.$('b-issue-count').textContent = this.issues.length ? `(${n('ERROR')} errors, ${n('WARNING')} warnings, ${n('INFO')} info)` : '';
        panel.innerHTML = this.issues.length ? this.issues.map(i => `<div class="um-issue">${this.h.sevTag(i.severity)}<code>${esc(i.path || '/')}</code><span>${esc(i.message)}</span></div>`).join('')
            : '<div class="um-empty">No issues.</div>';
    }

    showTab(tab) {
        this.d.querySelectorAll('[data-btab]').forEach(t => t.classList.toggle('active', t.dataset.btab === tab));
        this.d.querySelectorAll('[data-bpanel]').forEach(p => { p.style.display = p.dataset.bpanel === tab ? '' : 'none'; });
        if (tab === 'json') this.$('b-raw-json').value = JSON.stringify(this.doc, null, 2);
    }

    loadRaw() {
        try {
            const doc = JSON.parse(this.$('b-raw-json').value);
            if (doc.direction !== 'mqtt_to_winccoa') throw new Error('the document must have direction mqtt_to_winccoa');
            this.doc = doc;
            this.changed();
        } catch (e) { this.h.ui.error('Invalid JSON: ' + e.message); }
    }

    async save(silent) {
        try {
            const r = await this.h.gql.query('mutation($n: String!, $d: String!) { unsModeler { saveDraft(name: $n, document: $d) { stored document errors issues { severity path message } } } }', { n: this.h.name, d: JSON.stringify(this.doc) });
            const res = r.unsModeler.saveDraft;
            if (!res.stored) { this.h.ui.error('Draft not stored: ' + [...res.errors, ...res.issues.map(i => i.message)].join(', ')); return false; }
            this.doc = JSON.parse(res.document);
            this.saved = res.document;
            this.issues = res.issues;
            this.h.ui.markPageSaved();
            this.render();
            if (!silent) this.h.ui.success('Draft saved');
            return true;
        } catch (e) { this.h.ui.error('Save failed: ' + e.message); return false; }
    }

    importJson() {
        const body = this.d.createElement('div');
        body.innerHTML = `<p class="form-hint">Paste a Direction B proposal (types, datapoints, bindings). The broker stamps the source from the current topic selection (${this.h.esc(this.filters().join(', ') || 'none')}) and validates it like an AI answer.</p>
            <div class="form-group"><label for="b-import-file">File</label><input type="file" id="b-import-file" class="form-control" accept=".json,application/json"></div>
            <textarea class="form-control um-json" id="b-import-text" spellcheck="false"></textarea>`;
        body.querySelector('#b-import-file').addEventListener('change', async e => {
            const f = e.target.files[0];
            if (f) body.querySelector('#b-import-text').value = await f.text();
        });
        this.h.ui.modal({ title: 'Import proposal', body, size: 'lg', footer: [
            { label: 'Cancel', variant: 'secondary' },
            { label: 'Import', variant: 'primary', onClick: async close => {
                const filters = this.filters();
                if (!filters.length) { this.h.ui.error('Select the analysed topics first'); return; }
                try {
                    const r = await this.h.gql.query('mutation($n: String!, $d: String!, $m: String, $a: String, $f: [String!]!) { unsModeler { importProposal(name: $n, document: $d, topicMode: $m, archiveGroup: $a, topicFilters: $f) { stored document errors issues { severity path message } } } }',
                        { n: this.h.name, d: body.querySelector('#b-import-text').value, m: this.$('b-mode').value, a: this.archiveGroup(), f: filters });
                    const res = r.unsModeler.importProposal;
                    if (!res.stored) { this.h.ui.error('Not imported: ' + [...res.errors, ...res.issues.map(i => i.message)].join(', ')); return; }
                    close();
                    this.doc = JSON.parse(res.document);
                    this.saved = res.document;
                    this.issues = res.issues;
                    this.render();
                    this.h.ui.success('Proposal imported');
                } catch (e) { this.h.ui.error('Import failed: ' + e.message); }
            } }
        ] });
    }

    async aiRun() {
        const filters = this.filters();
        if (!filters.length) { this.h.ui.error('Select the topics to analyse first'); return; }
        if (this.saved && this.dirty() && !await this.save(true)) return;
        const prompt = await this.h.prompt('Analyse with AI', 'Instructions for the analysis (optional)', '');
        if (prompt === null) return;
        try {
            const r = await this.h.gql.query('mutation($n: String!, $i: UnsModelerAiRunInput!) { unsModeler { startAiRun(name: $n, input: $i) { success errors } } }',
                { n: this.h.name, i: { prompt, topicMode: this.$('b-mode').value, archiveGroup: this.archiveGroup(), topicFilters: filters } });
            const res = r.unsModeler.startAiRun;
            if (!res.success) { this.h.ui.error('AI run not started: ' + res.errors.join(', ')); return; }
            this.h.ui.success('AI analysis started');
            this.showTab('ai');
            this.pollAi();
        } catch (e) { this.h.ui.error('AI run not started: ' + e.message); }
    }

    async pollAi(once) {
        this.h.clearTimeout(this.at);
        try {
            const r = await this.h.gql.query('query($n: String!) { unsModelers(name: $n) { draft aiRun { id status model steps toolCalls inputTokens outputTokens error applied events { time kind name detail error } } } }', { n: this.h.name });
            const dev = r.unsModelers[0];
            const run = dev && dev.aiRun;
            const was = this.running;
            this.running = !!run && run.status === 'RUNNING';
            if (run) {
                this.$('b-ai-state').textContent = `(${run.status.toLowerCase()})`;
                this.h.renderAiInto(this.$('b-ai-panel'), run);
            }
            if (this.running) { this.at = this.h.setTimeout(() => this.pollAi(), 2000); return; }
            if (was && run) {
                if (run.status === 'SUCCEEDED') {
                    this.doc = JSON.parse(dev.draft);
                    this.saved = dev.draft;
                    this.h.ui.success(run.applied ? 'AI proposal created in WinCC OA' : 'AI proposal loaded; review, rename or exclude, then create it');
                    this.validate();
                } else this.h.ui.error('AI run failed: ' + (run.error || ''));
            }
        } catch (e) { if (!once) this.at = this.h.setTimeout(() => this.pollAi(), 5000); }
    }

    async create() {
        if (this.dirty() && !await this.save(true)) return;
        let plan;
        try {
            const r = await this.h.gql.query('query($n: String!) { unsModelers(name: $n) { createPlan { types datapoints configWrites excluded } } }', { n: this.h.name });
            plan = r.unsModelers[0].createPlan;
        } catch (e) { /* summary is best-effort */ }
        const warnings = this.issues.filter(i => i.severity !== 'ERROR');
        const ok = await this.h.ui.confirm({
            title: 'Create in WinCC OA',
            message: plan ? `Create ${plan.types} datapoint type(s) and ${plan.datapoints} datapoint(s) with ${plan.configWrites} config write(s); ${plan.excluded} excluded. ` +
                `${warnings.length} warning(s)/notes. Existing types are never changed; existing datapoints are skipped. Nothing is undone automatically.` : 'Create the proposal in WinCC OA?',
            confirmLabel: 'Create'
        });
        if (!ok) return;
        try {
            const r = await this.h.gql.query('mutation($n: String!) { unsModeler { createInWinCCOa(name: $n) { success errors issues { severity path message } objects { kind name status message configWrites } configWrites } } }', { n: this.h.name });
            const res = r.unsModeler.createInWinCCOa;
            this.renderResults(res);
            this.showTab('results');
            if (res.success) this.h.ui.success(`Created; ${res.configWrites} config writes`);
            else this.h.ui.error('Create finished with problems: ' + [...res.errors].join(', '));
        } catch (e) { this.h.ui.error('Create failed: ' + e.message); }
    }

    renderResults(res) {
        const esc = this.h.esc;
        const cls = s => s === 'created' ? 'new' : s === 'failed' ? 'err' : s === 'skipped' ? 'info' : '';
        this.$('b-results').innerHTML = `<table class="um-log"><thead><tr><th>Kind</th><th>Name</th><th>Result</th><th>Config writes</th><th>Message</th></tr></thead><tbody>
            ${(res.objects || []).map(o => `<tr><td>${esc(o.kind)}</td><td>${esc(o.name)}</td><td><span class="um-tag ${cls(o.status)}">${esc(o.status)}</span></td><td>${o.configWrites}</td><td>${esc(o.message || '')}</td></tr>`).join('')}
            </tbody></table>${(res.issues || []).length && !(res.objects || []).length ? res.issues.map(i => `<div class="um-issue">${this.h.sevTag(i.severity)}<span>${esc(i.message)}</span></div>`).join('') : ''}`;
    }
}
