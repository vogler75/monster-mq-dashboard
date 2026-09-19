# Plan: Dashboard Support for Standalone Broker Scripts & Deprecation of Legacy Scripts/Workflows

This plan outlines the design and implementation for the MonsterMQ Dashboard (`monster-mq-dashboard`) to configure and manage the new standalone **Broker Script Engine** (supporting **Python**, **Starlark**, and **JavaScript**), provide **language-aware AI script generation**, and mark the legacy FlowEngine-based Scripts and Workflows as **deprecated**.

---

## 1. Scope & Architecture

* **Unified Script Backend**: MonsterMQ main broker (`monster-mq`) uses **GraalVM Polyglot Python (`GraalPy`)** and **GraalJS**, while MonsterMQ Edge (`monster-mq-edge`) uses **Starlark** (pure-Go Python dialect). Both brokers expose an identical GraphQL API and `DeviceConfig` schema:
  - Query: `scripts(name, nodeId)`, `script(name)`
  - Mutation: `script { create, update, delete, toggle, start, stop, test }`
  - Feature Flag: `Scripts`
* **Generic Naming**:
  - **List Page**: `/pages/broker-scripts.html` (`src/js/broker-scripts.js`)
  - **Detail & Editor Page**: `/pages/broker-scripts-detail.html` (`src/js/broker-scripts-detail.js`)
  - **Help & API Reference**: `/pages/broker-script-help.html`
* **Multi-Language by Design**: The configuration form allows selecting `python`, `starlark`, or `javascript`. The code editor and AI script assistant adapt their prompts, bindings, and code generation accordingly.
* **Legacy FlowEngine Deprecation**: Existing FlowEngine pages (`/pages/scripts.html`, `/pages/script-detail.html`, `/pages/workflows.html`, `/pages/workflows-edit.html`) remain functional for backward compatibility but are labeled as **deprecated** in the sidebar and topped with deprecation notice banners directing users to Broker Scripts.

---

## 2. File Ownership & Directory Structure

```
dashboard/
├── dev/plans/
│   └── plan-broker-scripts.md           # This specification document
├── src/
│   ├── assets/
│   │   └── components.css               # Shared deprecation notice & badge styling
│   ├── js/
│   │   ├── sidebar.js                   # Menu config (Broker Scripts, deprecation hints) & route mapping
│   │   ├── broker-scripts.js            # Controller for Broker Scripts list page
│   │   ├── broker-scripts-detail.js     # Controller for detail/editor, AI generator, & test runner
│   │   └── help-modal.js                # Help modal integration for broker script API reference
│   └── pages/
│       ├── broker-scripts.html          # New Broker Scripts list view
│       ├── broker-scripts-detail.html   # New Broker Scripts detail/editor view with test sandbox & AI panel
│       ├── broker-script-help.html      # API reference & code recipes help
│       ├── scripts.html                 # Deprecation notice banner
│       ├── script-detail.html           # Deprecation notice banner
│       ├── workflows.html               # Deprecation notice banner
│       └── workflows-edit.html          # Deprecation notice banner
```

---

## 3. Menu & Navigation Structure

### Configuration Category in `src/js/sidebar.js`
```javascript
{
    section: 'Configuration', sectionIcon: 'cogwheel',
    items: [
        // New Standalone Broker Script Engine (Python, Starlark, JavaScript)
        { href: '/pages/broker-scripts.html', icon: 'code-script', text: 'Broker Scripts', feature: 'Scripts' },
        // Legacy FlowEngine scripts and workflows marked as deprecated
        { href: '/pages/scripts.html', icon: 'java-script', text: 'Java Scripts (deprecated)', feature: 'FlowEngine', deprecated: true },
        { href: '/pages/workflows.html', icon: 'ontology-filled', text: 'Workflows (deprecated)', feature: 'FlowEngine', deprecated: true },
        { href: '/pages/hmi-screens.html', icon: 'screen', text: 'HMI Screens', feature: 'Hmi' }
    ]
}
```

