// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
    const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
        requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
        IntersectionObserver, WebSocket, EventSource } = page;

    class BrokerScriptDetailManager {
        constructor() {
            this.scriptName = null;
            this.isNew = true;
            this.scriptData = null;
            this.topicFilters = [];
            this.clusterNodes = [];
            this.init();
        }

        async init() {
            if (!window.isLoggedIn()) {
                window.location.href = '/pages/login.html';
                return;
            }

            const params = new URLSearchParams(window.location.search);
            this.scriptName = params.get('name');
            this.isNew = !this.scriptName;

            this.attachEventListeners();
            await this.loadClusterNodes();
            await this.checkGenAiSupport();

            if (!this.isNew) {
                await this.loadScript();
            } else {
                this.setupNewMode();
            }
        }

        async checkGenAiSupport() {
            try {
                this.hasGenAi = await window.graphqlClient.hasQueryField('genai');
            } catch (e) {
                this.hasGenAi = false;
            }
            const aiPanel = document.querySelector('.ai-panel');
            if (aiPanel) {
                aiPanel.style.display = this.hasGenAi ? 'block' : 'none';
            }
        }

        async loadClusterNodes() {
            try {
                const query = `query GetBrokers { brokers { nodeId isCurrent } }`;
                const result = await window.graphqlClient.query(query);
                const brokers = result?.brokers || [];
                const select = document.getElementById('script-node-id');
                if (select) {
                    select.innerHTML = '<option value="*">* (All Cluster Nodes)</option><option value="local">local (Current Node)</option>';
                    brokers.forEach(b => {
                        if (b.nodeId && b.nodeId !== 'local' && b.nodeId !== '*') {
                            const opt = document.createElement('option');
                            opt.value = b.nodeId;
                            opt.textContent = b.nodeId + (b.isCurrent ? ' (Current)' : '');
                            select.appendChild(opt);
                        }
                    });
                }
            } catch (err) {
                console.warn('Failed to load cluster nodes:', err);
            }
        }

        attachEventListeners() {
            const saveBtn = document.getElementById('save-btn');
            if (saveBtn) saveBtn.addEventListener('click', () => this.saveScript());

            const deleteBtn = document.getElementById('delete-btn');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteScript());

            const testBtn = document.getElementById('test-run-btn');
            if (testBtn) testBtn.addEventListener('click', () => this.runTestSandbox());

            const addFilterBtn = document.getElementById('add-topic-filter-btn');
            if (addFilterBtn) addFilterBtn.addEventListener('click', () => this.addTopicFilterRow(''));

            const triggerSelect = document.getElementById('script-trigger-type');
            if (triggerSelect) {
                triggerSelect.addEventListener('change', () => this.updateTriggerVisibility());
            }

            const langSelect = document.getElementById('script-language');
            if (langSelect) {
                langSelect.addEventListener('change', () => this.onLanguageChange());
            }

            const apiDocsBtn = document.getElementById('api-docs-btn');
            if (apiDocsBtn) {
                apiDocsBtn.addEventListener('click', () => {
                    if (window.openHelp) window.openHelp('broker-script-help');
                });
            }

            const refreshLogsBtn = document.getElementById('refresh-logs-btn');
            if (refreshLogsBtn) {
                refreshLogsBtn.addEventListener('click', () => this.loadRecentLogs());
            }

            // Quick Snippets click
            const snippetBar = document.getElementById('snippet-bar');
            if (snippetBar) {
                snippetBar.addEventListener('click', (e) => {
                    const btn = e.target.closest('.snippet-btn');
                    if (btn && btn.dataset.snippet) {
                        this.insertSnippet(btn.dataset.snippet);
                    }
                });
            }

            // AI quick prompt chips
            document.querySelectorAll('.ai-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const promptInput = document.getElementById('ai-user-prompt');
                    if (promptInput) {
                        promptInput.value = chip.dataset.prompt;
                        promptInput.focus();
                    }
                });
            });

            // AI generate button
            const aiGenBtn = document.getElementById('ai-generate-btn');
            if (aiGenBtn) {
                aiGenBtn.addEventListener('click', () => this.generateAiScript());
            }

            // Indent on Tab key in editor
            const editor = document.getElementById('script-code-editor');
            if (editor) {
                editor.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        const start = editor.selectionStart;
                        const end = editor.selectionEnd;
                        editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
                        editor.selectionStart = editor.selectionEnd = start + 4;
                    }
                });
            }
        }

        setupNewMode() {
            document.getElementById('breadcrumb-name').textContent = 'New Script';
            document.getElementById('page-title').textContent = 'Configure New Broker Script';
            document.getElementById('script-name').disabled = false;
            document.getElementById('delete-btn').style.display = 'none';
            document.getElementById('recent-logs-section').style.display = 'none';

            // Add default topic filter
            this.addTopicFilterRow('sensors/#');

            // Default template in editor
            this.setInitialTemplate('starlark');
            this.updateTriggerVisibility();
            this.updateAiLangIndicator();
        }

        async loadScript() {
            ui.setLoading(true);
            ui.clearError();
            try {
                const query = `
                    query GetScript($name: String!) {
                        script(name: $name) {
                            name
                            namespace
                            nodeId
                            enabled
                            createdAt
                            updatedAt
                            isOnCurrentNode
                            executionCount
                            errorCount
                            lastExecutionTime
                            lastExecutionStatus
                            recentLogs
                            config {
                                language
                                script
                                triggerType
                                topicFilters
                                triggerOnChangeOnly
                                timerIntervalMs
                                instanceMode
                                timeoutMs
                                description
                            }
                        }
                    }
                `;
                const result = await window.graphqlClient.query(query, { name: this.scriptName });
                this.scriptData = result?.script;
                if (!this.scriptData) {
                    throw new Error(`Script "${this.scriptName}" not found`);
                }

                // Populate fields
                document.getElementById('breadcrumb-name').textContent = this.scriptData.name;
                document.getElementById('page-title').textContent = `Edit Script: ${this.scriptData.name}`;
                document.getElementById('page-subtitle').textContent = `Script in namespace "${this.scriptData.namespace || 'script'}"`;

                const nameInput = document.getElementById('script-name');
                nameInput.value = this.scriptData.name;
                nameInput.disabled = true;

                document.getElementById('script-namespace').value = this.scriptData.namespace || 'script';
                document.getElementById('script-node-id').value = this.scriptData.nodeId || '*';
                document.getElementById('script-enabled').checked = this.scriptData.enabled;
                document.getElementById('script-description').value = this.scriptData.config?.description || '';

                const lang = this.scriptData.config?.language || 'starlark';
                document.getElementById('script-language').value = lang;

                const trig = this.scriptData.config?.triggerType || 'TOPIC';
                document.getElementById('script-trigger-type').value = trig;

                document.getElementById('script-instance-mode').value = this.scriptData.config?.instanceMode || 'SINGLETON';
                document.getElementById('script-timeout').value = this.scriptData.config?.timeoutMs || 200;
                document.getElementById('script-timer-interval').value = this.scriptData.config?.timerIntervalMs || 5000;
                document.getElementById('script-trigger-on-change').checked = !!this.scriptData.config?.triggerOnChangeOnly;

                // Topic filters
                const filterContainer = document.getElementById('topic-filters-list');
                filterContainer.innerHTML = '';
                const filters = this.scriptData.config?.topicFilters || [];
                if (filters.length > 0) {
                    filters.forEach(f => this.addTopicFilterRow(f));
                } else {
                    this.addTopicFilterRow('');
                }

                // Script Code
                document.getElementById('script-code-editor').value = this.scriptData.config?.script || '';

                // UI controls
                document.getElementById('delete-btn').style.display = 'inline-flex';
                document.getElementById('recent-logs-section').style.display = 'block';
                this.renderRecentLogs(this.scriptData.recentLogs || []);

                this.updateTriggerVisibility();
                this.updateAiLangIndicator();
                ui.markPageSaved();
            } catch (err) {
                console.error('Failed to load script:', err);
                ui.showError('Failed to load script: ' + (err.message || err));
            } finally {
                ui.setLoading(false);
            }
        }

        onLanguageChange() {
            this.updateAiLangIndicator();
            const editor = document.getElementById('script-code-editor');
            if (!editor.value.trim()) {
                const lang = document.getElementById('script-language').value;
                this.setInitialTemplate(lang);
            }
        }

        updateAiLangIndicator() {
            const langSelect = document.getElementById('script-language');
            const ind = document.getElementById('ai-lang-indicator');
            if (ind && langSelect) {
                const text = langSelect.options[langSelect.selectedIndex]?.text || langSelect.value;
                ind.textContent = text.split(' ')[0];
            }
        }

        setInitialTemplate(lang) {
            const editor = document.getElementById('script-code-editor');
            if (!editor) return;

            if (lang === 'javascript') {
                editor.value = `// JavaScript Broker Script
if (typeof msg !== "undefined" && msg !== null) {
    log.info(\`Received message on: \${msg.topic}\`);
    // Process payload
    if (typeof msg.payload === "object") {
        // e.g. mqtt.publish("processed/" + msg.topic, JSON.stringify(msg.payload));
    }
}
`;
            } else {
                editor.value = `# ${lang === 'python' ? 'Python' : 'Starlark'} Broker Script
if msg != None:
    log.info("Received message on: " + msg["topic"])
    
    # Process payload (dict or string)
    payload = msg["payload"]
    if type(payload) == "dict":
        temp = payload.get("temperature", 0)
        if temp > 50:
            mqtt.publish("alerts/temp", json.encode({"val": temp, "status": "ALARM"}), retain=True)
`;
            }
        }

        updateTriggerVisibility() {
            const trig = document.getElementById('script-trigger-type').value;
            const timerGroup = document.getElementById('timer-settings-group');
            const topicGroup = document.getElementById('topic-settings-group');
            const onChangeGroup = document.getElementById('on-change-settings-group');

            const hasTopic = trig === 'TOPIC' || trig === 'BOTH';
            const hasTimer = trig === 'TIMER' || trig === 'BOTH';

            if (timerGroup) timerGroup.style.display = hasTimer ? 'block' : 'none';
            if (topicGroup) topicGroup.style.display = hasTopic ? 'block' : 'none';
            if (onChangeGroup) onChangeGroup.style.display = hasTopic ? 'flex' : 'none';
        }

        addTopicFilterRow(val = '') {
            const container = document.getElementById('topic-filters-list');
            if (!container) return;

            const row = document.createElement('div');
            row.className = 'topic-filter-row';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-control topic-filter-input';
            input.placeholder = 'e.g. sensors/+/temperature or alerts/#';
            input.value = val;

            const removeBtn = document.createElement('ix-icon-button');
            removeBtn.setAttribute('icon', 'trashcan');
            removeBtn.setAttribute('variant', 'subtle-tertiary');
            removeBtn.setAttribute('title', 'Remove filter');
            removeBtn.addEventListener('click', () => {
                row.remove();
            });

            row.appendChild(input);
            row.appendChild(removeBtn);
            container.appendChild(row);
        }

        collectTopicFilters() {
            const inputs = document.querySelectorAll('.topic-filter-input');
            const filters = [];
            inputs.forEach(inp => {
                const val = inp.value.trim();
                if (val) filters.push(val);
            });
            return filters;
        }

        insertSnippet(type) {
            const editor = document.getElementById('script-code-editor');
            if (!editor) return;

            const lang = document.getElementById('script-language').value;
            const isJs = lang === 'javascript';

            let snippet = '';
            switch (type) {
                case 'publish':
                    snippet = isJs
                        ? 'mqtt.publish("topic/name", JSON.stringify({ ok: true }), 0, false);'
                        : 'mqtt.publish("topic/name", json.encode({"ok": True}), qos=0, retain=False)';
                    break;
                case 'archive_last':
                    snippet = isJs
                        ? 'const lastVal = archive.getLastValue("topic/name", "Default");'
                        : 'last_val = archive.get_last_value("topic/name", archive_group="Default")';
                    break;
                case 'db_query':
                    snippet = isJs
                        ? 'const rows = db.query("PostgresStore", "SELECT * FROM metrics WHERE id = $1", [1]);'
                        : 'rows = db.query("PostgresStore", "SELECT * FROM metrics WHERE id = $1", [1])';
                    break;
                case 'state':
                    snippet = isJs
                        ? 'state.counter = (state.counter || 0) + 1;'
                        : 'state["counter"] = state.get("counter", 0) + 1';
                    break;
                case 'storage':
                    snippet = isJs
                        ? 'storage.set("last_run", Date.now());\nconst saved = storage.get("last_run");'
                        : 'storage.set("last_run", "saved_value")\nsaved = storage.get("last_run", default=None)';
                    break;
                case 'call':
                    snippet = isJs
                        ? 'const result = scripts.call("TargetScriptName", { param: "val" });'
                        : 'result = scripts.call("TargetScriptName", {"param": "val"})';
                    break;
            }

            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + snippet + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + snippet.length;
            editor.focus();
        }

        buildSystemPrompt(language) {
            const isPython = language === 'python' || language === 'starlark';
            const langName = isPython ? 'Python / Starlark' : 'JavaScript (ES2022)';
            const codeTag = isPython ? 'python' : 'javascript';

            return `You are an expert ${langName} script assistant for MonsterMQ edge and enterprise MQTT brokers.
The scripts execute in a sandboxed ${langName} environment with the following bindings:

1. 'msg' (Incoming MQTT message, null/None on timer or callable):
   - ${isPython ? 'msg["topic"], msg["payload"], msg["raw_payload"], msg["timestamp"], msg["qos"], msg["retain"]' : 'msg.topic, msg.payload, msg.raw_payload, msg.timestamp, msg.qos, msg.retain'}

2. 'mqtt' (Broker MQTT proxy):
   - ${isPython ? 'mqtt.publish(topic, payload, qos=0, retain=False)' : 'mqtt.publish(topic, payload, qos=0, retain=false)'}
   - ${isPython ? 'mqtt.subscribe(filter, callback_fn)' : 'mqtt.subscribe(filter, callback_fn)'}

3. 'archive' (Archive & historical queries):
   - ${isPython ? 'archive.get_last_value(topic, archive_group="Default")' : 'archive.get_last_value(topic, "Default")'}
   - ${isPython ? 'archive.get_history(topic, from_time=None, to_time=None, limit=100)' : 'archive.get_history(topic, fromTime, toTime, limit)'}

4. 'db' (Database connections):
   - ${isPython ? 'db.query(conn_name, sql, args=[])' : 'db.query(conn_name, sql, args)'}
   - ${isPython ? 'db.execute(conn_name, sql, args=[])' : 'db.execute(conn_name, sql, args)'}

5. Scoped Storage:
   - 'state': mutable dict/object local to this script instance across invocations
   - 'global': node-wide shared storage (${isPython ? 'global.get(k), global.set(k, v)' : 'global.get(k), global.set(k, v)'})
   - 'storage': persistent KV storage: storage.get(key, default), storage.set(key, val), storage.delete(key)

6. 'scripts' (Inter-script calls):
   - ${isPython ? 'scripts.call(script_name, args={})' : 'scripts.call(script_name, args)'}

7. 'log' / 'console':
   - log.info(...), log.warn(...), log.error(...)
   - ${isPython ? 'json.encode(obj), json.decode(str)' : 'JSON.stringify(obj), JSON.parse(str)'}

Goal: Return ONLY the executable ${langName} script inside a standard \`\`\`${codeTag} code block, followed by a brief explanation.`;
        }

        async generateAiScript() {
            const promptInput = document.getElementById('ai-user-prompt');
            const feedback = document.getElementById('ai-feedback');
            const genBtn = document.getElementById('ai-generate-btn');
            const userPrompt = promptInput?.value?.trim();

            if (!this.hasGenAi) {
                ui.toast('GenAI is not supported or enabled on this broker.', 'warn');
                return;
            }

            if (!userPrompt) {
                ui.toast('Please enter a description for the AI assistant', 'warn');
                promptInput?.focus();
                return;
            }

            const lang = document.getElementById('script-language').value;
            const currentCode = document.getElementById('script-code-editor').value;
            const triggerType = document.getElementById('script-trigger-type').value;
            const topicFilters = this.collectTopicFilters();

            feedback.className = 'ai-feedback loading';
            feedback.innerHTML = '<ix-spinner size="small"></ix-spinner> Generating script with AI...';
            genBtn.disabled = true;

            try {
                const systemPrompt = this.buildSystemPrompt(lang);
                const contextStr = `Configured Triggers:\n- Trigger Type: ${triggerType}\n- Topics: ${topicFilters.join(', ') || 'None'}\n- Language: ${lang}`;

                const fullUserPrompt = `User request: ${userPrompt}\n\nCurrent script:\n\`\`\`${lang}\n${currentCode || '# Empty'}\n\`\`\`\n\nPlease write or update the complete executable script.`;

                const endpoint = await window.graphqlClient.resolveEndpoint();
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: `
                            query GenerateAI($prompt: String!, $context: String) {
                                genai {
                                    generate(prompt: $prompt, context: $context) {
                                        response
                                        model
                                        error
                                    }
                                }
                            }
                        `,
                        variables: {
                            prompt: `${systemPrompt}\n\n${fullUserPrompt}`,
                            context: contextStr
                        }
                    })
                });

                const resData = await response.json();
                if (resData.errors) throw new Error(resData.errors[0].message);
                const ai = resData.data?.genai?.generate;
                if (ai?.error) throw new Error(ai.error);

                const responseText = ai?.response || '';
                const codeRegex = /```(?:python|starlark|javascript|js)?\s*\n([\s\S]*?)\n```/i;
                const match = responseText.match(codeRegex);

                let extracted = '';
                let explanation = '';
                if (match && match[1]) {
                    extracted = match[1].trim();
                    explanation = responseText.substring(match.index + match[0].length).trim();
                } else {
                    explanation = responseText;
                }

                if (extracted) {
                    document.getElementById('script-code-editor').value = extracted;
                    ui.markPageDirty();
                    feedback.className = 'ai-feedback success';
                    feedback.innerHTML = `
                        <div style="font-weight: 600;">✓ Script Generated (${ai?.model || 'AI'})</div>
                        <div style="margin-top: 4px; opacity: 0.9; white-space: pre-line;">${ui.escapeHtml(explanation)}</div>
                    `;
                    ui.toast('Script code updated from AI!', 'success');
                } else {
                    feedback.className = 'ai-feedback success';
                    feedback.textContent = responseText;
                }
            } catch (err) {
                console.error('AI generation failed:', err);
                feedback.className = 'ai-feedback error';
                feedback.textContent = 'AI generation failed: ' + (err.message || err);
            } finally {
                genBtn.disabled = false;
            }
        }

        async runTestSandbox() {
            const testBtn = document.getElementById('test-run-btn');
            const outputArea = document.getElementById('test-output-area');
            const outputBox = document.getElementById('test-output-log');
            const timeBadge = document.getElementById('test-time-badge');
            const header = document.getElementById('test-result-header');

            const name = document.getElementById('script-name').value.trim() || 'TestSandboxScript';
            const namespace = document.getElementById('script-namespace').value.trim() || 'script';
            const nodeId = document.getElementById('script-node-id').value || 'local';
            const lang = document.getElementById('script-language').value;
            const triggerType = document.getElementById('script-trigger-type').value;
            const instanceMode = document.getElementById('script-instance-mode').value;
            const timeoutMs = parseInt(document.getElementById('script-timeout').value) || 200;
            const timerMs = parseInt(document.getElementById('script-timer-interval').value) || 0;
            const triggerOnChange = document.getElementById('script-trigger-on-change').checked;
            const scriptCode = document.getElementById('script-code-editor').value;
            const topicFilters = this.collectTopicFilters();

            const testTopic = document.getElementById('test-topic').value.trim();
            const testPayload = document.getElementById('test-payload').value.trim();
            const testArgs = document.getElementById('test-args').value.trim();

            testBtn.disabled = true;
            outputArea.style.display = 'block';
            outputBox.textContent = 'Executing sandbox dry-run...';
            header.textContent = 'Executing...';
            timeBadge.textContent = '';

            try {
                const mutation = `
                    mutation TestScript($input: ScriptInput!, $testTopic: String, $testPayload: String, $testArgs: String) {
                        script {
                            test(input: $input, testTopic: $testTopic, testPayload: $testPayload, testArgs: $testArgs) {
                                success
                                returnValue
                                outputMessages {
                                    topic
                                    payload
                                    qos
                                    retain
                                }
                                logs
                                errors
                                executionTimeMs
                            }
                        }
                    }
                `;

                const vars = {
                    input: {
                        name,
                        namespace,
                        nodeId,
                        enabled: true,
                        config: {
                            language: lang,
                            script: scriptCode,
                            triggerType,
                            topicFilters,
                            triggerOnChangeOnly: triggerOnChange,
                            timerIntervalMs: timerMs,
                            instanceMode,
                            timeoutMs
                        }
                    },
                    testTopic: testTopic || null,
                    testPayload: testPayload || null,
                    testArgs: testArgs || null
                };

                const result = await window.graphqlClient.query(mutation, vars);
                const testRes = result?.script?.test;
                if (!testRes) throw new Error('No test response received');

                timeBadge.textContent = `${testRes.executionTimeMs.toFixed(2)} ms`;
                header.textContent = testRes.success ? 'Execution Succeeded' : 'Execution Failed';
                header.style.color = testRes.success ? 'var(--c-ok)' : 'var(--c-err)';

                let lines = [];
                if (testRes.returnValue !== null && testRes.returnValue !== undefined) {
                    lines.push(`RETURN VALUE: ${testRes.returnValue}`);
                }

                if (testRes.outputMessages && testRes.outputMessages.length > 0) {
                    lines.push(`\n--- PUBLISHED MESSAGES (${testRes.outputMessages.length}) ---`);
                    testRes.outputMessages.forEach((msg, idx) => {
                        lines.push(`[${idx + 1}] Topic: ${msg.topic} | QoS: ${msg.qos} | Retain: ${msg.retain}`);
                        lines.push(`    Payload: ${msg.payload}`);
                    });
                } else {
                    lines.push('\n--- NO MESSAGES PUBLISHED ---');
                }

                if (testRes.logs && testRes.logs.length > 0) {
                    lines.push(`\n--- CAPTURED LOGS (${testRes.logs.length}) ---`);
                    lines.push(...testRes.logs);
                }

                if (testRes.errors && testRes.errors.length > 0) {
                    lines.push(`\n--- ERRORS ---`);
                    lines.push(...testRes.errors);
                }

                outputBox.textContent = lines.join('\n');
            } catch (err) {
                console.error('Test run failed:', err);
                header.textContent = 'Test Run Error';
                header.style.color = 'var(--c-err)';
                outputBox.textContent = 'Error executing test sandbox: ' + (err.message || err);
            } finally {
                testBtn.disabled = false;
            }
        }

        async saveScript() {
            const nameInput = document.getElementById('script-name');
            const name = nameInput.value.trim();
            if (!name) {
                ui.toast('Script name is required', 'error');
                nameInput.focus();
                return;
            }

            const namespace = document.getElementById('script-namespace').value.trim() || 'script';
            const nodeId = document.getElementById('script-node-id').value || '*';
            const enabled = document.getElementById('script-enabled').checked;
            const description = document.getElementById('script-description').value.trim();
            const language = document.getElementById('script-language').value;
            const triggerType = document.getElementById('script-trigger-type').value;
            const instanceMode = document.getElementById('script-instance-mode').value;
            const timeoutMs = parseInt(document.getElementById('script-timeout').value) || 200;
            const timerIntervalMs = parseInt(document.getElementById('script-timer-interval').value) || 0;
            const triggerOnChangeOnly = document.getElementById('script-trigger-on-change').checked;
            const script = document.getElementById('script-code-editor').value;
            const topicFilters = this.collectTopicFilters();

            const input = {
                name,
                namespace,
                nodeId,
                enabled,
                config: {
                    language,
                    script,
                    triggerType,
                    topicFilters,
                    triggerOnChangeOnly,
                    timerIntervalMs,
                    instanceMode,
                    timeoutMs,
                    description: description || null
                }
            };

            ui.setLoading(true);
            ui.clearError();
            try {
                if (this.isNew) {
                    const mutation = `
                        mutation CreateScript($input: ScriptInput!) {
                            script {
                                create(input: $input) {
                                    success
                                    errors
                                    script {
                                        name
                                    }
                                }
                            }
                        }
                    `;
                    const res = await window.graphqlClient.query(mutation, { input });
                    const result = res?.script?.create;
                    if (!result?.success) {
                        throw new Error(result?.errors?.join(', ') || 'Failed to create script');
                    }
                    ui.markPageSaved();
                    ui.success(`Script "${name}" created successfully`);
                    setTimeout(() => {
                        window.spaLocation.href = `/pages/broker-scripts-detail.html?name=${encodeURIComponent(name)}`;
                    }, 800);
                } else {
                    const mutation = `
                        mutation UpdateScript($name: String!, $input: ScriptInput!) {
                            script {
                                update(name: $name, input: $input) {
                                    success
                                    errors
                                    script {
                                        name
                                    }
                                }
                            }
                        }
                    `;
                    const res = await window.graphqlClient.query(mutation, { name: this.scriptName, input });
                    const result = res?.script?.update;
                    if (!result?.success) {
                        throw new Error(result?.errors?.join(', ') || 'Failed to update script');
                    }
                    ui.markPageSaved();
                    ui.success(`Script "${name}" updated successfully`);
                    await this.loadScript();
                }
            } catch (err) {
                console.error('Failed to save script:', err);
                ui.showError('Failed to save script: ' + (err.message || err));
            } finally {
                ui.setLoading(false);
            }
        }

        async deleteScript() {
            if (!this.scriptName) return;
            const confirmed = await ui.confirm({
                title: 'Delete Broker Script',
                message: `Are you sure you want to delete script "${this.scriptName}"? This action cannot be undone.`,
                confirmLabel: 'Delete',
                danger: true
            });
            if (!confirmed) return;

            ui.setLoading(true);
            try {
                const mutation = `
                    mutation DeleteScript($name: String!) {
                        script {
                            delete(name: $name)
                        }
                    }
                `;
                const result = await window.graphqlClient.query(mutation, { name: this.scriptName });
                if (!result?.script?.delete) {
                    throw new Error('Deletion failed');
                }
                ui.markPageSaved();
                ui.success(`Script "${this.scriptName}" deleted`);
                setTimeout(() => {
                    window.spaLocation.href = '/pages/broker-scripts.html';
                }, 600);
            } catch (err) {
                console.error('Failed to delete script:', err);
                ui.showError('Failed to delete script: ' + (err.message || err));
            } finally {
                ui.setLoading(false);
            }
        }

        async loadRecentLogs() {
            if (!this.scriptName) return;
            try {
                const query = `query GetRecentLogs($name: String!) { script(name: $name) { recentLogs } }`;
                const result = await window.graphqlClient.query(query, { name: this.scriptName });
                this.renderRecentLogs(result?.script?.recentLogs || []);
            } catch (err) {
                console.warn('Failed to fetch recent logs:', err);
            }
        }

        renderRecentLogs(logs) {
            const box = document.getElementById('recent-logs-box');
            if (!box) return;
            if (!logs || logs.length === 0) {
                box.textContent = 'No recent logs recorded for this script.';
                return;
            }
            box.innerHTML = '';
            logs.forEach(l => {
                const line = document.createElement('div');
                line.className = 'log-line';
                line.textContent = l;
                box.appendChild(line);
            });
        }
    }

    const manager = new BrokerScriptDetailManager();

    page.expose({
        manager
    });
    page.ready();
    return () => page.dispose();
}
