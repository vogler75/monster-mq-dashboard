// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
// GenAI Provider Detail Page

class GenAiProviderDetailManager {
    constructor() {
        this.client = new GraphQLDashboardClient();
        this.providerName = null;
        this.isNew = false;
        this.providerData = null;
        this.init();
    }

    async init() {
        if (!window.isLoggedIn || !window.isLoggedIn()) return;
        const params = new URLSearchParams(window.location.search);
        this.providerName = params.get('name');
        this.isNew = params.get('new') === 'true';

        if (this.isNew) {
            this.showNewForm();
        } else if (this.providerName) {
            await this.loadProvider();
        } else {
            this.showAlert('No provider specified.', 'error');
        }
    }

    showNewForm() {
        document.getElementById('page-title').textContent = 'Add AI Provider';
        document.getElementById('page-subtitle').textContent = 'Create a new GenAI provider';
        document.getElementById('provider-name').disabled = false;
        document.getElementById('save-btn').textContent = 'Create Provider';
        document.getElementById('delete-btn').style.display = 'none';
        document.getElementById('provider-content').style.display = 'block';
        const serviceSelect = document.getElementById('provider-service');
        if (serviceSelect) serviceSelect.value = 'openrouter';
        const typeSelect = document.getElementById('provider-type');
        if (typeSelect) typeSelect.value = 'chat';
        this.onServiceOrTypeChange();
    }

    async loadProvider() {
        try {
            const result = await this.client.query(`
                query GetProvider($name: String!) {
                    genAiProvider(name: $name) {
                        name type model apiKey endpoint serviceVersion baseUrl temperature maxTokens enabled source createdAt updatedAt
                    }
                }
            `, { name: this.providerName });

            if (!result.genAiProvider) {
                this.showAlert('Provider not found.', 'error');
                return;
            }

            this.providerData = result.genAiProvider;
            this.populateForm(result.genAiProvider);

            // Timestamps
            if (!this.isNew) {
                document.getElementById('timestamps-section').style.display = 'block';
                document.getElementById('created-at').textContent = this.formatDateTime(result.genAiProvider.createdAt);
                document.getElementById('updated-at').textContent = this.formatDateTime(result.genAiProvider.updatedAt);
            }
        } catch (e) {
            this.showAlert('Failed to load provider: ' + e.message, 'error');
        }
    }

    formatDateTime(isoString) {
        if (!isoString) return '-';
        try {
            return new Date(isoString).toLocaleString();
        } catch (e) {
            return isoString;
        }
    }

    populateForm(p) {
        const rawType = (p.type || 'gemini').toLowerCase();
        const isDecision = rawType === 'openrouter-decision' || rawType === 'decision' || rawType.endsWith('-decision');
        const service = isDecision ? (rawType.replace('-decision', '') || 'openrouter') : rawType;

        document.getElementById('page-title').textContent = 'AI Provider: ' + p.name;
        document.getElementById('page-subtitle').textContent = (isDecision ? `${service} (Decision Provider)` : `${service} (Chat / LLM)`) + (p.source === 'config' ? ' · from config.yaml' : '');

        document.getElementById('provider-name').value = p.name;
        document.getElementById('provider-name').disabled = true;

        const serviceSelect = document.getElementById('provider-service');
        if (serviceSelect) {
            if (!Array.from(serviceSelect.options).some(o => o.value === service)) {
                const opt = document.createElement('option');
                opt.value = service;
                opt.textContent = service;
                serviceSelect.appendChild(opt);
            }
            serviceSelect.value = service;
        }

        const typeSelect = document.getElementById('provider-type');
        if (typeSelect) {
            typeSelect.value = isDecision ? 'decision' : 'chat';
        }

        document.getElementById('provider-model').value = p.model || '';
        document.getElementById('provider-api-key').value = '';
        document.getElementById('provider-api-key').placeholder = p.apiKey ? 'Stored (enter to replace)' : 'No key configured';
        document.getElementById('provider-endpoint').value = p.endpoint || '';
        document.getElementById('provider-service-version').value = p.serviceVersion || '';
        document.getElementById('provider-base-url').value = p.baseUrl || '';
        document.getElementById('provider-temperature').value = p.temperature != null ? p.temperature : 0.7;
        document.getElementById('provider-max-tokens').value = p.maxTokens || '';
        document.getElementById('provider-enabled').checked = p.enabled !== false;

        if (p.source === 'config') {
            // Read-only: from config.yaml
            document.getElementById('alert-area').innerHTML =
                '<div class="source-notice">⚙️ This provider is configured in <strong>config.yaml</strong> and cannot be edited here. Restart the broker to apply changes.</div>';
            document.querySelectorAll('#provider-content input, #provider-content select').forEach(el => el.disabled = true);
            document.getElementById('save-btn').style.display = 'none';
            document.getElementById('delete-btn').style.display = 'none';
        } else {
            document.getElementById('delete-btn').style.display = '';
        }

        document.getElementById('provider-content').style.display = 'block';
        this.onServiceOrTypeChange();
    }