### Route Matching in `sidebar.js`
Update `setActiveNavItem()` so that `/pages/broker-scripts-detail.html` correctly resolves to and highlights the `/pages/broker-scripts.html` menu item:
```javascript
const listPath = currentPath
    ? currentPath
        .replace(/-scripts-detail\.html$/, '-scripts.html')
        .replace(/-detail\.html$/, 's.html')
        .replace(/([a-z0-9]+)-client-detail\.html$/, '$1-clients.html')
    : null;
```

### Deprecation Hints
- When `item.deprecated === true`:
  - `menuItem.setAttribute('tooltipText', item.text + ' — Deprecated in favor of Broker Scripts');`
  - Subtle warning indicator / tag rendered next to label in the sidebar.
- In-page deprecation notices added to `/pages/scripts.html`, `/pages/script-detail.html`, `/pages/workflows.html`, and `/pages/workflows-edit.html`:
  ```html
  <div class="alert alert-warning" style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
      <ix-icon name="warning" size="20"></ix-icon>
      <div style="flex: 1;">
          <strong>Notice:</strong> FlowEngine Java Scripts and Workflows are deprecated. Please use <a href="/pages/broker-scripts.html" style="color: inherit; text-decoration: underline; font-weight: 600;">Broker Scripts</a> for new development.
      </div>
  </div>
  ```

---

## 4. Component Details

### Component 1: Broker Scripts List Page (`src/pages/broker-scripts.html` + `src/js/broker-scripts.js`)

Follows canonical **List Page Shape** from `DESIGN.md`:

#### 1. Page Header & Actions
- **Title**: "Broker Scripts"
- **Subtitle**: "Fast, standalone scripts (Python, Starlark, JavaScript) triggered by MQTT topics, timers, or explicit calls"
- **Actions**: `<button class="btn btn-secondary" onclick="openHelp('broker-script-api')"><ix-icon name="info" size="16"></ix-icon> API Reference</button>`

#### 2. Metrics Grid (4 cards with Siemens iX icons)
- **Total Scripts**: Count of configured script devices (`ix-icon name="code-script"`).
- **Active Scripts**: Count of enabled scripts (`ix-icon name="success"` with `.is-ok`).
- **Total Executions**: Sum of `executionCount` across all scripts (`ix-icon name="capacity-filled"`).
- **Errors**: Sum of `errorCount` (`ix-icon name="warning"` with `.is-warn` / `.is-err`).

#### 3. Data Table (`.data-table`)
- **Table Header**: Search input + Language filter dropdown (All, Python, Starlark, JavaScript) + Refresh button + "Add Script" button (`window.spaLocation.href = '/pages/broker-scripts-detail.html'`).
- **Columns**:
  - **Name & Namespace**: Script name (link to detail) + Namespace tag (`script`, `default`).
  - **Language**: Badge (`python`, `starlark`, `javascript`).
  - **Trigger**:
    - `TOPIC`: Displays topic filter badges (e.g. `sensors/+/temperature`) + "On Change" chip if `triggerOnChangeOnly`.
    - `TIMER`: Displays interval badge (e.g. `5000 ms`).
    - `BOTH`: Displays both topic and timer badges.
    - `CALLABLE`: Displays "Callable" badge.
  - **Concurrency**: `SINGLETON` (serial queue) or `MULTI_INSTANCE` (parallel worker pool).
  - **Status**: Live toggle switch invoking `mutation { script { toggle(name, enabled) } }`.
  - **Executions / Errors**: Counts formatted with tabular digits (`font-variant-numeric: tabular-nums`).
  - **Last Execution**: Timestamp and status badge (`SUCCESS`, `ERROR`).
  - **Actions**: Start/Stop, Edit, Delete (with `window.ui.showConfirm`).

---

### Component 2: Broker Script Detail & Editor (`src/pages/broker-scripts-detail.html` + `src/js/broker-scripts-detail.js`)

Follows canonical **Detail Page Shape** from `DESIGN.md`:

#### 1. Header & Page Actions
- **Breadcrumb**: `<a href="/pages/broker-scripts.html">Broker Scripts</a> › <span id="breadcrumb-name">New Script</span>`
- **Page Header Actions**:
  - `Delete` (`.btn-danger`, visible in edit mode only).
  - `Test Run` (`.btn-secondary`, executes the test sandbox).
  - `Save Script` (`.btn-primary`, creates or updates script via GraphQL).

