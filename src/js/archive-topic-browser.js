// MonsterMQ Dashboard — Shared Archive Topic Browser Side Panel
// Used by Archive Explorer (archive-explorer.html) and Topic Chart (topic-chart.html)

export class ArchiveTopicBrowser {
    static instance = null;

    constructor(opts = {}) {
        this.doc = opts.document || (typeof document !== 'undefined' ? document : window.document);
        this.gql = opts.gql || (typeof graphqlClient !== 'undefined' ? graphqlClient : window.graphqlClient);
        this.onSelectTopic = opts.onSelectTopic || null;

        this.panel = opts.panel || this.doc.getElementById('topic-browser-panel');
        this.tree = opts.tree || this.doc.getElementById('topic-panel-tree-root');
        this.archiveGroupSelect = opts.archiveGroupSelect || this.doc.getElementById('topic-panel-archive-group');
        this.toggleButton = opts.toggleButton || this.doc.getElementById('topic-browser-floating-toggle');
        this.closeButton = opts.closeButton || this.doc.getElementById('topic-panel-close');
        this.resizeHandle = opts.resizeHandle || this.doc.getElementById('topic-panel-resize-handle');

        this.treeNodes = new Map();
        this.selectedArchiveGroup = opts.archiveGroup || this.archiveGroupSelect?.value || 'Default';
        this.isOpen = false;
        this.panelWidth = 380;
        this._lastToggle = 0;

        ArchiveTopicBrowser.instance = this;
        this.init();
    }

    static getInstance() {
        return ArchiveTopicBrowser.instance ||
            (typeof window !== 'undefined' && (window.TopicChartSidePanel?.instance || window.explorerTopicBrowser)) ||
            null;
    }

    static toggle() {
        const inst = ArchiveTopicBrowser.getInstance();
        if (inst) inst.toggle();
    }

    static close() {
        const inst = ArchiveTopicBrowser.getInstance();
        if (inst) inst.close();
    }

    static open() {
        const inst = ArchiveTopicBrowser.getInstance();
        if (inst) inst.open();
    }

