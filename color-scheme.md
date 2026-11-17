# winccoa.ai colour scheme

The colours of winccoa.ai: the start page, the session workspace, the admin page and the WinCC OA
dashboard (WebUI Runtime). It is a dark scheme, Siemens deep blue with petrol. There is no light
variant. Use this file to give another UI (e.g. the MonsterMQ dashboard in the "Broker" tab) the
same look.

Sources in this repository, if you can read them:

- `orchestrator/src/public/assets/app.css`: the block `html.brand[data-ix-theme][data-ix-color-schema]`
  (the scheme as Siemens iX theme variables) and the classes below it (start page, progress view).
- `project-template/bootstrap-default/dashboard-starter/apps/dashboard-wc/public/customstyles.css`:
  the same scheme for the WebUI Runtime (iX classic, dark mode).

The page around the MonsterMQ dashboard is the session workspace: a header in `#00183c`, panels in
`#000033` on `#000028`. The dashboard is shown in an iframe in such a panel, so its background
should be one of these two blues and not black or grey.

## Palette

### Backgrounds and surfaces

| Token | Value | Use |
|---|---|---|
| background | `#000028` | page background, the deepest level |
| surface | `#000033` | cards, panels, dialogs, tables on the background |
| header | `#00183c` | application header / top bar, navigation bar |
| field | `#00113a` | input fields, image areas inside cards, code blocks |
| raised | `#0f2f5f` | a level above the surface: hover rows, selected menu item, user chat bubble, track of a progress ring |
| hover on the background | `#0a1f44` | hover of large areas on the background |

Further steps of the surface scale (used where a UI needs more levels, e.g. the dashboard):
`#1b3a6b`, `#2a4677`, `#3a4462` (progress bar track), `#4a5577` (input border, inactive ring),
`#6d7a9c` (strong border, weak text).

### Accent (petrol)

| Token | Value | Use |
|---|---|---|
| accent | `#00cccc` | primary buttons, links, active tab line, icons, focus border, checked checkbox and toggle |
| accent hover | `#00d7a0` | hover of primary buttons (turns green) |
| accent active | `#00bedc` | pressed state |
| accent disabled | `rgba(0, 204, 204, 0.45)` | disabled primary button (or the accent at opacity 0.45) |
| on accent | `#000028` | text and icons on an accent background (dark, not white) |
| gradient | `linear-gradient(#00d7a0, #00bedc)` | highlight word in headings (as text fill), progress bar (`90deg, #00bedc, #00d7a0`) |

Transparent accent for interaction states:

| State | Value |
|---|---|
| hover of ghost/subtle buttons, list rows | `rgba(0, 204, 204, 0.12)` |
| active (pressed) | `rgba(0, 204, 204, 0.2)` |
| selected | `rgba(0, 204, 204, 0.15)` |
| selected + hover | `rgba(0, 204, 204, 0.2)` |
| pill / badge background | `rgba(0, 204, 204, 0.15)` with accent text |
| card glow on hover | `box-shadow: 0 10px 30px rgba(0, 204, 204, 0.15)` |

### Text

| Token | Value | Use |
|---|---|---|
| heading | `#ffffff` | headings, labels, important values, button text on dark |
| body | `#ccccd4` | running text |
| muted | `#9aa0b4` | secondary text, descriptions, table headers, timestamps |
| weak | `#6d7a9c` | placeholders, pending/inactive items, disabled text |

### Lines

| Token | Value | Use |
|---|---|---|
| faint line | `rgba(255, 255, 255, 0.08)` | borders of cards and panels, header bottom line, dividers |
| soft line | `rgba(255, 255, 255, 0.16)` | table row lines, borders that must be visible |
| weak line | `rgba(255, 255, 255, 0.12)` | between the two above |
| strong border | `#6d7a9c` | checkbox border, outlines of inputs when not focused (or `#4a5577`) |
| accent border | `rgba(0, 204, 204, 0.35)` | border of a highlighted card |

### Status

| State | Colour | Background tint | Text on tint |
|---|---|---|---|
| success / running / OK | `#00d7a0` | `rgba(0, 215, 160, 0.12)` | `#00d7a0` |
| warning | `#ffd732` | `rgba(255, 215, 50, 0.10)` | `#ffe680` |
| error / alarm | `#ef4a5c` | `rgba(239, 74, 92, 0.12)` | `#ffd0d6` |
| info / neutral | `#00cccc` | `rgba(0, 204, 204, 0.12)` | `#00cccc` |

Text on a solid status colour is `#000028`. Message boxes use the tint as background with a
3 px left border in the status colour (no full border, no rounded corners).

## Components

- **Font:** `"Siemens Sans", "Segoe UI", Arial, sans-serif`. Headings weight 600 to 700, labels 600.
- **Buttons:** square corners (`border-radius: 0`), weight 600.
  - primary: background `#00cccc`, text `#000028`; hover background `#00d7a0`.
  - secondary / outline: transparent, 1 px border and text `#00cccc`; hover fills with `#00cccc`,
    text `#000028`.
  - ghost / subtle (toolbar and header buttons): transparent, text `#00cccc`, no border; hover
    background `rgba(0, 204, 204, 0.12)`.
- **Inputs:** background `#00113a`, border `#4a5577` (or only a 2 px bottom border), text `#ffffff`,
  placeholder `#6d7a9c`; focus border `#00cccc`, no glow. Square corners.
- **Checkbox:** square, transparent with border `#6d7a9c`; checked: fill `#00cccc`, check mark `#000028`.
- **Cards and panels:** background `#000033`, border `1px solid rgba(255, 255, 255, 0.08)`,
  radius 8 px (10 px for large highlight cards), shadow `0 6px 10px rgba(0, 0, 0, 0.2)` or none.
