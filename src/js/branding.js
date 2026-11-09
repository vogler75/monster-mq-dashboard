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

    window.branding = {
        get config() { return Object.assign({}, current); },
        get productName() { return current.productName; },
        get dashboardName() { return current.dashboardName; },
        get tagline() { return current.tagline; },
        get logo() { return current.logo; },
        text,
        swapText,
        apply,
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