#### 2. Section 1: General Settings (`.section-card`)
- **Script Name**: Text input (required, immutable in edit mode).
- **Namespace**: Text input (default `"script"`).
- **Node ID**: Text input (default `"*"` for all cluster nodes, or specific node name).
- **Enabled**: Toggle switch (`<ix-toggle>`).
- **Description**: Text input / textarea.

#### 3. Section 2: Trigger & Execution Concurrency (`.section-card`)
- **Language**: Dropdown selector (`python` [Default], `starlark`, `javascript`). Changing language switches editor syntax helpers and AI prompt generation targets.
- **Trigger Type**: Radio cards / select (`TOPIC`, `TIMER`, `BOTH`, `CALLABLE`).
- **Conditional Trigger Inputs**:
  - When `TOPIC` or `BOTH`:
    - **Topic Filters**: Dynamic tag/chip inputs supporting MQTT wildcards (`+`, `#`).
    - **Trigger on Change Only**: Checkbox (`triggerOnChangeOnly`).
  - When `TIMER` or `BOTH`:
    - **Timer Interval (ms)**: Number input (e.g. `5000` = 5s).
- **Concurrency Mode (`instanceMode`)**:
  - `SINGLETON` (Default): Serialized single-instance execution to avoid race conditions on `state`.
  - `MULTI_INSTANCE`: Parallel worker execution for stateless/high-throughput workloads.
- **Timeout (ms)**: Number input (default `200` ms).

#### 4. Section 3: Script Code Editor & AI Generator (`.section-card`)
- **Code Editor Container**:
  - Monospace font, line numbers, tab-key handling (`2 spaces`), full-screen modal expansion.
  - Quick snippet inserter buttons adapting to selected language (Python vs JavaScript):
    - `mqtt.publish(...)`
    - `mqtt.subscribe(...)`
    - `archive.get_last_value(...)`
    - `db.query(...)`
    - Scoped storage: `state`, `global`, `storage`
    - `scripts.call(...)`
- **Language-Aware AI Assistant Panel**:
  - Natural language input: "Prompt AI to write or modify script..."
  - **"Generate with AI"** button (`<ix-button icon="code-ai">`).
  - Pre-built quick prompt suggestions (Threshold Alert, DB Query & MQTT Publish, Moving Average in State, Persistent Storage).
  - Code diff / preview and 1-click apply.

#### 5. Section 4: Interactive Test Sandbox (`.section-card`)
- Dry-run test execution using `mutation { script { test(input: $input, testTopic: $testTopic, testPayload: $testPayload, testArgs: $testArgs) } }`.
- Test Inputs: Test Topic, Test Payload (JSON or string), Test Arguments (JSON).
- Output Results: Execution time, Success/Error status, Return value, Output published MQTT messages table (`topic`, `payload`, `qos`, `retain`), Captured logs list, Error traceback.

#### 6. Section 5: Recent Execution Logs (`.section-card`, Edit mode)
- Displays the broker's in-memory circular log buffer (`script.recentLogs`).

---

### Component 3: Language-Aware AI Script Generation

The AI script generation automatically adapts its prompt based on the **selected language** (`python`, `starlark`, or `javascript`):

#### 1. System Prompt Construction
```javascript
function buildSystemPrompt(language) {
    const isPython = language === 'python' || language === 'starlark';
    const langName = isPython ? 'Python / Starlark' : 'JavaScript (ES2022)';
    const codeTag = isPython ? 'python' : 'javascript';
    
    return `You are an expert ${langName} script assistant for MonsterMQ edge and enterprise brokers.
The scripts execute in a sandboxed ${langName} environment with the following bindings:

1. 'msg' (Incoming MQTT message, null on timer or callable):
   - ${isPython ? 'msg["topic"], msg["payload"], msg["raw_payload"], msg["timestamp"], msg["qos"], msg["retain"]' : 'msg.topic, msg.payload, msg.raw_payload, msg.timestamp, msg.qos, msg.retain'}

