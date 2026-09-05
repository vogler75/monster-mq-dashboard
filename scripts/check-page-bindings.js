// Rollup is provided by Vite. Inspect lexical references before converting a page to a module.
import { parseAst } from 'rollup/parseAst';
import { readdirSync, readFileSync } from 'node:fs';
const standard = new Set(('undefined NaN Infinity window document console location history navigator localStorage sessionStorage fetch URL URLSearchParams Blob File FileReader FormData Headers Request Response AbortController AbortSignal Event CustomEvent MouseEvent KeyboardEvent HTMLElement Element Node MutationObserver ResizeObserver IntersectionObserver WebSocket EventSource TextEncoder TextDecoder atob btoa crypto performance requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval getComputedStyle alert confirm prompt parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape Array Object Function String Number Boolean BigInt Symbol Date Math JSON Intl Promise Map Set WeakMap WeakSet RegExp Error TypeError Uint8Array ArrayBuffer arguments').split(' '));
const files = readdirSync('src/js').filter(f => f.endsWith('.js'));
const texts = Object.fromEntries(files.map(f => [f, readFileSync('src/js/' + f, 'utf8')]));
const shared = files.filter(f => !texts[f].includes('export function mount(page)'));
for (const f of shared) {
    for (const [, name] of texts[f].matchAll(/^(?:class|var|let|const|function)\s+(\w+)|window\.(\w+)\s*=/gm)) if (name) standard.add(name);
    for (const [, name] of texts[f].matchAll(/window\.(\w+)\s*=/g)) standard.add(name);
}
function inspect(text, globals) {
    const refs = [];
    const root = { names: new Set(globals), parent: null, fn: true };
    function scope(parent, fn = false) { return { names: new Set(), parent, fn }; }
    function declare(node, s) {
        if (!node) return;
        if (node.type === 'Identifier') s.names.add(node.name);
        else if (node.type === 'RestElement') declare(node.argument, s);
        else if (node.type === 'AssignmentPattern') { declare(node.left, s); walk(node.right, s); }
        else if (node.type === 'ArrayPattern') node.elements.forEach(n => declare(n, s));
        else if (node.type === 'ObjectPattern') node.properties.forEach(n => {
            if (n.computed) walk(n.key, s);
            declare(n.type === 'RestElement' ? n.argument : n.value, s);
        });
    }
    function walk(node, s, parent, key) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(n => walk(n, s, parent, key)); return; }
        if (node.type === 'Identifier') {
            if ((parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
                (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && key === 'key' && !parent.computed) ||
                ['label'].includes(key)) return;
            refs.push({ node, s }); return;
        }
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
            if (node.type === 'FunctionDeclaration' && node.id) declare(node.id, s);
            const inner = scope(s, true);
            declare(node.id, inner); node.params.forEach(p => declare(p, inner)); walk(node.body, inner); return;
        }
        if (node.type === 'VariableDeclaration') {
            let target = s; if (node.kind === 'var') while (!target.fn) target = target.parent;
            node.declarations.forEach(d => { declare(d.id, target); walk(d.init, s); }); return;
        }
        if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) {
            if (node.type === 'ClassDeclaration') declare(node.id, s);
            walk(node.superClass, s); const inner = scope(s); declare(node.id, inner); walk(node.body, inner); return;
        }
        if (node.type === 'CatchClause') { const inner = scope(s); declare(node.param, inner); walk(node.body, inner); return; }
        if (node.type === 'BlockStatement') { const inner = scope(s); walk(node.body, inner); return; }
        if (node.type === 'ImportDeclaration') { node.specifiers.forEach(n => declare(n.local, s)); return; }
        for (const [k, value] of Object.entries(node)) if (k !== 'type') walk(value, s, node, k);
    }
    walk(parseAst(text), root);
    return refs.filter(({ node, s }) => { for (; s; s = s.parent) if (s.names.has(node.name)) return false; return true; }).map(({ node }) => node.name);
}
let failures = 0;
for (const file of files.filter(f => texts[f].includes('export function mount(page)'))) {
    const allowed = new Set(standard);
    for (const html of readdirSync('src/pages').map(f => readFileSync('src/pages/' + f, 'utf8')).filter(s => s.includes('/js/' + file))) {
        for (const [vendor, binding] of Object.entries({ 'chart.umd.js': 'Chart', 'echarts.min.js': 'echarts', 'marked.umd.js': 'marked' })) {
            if (html.includes('/js/vendor/' + vendor)) allowed.add(binding);
        }
        for (const [, linked] of html.matchAll(/src="\/js\/([^"/]+)"/g)) {
            const code = texts[linked] || '';
            for (const [, name] of code.matchAll(/get (\w+)\(\)|window\.(\w+)\s*=/g)) if (name) allowed.add(name);
            for (const [, name] of code.matchAll(/window\.(\w+)\s*=/g)) allowed.add(name);
        }
    }
    const missing = [...new Set(inspect(texts[file], allowed))];
    if (missing.length) { console.error(file + ': ' + missing.join(', ')); failures++; }
}
if (failures) process.exitCode = 1;
else console.log('All page module references resolve to local declarations or declared page/shared bindings.');
