import '@siemens/ix/dist/siemens-ix/siemens-ix.css';
import { defineCustomElements } from '@siemens/ix/loader';
import { defineCustomElements as defineIxIconCustomElements } from '@siemens/ix-icons/loader';

// Tell ix-icons where to find SVG files
const meta = document.createElement('meta');
meta.setAttribute('name', 'ix-icons:path');
meta.setAttribute('content', '/svg');
document.head.appendChild(meta);

defineIxIconCustomElements();
defineCustomElements();

window.__DASHBOARD_VERSION__ = typeof __DASHBOARD_VERSION__ !== 'undefined' ? __DASHBOARD_VERSION__ : '1.8.29';

document.body.classList.add('theme-classic-dark');
