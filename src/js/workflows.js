// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver,
    IntersectionObserver, WebSocket, EventSource } = page;
/**
 * MonsterMQ Workflows List Page (Refactored)
 * Table-based listing of Flow Classes & Flow Instances.
 * Editing moved to workflows-edit.html + workflows-edit.js.
 */

let flowClasses = [];
let flowInstances = [];
let sortState = { classes: { key: 'name', dir: 'asc' }, instances: { key: 'name', dir: 'asc' } };
let filters = { classes: '', instances: '', hideScriptsNamespace: true };
let selectedFlowClassName = ''; // Track selected flow class

document.addEventListener('DOMContentLoaded', initListPage);

async function initListPage(){
    restoreWorkflowFilters();
    await loadFlowClasses();
    setupListInteractions();
    renderClassesTable();

    // Restore previously selected class from sessionStorage
    const selectedClass = sessionStorage.getItem('selectedFlowClass');
    if(selectedClass && flowClasses.some(c => c.name === selectedClass && isVisibleByNamespace(c))){
        await selectFlowClass(selectedClass);
    }
}

// ---------------------- GraphQL ----------------------
async function graphqlQuery(query, variables = {}) {
    try { return await window.graphqlClient.query(query, variables); }
    catch (e) { showNotification('GraphQL error: '+e.message,'error'); throw e; }
}

async function loadFlowClasses(){
    const q = `query { flowClasses { name namespace version description nodes { id } connections { fromNode toNode fromOutput toInput } updatedAt } }`;
    try { const data = await graphqlQuery(q); flowClasses = data.flowClasses||[]; }
    catch(e){ console.error(e); showNotification('Failed to load flow classes','error'); }
}

async function refreshFlowClasses(){
    await loadFlowClasses();
    if(selectedFlowClassName){
        const selectedClass = flowClasses.find(c => c.name === selectedFlowClassName);
        if(!selectedClass || !isVisibleByNamespace(selectedClass)){
            await selectFlowClass('');
            return;
        }
    }
    renderClassesTable();
    if(selectedFlowClassName) await loadFlowInstances();
}

async function loadFlowInstances(){
    // If a flow class is selected, reload instances for that class
    if(selectedFlowClassName) {
        await loadFlowInstancesForClass(selectedFlowClassName);
        renderInstancesTable();
        return;
    }
    // Otherwise, skip loading instances (loaded on demand)
}

async function loadFlowInstancesForClass(flowClassName){
    const q = `query($flowClassId:String){ flowInstances(flowClassId:$flowClassId) { name namespace nodeId flowClassId inputMappings { nodeInput } outputMappings { nodeOutput } enabled status { running executionCount errorCount } updatedAt } }`;
    try {
        const data = await graphqlQuery(q, { flowClassId: flowClassName });
        flowInstances = data.flowInstances||[];
        console.log(`Loaded ${flowInstances.length} instances for flow class "${flowClassName}"`);
    }
    catch(e){ console.error('Error loading flow instances:', e); showNotification('Failed to load flow instances','error'); }
}

// ---------------------- Interactions ----------------------
function setupListInteractions(){
    const clsSearch = document.getElementById('class-search');
    if(clsSearch) clsSearch.addEventListener('input', e=>{ filters.classes=e.target.value.toLowerCase(); renderClassesTable(); });
    const instSearch = document.getElementById('instance-search');
    if(instSearch) instSearch.addEventListener('input', e=>{ filters.instances=e.target.value.toLowerCase(); renderInstancesTable(); });
    const hideScripts = document.getElementById('hide-scripts-namespace');
    if(hideScripts) {
        hideScripts.checked = filters.hideScriptsNamespace;
        hideScripts.addEventListener('change', async e => {
            filters.hideScriptsNamespace = e.target.checked;
            localStorage.setItem('workflows.hideScriptsNamespace', String(filters.hideScriptsNamespace));

            const selectedClass = flowClasses.find(c => c.name === selectedFlowClassName);
            if(selectedClass && !isVisibleByNamespace(selectedClass)){
                await selectFlowClass('');
                return;
            }

            renderClassesTable();
            renderInstancesTable();
        });
    }
    document.querySelectorAll('#classes-table thead th[data-sort]').forEach(th=>{ th.style.cursor='pointer'; th.addEventListener('click', ()=>toggleSort('classes', th.getAttribute('data-sort'))); });
    document.querySelectorAll('#instances-table thead th[data-sort]').forEach(th=>{ th.style.cursor='pointer'; th.addEventListener('click', ()=>toggleSort('instances', th.getAttribute('data-sort'))); });
}