    init() {
        if (this.toggleButton) {
            this.toggleButton.addEventListener('click', () => this.toggle());
        }
        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.close());
        }
        if (this.archiveGroupSelect) {
            this.archiveGroupSelect.addEventListener('change', (e) => {
                this.selectedArchiveGroup = e.target.value;
                const mainSelect = this.doc.getElementById('archive-group-select');
                if (mainSelect && mainSelect.value !== e.target.value) {
                    mainSelect.value = e.target.value;
                    mainSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                this.browseRoot();
            });
        }

        this.createRootNode();
        this.setupResize();
        this.loadArchiveGroupsIfEmpty();
    }

    async loadArchiveGroupsIfEmpty() {
        if (!this.archiveGroupSelect) return;
        // If select only has a placeholder (e.g. "Loading...") or is empty
        if (this.archiveGroupSelect.options.length <= 1) {
            try {
                const query = `
                    query GetArchiveGroups {
                        archiveGroups(enabled: true) {
                            name
                        }
                    }
                `;
                const response = await this.gql.query(query);
                if (response?.archiveGroups?.length > 0) {
                    this.archiveGroupSelect.innerHTML = '';
                    response.archiveGroups.forEach(group => {
                        const opt = this.doc.createElement('option');
                        opt.value = group.name;
                        opt.textContent = group.name;
                        this.archiveGroupSelect.appendChild(opt);
                    });
                    if (!this.selectedArchiveGroup || this.selectedArchiveGroup === 'Default') {
                        this.selectedArchiveGroup = response.archiveGroups[0].name;
                        this.archiveGroupSelect.value = this.selectedArchiveGroup;
                        this.browseRoot();
                    }
                }
            } catch (e) {
                console.error('Error loading archive groups in ArchiveTopicBrowser:', e);
            }
        }
    }

    syncArchiveGroups(groups, selectedGroup = null) {
        if (!this.archiveGroupSelect || !groups || !groups.length) return;
        this.archiveGroupSelect.innerHTML = '';
        groups.forEach(group => {
            const name = typeof group === 'string' ? group : group.name;
            const enabled = typeof group === 'object' && group.enabled !== undefined ? group.enabled : true;
            const opt = this.doc.createElement('option');
            opt.value = name;
            opt.textContent = name + (enabled ? '' : ' (disabled)');
            this.archiveGroupSelect.appendChild(opt);
        });
        if (selectedGroup) {
            this.selectedArchiveGroup = selectedGroup;
        } else if (!this.selectedArchiveGroup || !groups.some(g => (typeof g === 'string' ? g : g.name) === this.selectedArchiveGroup)) {
            const defaultGroup = groups.find(g => (typeof g === 'string' ? g : g.name) === 'Default') || groups[0];
            this.selectedArchiveGroup = typeof defaultGroup === 'string' ? defaultGroup : defaultGroup.name;
        }
        if (this.selectedArchiveGroup) {
            this.archiveGroupSelect.value = this.selectedArchiveGroup;
        }
        this.browseRoot();
    }

    toggle() {
        const now = Date.now();
        if (this._lastToggle && (now - this._lastToggle) < 100) return;
        this._lastToggle = now;
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        if (!this.panel) {
            this.panel = this.doc.getElementById('topic-browser-panel');
            if (!this.panel) return;
        }
        this.panel.classList.add('open');
        this.doc.body?.classList.add('topic-panel-open');
        if (this.toggleButton) {
            this.toggleButton.classList.add('active');
            this.toggleButton.setAttribute('aria-expanded', 'true');
        }
        this.updateMainContentMargin();
        this.isOpen = true;

        // Sync archive group with main page selector if present
        const mainArchiveGroupEl = this.doc.getElementById('archive-group-select');
        if (mainArchiveGroupEl && mainArchiveGroupEl.value) {
            if (this.selectedArchiveGroup !== mainArchiveGroupEl.value) {
                this.selectedArchiveGroup = mainArchiveGroupEl.value;
                if (this.archiveGroupSelect) {
                    this.archiveGroupSelect.value = mainArchiveGroupEl.value;
                }
                this.browseRoot();
                return;
            }
        }

        // If tree is empty or had error/loading placeholder, reload root
        if (!this.tree || !this.tree.children.length || this.tree.querySelector('.loading-item') || this.tree.textContent.includes('Error:')) {
            this.browseRoot();
        }
    }

    close() {
        if (!this.panel) {
            this.panel = this.doc.getElementById('topic-browser-panel');
            if (!this.panel) return;
        }
        this.panel.classList.remove('open');
        this.doc.body?.classList.remove('topic-panel-open');
        if (this.toggleButton) {
            this.toggleButton.classList.remove('active');
            this.toggleButton.setAttribute('aria-expanded', 'false');
        }
        const mainContent = this.doc.querySelector('.main-content');
        if (mainContent) {
            mainContent.style.marginRight = '0';
        }
        this.isOpen = false;
    }

    updateMainContentMargin() {
        const mainContent = this.doc.querySelector('.main-content');
        if (mainContent) {
            mainContent.style.marginRight = `${this.panelWidth}px`;
        }
    }

    setupResize() {
        if (!this.resizeHandle || !this.panel) return;
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        this.resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = this.panel.offsetWidth;
            this.doc.body.style.cursor = 'col-resize';
            this.doc.body.style.userSelect = 'none';
            e.preventDefault();
        });

        this.doc.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const deltaX = startX - e.clientX;
            const newWidth = Math.max(300, Math.min(600, startWidth + deltaX));
            this.panelWidth = newWidth;
            this.panel.style.width = `${newWidth}px`;
            if (this.isOpen) {
                this.updateMainContentMargin();
            }
        });

        this.doc.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                this.doc.body.style.cursor = '';
                this.doc.body.style.userSelect = '';
            }
        });
    }

    browseRoot() {
        if (!this.tree) return;
        this.tree.innerHTML = '';
        this.treeNodes.clear();
        this.createRootNode();
    }

    createRootNode() {
        this.loadTopicLevel('+', this.tree, '');
    }

    async loadTopicLevel(pattern, container, parentPath = '') {
        if (!container) return;
        try {
            const loadingItem = this.doc.createElement('li');
            loadingItem.className = 'tree-node loading-item';
            loadingItem.innerHTML = '<div class="tree-item" style="color:var(--text-muted);font-style:italic;">Loading...</div>';
            container.appendChild(loadingItem);

            const query = `
                query BrowseTopics($topic: String!, $archiveGroup: String!) {
                    browseTopics(topic: $topic, archiveGroup: $archiveGroup) {
                        name
                    }
                }
            `;
            const response = await this.gql.query(query, {
                topic: pattern,
                archiveGroup: this.selectedArchiveGroup
            });

            if (loadingItem.parentNode) {
                container.removeChild(loadingItem);
            }

            if (response && response.browseTopics && response.browseTopics.length > 0) {
                const topics = response.browseTopics.map(t => ({ topic: t.name, hasValue: true }));
                const grouped = this.groupTopicsByLevel(topics, parentPath);

                if (grouped.size === 0) {
                    container.appendChild(this.emptyItem());
                    return;
                }

                for (const [levelName, topicData] of grouped) {
                    const fullPath = parentPath ? `${parentPath}/${levelName}` : levelName;
                    container.appendChild(this.createTreeItem(levelName, fullPath, topicData.hasValue, topicData.hasChildren));
                }
            } else {
                container.appendChild(this.emptyItem());
            }
        } catch (error) {
            console.error('Error loading topic level:', error);
            const loadingItems = container.querySelectorAll('.loading-item');
            loadingItems.forEach(item => item.parentNode && container.removeChild(item));
            const errItem = this.doc.createElement('li');
            errItem.className = 'tree-node';
            errItem.innerHTML = `<div class="tree-item" style="color:var(--monster-red);font-style:italic;">Error: ${error.message || error}</div>`;
            container.appendChild(errItem);
        }
    }

    groupTopicsByLevel(topics, parentPath) {
        const grouped = new Map();
        const parentLevels = parentPath ? parentPath.split('/').length : 0;

        for (const topic of topics) {
            const levels = topic.topic.split('/');
            const targetLevel = parentLevels === 0 ? 0 : parentLevels;

            if (levels.length > targetLevel) {
                const nextLevel = levels[targetLevel];
                const isDeeper = levels.length > targetLevel + 1;
                const isExact = levels.length === targetLevel + 1;

                if (!grouped.has(nextLevel)) {
                    grouped.set(nextLevel, {
                        hasValue: isExact && topic.hasValue,
                        hasChildren: isDeeper
                    });
                } else {
                    const existing = grouped.get(nextLevel);
                    existing.hasValue = existing.hasValue || (isExact && topic.hasValue);
                    existing.hasChildren = existing.hasChildren || isDeeper;
                }
            }
        }
        return grouped;
    }

    createTreeItem(name, fullPath, hasValue, hasChildren) {
        const li = this.doc.createElement('li');
        li.className = 'tree-node';

        const item = this.doc.createElement('div');
        item.className = 'tree-item';
        if (hasValue) item.classList.add('has-data');

        // Make draggable
        item.setAttribute('draggable', 'true');
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', fullPath);
            e.dataTransfer.effectAllowed = 'copy';
        });

        const toggle = this.doc.createElement('button');
        toggle.className = 'tree-toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-label', hasChildren ? `Toggle ${name}` : '');
        if (hasChildren) {
            toggle.innerHTML = `
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease; display: inline-block;">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            `;
        } else {
            toggle.innerHTML = '';
        }

        const icon = this.doc.createElement('span');
        icon.className = 'tree-icon';
        if (hasChildren) {
            icon.className += ' folder';
            icon.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--monster-purple)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-top: -2px;">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
            `;
        } else {
            icon.className += ' topic';
            icon.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--monster-teal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-top: -2px;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            `;
        }

        const nameSpan = this.doc.createElement('span');
        nameSpan.textContent = name;

        item.appendChild(toggle);
        item.appendChild(icon);
        item.appendChild(nameSpan);
        li.appendChild(item);

        this.treeNodes.set(fullPath, { element: li, item, toggle, expanded: false, hasChildren, fullPath });

        if (hasChildren) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(fullPath);
            });
        }

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hasValue) {
                if (this.onSelectTopic) {
                    this.onSelectTopic(fullPath, this.selectedArchiveGroup);
                } else {
                    const filter = this.doc.getElementById('topic-filter');
                    if (filter) {
                        filter.value = fullPath;
                        filter.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            } else if (hasChildren) {
                this.toggleNode(fullPath);
            }
        });

        return li;
    }

    async toggleNode(fullPath) {
        const nodeData = this.treeNodes.get(fullPath);
        if (!nodeData || !nodeData.hasChildren) return;

        if (nodeData.expanded) {
            const childContainer = nodeData.element.querySelector('.tree-children');
            if (childContainer) childContainer.classList.add('collapsed');
            nodeData.toggle.classList.remove('expanded');
            nodeData.expanded = false;
        } else {
            let childContainer = nodeData.element.querySelector('.tree-children');
            if (!childContainer) {
                childContainer = this.doc.createElement('ul');
                childContainer.className = 'tree-children';
                nodeData.element.appendChild(childContainer);
                const pattern = `${fullPath}/+`;
                await this.loadTopicLevel(pattern, childContainer, fullPath);
            }
            childContainer.classList.remove('collapsed');
            nodeData.toggle.classList.add('expanded');
            nodeData.expanded = true;
        }
    }

    emptyItem() {
        const li = this.doc.createElement('li');
        li.className = 'tree-node';
        li.innerHTML = '<div class="tree-item" style="color:var(--text-muted);font-style:italic;">No topics found</div>';
        return li;
    }
}

// Global aliases for backwards compatibility with inline onclick handlers
if (typeof window !== 'undefined') {
    window.ArchiveTopicBrowser = ArchiveTopicBrowser;
    window.TopicChartSidePanel = ArchiveTopicBrowser;
    window.ExplorerTopicBrowser = ArchiveTopicBrowser;
}
