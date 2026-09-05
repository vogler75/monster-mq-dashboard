// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
/**
 * MonsterMQ Scripts List Page Controller
 * Table-based listing of simplified Scripts.
 * Maps scripts to FlowClasses & FlowInstances under the 'scripts' namespace.
 */

let scriptsList = [];
let sortState = { key: 'name', dir: 'asc' };
let filterText = '';

document.addEventListener('DOMContentLoaded', initScriptsPage);

async function initScriptsPage() {
    await loadScriptsList();
    setupInteractions();
}

// ---------------------- GraphQL & Data Fetching ----------------------
async function graphqlQuery(query, variables = {}) {
    try {
        return await window.graphqlClient.query(query, variables);
    } catch (e) {
        showNotification('GraphQL error: ' + e.message, 'error');
        throw e;
    }
}

async function loadScriptsList() {
    const tbody = document.querySelector('#scripts-table tbody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 3rem;">
                    Loading scripts...
                </td>
            </tr>
        `;
    }

    try {
        // Query both flow classes and flow instances
        const classesQuery = `
            query {
                flowClasses {
                    name
                    namespace
                    description
                    nodes {
                        id
                        type
                        config
                    }
                    updatedAt
                }
            }
        `;
        const instancesQuery = `
            query {
                flowInstances {
                    name
                    namespace
                    flowClassId
                    enabled
                    nodeId
                    inputMappings {
                        nodeInput
                        type
                        value
                    }
                    status {
                        running
                        lastExecution
                        executionCount
                        errorCount
                        lastError
                    }
                    updatedAt
                }
            }
        `;

        const [classesData, instancesData] = await Promise.all([
            graphqlQuery(classesQuery),
            graphqlQuery(instancesQuery)
        ]);

        const classes = classesData.flowClasses || [];
        const instances = instancesData.flowInstances || [];

        // Filter instances that belong to our 'scripts' namespace
        const scriptInstances = instances.filter(inst => inst.namespace === 'scripts');

        // Combine instance and class info
        scriptsList = scriptInstances.map(inst => {
            const correspondingClass = classes.find(c => c.name === inst.flowClassId);
            
            // Determine trigger type and details by looking at the class and instance configuration
            let triggerType = 'MQTT';
            let triggerDetails = 'Unknown';
            let topicsList = [];
            
            if (correspondingClass) {
                const timerNode = correspondingClass.nodes.find(n => n.type === 'timer');
                if (timerNode) {
                    triggerType = 'Timer';
                    const frequency = timerNode.config?.frequency || 1000;
                    triggerDetails = formatInterval(frequency);
                } else {
                    // Topic trigger
                    triggerType = 'MQTT';
                    topicsList = inst.inputMappings
                        .filter(m => m.type === 'TOPIC')
                        .map(m => m.value);
                    
                    if (topicsList.length > 0) {
                        triggerDetails = topicsList.join(', ');
                    } else {
                        triggerDetails = 'None (Manual)';
                    }
                }
            }

            // Stripped display name
            const cleanName = inst.name.replace(/^script-instance-/, '').replace(/^script-/, '');

            return {
                rawName: inst.name,
                name: cleanName,
                description: correspondingClass ? correspondingClass.description || '' : '',
                triggerType: triggerType,
                triggerDetails: triggerDetails,
                topics: topicsList,
                enabled: inst.enabled,
                executionCount: inst.status ? inst.status.executionCount : 0,
                errorCount: inst.status ? inst.status.errorCount : 0,
                lastExecution: inst.status ? inst.status.lastExecution : null,
                lastError: inst.status ? inst.status.lastError : null,
                updatedAt: inst.updatedAt
            };
        });

        renderScriptsTable();

    } catch (e) {
        console.error('Error loading scripts list:', e);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #ef4444; padding: 3rem;">
                        Failed to load scripts: ${escapeHtml(e.message)}
                    </td>
                </tr>
            `;
        }
    }
}

// ---------------------- Interaction Setup ----------------------
function setupInteractions() {
    const searchInput = document.getElementById('script-search');
    if (searchInput) {
        searchInput.addEventListener('input', e => {
            filterText = e.target.value.toLowerCase();
            renderScriptsTable();
        });
    }

    // Set sorting columns clickable styling
    document.querySelectorAll('#scripts-table thead th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort');
            toggleSort(sortKey);
        });
    });
}