2. 'mqtt' (Broker MQTT proxy):
   - mqtt.publish(topic, payload, qos=0, retain=False)
   - mqtt.subscribe(filter, callback_fn)

3. 'archive' (Archive & historical queries):
   - archive.get_last_value(topic, archive_group="Default")
   - archive.get_last_values(pattern, limit=100, archive_group="Default")
   - archive.get_history(topic, from_time=None, to_time=None, limit=100)
   - archive.get_aggregated_history(topics, interval, from_time, to_time, functions, fields)

4. 'db' (Configured database connections):
   - db.query(conn_name, sql, args=[]) -> list of row dicts / objects
   - db.execute(conn_name, sql, args=[]) -> {"affected_rows": int, "success": bool}

5. Scoped Storage:
   - 'state': dict/object local to this script instance across invocations (in-memory)
   - 'global': node-wide shared storage (${isPython ? 'global.get(k), global.set(k, v)' : 'global.get(k), global.set(k, v)'})
   - 'storage': persistent KV storage surviving script reloads and broker restarts:
     storage.get(key, default=None), storage.set(key, val), storage.delete(key)

6. 'scripts' (Inter-script calls):
   - scripts.call(script_name, args={}) -> return value

7. 'log' / 'console':
   - log.info(...), log.warn(...), log.error(...), log.debug(...)
   - ${isPython ? 'json.encode(obj), json.decode(str)' : 'JSON.stringify(obj), JSON.parse(str)'}

Goal: Return ONLY the executable ${langName} script inside a standard \`\`\`${codeTag} code block, followed by a brief explanation.`;
}
```

#### 2. Live Context Injection
The frontend injects live broker metadata into the AI prompt:
- Configured triggers (topics, interval).
- Available database connection names (from `databaseConnections` query).
- Available archive groups (from `archiveGroups` query).
- Existing script content and current user prompt.

---

### Component 4: Documentation & Help (`src/pages/broker-script-help.html`)

A dedicated iframe-ready help document matching `workflow-help.html`:
- Overview of Python (GraalPy Truffle), Starlark (pure Go Edge), and JavaScript runtimes.
- Complete API reference for `msg`, `mqtt`, `archive`, `db`, `state`, `global`, `storage`, `scripts`, `log`, and `json`.
- Practical recipes and snippets in both Python and JavaScript.

---

## 5. Verification Plan

### Automated Build & Syntax Checks
- Run `npm run build` in `dashboard/` to verify bundling without errors.
- Verify air-gapped asset compliance (no CDN scripts or unbundled external fonts).
- Check that all newly added files (`broker-scripts.html`, `broker-scripts-detail.html`, `broker-script-help.html`, `broker-scripts.js`, `broker-scripts-detail.js`) are present in `dist/`.

### Manual & UI Flow Verification
1. **Sidebar Navigation**:
   - Verify "Broker Scripts" appears under `Configuration`.
   - Verify "Java Scripts (deprecated)" and "Workflows (deprecated)" display the deprecation hint/badge and tooltip.
   - Verify routing between list (`broker-scripts.html`) and detail (`broker-scripts-detail.html`) keeps "Broker Scripts" active.
2. **List Page**:
   - Verify loading scripts via `query { scripts { ... } }`.
   - Verify search, filtering by language (Python, Starlark, JavaScript) and trigger type.
   - Verify toggle switch mutates `script.toggle` and updates row state.
   - Verify script deletion with confirm modal.
3. **Detail Page & Form**:
   - Create new script with topic filters, timer, and description.
   - Test switching Language dropdown between `python`, `starlark`, and `javascript`.
   - Verify edit mode loads script details and updates via `script.update`.
4. **AI Assistant**:
   - Prompt AI with sample requests in both Python and JavaScript modes.
   - Verify response parsing, code replacement, and explanation display.
5. **Interactive Test Runner**:
   - Run a test script with mock topic, payload, and args.
   - Verify captured published messages, logs, and execution time display.
6. **Deprecation Banners**:
   - Navigate to `/pages/scripts.html` and `/pages/workflows.html` and confirm the deprecation banner and link to Broker Scripts render correctly.
