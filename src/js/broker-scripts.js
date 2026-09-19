// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
    const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
        requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
        IntersectionObserver, WebSocket, EventSource } = page;

    class BrokerScriptsManager {
        constructor() {
            this.scripts = [];
            this.filterText = '';
            this.selectedLang = '';
            this.refreshTimer = null;
            this.init();
        }

        async init() {
            if (!window.isLoggedIn()) {
                window.location.href = '/pages/login.html';
                return;
            }

            this.attachEventListeners();
            await this.loadScripts();

            this.refreshTimer = setInterval(() => this.loadScripts(true), 30000);
        }

        attachEventListeners() {
            const refreshBtn = document.getElementById('refresh-scripts-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.loadScripts());
            }

            const addBtn = document.getElementById('add-script-btn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    window.spaLocation.href = '/pages/broker-scripts-detail.html';
                });
            }

            const apiRefBtn = document.getElementById('api-ref-btn');
            if (apiRefBtn) {
                apiRefBtn.addEventListener('click', () => {
                    if (window.openHelp) {
                        window.openHelp('broker-script-help');
                    }
                });
            }

            const searchInput = document.getElementById('script-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.filterText = e.target.value.toLowerCase().trim();
                    this.renderTable();
                });
            }

            const langFilter = document.getElementById('script-lang-filter');
            if (langFilter) {
                langFilter.addEventListener('change', (e) => {
                    this.selectedLang = e.target.value;
                    this.renderTable();
                });
            }
        }

        async loadScripts(isBackground = false) {
            if (!isBackground) {
                ui.setLoading(true);
                ui.clearError();
            }

            try {
                const query = `
                    query GetBrokerScripts {
                        scripts {
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
                            config {
                                language
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
                const result = await window.graphqlClient.query(query);
                this.scripts = result?.scripts || [];
                this.updateMetrics();
                this.renderTable();
            } catch (err) {
                console.error('Failed to load broker scripts:', err);
                if (!isBackground) {
                    ui.showError('Failed to load broker scripts: ' + (err.message || err));
                }
            } finally {
                if (!isBackground) {
                    ui.setLoading(false);
                }
            }
        }

        updateMetrics() {
            const total = this.scripts.length;
            const active = this.scripts.filter(s => s.enabled).length;
            const totalRuns = this.scripts.reduce((acc, s) => acc + (s.executionCount || 0), 0);
            const totalErrors = this.scripts.reduce((acc, s) => acc + (s.errorCount || 0), 0);

            const totalEl = document.getElementById('metric-total-scripts');
            if (totalEl) totalEl.textContent = total;

            const activeEl = document.getElementById('metric-active-scripts');
            if (activeEl) activeEl.textContent = active;

            const runsEl = document.getElementById('metric-total-executions');
            if (runsEl) runsEl.textContent = totalRuns.toLocaleString();

            const errorsEl = document.getElementById('metric-total-errors');
            if (errorsEl) {
                errorsEl.textContent = totalErrors.toLocaleString();
                const iconEl = document.getElementById('metric-error-icon');
                if (iconEl) {
                    iconEl.className = totalErrors > 0 ? 'metric-icon is-err' : 'metric-icon is-ok';
                }
            }
        }

        getFilteredScripts() {
            return this.scripts.filter(s => {
                if (this.selectedLang && s.config?.language !== this.selectedLang) {
                    return false;
                }
                if (!this.filterText) return true;

                const nameMatch = s.name.toLowerCase().includes(this.filterText);
                const descMatch = (s.config?.description || '').toLowerCase().includes(this.filterText);
                const nsMatch = (s.namespace || '').toLowerCase().includes(this.filterText);
                const topicsMatch = (s.config?.topicFilters || []).some(t => t.toLowerCase().includes(this.filterText));

                return nameMatch || descMatch || nsMatch || topicsMatch;
            });
        }

        renderTable() {
            const tbody = document.getElementById('broker-scripts-tbody');
            if (!tbody) return;

            const filtered = this.getFilteredScripts();
            if (filtered.length === 0) {
                if (this.scripts.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 3rem;">
                                No broker scripts configured yet. Click "Add Script" to create your first script.
                            </td>
                        </tr>
                    `;
                } else {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                                No scripts match your search filters.
                            </td>
                        </tr>
                    `;
                }
                return;
            }

            tbody.innerHTML = '';
            filtered.forEach(s => {
                const tr = document.createElement('tr');

                // Name & Namespace
                const nameTd = document.createElement('td');
                const link = document.createElement('a');
                link.href = `/pages/broker-scripts-detail.html?name=${encodeURIComponent(s.name)}`;
                link.style.fontWeight = '600';
                link.style.color = 'var(--text-primary)';
                link.style.textDecoration = 'none';
                link.textContent = s.name;
                link.addEventListener('mouseenter', () => link.style.textDecoration = 'underline');
                link.addEventListener('mouseleave', () => link.style.textDecoration = 'none');

                const nsBadge = document.createElement('span');
                nsBadge.style.display = 'inline-block';
                nsBadge.style.marginLeft = '0.5rem';
                nsBadge.style.padding = '1px 6px';
                nsBadge.style.fontSize = '0.75rem';
                nsBadge.style.borderRadius = '4px';
                nsBadge.style.background = 'rgba(255,255,255,0.06)';
                nsBadge.style.color = 'var(--text-secondary)';
                nsBadge.textContent = s.namespace || 'script';

                nameTd.appendChild(link);
                nameTd.appendChild(nsBadge);
                if (s.config?.description) {
                    const descDiv = document.createElement('div');
                    descDiv.style.fontSize = '0.75rem';
                    descDiv.style.color = 'var(--text-muted)';
                    descDiv.style.marginTop = '2px';
                    descDiv.style.whiteSpace = 'nowrap';
                    descDiv.style.overflow = 'hidden';
                    descDiv.style.textOverflow = 'ellipsis';
                    descDiv.style.maxWidth = '250px';
                    descDiv.textContent = s.config.description;
                    nameTd.appendChild(descDiv);
                }
                tr.appendChild(nameTd);

                // Language Badge
                const langTd = document.createElement('td');
                const lang = s.config?.language || 'starlark';
                const langBadge = document.createElement('span');
                langBadge.className = 'status-badge';
                if (lang === 'python') {
                    langBadge.classList.add('badge-info');
                    langBadge.textContent = 'Python';
                } else if (lang === 'starlark') {
                    langBadge.classList.add('badge-warn');
                    langBadge.textContent = 'Starlark';
                } else {
                    langBadge.classList.add('badge-ok');
                    langBadge.textContent = 'JavaScript';
                }
                langTd.appendChild(langBadge);
                tr.appendChild(langTd);

                // Trigger details
                const triggerTd = document.createElement('td');
                const triggerType = s.config?.triggerType || 'TOPIC';
                const chipsContainer = document.createElement('div');
                chipsContainer.style.display = 'flex';
                chipsContainer.style.flexWrap = 'wrap';
                chipsContainer.style.gap = '4px';
                chipsContainer.style.alignItems = 'center';

                if (triggerType === 'TOPIC' || triggerType === 'BOTH') {
                    const topics = s.config?.topicFilters || [];
                    if (topics.length > 0) {
                        topics.slice(0, 3).forEach(top => {
                            const chip = document.createElement('span');
                            chip.style.padding = '2px 6px';
                            chip.style.fontSize = '0.75rem';
                            chip.style.fontFamily = 'monospace';
                            chip.style.borderRadius = '4px';
                            chip.style.background = 'rgba(59, 130, 246, 0.15)';
                            chip.style.color = '#93c5fd';
                            chip.style.border = '1px solid rgba(59, 130, 246, 0.25)';
                            chip.textContent = top;
                            chipsContainer.appendChild(chip);
                        });
                        if (topics.length > 3) {
                            const more = document.createElement('span');
                            more.style.fontSize = '0.75rem';
                            more.style.color = 'var(--text-muted)';
                            more.textContent = `+${topics.length - 3} more`;
                            chipsContainer.appendChild(more);
                        }
                    }
                    if (s.config?.triggerOnChangeOnly) {
                        const changeBadge = document.createElement('span');
                        changeBadge.style.fontSize = '0.7rem';
                        changeBadge.style.color = '#a78bfa';
                        changeBadge.style.border = '1px solid rgba(167, 139, 250, 0.3)';
                        changeBadge.style.borderRadius = '4px';
                        changeBadge.style.padding = '1px 4px';
                        changeBadge.textContent = 'on-change';
                        chipsContainer.appendChild(changeBadge);
                    }
                }

                if (triggerType === 'TIMER' || triggerType === 'BOTH') {
                    const timerChip = document.createElement('span');
                    timerChip.style.padding = '2px 6px';
                    timerChip.style.fontSize = '0.75rem';
                    timerChip.style.borderRadius = '4px';
                    timerChip.style.background = 'rgba(245, 158, 11, 0.15)';
                    timerChip.style.color = '#fcd34d';
                    timerChip.style.border = '1px solid rgba(245, 158, 11, 0.25)';
                    timerChip.textContent = `${s.config?.timerIntervalMs || 0} ms`;
                    chipsContainer.appendChild(timerChip);
                }

                if (triggerType === 'CALLABLE') {
                    const callChip = document.createElement('span');
                    callChip.style.padding = '2px 6px';
                    callChip.style.fontSize = '0.75rem';
                    callChip.style.borderRadius = '4px';
                    callChip.style.background = 'rgba(16, 185, 129, 0.15)';
                    callChip.style.color = '#6ee7b7';
                    callChip.style.border = '1px solid rgba(16, 185, 129, 0.25)';
                    callChip.textContent = 'Callable';
                    chipsContainer.appendChild(callChip);
                }

                triggerTd.appendChild(chipsContainer);
                tr.appendChild(triggerTd);

                // Concurrency Mode
                const modeTd = document.createElement('td');
                const mode = s.config?.instanceMode || 'SINGLETON';
                const modeSpan = document.createElement('span');
                modeSpan.style.fontSize = '0.8rem';
                modeSpan.style.color = mode === 'SINGLETON' ? 'var(--text-secondary)' : '#c084fc';
                modeSpan.textContent = mode;
                modeTd.appendChild(modeSpan);
                tr.appendChild(modeTd);

                // Status Toggle Switch
                const statusTd = document.createElement('td');
                const toggle = document.createElement('ix-toggle');
                if (s.enabled) toggle.setAttribute('checked', '');
                toggle.addEventListener('checkedChange', async (e) => {
                    const newEnabled = e.detail;
                    await this.toggleScript(s.name, newEnabled, toggle);
                });
                statusTd.appendChild(toggle);
                tr.appendChild(statusTd);

                // Runs / Errors count
                const countsTd = document.createElement('td');
                countsTd.style.textAlign = 'right';
                countsTd.className = 'num';
                const runs = s.executionCount || 0;
                const errors = s.errorCount || 0;
                countsTd.innerHTML = `${runs.toLocaleString()} / <span style="color: ${errors > 0 ? 'var(--c-err)' : 'var(--text-muted)'}; font-weight: ${errors > 0 ? '600' : 'normal'}">${errors.toLocaleString()}</span>`;
                tr.appendChild(countsTd);

                // Last Execution Time & Status
                const lastExecTd = document.createElement('td');
                if (s.lastExecutionTime) {
                    const timeDiv = document.createElement('div');
                    timeDiv.style.fontSize = '0.8rem';
                    timeDiv.textContent = ui.formatDateTime(s.lastExecutionTime);

                    const statusBadge = document.createElement('span');
                    statusBadge.style.fontSize = '0.7rem';
                    statusBadge.style.padding = '1px 4px';
                    statusBadge.style.borderRadius = '3px';
                    statusBadge.style.display = 'inline-block';
                    statusBadge.style.marginTop = '2px';

                    if (s.lastExecutionStatus === 'SUCCESS') {
                        statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                        statusBadge.style.color = '#34d399';
                        statusBadge.textContent = 'SUCCESS';
                    } else if (s.lastExecutionStatus === 'ERROR') {
                        statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                        statusBadge.style.color = '#f87171';
                        statusBadge.textContent = 'ERROR';
                    } else {
                        statusBadge.style.background = 'rgba(255, 255, 255, 0.08)';
                        statusBadge.style.color = 'var(--text-muted)';
                        statusBadge.textContent = s.lastExecutionStatus || '-';
                    }

                    lastExecTd.appendChild(timeDiv);
                    lastExecTd.appendChild(statusBadge);
                } else {
                    lastExecTd.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Never</span>';
                }
                tr.appendChild(lastExecTd);

                // Actions
                const actionsTd = document.createElement('td');
                actionsTd.style.textAlign = 'center';
                const actionWrap = document.createElement('div');
                actionWrap.className = 'action-buttons';
                actionWrap.style.justifyContent = 'center';

                // Edit Button
                const editBtn = document.createElement('ix-icon-button');
                editBtn.setAttribute('icon', 'pen');
                editBtn.setAttribute('variant', 'subtle-tertiary');
                editBtn.setAttribute('title', 'Edit Script');
                editBtn.addEventListener('click', () => {
                    window.spaLocation.href = `/pages/broker-scripts-detail.html?name=${encodeURIComponent(s.name)}`;
                });
                actionWrap.appendChild(editBtn);

                // Delete Button
                const deleteBtn = document.createElement('ix-icon-button');
                deleteBtn.setAttribute('icon', 'trashcan');
                deleteBtn.setAttribute('variant', 'subtle-tertiary');
                deleteBtn.setAttribute('title', 'Delete Script');
                deleteBtn.addEventListener('click', () => this.deleteScript(s.name));
                actionWrap.appendChild(deleteBtn);

                actionsTd.appendChild(actionWrap);
                tr.appendChild(actionsTd);

                tbody.appendChild(tr);
            });
        }

        async toggleScript(name, enabled, toggleEl) {
            try {
                const mutation = `
                    mutation ToggleScript($name: String!, $enabled: Boolean!) {
                        script {
                            toggle(name: $name, enabled: $enabled) {
                                success
                                errors
                                script {
                                    name
                                    enabled
                                }
                            }
                        }
                    }
                `;
                const result = await window.graphqlClient.query(mutation, { name, enabled });
                const res = result?.script?.toggle;
                if (!res?.success) {
                    throw new Error(res?.errors?.[0] || 'Toggle failed');
                }
                ui.toast(`Script "${name}" ${enabled ? 'enabled' : 'disabled'}`, 'info');
                // Update local model
                const item = this.scripts.find(s => s.name === name);
                if (item) item.enabled = enabled;
                this.updateMetrics();
            } catch (err) {
                console.error('Failed to toggle script:', err);
                ui.toast(`Failed to toggle script: ${err.message}`, 'error');
                if (toggleEl) {
                    toggleEl.checked = !enabled;
                }
            }
        }

        async deleteScript(name) {
            const confirmed = await ui.confirm({
                title: 'Delete Broker Script',
                message: `Are you sure you want to delete script "${name}"? This action cannot be undone.`,
                confirmLabel: 'Delete Script',
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
                const result = await window.graphqlClient.query(mutation, { name });
                if (!result?.script?.delete) {
                    throw new Error('Script deletion failed');
                }
                ui.toast(`Script "${name}" deleted`, 'info');
                await this.loadScripts();
            } catch (err) {
                console.error('Failed to delete script:', err);
                ui.showError('Failed to delete script: ' + (err.message || err));
            } finally {
                ui.setLoading(false);
            }
        }

        destroy() {
            if (this.refreshTimer) {
                clearInterval(this.refreshTimer);
                this.refreshTimer = null;
            }
        }
    }

    const manager = new BrokerScriptsManager();

    page.expose({
        manager
    });
    page.ready();
    return () => {
        manager.destroy();
        page.dispose();
    };
}
