import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const failures = [];
const pages = readdirSync('src/pages').filter(name => name.endsWith('.html'));
const scripts = readdirSync('src/js').filter(name => name.endsWith('.js'));
for (const name of scripts) {
    const file = join('src/js', name);
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (checked.status) failures.push(checked.stderr.trim());
    const text = readFileSync(file, 'utf8');
    if (name === 'sidebar.js' && /code\.replace|_pageIntervals|_pageTimeouts/.test(text)) failures.push(`${file}: use explicit page lifecycles instead of rewriting source or global timer tracking`);
    if (/notify-keyframes|animation:notify-dismiss/.test(text)) failures.push(`${file}: use ui.toast instead of a custom notification`);
}
// Check the actual shell as well as standalone page entry points.
for (const file of ['src/index.html', ...pages.map(name => join('src/pages', name))]) {
    const text = readFileSync(file, 'utf8');
    for (const [tag, src] of text.matchAll(/<script\b[^>]*src="(\/js\/[^"?]+)"[^>]*>/g)) {
        if (!existsSync('src' + src)) continue;
        const source = readFileSync('src' + src, 'utf8');
        // Vite also transforms dynamic imports, so these entry points must be modules.
        if (/\b(?:import\s*[({]|import\s+|export\s+)/.test(source) && !/type="module"/.test(tag)) {
            failures.push(`${file}: ${src} uses imports/exports but is loaded as a classic script`);
        }
    }
}
for (const name of pages) {
    const file = join('src/pages', name);
    const text = readFileSync(file, 'utf8');
    for (const [, css] of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
        if (/[^{}]*\.(?:btn|data-table|form-control|metric-card|section-card|status-badge|loading-indicator|error-message|modal)(?![\w-])[^{}]*\{/.test(rules)) failures.push(`${file}: local shared component override`);
    }
    const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    for (const id of new Set(ids)) {
        if (ids.filter(value => value === id).length > 1) failures.push(`${file}: duplicate ID ${id}`);
        if (/delete.*modal/i.test(id)) failures.push(`${file}: migrate ${id} to ui.confirmDelete`);
    }
    for (const match of text.matchAll(/<(?:a|button)\b[^>]*>/g)) {
        const tag = match[0];
        const classes = tag.match(/class="([^"]+)"/)?.[1].split(/\s+/) || [];
        const style = tag.match(/style="([^"]*)"/)?.[1] || '';
        if (classes.some(value => value === 'btn' || value === 'btn-icon') && /(?:^|;)\s*(?:padding(?:-[\w]+)?|font-size|(?:min-)?width|background(?:-color)?)\s*:/.test(style)) failures.push(`${file}: inline button styling ${tag}`);
    }
    if (/<ix-icon-button[^>]*\bghost\b/.test(text)) failures.push(`${file}: obsolete icon button ghost attribute`);
    for (const [, src] of text.matchAll(/<script[^>]*src="(\/[^"?]+)"/g)) {
        if (!src.startsWith('/js/vendor/') && !existsSync('src' + src)) failures.push(`${file}: missing script ${src}`);
        const shared = new Set(['ix-init', 'storage', 'graphql-client', 'ui', 'sidebar', 'log-viewer', 'broker-manager', 'login', 'broker-config-entry']);
        const stem = src.split('/').pop().replace('.js', '');
        if (!shared.has(stem) && !src.startsWith('/js/vendor/') && existsSync('src' + src)) {
            const moduleSource = readFileSync('src' + src, 'utf8');
            if (!/export function mount\(page\)/.test(moduleSource) || !/return \(\) => page\.dispose\(\)/.test(moduleSource)) failures.push(`${file}: ${src} must expose mount/dispose`);
        }
    }
    if (/<!doctype html>/i.test(text)) {
        const linkedScripts = [...text.matchAll(/<script[^>]*src="(\/js\/[^"?]+)"/g)]
            .map(match => 'src' + match[1]).filter(existsSync);
        const code = linkedScripts.map(path => readFileSync(path, 'utf8')).join('\n');
        const names = new Set([
            ...[...code.matchAll(/get (\w+)\(\)/g)].map(match => match[1]),
            ...[...code.matchAll(/window\.(\w+)\s*=/g)].map(match => match[1]),
            ...[...text.matchAll(/^(?:async )?function (\w+)\(/gm)].map(match => match[1]),
            'window', 'document', 'this', 'event', 'e', 'ui', 'console', 'Math', 'JSON', 'Number', 'String',
            'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'setInterval',
            'clearTimeout', 'clearInterval', 'fetch', 'return', 'if', 'switch'
        ]);
        for (const [, handler] of (text + '\n' + code).matchAll(/\bon(?:click|change|input|submit|keydown|keyup)="([^"]*)"/g)) {
            const body = handler.replace(/\$\{[^}]*\}/g, '');
            for (const [, root] of body.matchAll(/(?<![\w.])([a-zA-Z_$][\w$]*)(?:\.[a-zA-Z_$][\w$]*)*\s*\(/g)) {
                if (!names.has(root)) failures.push(`${file}: inline handler has no explicit binding for ${root}`);
            }
        }
    }
    const ownScript = join('src/js', name.replace('.html', '.js'));
    const scriptText = existsSync(ownScript) ? readFileSync(ownScript, 'utf8') : '';
    for (const [, id] of (text + scriptText).matchAll(/(?:getElementById\(['"]|(?:target\.id\s*===\s*)['"])([^'"]*delete[^'"]*modal)['"]/gi)) {
        if (!ids.includes(id)) failures.push(`${file}: reference to removed modal ${id}`);
    }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Dashboard checks passed: ${pages.length} pages, ${scripts.length} scripts.`);