// ---------------------- Flow Class Selection ----------------------
async function selectFlowClass(flowClassName){
    selectedFlowClassName = flowClassName;
    const instanceSection = document.getElementById('instances-section');
    const selectedNameEl = document.getElementById('selected-class-name');

    if(selectedFlowClassName) {
        if(instanceSection) instanceSection.style.display = 'block';
        if(selectedNameEl) selectedNameEl.textContent = selectedFlowClassName;
        sessionStorage.setItem('selectedFlowClass', selectedFlowClassName); // Remember selection
        await loadFlowInstancesForClass(selectedFlowClassName);
    } else {
        if(instanceSection) instanceSection.style.display = 'none';
        if(selectedNameEl) selectedNameEl.textContent = '-';
        flowInstances = [];
        sessionStorage.removeItem('selectedFlowClass');
    }

    renderClassesTable(); // Re-render to show selection highlight
    renderInstancesTable();
}

function createNewInstance(){
    if(!selectedFlowClassName){
        showNotification('Please select a flow class first','error');
        return;
    }
    window.spaLocation.href = `/pages/workflows-edit-instance.html?type=instance&flowClassId=${encodeURIComponent(selectedFlowClassName)}`;
}

// ---------------------- Rendering ----------------------
function renderClassesTable(){
    const tbody = document.querySelector('#classes-table tbody'); if(!tbody) return;
    let rows = flowClasses.slice();
    rows = rows.filter(isVisibleByNamespace);
    if(filters.classes) rows = rows.filter(r => (r.name+" "+r.namespace).toLowerCase().includes(filters.classes));
    const { key, dir } = sortState.classes; rows.sort((a,b)=>compareValues(a,b,key,dir));
    if(rows.length===0){ tbody.innerHTML=ui.emptyRow(7, 'No flow classes found'); return; }
    tbody.innerHTML = rows.map(r=>`<tr style="cursor:pointer; ${selectedFlowClassName === r.name ? 'background: var(--background-secondary); border-left: 3px solid var(--primary-color);' : ''}" onclick="selectFlowClass('${escapeHtml(r.name)}')">
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.namespace||'')}</td>
        <td>${escapeHtml(r.version||'')}</td>
        <td style="text-align:right;">${r.nodes.length}</td>
        <td style="text-align:right;">${r.connections.length}</td>
        <td>${formatDateTime(r.updatedAt)}</td>
          <td onclick="event.stopPropagation();"><div class="action-buttons">
              <ix-icon-button icon="highlight" variant="subtle-tertiary" size="24" title="Edit" onclick="window.spaLocation.href = '/pages/workflows-visual.html?name=${encodeURIComponent(r.name)}'"></ix-icon-button>
              <ix-icon-button icon="refresh" variant="subtle-tertiary" size="24" title="Restart all instances of this class" onclick="restartAllInstancesOfClass('${escapeHtml(r.name)}')"></ix-icon-button>
              <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete" onclick="listPageDeleteFlowClass('${escapeHtml(r.name)}')"></ix-icon-button>
          </div></td>
    </tr>`).join('');
}