// ---------------------- Rendering ----------------------
function renderScriptsTable() {
    const tbody = document.querySelector('#scripts-table tbody');
    if (!tbody) return;

    let rows = scriptsList.slice();

    // Filter rows by search term
    if (filterText) {
        rows = rows.filter(r => 
            r.name.toLowerCase().includes(filterText) || 
            r.description.toLowerCase().includes(filterText) ||
            r.triggerDetails.toLowerCase().includes(filterText)
        );
    }

    // Sort rows
    const { key, dir } = sortState;
    rows.sort((a, b) => {
        let av = a[key];
        let bv = b[key];
        
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        
        const cmp = av > bv ? 1 : (av < bv ? -1 : 0);
        return dir === 'asc' ? cmp : -cmp;
    });

    if (rows.length === 0) {
        tbody.innerHTML = filterText
            ? ui.emptyRow(8, 'No matching scripts found')
            : ui.emptyRow(8, 'No scripts created yet', 'Use “New Script” to get started.');
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const triggerBadge = r.triggerType === 'Timer'
            ? `<span class="badge badge-timer">⏱ ${escapeHtml(r.triggerDetails)}</span>`
            : `<span class="badge badge-topic">✉ ${escapeHtml(r.triggerDetails)}</span>`;

        const statusBadge = r.enabled 
            ? `<span style="color: #10b981; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; background: #10b981; border-radius: 50%;"></span>Active</span>`
            : `<span style="color: #ef4444; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%;"></span>Inactive</span>`;

        // "Play/Run" button triggers a manual run by publishing an empty message to the trigger topic
        const runManualBtn = r.triggerType === 'MQTT' && r.topics.length > 0
            ? `<ix-icon-button icon="publish" variant="subtle-tertiary" size="24" title="Manually trigger script (publish message to ${escapeHtml(r.topics[0])})" onclick="runScriptManually('${escapeHtml(r.rawName)}')"></ix-icon-button>`
            : '';
 
        return `
            <tr>
                <td>
                    <strong style="color: var(--text-primary); cursor: pointer;" onclick="editScript('${escapeHtml(r.rawName)}')">
                        ${escapeHtml(r.name)}
                    </strong>
                </td>
                <td>
                    <div style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.description)}">
                        ${escapeHtml(r.description || 'No description')}
                    </div>
                </td>
                <td>${triggerBadge}</td>
                <td>
                    ${statusBadge}
                </td>
                <td style="text-align: right; font-weight: 500; color: var(--text-primary);">${r.executionCount}</td>
                <td style="text-align: right; font-weight: 500; color: ${r.errorCount > 0 ? '#ef4444' : 'var(--text-secondary)'};">${r.errorCount}</td>
                <td>
                    <div title="${r.lastError ? 'Last error: ' + escapeHtml(r.lastError) : ''}">
                        ${r.lastExecution ? formatDateTime(r.lastExecution) : '<span style="color: var(--text-muted); font-style: italic;">Never</span>'}
                        ${r.errorCount > 0 && r.lastError ? ' <span style="color: #ef4444;" title="' + escapeHtml(r.lastError) + '">⚠️</span>' : ''}
                    </div>
                </td>
                <td>
                    <div class="action-buttons" style="justify-content: center;">
                        <ix-icon-button icon="${r.enabled ? 'pause' : 'play'}" variant="subtle-tertiary" size="24" title="${r.enabled ? 'Stop Script (Disable)' : 'Start Script (Enable)'}" onclick="toggleScriptState('${escapeHtml(r.rawName)}', ${!r.enabled})"></ix-icon-button>
                        ${runManualBtn}
                        <ix-icon-button icon="highlight" variant="subtle-tertiary" size="24" title="Edit script" onclick="editScript('${escapeHtml(r.rawName)}')"></ix-icon-button>
                        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete script" onclick="deleteScript('${escapeHtml(r.rawName)}')"></ix-icon-button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ---------------------- Actions ----------------------
function editScript(rawName) {
    window.spaLocation.href = `/pages/script-detail.html?name=${encodeURIComponent(rawName)}`;
}

async function toggleScriptState(rawName, enable) {
    const mutation = enable
        ? `mutation($name:String!){ flow { enableInstance(name:$name) { name } } }`
        : `mutation($name:String!){ flow { disableInstance(name:$name) { name } } }`;
    
    try {
        await graphqlQuery(mutation, { name: rawName });
        showNotification(enable ? 'Script enabled successfully' : 'Script disabled successfully', 'success');
        await loadScriptsList();
    } catch (e) {
        console.error('Failed to change script state:', e);
        showNotification('Operation failed: ' + e.message, 'error');
        await loadScriptsList(); // Reload to revert visually
    }
}

async function deleteScript(rawName) {
    const cleanName = rawName.replace(/^script-instance-/, '').replace(/^script-/, '');
    showConfirmModal('Confirm Delete', `Are you sure you want to delete script "${cleanName}"?\n\nThis will permanently stop and delete the script.`, async () => {
        try {
            // Delete instance first, then class
            const deleteInstanceMutation = `mutation($name:String!){ flow { deleteInstance(name:$name) } }`;
            const deleteClassMutation = `mutation($name:String!){ flow { deleteClass(name:$name) } }`;
            
            const classId = `script-class-${cleanName}`;
            const instanceId = `script-instance-${cleanName}`;
            
            await graphqlQuery(deleteInstanceMutation, { name: instanceId });
            await graphqlQuery(deleteClassMutation, { name: classId });
            
            // Also clean up old format if present
            if (rawName !== instanceId) {
                await graphqlQuery(deleteInstanceMutation, { name: rawName });
                await graphqlQuery(deleteClassMutation, { name: rawName });
            }
            
            showNotification('Script deleted successfully', 'success');
            await loadScriptsList();
        } catch (e) {
            console.error('Failed to delete script:', e);
            showNotification('Deletion failed: ' + e.message, 'error');
            await loadScriptsList();
        }
    });
}

/** Triggers script manually by publishing an empty JSON object to its first input topic */
async function runScriptManually(rawName) {
    const script = scriptsList.find(s => s.rawName === rawName);
    if (!script || !script.topics || script.topics.length === 0) return;
    
    const topic = script.topics[0];
    
    try {
        // Publish to MQTT topic via GraphQL mutation
        const publishMutation = `
            mutation PublishMessage($input: PublishInput!) {
                publish(input: $input) {
                    success
                    error
                }
            }
        `;
        
        await graphqlQuery(publishMutation, {
            input: {
                topic: topic,
                payload: "{}",
                qos: 0
            }
        });
        
        showNotification(`Trigger message sent to topic "${topic}"`, 'success');
        
        // Brief delay before reloading to give Vert.x event bus a moment to execute
        setTimeout(loadScriptsList, 500);
    } catch (e) {
        console.error('Failed to run script manually:', e);
        showNotification('Trigger failed: ' + e.message, 'error');
    }
}

// ---------------------- Helpers & Utilities ----------------------
function toggleSort(key) {
    if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.dir = 'asc';
    }
    renderScriptsTable();
}

function formatInterval(ms) {
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `Every ${sec}s`;
    const min = sec / 60;
    if (min < 60) return `Every ${min}m`;
    const hr = min / 60;
    return `Every ${hr}h`;
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    return dateStr.replace(/\.\d+Z?$/, '').replace('T', ' ');
}

function showNotification(message, type = 'info') { return ui.toast(message, type); }

async function showConfirmModal(title, message, onConfirm, confirmLabel = 'Delete') {
    if (await ui.confirm({ title, message, confirmLabel, danger: true })) return onConfirm();
}

page.expose({
    get deleteScript() { return deleteScript; },
    get editScript() { return editScript; },
    get escapeHtml() { return escapeHtml; },
    get filterText() { return filterText; },
    get formatDateTime() { return formatDateTime; },
    get formatInterval() { return formatInterval; },
    get graphqlQuery() { return graphqlQuery; },
    get initScriptsPage() { return initScriptsPage; },
    get loadScriptsList() { return loadScriptsList; },
    get renderScriptsTable() { return renderScriptsTable; },
    get runScriptManually() { return runScriptManually; },
    get scriptsList() { return scriptsList; },
    get setupInteractions() { return setupInteractions; },
    get showConfirmModal() { return showConfirmModal; },
    get showNotification() { return showNotification; },
    get sortState() { return sortState; },
    get toggleScriptState() { return toggleScriptState; },
    get toggleSort() { return toggleSort; }
});
page.ready();
return () => page.dispose();
}