- **Header / top bar:** background `#00183c`, bottom border `1px solid rgba(255, 255, 255, 0.08)`,
  product name white, a highlighted part of the name in `#00cccc`.
- **Tabs:** inactive text `#9aa0b4`, active text `#ffffff` with a 2 px underline `#00cccc`.
- **Tables:** header text `#9aa0b4` weight 700, rows separated by `rgba(255, 255, 255, 0.16)`,
  hover row `rgba(0, 204, 204, 0.12)`; numbers right aligned.
- **Pills / badges:** radius 12 px, background `rgba(0, 204, 204, 0.15)`, text `#00cccc`, weight 600;
  status pills with the status colour and its tint.
- **Code / monospace:** background `#00113a`, text `#ffffff` or `#00cccc` for inline identifiers.
- **Charts:** series in this order `#00cccc`, `#00d7a0`, `#ffd732`, `#00bedc`, `#ef4a5c`;
  grid lines `#3a4462`, axis text `#9aa0b4`, on a `#000033` or `#00113a` background.
- **Scrollbars (if styled):** track `#000033`, thumb `#3a4462`, thumb hover `#4a5577`.
- **Dialogs:** surface `#000033`, border faint line, backdrop `rgba(0, 0, 0, 0.5)`.

## As CSS variables

A starting point for a UI that uses CSS variables (rename them to the variables of that UI):

```css
:root {
  --bg: #000028;
  --surface: #000033;
  --header: #00183c;
  --field: #00113a;
  --raised: #0f2f5f;
  --hover-bg: #0a1f44;

  --accent: #00cccc;
  --accent-hover: #00d7a0;
  --accent-active: #00bedc;
  --on-accent: #000028;
  --accent-ghost-hover: rgba(0, 204, 204, 0.12);
  --accent-ghost-active: rgba(0, 204, 204, 0.2);
  --accent-selected: rgba(0, 204, 204, 0.15);
  --gradient: linear-gradient(#00d7a0, #00bedc);

  --text-heading: #ffffff;
  --text: #ccccd4;
  --text-muted: #9aa0b4;
  --text-weak: #6d7a9c;

  --line-faint: rgba(255, 255, 255, 0.08);
  --line-weak: rgba(255, 255, 255, 0.12);
  --line-soft: rgba(255, 255, 255, 0.16);
  --border-strong: #6d7a9c;
  --border-input: #4a5577;

  --success: #00d7a0;
  --warning: #ffd732;
  --error: #ef4a5c;
  --info: #00cccc;

  --font: "Siemens Sans", "Segoe UI", Arial, sans-serif;
  --radius-card: 8px;
  --radius-button: 0;
}
```

## As Siemens iX theme variables

If the UI uses Siemens iX, these are the overrides winccoa.ai uses (on top of
`data-ix-theme="classic" data-ix-color-schema="dark"`; the selector must be more specific than the
iX theme, e.g. `html.brand[data-ix-theme][data-ix-color-schema]`):

```css
--theme-color-1: #000028;            --theme-color-1--hover: #0a1f44;   --theme-color-1--active: #0f2f5f;
--theme-color-2: #000033;            --theme-color-3: #0f2f5f;
--theme-color-primary: #00cccc;      --theme-color-primary--hover: #00d7a0;
--theme-color-primary--active: #00bedc;  --theme-color-primary--contrast: #000028;
--theme-color-dynamic: #00cccc;
--theme-color-std-text: #ffffff;     --theme-color-soft-text: #9aa0b4;  --theme-color-weak-text: #6d7a9c;
--theme-color-std-bdr: #6d7a9c;      --theme-color-soft-bdr: rgba(255, 255, 255, 0.16);
--theme-color-weak-bdr: rgba(255, 255, 255, 0.12);  --theme-color-x-weak-bdr: rgba(255, 255, 255, 0.08);
--theme-color-ghost--hover: rgba(0, 204, 204, 0.12);  --theme-color-ghost--selected: rgba(0, 204, 204, 0.15);
--theme-color-component-1: rgba(109, 122, 156, 0.25);
--theme-color-success: #00d7a0;      --theme-color-warning: #ffd732;    --theme-color-alarm: #ef4a5c;
--theme-input--background: #00113a;  --theme-input--border-color: #4a5577;
--theme-app-header--background: #00183c;  --theme-app-header--border-color: rgba(255, 255, 255, 0.08);
--theme-btn--border-radius: 0;
--theme-btn-subtle-primary--background: transparent;
--theme-btn-subtle-primary--background--hover: rgba(0, 204, 204, 0.12);
--theme-btn-subtle-primary--color: #00cccc;
```

The complete list for the WebUI Runtime is in its `customstyles.css` (see the sources above).

## Rules

- Keep it dark: no white or light grey surfaces, no pure black. Every area is one of the blues above.
- One accent: petrol `#00cccc`. Green `#00d7a0` appears only as its hover, in the gradient and for
  success; do not add other accent hues (no orange, purple, bright blue).
- Text on accent or status backgrounds is dark `#000028`, never white.
- Borders are faint; separate areas by the surface levels (`#000028` / `#000033` / `#00113a` /
  `#0f2f5f`) rather than by strong lines.
- Status colours mean status only (running, warning, error), not decoration.
- Check contrast: body text `#ccccd4` and muted `#9aa0b4` on `#000028`/`#000033` are readable;
  `#6d7a9c` only for placeholders and inactive items, not for content.
