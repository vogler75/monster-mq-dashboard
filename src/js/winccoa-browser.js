// Mounted by the SPA router; resources and handler bindings belong to this visit.
import { WinCCOaBrowserView } from './winccoa-browser-view.js';

export function mount(page) {
const { document, ui, setTimeout, clearTimeout } = page;
// Stand-alone WinCC OA browser (Query.winccoa).

const esc = s => ui.escapeHtml(s == null ? '' : String(s));

function showDetails(info) {
    const pane = document.getElementById('oa-details');
    if (!info) return;
    const rows = [['DPE', info.dpe], ['Kind', info.kindLabel], ['Datapoint type', info.type], ['Element type', info.elementType], ['Unit', info.unit],
        ['Description', info.description], ['Format', info.format], ['Value', info.value], ['Source time', info.stime],
        ['Status', info.status == null ? null : '0x' + Number(info.status).toString(16)], ['Error', info.error]]
        .filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '');
    pane.innerHTML = `<dl class="um-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const view = new WinCCOaBrowserView(document.getElementById('oa-browser'), {
        document, gql: new GraphQLDashboardClient(), setTimeout, clearTimeout, onDetails: showDetails
    });
    if (!await view.init()) ui.showError('WinCC OA browsing is only available when the broker runs embedded in WinCC OA (WCCOAmmq).');
});

page.ready();
return () => page.dispose();
}
