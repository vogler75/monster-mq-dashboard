// Dashboard branding — product name, logo and favicons.
//
// The dashboard is written as "MonsterMQ". A host that embeds it (e.g. the
// MonsterMQ Edge broker built as "WinCCMQ") can rebrand it by serving
// /config/branding.json:
//
//   {
//     "brand": "nexusmq",          // icon pack under /brands/<brand>/
//     "productName": "WinCCMQ",
//     "dashboardName": "WinCCMQ Dashboard",   // optional, default "<productName> Dashboard"
//     "tagline": "...",                       // optional, About dialog subtitle
//     "logo": "...", "favicon": "...", "favicon16": "...",
//     "favicon32": "...", "appleTouchIcon": "...", "css": "..."  // optional overrides
//   }
//
// A missing or invalid file means the built-in MonsterMQ branding. The brand
// is chosen by whoever serves the dashboard, never by the viewer.
//
// Loaded as a classic script in <head> of index.html and login.html, before
// sidebar.js. Exposes window.branding.
(function () {
    'use strict';

    const DEFAULT_NAME = 'MonsterMQ';
    const CACHE_KEY = 'monstermq_branding_v1';
    const FETCH_TIMEOUT_MS = 3000;

    // Icon packs shipped in every build (src/brands/<id>/).
    const PACKS = {
        monstermq: {
            logo: '/assets/logo.png',
            favicon: '/favicon.ico',
            favicon16: '/favicon-16x16.png',
            favicon32: '/favicon-32x32.png',
            appleTouchIcon: '/apple-touch-icon.png',
            css: null
        },
        nexusmq: {
            logo: '/brands/nexusmq/logo.svg',
            favicon: '/brands/nexusmq/favicon.ico',
            favicon16: '/brands/nexusmq/favicon-16x16.png',
            favicon32: '/brands/nexusmq/favicon-32x32.png',
            appleTouchIcon: '/brands/nexusmq/apple-touch-icon.png',
            css: '/brands/nexusmq/brand.css'
        }
    };

    const ASSET_KEYS = ['logo', 'favicon', 'favicon16', 'favicon32', 'appleTouchIcon', 'css'];

    // Text containers the swap never touches: code, editors, user input,
    // the live log viewer, and anything explicitly opted out.
    const SKIP_SELECTOR = [
        'script', 'style', 'code', 'pre', 'textarea', 'input', 'select',
        '[contenteditable]', '[data-no-brand]', '#log-viewer-container',
        '.cm-editor', '.CodeMirror', '.monaco-editor'
    ].join(',');
    const SWAP_ATTRIBUTES = ['title', 'placeholder', 'alt', 'aria-label', 'label', 'header', 'application-name'];

    function str(v) {
        return typeof v === 'string' && v.trim() ? v.trim() : null;
    }

    function resolve(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        const brand = str(raw.brand) && PACKS[str(raw.brand).toLowerCase()] ? str(raw.brand).toLowerCase() : 'monstermq';
        const productName = str(raw.productName) || DEFAULT_NAME;
        const cfg = {
            brand,
            productName,
            dashboardName: str(raw.dashboardName) || productName + ' Dashboard',
            tagline: str(raw.tagline) || 'Industrial IoT & MQTT 5.0 Gateway Platform'
        };
        ASSET_KEYS.forEach(k => { cfg[k] = str(raw[k]) || PACKS[brand][k]; });
        return cfg;
    }

    function readCache() {
        try {
            const s = sessionStorage.getItem(CACHE_KEY);
            return s ? JSON.parse(s) : null;
        } catch (e) { return null; }
    }

    function writeCache(raw) {
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(raw || {})); } catch (e) { /* ignore */ }
    }

    let current = resolve(readCache());
    let observer = null;

    function isDefault() {
        return current.productName === DEFAULT_NAME;
    }

    // Replace the product name in a plain string.
    function text(value) {
        if (typeof value !== 'string' || isDefault() || value.indexOf(DEFAULT_NAME) === -1) return value;
        return value.split(DEFAULT_NAME).join(current.productName);
    }

    function skipped(el) {
        return !el || (el.closest && el.closest(SKIP_SELECTOR) !== null);
    }

    function swapElementAttributes(el) {
        for (const attr of SWAP_ATTRIBUTES) {
            const v = el.getAttribute(attr);
            if (v && v.indexOf(DEFAULT_NAME) !== -1) {
                const nv = text(v);
                if (nv !== v) el.setAttribute(attr, nv);
            }
        }
    }

    // Rewrite visible text and a few user-facing attributes below root.
    function swapText(root) {
        if (isDefault() || !root) return;
        if (root.nodeType === Node.TEXT_NODE) {
            if (!skipped(root.parentElement)) {
                const nv = text(root.nodeValue);
                if (nv !== root.nodeValue) root.nodeValue = nv;
            }
            return;
        }
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
        if (root.nodeType === Node.ELEMENT_NODE) {
            if (skipped(root)) return;
            swapElementAttributes(root);
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    return node.matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                }
                return node.nodeValue && node.nodeValue.indexOf(DEFAULT_NAME) !== -1
                    ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        const textNodes = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeType === Node.ELEMENT_NODE) swapElementAttributes(node);
            else textNodes.push(node);
        }
        textNodes.forEach(n => { n.nodeValue = text(n.nodeValue); });
    }

    function setIcon(rel, sizes, type, href) {
        if (!href) return;
        const key = rel + (sizes ? ':' + sizes : '');
        let link = document.head.querySelector(`link[data-brand-icon="${key}"]`);
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('data-brand-icon', key);
            link.rel = rel;
            if (sizes) link.setAttribute('sizes', sizes);
            if (type) link.type = type;
            document.head.appendChild(link);
        }
        if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    }

    function applyHead() {
        setIcon('icon', null, 'image/x-icon', current.favicon);
        setIcon('icon', '32x32', 'image/png', current.favicon32);
        setIcon('icon', '16x16', 'image/png', current.favicon16);
        setIcon('apple-touch-icon', '180x180', null, current.appleTouchIcon);

        let css = document.head.querySelector('link[data-brand-css]');
        if (current.css) {
            if (!css) {
                css = document.createElement('link');
                css.rel = 'stylesheet';
                css.setAttribute('data-brand-css', 'true');
                document.head.appendChild(css);
            }
            if (css.getAttribute('href') !== current.css) css.setAttribute('href', current.css);
        } else if (css) {
            css.remove();
        }

        document.documentElement.setAttribute('data-brand', current.brand);
        document.title = text(document.title);
    }

    function applyBody() {
        if (!document.body) return;
        document.querySelectorAll('[data-brand-src="logo"]').forEach(img => {
            if (img.getAttribute('src') !== current.logo) img.setAttribute('src', current.logo);
            img.setAttribute('alt', current.productName);
        });
        document.querySelectorAll('[data-brand="name"]').forEach(el => { el.textContent = current.productName; });
        document.querySelectorAll('[data-brand="dashboardName"]').forEach(el => { el.textContent = current.dashboardName; });
        document.querySelectorAll('[data-brand="tagline"]').forEach(el => { el.textContent = current.tagline; });
        document.querySelectorAll('ix-menu[application-name]').forEach(el => el.setAttribute('application-name', current.productName));
        document.querySelectorAll('ix-application-header[name]').forEach(el => el.setAttribute('name', current.productName));
        swapText(document.body);
        observe();
    }

    // Pages render most of their text after load (tables, modals, toasts), so
    // keep rewriting new nodes for as long as a non-default name is active.
    function observe() {
        if (isDefault()) {
            if (observer) { observer.disconnect(); observer = null; }
            return;
        }
        if (observer || typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver(records => {
            for (const r of records) {
                if (r.type === 'characterData') swapText(r.target);
                else r.addedNodes.forEach(swapText);
            }
            // Drop the records our own rewrites produced.
            observer.takeRecords();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function apply() {
        applyHead();
        if (document.body) applyBody();
    }

    async function load() {
        let raw = null;
        try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
            const res = await fetch('/config/branding.json', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
            if (timer) clearTimeout(timer);
            const type = res.headers.get('content-type') || '';
            // Static hosts with an SPA fallback answer 200 + index.html.
            if (res.ok && !/html/i.test(type)) raw = await res.json();
        } catch (e) { raw = null; }
        writeCache(raw);
        current = resolve(raw);
        apply();
        return current;
    }

    // ---- Brand colours for canvas/Chart.js code, where CSS var() cannot be used.
    // Page CSS wraps hard-coded colours as var(--bx-<role>, <literal>); a brand
    // stylesheet sets the roles on <html>. brandColor() resolves a literal the
    // same way at runtime and returns it unchanged when no brand defines it.
    const COLOR_ROLES = {"#7c3aed":"accent","#8b5cf6":"accent","#a78bfa":"accent","#9333ea":"accent","#9f67ff":"accent","#c4b5fd":"accent","#6366f1":"accent","#3b82f6":"accent","#60a5fa":"accent","#38bdf8":"accent","#0ea5e9":"accent","#06b6d4":"accent","#22d3ee":"accent","#93c5fd":"accent","#286d8e":"accent","#4fc3f7":"accent","#2563eb":"accent","#818cf8":"accent","#a855f7":"accent","#c084fc":"accent","#ddd6fe":"accent","#5b21b6":"accent-2","#6d28d9":"accent-2","#14b8a6":"accent-2","#2dd4bf":"accent-2","#205b77":"accent-2","#0891b2":"accent-2","#4f46e5":"accent-2","#10b981":"ok","#34d399":"ok","#22c55e":"ok","#2ed573":"ok","#46e08c":"ok","#28a745":"ok","#4ade80":"ok","#84cc16":"ok","#a7f3d0":"ok","#6a9955":"ok","#059669":"ok","#16a34a":"ok","#6ee7b7":"ok","#ef4444":"err","#f87171":"err","#dc3545":"err","#ff4757":"err","#dc2626":"err","#f44336":"err","#ef5350":"err","#fca5a5":"err-text","#fecaca":"err-text","#f28b95":"err-text","#f59e0b":"warn","#f97316":"warn","#fbbf24":"warn","#ffc107":"warn","#ffb020":"warn","#fb923c":"warn","#eab308":"warn","#ff9800":"warn","#ffb74d":"warn","#d97706":"warn","#ea580c":"warn","#facc15":"warn","#fed7aa":"warn-text","#fde68a":"warn-text","#fcd34d":"warn-text","#ec4899":"accent-3","#f472b6":"accent-3","#0f172a":"bg","#0f1619":"bg","#0f1117":"bg","#111827":"bg","#12141a":"bg","#0b0f19":"bg","#090d16":"bg","#1e293b":"surface","#1f2937":"surface","#18262d":"surface","#1a1d28":"surface","#182234":"surface","#222632":"surface","#2e2e4f":"surface","#223240":"raised","#2d3139":"raised","#252936":"raised","#2d3142":"raised","#2a3d4d":"raised","#242a35":"raised","#3b2c5c":"raised","#24352d":"ok-tint","#3a2528":"err-tint","#334155":"track","#3d4153":"track","#374151":"track","#475569":"border-input","#4b5563":"border-input","#64748b":"weak","#617d91":"weak","#6b7280":"weak","#94a3b8":"muted","#9ca3af":"muted","#8b8ba7":"muted","#97bdd4":"muted","#b8bcc8":"muted","#9aa0b5":"muted","#7d8492":"muted","#6c757d":"muted","#cbd5e1":"body","#e2e8f0":"body","#e4e6eb":"body","#e8eaed":"body","#d1d5db":"body","#f1f5f9":"heading","#f8fafc":"heading","#f0f6fc":"heading","#f3f4f6":"heading","#f9fafb":"heading","124, 58, 237":"accent","139, 92, 246":"accent","167, 139, 250":"accent","99, 102, 241":"accent","147, 51, 234":"accent","59, 130, 246":"accent","56, 189, 248":"accent","14, 165, 233":"accent","6, 182, 212":"accent","168, 85, 247":"accent","82, 181, 225":"accent","20, 184, 166":"accent-2","91, 33, 182":"accent-2","45, 212, 191":"accent-2","16, 185, 129":"ok","34, 197, 94":"ok","46, 213, 115":"ok","40, 167, 69":"ok","52, 211, 153":"ok","239, 68, 68":"err","220, 53, 69":"err","255, 71, 87":"err","248, 113, 113":"err","244, 67, 54":"err","245, 158, 11":"warn","249, 115, 22":"warn","251, 191, 36":"warn","255, 193, 7":"warn","255, 176, 32":"warn","234, 179, 8":"warn","255, 152, 0":"warn","236, 72, 153":"accent-3","15, 23, 42":"bg","15, 22, 25":"bg","3, 7, 10":"bg","24, 38, 45":"surface","26, 29, 40":"surface","23, 23, 37":"surface","30, 41, 59":"surface","29, 33, 45":"surface","46, 46, 79":"surface","34, 50, 64":"raised","71, 85, 105":"border-input","51, 65, 85":"border-input","148, 163, 184":"muted","107, 114, 128":"muted","151, 189, 212":"muted","211, 236, 248":"line"};

    function cssVar(name) {
        try {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        } catch (e) { return ''; }
    }

    function rgbOf(hex) {
        const h = hex.replace('#', '');
        return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)).join(', ');
    }

    function brandColor(value) {
        if (typeof value !== 'string') return value;
        const v = value.trim();
        const hex = /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
        if (hex) {
            const role = COLOR_ROLES[hex];
            return (role && cssVar('--bx-' + role)) || value;
        }
        const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
        if (m) {
            const role = COLOR_ROLES[`${m[1]}, ${m[2]}, ${m[3]}`];
            const rgb = role && cssVar('--bx-' + role + '-rgb');
            if (rgb) return m[4] !== undefined ? `rgba(${rgb}, ${m[4]})` : `rgb(${rgb})`;
        }
        return value;
    }

    // A categorical palette: the brand's --bx-series (space separated) when set,
    // repeated to the default's length; otherwise the default unchanged.
    function brandPalette(defaults) {
        const series = cssVar('--bx-series').split(/\s+/).filter(Boolean);
        if (!series.length) return defaults.slice();
        return defaults.map((_, i) => series[i % series.length]);
    }

    // A colour at the given opacity, for chart fills derived from a line colour.
    function brandAlpha(hex, alpha) {
        return /^#[0-9a-f]{6}$/i.test(hex) ? `rgba(${rgbOf(hex)}, ${alpha})` : hex;
    }

    window.brandColor = brandColor;
    window.brandPalette = brandPalette;
    window.brandAlpha = brandAlpha;

    window.branding = {
        get config() { return Object.assign({}, current); },
        get productName() { return current.productName; },
        get dashboardName() { return current.dashboardName; },
        get tagline() { return current.tagline; },
        get logo() { return current.logo; },
        text,
        swapText,
        apply,
        color: brandColor,
        palette: brandPalette,
        alpha: brandAlpha,
        ready: null
    };

    // Cached branding first (no flash on later page loads), then the live file.
    applyHead();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyBody, { once: true });
    } else {
        applyBody();
    }
    window.branding.ready = load();
})();
