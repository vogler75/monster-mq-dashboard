// Broker configuration is also available before login, outside the SPA shell.
import { PageLifecycle } from './page-lifecycle.js';
import { mount } from './broker-config.js';
const page = new PageLifecycle();
const edits = window.ui.trackPageEdits(document.body);
page.addCleanup(edits);
page.window.addEventListener('beforeunload', event => {
    if (edits.isDirty()) { event.preventDefault(); event.returnValue = ''; }
});
mount(page);
window.addEventListener('pagehide', () => page.dispose(), { once: true });
