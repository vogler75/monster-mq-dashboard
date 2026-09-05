# Dashboard design concept

Every page in the dashboard is one of two shapes. Build new pages by copying an
existing migrated example rather than starting from scratch.

- **List page** — `pages/redis-clients.html` + `js/redis-clients.js`
- **Detail page** — `pages/nats-client-detail.html` + `js/nats-client-detail.js`

## The one rule

**Pages must not redefine shared components in a local `<style>` block.**

The SPA router (`js/sidebar.js`) hoists each page's `<style>` into `<head>`
*after* the shared stylesheets, so a local copy of `.data-table` or `.btn`
silently wins. That is how the dashboard ended up with the same component
defined 37 times at slightly different sizes, visibly changing as you navigate.

A page `<style>` block is for things genuinely unique to that page — a topic
tree, a workflow canvas, a drag-and-drop zone. If you are typing `.btn`,
`.modal`, `.form-control`, `.data-table`, `.status-badge`, `.metric-card`,
`.section-card`, `.loading-indicator` or `.error-message`, stop: it already
exists in `assets/components.css`. If it needs a variant, add the variant there.

## Where things live

| File | Owns |
|---|---|
| `assets/components.css` | Every recurring UI element. The design system. |
| `assets/monster-theme.css` | Brand tokens, scrollbars, auth indicator, the standalone login page. |
| `assets/ix-app.css` | Layout only — viewport, `.main-content`, `ix-menu` height. |
| `js/ui.js` | Modals, confirms, toasts, loading/error/empty states. |
| `js/sidebar.js` | Menu config and SPA navigation. Add new pages to `getMenuConfig()`. |

Loaded once from `index.html`. Pages do **not** link them — the router skips
duplicates anyway.

## Page anatomy

### List page

```
page-header          block wrapper — never a flex row itself
  page-header-content  title + subtitle left; actions right, if any
error-message        hidden banner, driven by ui.showError()
metrics-grid         4–6 metric-cards, iX icons (never emoji)
data-table
  table-header       table title left, table-actions right
  table-responsive   the table scrolls here, never the page body
loading-indicator    hidden, driven by ui.setLoading()
```

A list page's create action lives in `table-actions`, last in the cluster,
after the filters and the refresh button — it acts on the table below it, and
a page with two tables needs one per table. The page header carries the title
only. (Detail pages are the other way round: their actions are page-level, so
they go in `page-header-actions`.)

The cluster class depends on the bar it sits in: `table-actions` inside a
`table-header`, `section-header-actions` inside a `section-header`. Both are a
plain right-aligned row. `toolbar` is not one of them — it is a standalone
strip that sits *above* a card, so it carries `justify-content: space-between`
and a bottom margin. Nest it in a header bar and the controls spread apart and
sit off-centre, which is how one page's create button ended up looking unlike
every other page's.

### Detail page

```
page-header
  breadcrumb         Parent list › this entity. Replaces per-page Back buttons.
  title + subtitle
  page-header-actions  destructive first, primary last — always that order
error-message
section-card         one per logical group
  section-header     heading left, status badge or section action right
  section-content    form-grid / info-grid / table
loading-indicator
```

Detail pages have no Back button. The breadcrumb is the way back, and its last
segment is set from the loaded entity (`setText('breadcrumb-name', …)`).

#### After a save

Save never navigates to the list. Create and update end the same way — on the
detail page, showing the entity that was just saved:

```js
if (this.isNew) {
    ui.success(`Thing "${input.name}" created successfully`);
    setTimeout(() => { window.spaLocation.href =
        `/pages/thing-detail.html?name=${encodeURIComponent(input.name)}`; }, 800);
} else {
    ui.success('Thing updated successfully');
    await this.loadThing();
}
```

Create redirects to its own detail URL so the page comes back in edit mode
bound to the new entity — sub-resource editors (address mappings, queries,
streams) need a saved entity to attach to, and bouncing to the list forced the
user to re-open the row to reach them. Update reloads in place; if the page
lets the name change, retarget `this.<entity>Name` and `history.replaceState`
the URL first, or the reload reads the old record.

Only delete and cancel return to the list, and the breadcrumb is always there.

`page-header` is a block, so a page that writes a bare `h1 + p` inside it still
stacks correctly. Anything that needs a title row with actions wraps them in
`page-header-content` — don't hand-roll that row with inline flex styles.

## Interaction

Use `window.ui` — never `alert()`, `confirm()`, or a hand-rolled toast:

```js
if (await ui.confirmDelete(name, { title: 'Delete Redis client' })) { … }
ui.success('Client saved');           // auto-hides
ui.error('Failed: ' + e.message);     // stays until dismissed
ui.setLoading(true);                  // toggles #loading-indicator
ui.showError(msg); ui.clearError();   // the page's #error-message banner
tbody.innerHTML = ui.emptyRow(8, 'No clients configured', 'Hint text.');
ui.statusBadge('Enabled', 'ok');
```

Write actions carry `data-requires-auth` so guest mode hides them.

## Icons

iX icons only: `<ix-icon name="database" size="12">`. Names come from
`node_modules/@siemens/ix-icons/dist/ix-icons/svg/` — check the file exists
before using it; a wrong name renders as nothing.

