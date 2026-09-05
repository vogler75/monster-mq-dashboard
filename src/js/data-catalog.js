class DataCatalogManager {
    constructor() {
        this.types = [];
        this.instances = [];
        this.relations = [];
        this.listeners = [];
        this.disposed = false;
        this.loadVersion = 0;
        this.bind();
        this.configureFeatures();
        this.load();
        window.registerPageCleanup?.(() => this.cleanup());
    }

    on(element, event, handler) {
        element?.addEventListener(event, handler);
        if (element) this.listeners.push([element, event, handler]);
    }

    bind() {
        this.on(document.getElementById('catalog-refresh-btn'), 'click', () => this.load());
        this.on(document.getElementById('catalog-add-type'), 'click', () => this.openType());
        this.on(document.getElementById('catalog-add-instance'), 'click', () => this.openInstance());
        this.on(document.getElementById('catalog-add-relation'), 'click', () => this.openRelation());
        this.on(document.getElementById('catalog-export-btn'), 'click', () => this.exportCatalog());
        this.on(document.getElementById('catalog-import-btn'), 'click', () => document.getElementById('catalog-import-file').click());
        this.on(document.getElementById('catalog-import-file'), 'change', event => this.importFile(event));
        this.on(document.getElementById('catalog-infer-btn'), 'click', () => this.openDiscovery(false));
        this.on(document.getElementById('catalog-ai-btn'), 'click', () => this.openDiscovery(true));
        this.on(document.getElementById('catalog-namespace-filter'), 'change', () => this.render());
        this.on(document.getElementById('catalog-search'), 'input', () => this.render());
        ['catalog-types-body', 'catalog-instances-body', 'catalog-relations-body'].forEach(id => {
            this.on(document.getElementById(id), 'click', event => this.handleTableAction(event));
        });
    }

    cleanup() {
        this.disposed = true;
        this.loadVersion++;
        this.listeners.forEach(([element, event, handler]) => element.removeEventListener(event, handler));
        this.listeners = [];
    }

    async configureFeatures() {
        if (this.disposed) return;
        try {
            const features = await graphqlClient.getEnabledFeatures();
            if (this.disposed) return;
            if (Array.isArray(features) && !features.includes('GenAi')) {
                document.getElementById('catalog-ai-btn').style.display = 'none';
            }
        } catch (_) { /* Legacy brokers do not report feature flags. */ }
    }

    async load() {
        if (this.disposed) return;
        const version = ++this.loadVersion;
        ui.clearError();
        ui.setLoading(true);
        try {
            const result = await graphqlClient.query(`
                query DataCatalogPage {
                    dataCatalogTypes { id namespace name description structure topicPattern createdAt updatedAt }
                    dataCatalogInstances { id typeId name baseTopic properties createdAt updatedAt }
                    dataCatalogRelations { sourceId targetId relationType }
                }
            `);
            if (this.disposed || version !== this.loadVersion) return;
            this.types = result.dataCatalogTypes || [];
            this.instances = result.dataCatalogInstances || [];
            this.relations = result.dataCatalogRelations || [];
            this.renderNamespaceOptions();
            this.render();
        } catch (error) {
            if (this.disposed || version !== this.loadVersion) return;
            ui.showError(`Failed to load the data catalog: ${error.message}`);
        } finally {
            if (!this.disposed && version === this.loadVersion) ui.setLoading(false);
        }
    }

    renderNamespaceOptions() {
        const select = document.getElementById('catalog-namespace-filter');
        const selected = select.value;
        const namespaces = [...new Set(this.types.map(type => type.namespace))].sort();
        select.innerHTML = '<option value="">All namespaces</option>' + namespaces
            .map(namespace => `<option value="${this.escape(namespace)}">${this.escape(namespace)}</option>`).join('');
        select.value = namespaces.includes(selected) ? selected : '';
    }

    visibleData() {
        const namespace = document.getElementById('catalog-namespace-filter').value;
        const search = document.getElementById('catalog-search').value.trim().toLowerCase();
        let types = namespace ? this.types.filter(type => type.namespace === namespace) : this.types;
        const typeIds = new Set(types.map(type => type.id));
        let instances = namespace ? this.instances.filter(instance => typeIds.has(instance.typeId)) : this.instances;
        const entityIds = new Set([...typeIds, ...instances.map(instance => instance.id)]);
        let relations = namespace ? this.relations.filter(relation => entityIds.has(relation.sourceId) && entityIds.has(relation.targetId)) : this.relations;
        if (search) {
            const has = (...values) => values.some(value => String(value || '').toLowerCase().includes(search));
            types = types.filter(type => has(type.id, type.name, type.namespace, type.topicPattern, type.description));
            instances = instances.filter(instance => has(instance.id, instance.name, instance.typeId, instance.baseTopic, JSON.stringify(instance.properties)));
            relations = relations.filter(relation => has(relation.sourceId, relation.targetId, relation.relationType));
        }
        return { types, instances, relations };
    }

    render() {
        const visible = this.visibleData();
        this.text('catalog-types-count', this.types.length);
        this.text('catalog-instances-count', this.instances.length);
        this.text('catalog-relations-count', this.relations.length);
        this.text('catalog-namespaces-count', new Set(this.types.map(type => type.namespace)).size);
        this.renderTypes(visible.types);
        this.renderInstances(visible.instances);
        this.renderRelations(visible.relations);
    }

    renderTypes(types) {
        const body = document.getElementById('catalog-types-body');
        if (!types.length) {
            body.innerHTML = ui.emptyRow(7, 'No object types found', 'Add a type or infer a catalog from MQTT topics.');
            return;
        }
        body.innerHTML = types.map(type => `<tr>
            <td><strong>${this.escape(type.name)}</strong>${type.description ? `<br><small>${this.escape(type.description)}</small>` : ''}</td>
            <td><code>${this.escape(type.id)}</code></td><td>${this.escape(type.namespace)}</td>
            <td><code>${this.escape(type.topicPattern || '-')}</code></td>
            <td class="num">${this.instances.filter(instance => instance.typeId === type.id).length}</td>
            <td>${this.date(type.updatedAt)}</td>
            <td><div class="action-buttons">
                <ix-icon-button data-action="edit-type" data-id="${this.attr(type.id)}" icon="highlight" variant="subtle-tertiary" title="Edit type" data-requires-auth></ix-icon-button>
                <ix-icon-button data-action="delete-type" data-id="${this.attr(type.id)}" icon="trashcan" variant="subtle-tertiary" class="btn-delete" title="Delete type" data-requires-auth></ix-icon-button>
            </div></td></tr>`).join('');
    }

    renderInstances(instances) {
        const body = document.getElementById('catalog-instances-body');
        if (!instances.length) {
            body.innerHTML = ui.emptyRow(7, 'No object instances found', 'Map a concrete MQTT topic to an object type.');
            return;
        }
        body.innerHTML = instances.map(instance => `<tr>
            <td><strong>${this.escape(instance.name)}</strong></td><td><code>${this.escape(instance.id)}</code></td>
            <td>${this.escape(this.typeName(instance.typeId))}</td><td><code>${this.escape(instance.baseTopic)}</code></td>
            <td>${Object.keys(instance.properties || {}).length}</td><td>${this.date(instance.updatedAt)}</td>
            <td><div class="action-buttons">
                <ix-icon-button data-action="edit-instance" data-id="${this.attr(instance.id)}" icon="highlight" variant="subtle-tertiary" title="Edit instance" data-requires-auth></ix-icon-button>
                <ix-icon-button data-action="delete-instance" data-id="${this.attr(instance.id)}" icon="trashcan" variant="subtle-tertiary" class="btn-delete" title="Delete instance" data-requires-auth></ix-icon-button>
            </div></td></tr>`).join('');
    }

    renderRelations(relations) {
        const body = document.getElementById('catalog-relations-body');
        if (!relations.length) {
            body.innerHTML = ui.emptyRow(4, 'No relationships found', 'Connect types and instances to describe your asset model.');
            return;
        }
        body.innerHTML = relations.map((relation, index) => `<tr>
            <td>${this.escape(this.entityName(relation.sourceId))}<br><small>${this.escape(relation.sourceId)}</small></td>
            <td><span class="status-badge status-enabled">${this.escape(relation.relationType)}</span></td>
            <td>${this.escape(this.entityName(relation.targetId))}<br><small>${this.escape(relation.targetId)}</small></td>
            <td><div class="action-buttons"><ix-icon-button data-action="delete-relation" data-index="${index}" icon="trashcan" variant="subtle-tertiary" class="btn-delete" title="Delete relationship" data-requires-auth></ix-icon-button></div></td>
        </tr>`).join('');
    }

    async handleTableAction(event) {
        if (this.disposed) return;
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        const id = button.dataset.id;
        if (action === 'edit-type') this.openType(this.types.find(type => type.id === id));
        if (action === 'edit-instance') this.openInstance(this.instances.find(instance => instance.id === id));
        if (action === 'delete-type') await this.deleteType(id);
        if (action === 'delete-instance') await this.deleteInstance(id);
        if (action === 'delete-relation') await this.deleteRelation(this.visibleData().relations[Number(button.dataset.index)]);
    }

    openType(type = null) {
        const body = document.createElement('div');
        body.innerHTML = `<div class="form-grid">
            <div class="form-group"><label for="dc-type-id">ID *</label><input id="dc-type-id" class="form-control" required placeholder="pump-type"></div>
            <div class="form-group"><label for="dc-type-name">Name *</label><input id="dc-type-name" class="form-control" required></div>
            <div class="form-group"><label for="dc-type-namespace">Namespace *</label><input id="dc-type-namespace" class="form-control" required value="default"></div>
            <div class="form-group"><label for="dc-type-pattern">MQTT topic pattern</label><input id="dc-type-pattern" class="form-control" placeholder="plants/+/pumps/+"></div>
            <div class="form-group span-all"><label for="dc-type-description">Description</label><textarea id="dc-type-description" class="form-control" rows="2"></textarea></div>
            <div class="form-group span-all"><label for="dc-type-structure">JSON Schema *</label><textarea id="dc-type-structure" class="form-control" rows="12" spellcheck="false"></textarea><small>A JSON object describing the payload structure.</small></div>
        </div>`;
        const modal = ui.modal({ title: type ? `Edit ${type.name}` : 'Add Object Type', body, size: 'lg', footer: [
            { label: 'Cancel' }, { label: 'Save Type', variant: 'primary', onClick: () => this.saveType(modal, type) }
        ] });
        this.value('dc-type-id', type?.id || '');
        this.value('dc-type-name', type?.name || '');
        this.value('dc-type-namespace', type?.namespace || 'default');
        this.value('dc-type-pattern', type?.topicPattern || '');
        this.value('dc-type-description', type?.description || '');
        this.value('dc-type-structure', JSON.stringify(type?.structure || { type: 'object', properties: {} }, null, 2));
        if (type) document.getElementById('dc-type-id').disabled = true;
    }

    async saveType(modal) {
        if (this.disposed) return;
        try {
            const input = {
                id: this.required('dc-type-id'), name: this.required('dc-type-name'),
                namespace: this.required('dc-type-namespace'),
                description: this.value('dc-type-description') || null,
                topicPattern: this.value('dc-type-pattern') || null,
                structure: this.jsonObject('dc-type-structure')
            };
            await graphqlClient.query(`mutation SaveCatalogType($input: DataCatalogTypeInput!) { dataCatalog { saveType(input: $input) { id } } }`, { input });
            if (this.disposed) return;
            modal.close(); ui.success(`Object type "${input.name}" saved`); await this.load();
        } catch (error) { if (!this.disposed) ui.error(`Could not save object type: ${error.message}`); }
    }

    openInstance(instance = null) {
        if (!this.types.length) { ui.error('Create an object type before adding an instance.'); return; }
        const options = this.types.map(type => `<option value="${this.attr(type.id)}">${this.escape(type.name)} (${this.escape(type.namespace)})</option>`).join('');
        const body = document.createElement('div');
        body.innerHTML = `<div class="form-grid">
            <div class="form-group"><label for="dc-instance-id">ID *</label><input id="dc-instance-id" class="form-control" required placeholder="pump-01"></div>
            <div class="form-group"><label for="dc-instance-name">Name *</label><input id="dc-instance-name" class="form-control" required></div>
            <div class="form-group"><label for="dc-instance-type">Object type *</label><select id="dc-instance-type" class="form-control">${options}</select></div>
            <div class="form-group"><label for="dc-instance-topic">Base MQTT topic *</label><input id="dc-instance-topic" class="form-control" required placeholder="plants/vienna/pumps/01"></div>
            <div class="form-group span-all"><label for="dc-instance-properties">Properties *</label><textarea id="dc-instance-properties" class="form-control" rows="10" spellcheck="false"></textarea><small>Instance metadata as a JSON object.</small></div>
        </div>`;
        const modal = ui.modal({ title: instance ? `Edit ${instance.name}` : 'Add Object Instance', body, size: 'lg', footer: [
            { label: 'Cancel' }, { label: 'Save Instance', variant: 'primary', onClick: () => this.saveInstance(modal) }
        ] });
        this.value('dc-instance-id', instance?.id || ''); this.value('dc-instance-name', instance?.name || '');
        this.value('dc-instance-type', instance?.typeId || this.types[0].id); this.value('dc-instance-topic', instance?.baseTopic || '');
        this.value('dc-instance-properties', JSON.stringify(instance?.properties || {}, null, 2));
        if (instance) document.getElementById('dc-instance-id').disabled = true;
    }

    async saveInstance(modal) {
        if (this.disposed) return;
        try {
            const input = { id: this.required('dc-instance-id'), name: this.required('dc-instance-name'),
                typeId: this.required('dc-instance-type'), baseTopic: this.required('dc-instance-topic'),
                properties: this.jsonObject('dc-instance-properties') };
            if (/[+#\u0000]/.test(input.baseTopic)) throw new Error('Base topic must be a concrete MQTT topic without + or #');
            await graphqlClient.query(`mutation SaveCatalogInstance($input: DataCatalogInstanceInput!) { dataCatalog { saveInstance(input: $input) { id } } }`, { input });
            if (this.disposed) return;
            modal.close(); ui.success(`Object instance "${input.name}" saved`); await this.load();
        } catch (error) { if (!this.disposed) ui.error(`Could not save object instance: ${error.message}`); }
    }

    openRelation() {
        const entities = [...this.types, ...this.instances];
        if (entities.length < 2) { ui.error('Create at least two catalog entities before adding a relationship.'); return; }
        const options = entities.map(entity => `<option value="${this.attr(entity.id)}">${this.escape(entity.name)} (${this.escape(entity.id)})</option>`).join('');
        const body = document.createElement('div');
        body.innerHTML = `<div class="form-grid">
            <div class="form-group"><label for="dc-relation-source">Source *</label><select id="dc-relation-source" class="form-control">${options}</select></div>
            <div class="form-group"><label for="dc-relation-type">Relationship *</label><input id="dc-relation-type" class="form-control" list="dc-relation-types" value="HasComponent"><datalist id="dc-relation-types"><option value="HasParent"><option value="HasChildren"><option value="HasComponent"><option value="ComponentOf"><option value="ConnectedTo"></datalist></div>
            <div class="form-group"><label for="dc-relation-target">Target *</label><select id="dc-relation-target" class="form-control">${options}</select></div>
        </div>`;
        const modal = ui.modal({ title: 'Add Relationship', body, size: 'lg', footer: [
            { label: 'Cancel' }, { label: 'Add Relationship', variant: 'primary', onClick: () => this.saveRelation(modal) }
        ] });
        if (entities[1]) this.value('dc-relation-target', entities[1].id);
    }

    async saveRelation(modal) {
        if (this.disposed) return;
        try {
            const input = { sourceId: this.required('dc-relation-source'), targetId: this.required('dc-relation-target'), relationType: this.required('dc-relation-type') };
            if (input.sourceId === input.targetId) throw new Error('Source and target must be different entities');
            await graphqlClient.query(`mutation SaveCatalogRelation($input: DataCatalogRelationInput!) { dataCatalog { saveRelation(input: $input) { sourceId } } }`, { input });
            if (this.disposed) return;
            modal.close(); ui.success('Relationship added'); await this.load();
        } catch (error) { if (!this.disposed) ui.error(`Could not add relationship: ${error.message}`); }
    }

    async deleteType(id) {
        if (this.disposed) return;
        const type = this.types.find(item => item.id === id);
        const count = this.instances.filter(item => item.typeId === id).length;
        if (!await ui.showConfirm({ title: 'Delete object type', message: `Delete "${type?.name || id}"? ${count} instance(s) and their relationships will also be deleted.`, confirmText: 'Delete', type: 'danger' })) return;
        if (this.disposed) return;
        await this.mutateDelete(`mutation DeleteCatalogType($id: String!) { dataCatalog { deleteType(id: $id) } }`, { id }, 'Object type deleted');
    }

    async deleteInstance(id) {
        if (this.disposed) return;
        const instance = this.instances.find(item => item.id === id);
        if (!await ui.showConfirm({ title: 'Delete object instance', message: `Delete "${instance?.name || id}" and its relationships?`, confirmText: 'Delete', type: 'danger' })) return;
        if (this.disposed) return;
        await this.mutateDelete(`mutation DeleteCatalogInstance($id: String!) { dataCatalog { deleteInstance(id: $id) } }`, { id }, 'Object instance deleted');
    }

    async deleteRelation(relation) {
        if (this.disposed) return;
        if (!relation || !await ui.showConfirm({ title: 'Delete relationship', message: `Delete ${relation.sourceId} ${relation.relationType} ${relation.targetId}?`, confirmText: 'Delete', type: 'danger' })) return;
        if (this.disposed) return;
        await this.mutateDelete(`mutation DeleteCatalogRelation($sourceId: String!, $targetId: String!, $relationType: String!) { dataCatalog { deleteRelation(sourceId: $sourceId, targetId: $targetId, relationType: $relationType) } }`, relation, 'Relationship deleted');
    }

    async mutateDelete(query, variables, message) {
        if (this.disposed) return;
        try { await graphqlClient.query(query, variables); if (this.disposed) return; ui.success(message); await this.load(); }
        catch (error) { if (!this.disposed) ui.error(`Delete failed: ${error.message}`); }
    }

    async exportCatalog() {
        if (this.disposed) return;
        try {
            const namespace = document.getElementById('catalog-namespace-filter').value || null;
            const result = await graphqlClient.query(`mutation ExportDataCatalog($namespace: String) { dataCatalog { exportCatalog(namespace: $namespace) } }`, { namespace });
            if (this.disposed) return;
            const data = result.dataCatalog.exportCatalog;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
            link.download = `monstermq-data-catalog${namespace ? `-${namespace}` : ''}.json`; link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 0); ui.success('Data catalog exported');
        } catch (error) { if (!this.disposed) ui.error(`Export failed: ${error.message}`); }
    }

    async importFile(event) {
        if (this.disposed) return;
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (this.disposed) return;
            const result = await this.importCatalog(data);
            if (this.disposed) return;
            if (!result.success) throw new Error(result.errors.join('; ') || 'Import failed');
            ui.success(`Imported ${result.typesImported} types, ${result.instancesImported} instances, and ${result.relationsImported} relationships`);
            await this.load();
        } catch (error) { if (!this.disposed) ui.error(`Import failed: ${error.message}`); }
    }

    async importCatalog(data) {
        if (this.disposed) return;
        const result = await graphqlClient.query(`mutation ImportDataCatalog($data: JSON!) { dataCatalog { importCatalog(data: $data) { success typesImported instancesImported relationsImported failed errors } } }`, { data });
        if (this.disposed) return;
        return result.dataCatalog.importCatalog;
    }

    openDiscovery(ai) {
        const body = document.createElement('div');
        body.innerHTML = `<div class="form-grid">
            <div class="form-group"><label for="dc-discovery-pattern">MQTT topic pattern *</label><input id="dc-discovery-pattern" class="form-control" value="#"></div>
            <div class="form-group"><label for="dc-discovery-archive">Archive group</label><input id="dc-discovery-archive" class="form-control" value="Default"></div>
            ${ai ? '<div class="form-group span-all"><label for="dc-discovery-prompt">Guidance for AI</label><textarea id="dc-discovery-prompt" class="form-control" rows="4" placeholder="Describe the desired asset hierarchy or naming conventions"></textarea></div>' : ''}
        </div>`;
        const modal = ui.modal({ title: ai ? 'Propose Catalog with AI' : 'Infer Catalog from Topics', body, size: 'lg', footer: [
            { label: 'Cancel' }, { label: ai ? 'Generate Proposal' : 'Infer Catalog', variant: 'primary', onClick: () => this.discover(modal, ai) }
        ] });
    }

    async discover(modal, ai) {
        if (this.disposed) return;
        try {
            const topicPattern = this.required('dc-discovery-pattern');
            const archiveGroup = this.value('dc-discovery-archive') || 'Default';
            let proposal;
            if (ai) {
                const prompt = this.value('dc-discovery-prompt') || null;
                const result = await graphqlClient.query(`query ProposeDataCatalog($topicPattern: String!, $archiveGroup: String, $prompt: String) { genai { proposeDataCatalog(topicPattern: $topicPattern, archiveGroup: $archiveGroup, prompt: $prompt) { types { id namespace name description structure topicPattern } instances { id typeId name baseTopic properties } relations { sourceId targetId relationType } topicsAnalyzed summary error } } }`, { topicPattern, archiveGroup, prompt });
                if (this.disposed) return;
                proposal = result.genai?.proposeDataCatalog;
            } else {
                const result = await graphqlClient.query(`query InferDataCatalog($topicPattern: String!, $archiveGroup: String) { inferDataCatalog(topicPattern: $topicPattern, archiveGroup: $archiveGroup) { types { id namespace name description structure topicPattern } instances { id typeId name baseTopic properties } relations { sourceId targetId relationType } topicsAnalyzed summary error } }`, { topicPattern, archiveGroup });
                if (this.disposed) return;
                proposal = result.inferDataCatalog;
            }
            if (!proposal) throw new Error(ai ? 'GenAI is disabled or not configured' : 'No proposal returned');
            if (proposal.error) throw new Error(proposal.error);
            modal.close(); this.openProposal(proposal, ai ? 'AI Catalog Proposal' : 'Inferred Catalog Proposal');
        } catch (error) { if (!this.disposed) ui.error(`Catalog discovery failed: ${error.message}`); }
    }

    openProposal(proposal, title) {
        const catalog = { types: proposal.types || [], instances: proposal.instances || [], relations: proposal.relations || [] };
        const body = document.createElement('div');
        body.innerHTML = `<p>${this.escape(proposal.summary || `Analyzed ${proposal.topicsAnalyzed || 0} topics.`)}</p>
            <div class="info-grid"><div class="info-item"><span class="info-label">Types</span><span class="info-value">${catalog.types.length}</span></div><div class="info-item"><span class="info-label">Instances</span><span class="info-value">${catalog.instances.length}</span></div><div class="info-item"><span class="info-label">Relations</span><span class="info-value">${catalog.relations.length}</span></div><div class="info-item"><span class="info-label">Topics analyzed</span><span class="info-value">${proposal.topicsAnalyzed || 0}</span></div></div>
            <div class="form-group"><label for="dc-proposal-json">Review JSON</label><textarea id="dc-proposal-json" class="form-control" rows="18" spellcheck="false"></textarea></div>`;
        const modal = ui.modal({ title, body, size: 'lg', footer: [
            { label: 'Cancel' }, { label: 'Import Proposal', variant: 'primary', onClick: () => this.applyProposal(modal) }
        ] });
        this.value('dc-proposal-json', JSON.stringify(catalog, null, 2));
    }

    async applyProposal(modal) {
        if (this.disposed) return;
        try {
            const catalog = this.jsonObject('dc-proposal-json');
            const result = await this.importCatalog(catalog);
            if (this.disposed) return;
            if (!result.success) throw new Error(result.errors.join('; ') || 'Import failed');
            modal.close(); ui.success(`Imported proposal: ${result.typesImported} types, ${result.instancesImported} instances, ${result.relationsImported} relationships`); await this.load();
        } catch (error) { if (!this.disposed) ui.error(`Could not import proposal: ${error.message}`); }
    }

    required(id) { const value = this.value(id).trim(); if (!value) throw new Error(`${document.querySelector(`label[for="${id}"]`)?.textContent || id} is required`); return value; }
    jsonObject(id) { const value = JSON.parse(this.value(id)); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON value must be an object'); return value; }
    value(id, value) { const element = document.getElementById(id); if (arguments.length === 2) element.value = value; return element?.value || ''; }
    text(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
    typeName(id) { return this.types.find(type => type.id === id)?.name || id; }
    entityName(id) { return [...this.types, ...this.instances].find(entity => entity.id === id)?.name || id; }
    date(value) { return value ? new Date(value).toLocaleString() : '-'; }
    attr(value) { return this.escape(value).replace(/`/g, '&#96;'); }
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
}

function startDataCatalogPage() {
    if (window.dataCatalogManager) window.dataCatalogManager.cleanup();
    window.dataCatalogManager = new DataCatalogManager();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startDataCatalogPage, { once: true });
else startDataCatalogPage();