    onServiceOrTypeChange() {
        const serviceSelect = document.getElementById('provider-service');
        const typeSelect = document.getElementById('provider-type');
        const service = serviceSelect?.value || 'openrouter';
        const typeKind = typeSelect?.value || 'chat';
        const isDecision = typeKind === 'decision';

        // Currently, OpenRouter is the decision provider
        if (isDecision && service !== 'openrouter') {
            serviceSelect.value = 'openrouter';
        }
        const activeService = serviceSelect?.value || 'openrouter';

        const isAzure = activeService === 'azure-openai';
        const isOpenAI = activeService === 'openai';
        const isOpenRouter = activeService === 'openrouter';
        const isOllama = activeService === 'ollama';
        const isLlamaCpp = activeService === 'llamacpp';

        document.getElementById('provider-endpoint-group').style.display = (isAzure || isOpenAI || isLlamaCpp || isOpenRouter) ? '' : 'none';
        document.getElementById('provider-service-version-group').style.display = isAzure ? '' : 'none';
        document.getElementById('provider-base-url-group').style.display = isOllama ? '' : 'none';

        const endpointLabel = document.getElementById('provider-endpoint-label');
        const endpointInput = document.getElementById('provider-endpoint');
        if (isAzure) {
            endpointLabel.textContent = 'Azure Endpoint';
            endpointInput.placeholder = 'https://<resource>.openai.azure.com/';
        } else if (isOpenRouter && isDecision) {
            endpointLabel.textContent = 'Decisions Endpoint (optional)';
            endpointInput.placeholder = 'https://openrouter.ai/api/alpha/decisions (leave blank for default)';
        } else if (isOpenRouter) {
            endpointLabel.textContent = 'OpenRouter Base URL (optional)';
            endpointInput.placeholder = 'https://openrouter.ai/api/v1 (leave blank for default)';
        } else if (isOpenAI) {
            endpointLabel.textContent = 'Custom Endpoint (optional)';
            endpointInput.placeholder = 'https://api.openai.com/v1 (leave blank for default)';
        } else if (isLlamaCpp) {
            endpointLabel.textContent = 'llama.cpp Host URL';
            endpointInput.placeholder = 'http://localhost:8080/v1';
        }

        const modelInput = document.getElementById('provider-model');
        if (isDecision) {
            modelInput.placeholder = 'typesafe/jev-1.13';
        } else {
            const placeholders = {
                'gemini': 'gemini-2.0-flash',
                'claude': 'claude-sonnet-4-20250514',
                'openai': 'gpt-4o',
                'ollama': 'llama3',
                'azure-openai': 'deployment-name',
                'llamacpp': 'local-model',
                'openrouter': 'anthropic/claude-3.5-sonnet'
            };
            modelInput.placeholder = placeholders[activeService] || 'Model name';
        }
    }

    onTypeChange() {
        this.onServiceOrTypeChange();
    }

    collectFormData() {
        const service = document.getElementById('provider-service')?.value || 'gemini';
        const typeKind = document.getElementById('provider-type')?.value || 'chat';
        const effectiveType = typeKind === 'decision' ? `${service}-decision` : service;

        const data = {
            type:           effectiveType,
            model:          document.getElementById('provider-model').value.trim() || null,
            endpoint:       document.getElementById('provider-endpoint').value.trim() || null,
            serviceVersion: document.getElementById('provider-service-version').value.trim() || null,
            baseUrl:        document.getElementById('provider-base-url').value.trim() || null,
            temperature:    document.getElementById('provider-temperature').value !== '' ? parseFloat(document.getElementById('provider-temperature').value) : 0.7,
            maxTokens:      parseInt(document.getElementById('provider-max-tokens').value) || null,
            enabled:        document.getElementById('provider-enabled').checked
        };
        const apiKey = document.getElementById('provider-api-key').value;
        if (apiKey) data.apiKey = apiKey;
        return data;
    }

    async save() {
        const name = document.getElementById('provider-name').value.trim();

        if (this.isNew) {
            const nameError = window.validateNameInput(name, 'Provider');
            if (nameError) {
                this.showAlert(nameError, 'error');
                return;
            }
        }

        const input = this.collectFormData();

        try {
            if (this.isNew) {
                const result = await this.client.query(`
                    mutation CreateProvider($name: String!, $input: GenAiProviderInput!) {
                        genAiProvider { create(name: $name, input: $input) { name } }
                    }
                `, { name, input });
                if (result.genAiProvider?.create) {
                    ui.markPageSaved();
                    this.showAlert('Provider "' + name + '" created successfully.', 'success');
                    setTimeout(() => window.navigateTo('/pages/genai-provider-detail.html?name=' + encodeURIComponent(name)), 800);
                }
            } else {
                const result = await this.client.query(`
                    mutation UpdateProvider($name: String!, $input: GenAiProviderInput!) {
                        genAiProvider { update(name: $name, input: $input) { name } }
                    }
                `, { name: this.providerName, input });
                if (result.genAiProvider?.update) {
                    ui.markPageSaved();
                    this.showAlert('Provider updated successfully.', 'success');
                    await this.loadProvider();
                }
            }
        } catch (e) {
            this.showAlert('Save failed: ' + e.message, 'error');
        }
    }

    async deleteProvider() {
        if (!await ui.confirmDelete(this.providerName, { title: 'Delete AI provider' })) return;
        try {
            const result = await this.client.query(`
                mutation DeleteProvider($name: String!) {
                    genAiProvider { delete(name: $name) }
                }
            `, { name: this.providerName });
            if (result.genAiProvider?.delete) {
                ui.markPageSaved();
                window.navigateTo('/pages/genai-providers.html');
            }
        } catch (e) {
            this.showAlert('Delete failed: ' + e.message, 'error');
        }
    }

    showAlert(msg, type) {
        if (type === 'success') ui.success(msg);
        else ui.showError(msg);
    }
}

const providerDetailManager = new GenAiProviderDetailManager();

page.expose({
    get GenAiProviderDetailManager() { return GenAiProviderDetailManager; },
    get providerDetailManager() { return providerDetailManager; }
});
page.ready();
return () => page.dispose();
}