Metric card icons take a tone class: `is-ok`, `is-warn`, `is-err`, `is-info`,
or none for the default accent. Green must always mean the same thing.

## Buttons

`.btn` carries size, radius, weight and gap; a variant class carries colour.
Never set `padding`, `font-size`, `width` or `background` on a button inline or
in a page `<style>` block — use `.btn-sm` / `.btn-lg` for size and `.btn-block`
for full width. `components.css` is the only place that styles `.btn`; a `.btn`
rule anywhere else wins on whatever property `components.css` happens not to
restate, which is how a primary button once ended up full-width on every table
header.

The create action of a list is always the same button, and always last in its
cluster:

```html
<a href="/pages/thing-detail.html?new=true" class="btn btn-primary"><ix-icon name="add-circle" size="16"></ix-icon> Add Thing</a>
```

`add-circle` at `size="16"`, a verb-plus-noun label, and no inline style — `.btn`
already sets `text-decoration: none` for the anchor form. Use a `<button>` with
the same classes and icon when the action opens a modal instead of navigating.
Refresh beside it is an icon button, never a `Refresh` text button.

## Icon buttons

```html
<ix-icon-button icon="refresh" variant="subtle-tertiary" title="Refresh"></ix-icon-button>
```

`subtle-tertiary` is the only variant to use — it is the borderless button.
iX 4 removed the `ghost` attribute that used to produce that look, and a
leftover `ghost` silently renders a solid, bordered button that fights with
every `.btn` beside it. Do not set a `variant` of `primary` or `secondary`.

Size, radius and colour come from `components.css`: an icon button in a
`.page-header-actions`, `.table-actions`, `.section-header`, `.toolbar` or
`.action-buttons` cluster is pinned to the same control height as `.btn`, so
the two button systems line up. Tint one with the same class hooks the
`.btn-icon` variants use — `btn-delete`, `btn-edit`, `btn-view`, `btn-play`,
`btn-pause`, `btn-cert`.

## Status colours

Four semantic states, defined once. Any `enabled` / `connected` / `online` /
`running` class resolves to the same green; `disabled` / `disconnected` /
`offline` / `error` to the same red.

## Third-party scripts

Never load from a CDN. The broker is deployed into air-gapped plant networks.
Add the package to `package.json`, register it in `VENDOR_BUNDLES` in
`vite.config.js`, and reference it as `/js/vendor/<name>.js`.

## Page lifecycle

Page scripts are ES modules with an explicit `export function mount(page)` entry
point. The router imports and mounts each module on navigation and disposes it
before mounting the next page. Reference these scripts and `sidebar.js` with
`type="module"`, including in standalone page templates. The Vite runtime belongs
to the shell and is never mounted as a page.

Use the page-provided `window`, `document`, timers, observers, and sockets so
resources belong to the current visit. Register additional cleanup with
`page.addCleanup(fn)`. For overlays inserted with `insertAdjacentHTML`, call
`page.own(element)`; elements created through the page document are owned
already. Return `() => page.dispose()` from `mount`.

Existing inline HTML handlers use explicit getters in `page.expose({...})`.
These bindings are restored on disposal; adding a declaration does not implicitly
make it global. Prefer element event listeners for new controls. Shared services
such as the GraphQL client and UI helpers remain shell-owned.

## Edit tracking and tables

The router tracks primary detail forms and open modal editors. Mark staged or
programmatic changes with `ui.markPageDirty()`. Call `ui.markPageSaved()` only
after a successful primary save; a failed save or subresource save must preserve
pending primary edits. Use `data-edit-section` for inline editors on list pages
and `data-ignore-dirty` for filters/search controls. Navigation, browser history,
and browser unload use the same pending-edit state.

Management lists opt into shared search and accessible sorting with
`data-table-tools` on their `.data-table` card. Existing filters are preserved.
Wrap tables in `.table-responsive` so dense columns scroll within the card.
Specialized topic trees, explorers, and virtualized views retain their own
filtering controls.

## Migration status

All remaining legacy delete dialogs use `ui.confirmDelete()`. Recurring controls,
headers, metric cards, section cards, errors, and notifications use the shared
components. Local styles are reserved for page-specific layouts such as topic
trees, workflow canvases, and table-specific column widths scoped by table ID.

Examples to follow:

- list: `redis-clients`
- detail: `nats-client-detail`
- overview: `dashboard`, `sessions`

## Checking your work

Run `npm run check`, `npm test`, and `npm run build` after changes. Checks cover
script syntax, module entry tags (including the shell), explicit handler bindings,
duplicate IDs, removed-modal references, and shared component style invariants.
Tests cover page resources, edit tracking, navigation failures, and cancellation
and confirmation of migrated delete operations.

Also exercise affected pages in the browser under Vite: a production build alone
does not exercise Vite's injected scripts or import transforms. The isolated
fixture supports `DASHBOARD_FIXTURE_DEV=1 node tests/preview-server.js` on port
5181 and built assets with `node tests/preview-server.js` on port 5180. It supplies
synthetic data and permits only fixture-prefixed Redis mutations in memory.
Real broker integration and desktop packaging need their own verification.