function renderInstancesTable(){
    const tbody = document.querySelector('#instances-table tbody'); if(!tbody) return;
    let rows = flowInstances.slice();
    rows = rows.filter(isVisibleByNamespace);
    // Filter by search text (instances are already filtered by selected flow class)
    if(filters.instances) rows = rows.filter(r => (r.name+" "+r.namespace+" "+r.flowClassId).toLowerCase().includes(filters.instances));
    const { key, dir } = sortState.instances; rows.sort((a,b)=>compareValues(a,b,key,dir));
    if(rows.length===0){
        const msg = selectedFlowClassName ? 'No flow instances for this class' : 'Select a flow class to view instances';
        tbody.innerHTML=`<tr><td colspan="9" style="text-align:center; color:#6c757d;">${msg}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r=>{
        const startStopBtn = r.enabled
            ? `<ix-icon-button icon="pause" variant="subtle-tertiary" size="24" title="Stop" onclick="listPageStopFlowInstance('${escapeHtml(r.name)}')"></ix-icon-button>`
            : `<ix-icon-button icon="play" variant="subtle-tertiary" size="24" title="Start" onclick="listPageStartFlowInstance('${escapeHtml(r.name)}')"></ix-icon-button>`;
        return `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.namespace||'')}</td>
        <td>${escapeHtml(r.flowClassId)}</td>
        <td>${escapeHtml(r.nodeId||'')}</td>
        <td style="text-align:right;">${r.inputMappings.length}</td>
        <td style="text-align:right;">${r.outputMappings.length}</td>
        <td>${r.enabled?'<span style="color:#2ed573;">Yes</span>':'<span style="color:#ff4757;">No</span>'}</td>
        <td>${formatDateTime(r.updatedAt)}</td>
    <td><div class="action-buttons">
        ${startStopBtn}
        <ix-icon-button icon="highlight" variant="subtle-tertiary" size="24" title="Edit" onclick="window.spaLocation.href = '/pages/workflows-edit-instance.html?type=instance&name=${encodeURIComponent(r.name)}&flowClassId=${encodeURIComponent(r.flowClassId)}'"></ix-icon-button>
        <ix-icon-button icon="trashcan" variant="subtle-tertiary" size="24" class="btn-delete" title="Delete" onclick="listPageDeleteFlowInstance('${escapeHtml(r.name)}')"></ix-icon-button>
    </div></td>
    </tr>`; }).join('');
}

// ---------------------- Actions ----------------------
// Use unique internal names to avoid being shadowed by legacy functions defined later in file.
async function listPageDeleteFlowClass(name){
    showConfirmModal('Confirm Delete', `Are you sure you want to delete flow class "${name}"?\n\nThis action cannot be undone.`, async () => {
        const mutation = `mutation($name:String!){ flow { deleteClass(name:$name) } }`;
        try { await graphqlQuery(mutation,{name}); showNotification('Deleted','success'); await loadFlowClasses(); renderClassesTable(); }
        catch(e){ console.error(e); showNotification('Delete failed','error'); }
    });
}

async function listPageDeleteFlowInstance(name){
    showConfirmModal('Confirm Delete', `Are you sure you want to delete flow instance "${name}"?\n\nThis action cannot be undone.`, async () => {
        const mutation = `mutation($name:String!){ flow { deleteInstance(name:$name) } }`;
        try { await graphqlQuery(mutation,{name}); showNotification('Deleted','success'); if(selectedFlowClassName) await loadFlowInstancesForClass(selectedFlowClassName); renderInstancesTable(); }
        catch(e){ console.error(e); showNotification('Delete failed','error'); }
    });
}

async function listPageStartFlowInstance(name){
    const mutation = `mutation($name:String!){ flow { enableInstance(name:$name) { name } } }`;
    try { await graphqlQuery(mutation,{name}); showNotification('Instance enabled','success'); if(selectedFlowClassName) await loadFlowInstancesForClass(selectedFlowClassName); renderInstancesTable(); }
    catch(e){ console.error(e); showNotification('Enable failed: '+e.message,'error'); }
}

async function listPageStopFlowInstance(name){
    const mutation = `mutation($name:String!){ flow { disableInstance(name:$name) { name } } }`;
    try { await graphqlQuery(mutation,{name}); showNotification('Instance disabled','success'); if(selectedFlowClassName) await loadFlowInstancesForClass(selectedFlowClassName); renderInstancesTable(); }
    catch(e){ console.error(e); showNotification('Disable failed: '+e.message,'error'); }
}

async function restartAllInstancesOfClass(flowClassName){
    if(!flowClassName){
        showNotification('Please select a flow class first','error');
        return;
    }

    // Load instances for this flow class
    await loadFlowInstancesForClass(flowClassName);
    const instancesToRestart = flowInstances;

    if(instancesToRestart.length === 0){
        showNotification('No instances found for this flow class','info');
        return;
    }

    showConfirmModal('Confirm Restart', `Restart all ${instancesToRestart.length} instance(s) of class "${flowClassName}"?`, async () => {
        try {
            let successCount = 0;
            let failCount = 0;

            // Disable all instances
            for(const instance of instancesToRestart){
                try {
                    const mutation = `mutation($name:String!){ flow { disableInstance(name:$name) { name } } }`;
                    await graphqlQuery(mutation, {name: instance.name});
                    successCount++;
                } catch(e){
                    console.error(e);
                    failCount++;
                }
            }

            // Small delay between disable and enable
            await new Promise(resolve => setTimeout(resolve, 500));

            // Enable all instances again
            for(const instance of instancesToRestart){
                if(instance.enabled){ // Only re-enable if it was previously enabled
                    try {
                        const mutation = `mutation($name:String!){ flow { enableInstance(name:$name) { name } } }`;
                        await graphqlQuery(mutation, {name: instance.name});
                    } catch(e){
                        console.error(e);
                        failCount++;
                    }
                }
            }

            // Reload instances
            await loadFlowInstancesForClass(flowClassName);
            renderInstancesTable();

            if(failCount === 0){
                showNotification(`Successfully restarted ${successCount} instance(s)`, 'success');
            } else {
                showNotification(`Restarted ${successCount} instance(s), ${failCount} failed`, 'error');
            }
        } catch(e){
            console.error(e);
            showNotification('Restart failed: '+e.message, 'error');
        }
    }, 'Restart');
}

// ---------------------- Sorting & Helpers ----------------------
function compareValues(a,b,key,dir){
    let av,bv;
    switch(key){
        case 'nodes': av=a.nodes.length; bv=b.nodes.length; break;
        case 'connections': av=a.connections.length; bv=b.connections.length; break;
        case 'inputs': av=a.inputMappings.length; bv=b.inputMappings.length; break;
        case 'outputs': av=a.outputMappings.length; bv=b.outputMappings.length; break;
        case 'executions': av=a.status? a.status.executionCount:0; bv=b.status? b.status.executionCount:0; break;
        default: av=a[key]||''; bv=b[key]||''; break;
    }
    if(typeof av==='string') av=av.toLowerCase();
    if(typeof bv==='string') bv=bv.toLowerCase();
    const cmp = av>bv?1: av<bv?-1:0; return dir==='asc'?cmp:-cmp;
}
function toggleSort(table,key){ const st=sortState[table]; if(st.key===key){ st.dir=st.dir==='asc'?'desc':'asc'; } else { st.key=key; st.dir='asc'; } if(table==='classes') renderClassesTable(); else renderInstancesTable(); }

// ---------------------- Utilities ----------------------
function escapeHtml(text){ if(text===null||text===undefined) return ''; const div=document.createElement('div'); div.textContent=String(text); return div.innerHTML; }

function restoreWorkflowFilters(){
    filters.hideScriptsNamespace = localStorage.getItem('workflows.hideScriptsNamespace') !== 'false';
}

function isVisibleByNamespace(item){
    return !filters.hideScriptsNamespace || (item.namespace || '') !== 'scripts';
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    // Remove fractional seconds (e.g., 2024-01-15T10:30:45.123456Z -> 2024-01-15 10:30:45)
    return dateStr.replace(/\.\d+Z?$/, '').replace('T', ' ');
}

function showNotification(message, type = 'info') { return ui.toast(message, type); }

async function showConfirmModal(title, message, onConfirm, confirmLabel = 'Delete') {
    if (await ui.confirm({ title, message, confirmLabel, danger: true })) return onConfirm();
}

page.expose({
    get compareValues() { return compareValues; },
    get createNewInstance() { return createNewInstance; },
    get escapeHtml() { return escapeHtml; },
    get filters() { return filters; },
    get flowClasses() { return flowClasses; },
    get flowInstances() { return flowInstances; },
    get formatDateTime() { return formatDateTime; },
    get graphqlQuery() { return graphqlQuery; },
    get initListPage() { return initListPage; },
    get isVisibleByNamespace() { return isVisibleByNamespace; },
    get listPageDeleteFlowClass() { return listPageDeleteFlowClass; },
    get listPageDeleteFlowInstance() { return listPageDeleteFlowInstance; },
    get listPageStartFlowInstance() { return listPageStartFlowInstance; },
    get listPageStopFlowInstance() { return listPageStopFlowInstance; },
    get loadFlowClasses() { return loadFlowClasses; },
    get loadFlowInstances() { return loadFlowInstances; },
    get loadFlowInstancesForClass() { return loadFlowInstancesForClass; },
    get refreshFlowClasses() { return refreshFlowClasses; },
    get renderClassesTable() { return renderClassesTable; },
    get renderInstancesTable() { return renderInstancesTable; },
    get restartAllInstancesOfClass() { return restartAllInstancesOfClass; },
    get restoreWorkflowFilters() { return restoreWorkflowFilters; },
    get selectFlowClass() { return selectFlowClass; },
    get selectedFlowClassName() { return selectedFlowClassName; },
    get setupListInteractions() { return setupListInteractions; },
    get showConfirmModal() { return showConfirmModal; },
    get showNotification() { return showNotification; },
    get sortState() { return sortState; },
    get toggleSort() { return toggleSort; }
});
page.ready();
return () => page.dispose();
}
