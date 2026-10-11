// Mounted by the SPA router; resources and handler bindings belong to this visit.
export function mount(page) {
const { window, document, ui, setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, WebSocket } = page;

const safeStorage = window.safeStorage || localStorage;

// Storage keys
const STORAGE_KEYS = {
    TREE_WIDTH: 'monstermq_explorer_tree_width',
    TABLE_HEIGHT: 'monstermq_explorer_table_height',
    PUB_WIDTH: 'monstermq_explorer_pub_width',
    FLASH_ENABLED: 'monstermq_explorer_flash_enabled',
    SUBSCRIPTIONS: 'monstermq_explorer_subscriptions',
    SUB_ENABLED: 'monstermq_explorer_sub_enabled',
    FETCH_SUBNODES: 'monstermq_explorer_fetch_subnodes',
    ARCHIVE_GROUP: 'monstermq_selected_archive_group',
    VIEW_MODE: 'monstermq_explorer_view_mode',
    AUTOSCROLL: 'monstermq_explorer_autoscroll',
    AI_SOURCE_MODE: 'monstermq_explorer_ai_source_mode',
    AI_SCOPE_MODE: 'monstermq_explorer_ai_scope_mode'
};

class TopicExplorer {
    constructor() {
        // UI Elements - Toolbar
        this.statusBadge = document.getElementById('connection-status-badge');
        this.statusText = document.getElementById('connection-status-text');
        this.statRate = document.getElementById('stat-rate');
        this.toggleFlashBtn = document.getElementById('toggle-flash-btn');
        this.archiveSelect = document.getElementById('archive-group-select');
        this.subscriptionsBtn = document.getElementById('subscriptions-btn');
        this.subCountBadge = document.getElementById('sub-count-badge');
        this.toggleAiBtn = document.getElementById('toggle-ai-panel');
        this.togglePublishBtn = document.getElementById('toggle-publish-btn');

        // UI Elements - Panes & Resizers
        this.treePane = document.getElementById('tree-pane');
        this.centerPane = document.getElementById('center-pane');
        this.tablePane = document.getElementById('table-pane');
        this.detailPane = document.getElementById('detail-pane');
        this.publishPane = document.getElementById('publish-pane');
        this.aiPanel = document.getElementById('ai-panel');

        this.resizerTreeCenter = document.getElementById('resizer-tree-center');
        this.resizerTableDetail = document.getElementById('resizer-table-detail');
        this.resizerCenterPublish = document.getElementById('resizer-center-publish');

        // UI Elements - Tree
        this.treeFilter = document.getElementById('tree-filter');
        this.treeSortBtn = document.getElementById('tree-sort-btn');
        this.treeExpandAllBtn = document.getElementById('tree-expand-all-btn');
        this.treeCollapseAllBtn = document.getElementById('tree-collapse-all-btn');
        this.treeFetchSubnodesBtn = document.getElementById('tree-fetch-subnodes-btn');
        this.treeClearBtn = document.getElementById('tree-clear-btn');
        this.treeContent = document.getElementById('tree-content');

        // UI Elements - Table
        this.tableClearBtn = document.getElementById('table-clear-btn');
        this.tableActiveCheckbox = document.getElementById('table-active-checkbox');
        this.fetchSubnodesCheckbox = document.getElementById('fetch-subnodes-checkbox');
        this.modeLiveBtn = document.getElementById('mode-live-btn');
        this.modeHistoryBtn = document.getElementById('mode-history-btn');
        this.tableAutoScrollBtn = document.getElementById('table-autoscroll-btn');
        this.tableFilter = document.getElementById('table-filter');
        this.tableRowCount = document.getElementById('table-row-count');
        this.tableBody = document.getElementById('message-table-body');

        // UI Elements - Detail
        this.detailTabs = document.querySelectorAll('.detail-tab');
        this.detailTopicText = document.getElementById('detail-topic-text');
        this.detailCopyTopicBtn = document.getElementById('detail-copy-topic-btn');
        this.detailSourceBadge = document.getElementById('detail-source-badge');
        this.detailPayloadSize = document.getElementById('detail-payload-size');
        this.detailQosBadge = document.getElementById('detail-qos-badge');
        this.detailRetainBadge = document.getElementById('detail-retain-badge');
        this.detailQuickSubBtn = document.getElementById('detail-quick-sub-btn');
        this.detailBody = document.getElementById('detail-body');

        // UI Elements - Publish Pane
        this.closePublishBtn = document.getElementById('close-publish-btn');
        this.pubAutofillCheckbox = document.getElementById('pub-autofill-checkbox');
        this.pubTopicInput = document.getElementById('pub-topic-input');
        this.pubPayloadInput = document.getElementById('pub-payload-input');
        this.pubFormatJsonBtn = document.getElementById('pub-format-json-btn');
        this.pubSubmitBtn = document.getElementById('pub-submit-btn');

        // UI Elements - Subscriptions Modal
        this.subModalBackdrop = document.getElementById('sub-modal-backdrop');
        this.subModalDialog = document.getElementById('sub-modal-dialog');
        this.subModalInput = document.getElementById('sub-modal-input');
        this.subModalAddBtn = document.getElementById('sub-modal-add-btn');
        this.subModalTags = document.getElementById('sub-modal-tags');
        this.subModalToggleActive = document.getElementById('sub-modal-toggle-active');
        this.subModalClose = document.getElementById('sub-modal-close');
        this.subModalDone = document.getElementById('sub-modal-done');

        // UI Elements - AI
        this.closeAiBtn = document.getElementById('close-ai-btn');
        this.clearAiBtn = document.getElementById('clear-ai-chat-btn');
        this.aiSourceMode = document.getElementById('ai-source-mode');
        this.aiScopeMode = document.getElementById('ai-scope-mode');
        this.aiQuickActions = document.getElementById('ai-quick-actions');
        this.aiChatHistory = document.getElementById('ai-chat-history');
        this.aiQuestion = document.getElementById('ai-question');
        this.aiSend = document.getElementById('ai-send');
        this.aiContextDesc = document.getElementById('ai-context-desc');
        this.aiChatMessages = [];

        if (this.aiSourceMode) {
            const savedSource = safeStorage.getItem(STORAGE_KEYS.AI_SOURCE_MODE);
            this.aiSourceMode.value = (savedSource === 'archive') ? 'archive' : 'live';
        }
        if (this.aiScopeMode) {
            this.aiScopeMode.value = safeStorage.getItem(STORAGE_KEYS.AI_SCOPE_MODE) || 'selected';
        }

        // State variables
        this.treeNodes = new Map(); // path -> { element, label, isLeaf, children: Set, expanded, messageCount, lastMessage }
        this.treeRowElements = new Map(); // path -> DOM row element
        this._renderTreeTimer = null;
        this.expandedPaths = new Set();
        this.selectedTopic = null;
        this.selectedMessage = null;
        this.isSortedAZ = false;
        this.flashEnabled = safeStorage.getItem(STORAGE_KEYS.FLASH_ENABLED) !== 'false';
        this.fetchSubnodes = safeStorage.getItem(STORAGE_KEYS.FETCH_SUBNODES) === 'true';
        this.viewMode = safeStorage.getItem(STORAGE_KEYS.VIEW_MODE) || 'live';
        this.autoScroll = safeStorage.getItem(STORAGE_KEYS.AUTOSCROLL) !== 'false';
        this.activeTab = 'formatted';
        this.selectedArchiveGroup = safeStorage.getItem(STORAGE_KEYS.ARCHIVE_GROUP) || 'Default';

        // Message store
        this.liveTopics = new Map(); // topic -> message object
        this.historyMessages = []; // array of message objects
        this.maxHistory = 500;
        this.messageIdCounter = 0;

        // Rate tracking
        this.messageCountWindow = 0;
        this.rateInterval = null;

        // Subscriptions & WebSocket
        this.subscriptions = [];
        try {
            const saved = safeStorage.getItem(STORAGE_KEYS.SUBSCRIPTIONS);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) this.subscriptions = parsed.filter(t => typeof t === 'string' && t.trim().length > 0);
            }
        } catch { this.subscriptions = []; }
        this.subEnabled = safeStorage.getItem(STORAGE_KEYS.SUB_ENABLED) === 'true';
        this.ws = null;
        this.wsSubscriptionId = 0;
        this.wsReconnectTimer = null;

        this.init();
    }

    async init() {
        this.applySavedDimensions();
        this.setupResizers();
        this.setupEventListeners();
        this.setupFlashBtn();
        this.setupFetchSubnodesToggle();
        this.setupViewModeButtons();
        this.setupTableAutoScroll();
        this.setupRateMeter();
        await this.loadArchiveGroups();
        this.renderSubscriptionTags();

        // Connect live subscriptions if enabled and filters exist
        if (this.subEnabled && this.subscriptions.length > 0) {
            this.connectWebSocket();
        } else {
            this.updateConnectionStatus(false, 'Live Off');
        }

        // Initial browse of topic tree
        await this.browseRoot();
    }

    // =========================================================================
    // Dimension & Resizers
    // =========================================================================

    applySavedDimensions() {
        const savedTreeW = safeStorage.getItem(STORAGE_KEYS.TREE_WIDTH);
        if (savedTreeW && this.treePane) {
            this.treePane.style.width = `${parseInt(savedTreeW, 10)}px`;
        }

        const savedTableH = safeStorage.getItem(STORAGE_KEYS.TABLE_HEIGHT);
        if (savedTableH && this.tablePane) {
            this.tablePane.style.height = `${parseInt(savedTableH, 10)}px`;
        }

        const savedPubW = safeStorage.getItem(STORAGE_KEYS.PUB_WIDTH);
        if (savedPubW && this.publishPane) {
            this.publishPane.style.width = `${parseInt(savedPubW, 10)}px`;
        }
    }

    setupResizers() {
        // 1. Resizer: Tree <-> Center Pane (Horizontal)
        if (this.resizerTreeCenter && this.treePane) {
            this.attachHorizontalResizer(this.resizerTreeCenter, (deltaX) => {
                const currentW = this.treePane.getBoundingClientRect().width;
                const newW = Math.max(180, Math.min(window.innerWidth * 0.6, currentW + deltaX));
                this.treePane.style.width = `${newW}px`;
                safeStorage.setItem(STORAGE_KEYS.TREE_WIDTH, String(Math.round(newW)));
            });
        }

        // 2. Resizer: Table <-> Detail Pane (Vertical)
        if (this.resizerTableDetail && this.tablePane && this.centerPane) {
            this.attachVerticalResizer(this.resizerTableDetail, (deltaY) => {
                const currentH = this.tablePane.getBoundingClientRect().height;
                const centerH = this.centerPane.getBoundingClientRect().height;
                const newH = Math.max(80, Math.min(centerH - 80, currentH + deltaY));
                this.tablePane.style.height = `${newH}px`;
                safeStorage.setItem(STORAGE_KEYS.TABLE_HEIGHT, String(Math.round(newH)));
            });
        }

        // 3. Resizer: Center <-> Publish Pane (Horizontal)
        if (this.resizerCenterPublish && this.publishPane) {
            this.attachHorizontalResizer(this.resizerCenterPublish, (deltaX) => {
                const currentW = this.publishPane.getBoundingClientRect().width;
                // dragging left increases publish pane width
                const newW = Math.max(220, Math.min(window.innerWidth * 0.5, currentW - deltaX));
                this.publishPane.style.width = `${newW}px`;
                safeStorage.setItem(STORAGE_KEYS.PUB_WIDTH, String(Math.round(newW)));
            });
        }

        // 4. Resizers for Table Columns
        this.setupTableColumnResizers();
    }

    setupTableColumnResizers() {
        const resizableCols = ['col-time', 'col-topic', 'col-source', 'col-qos', 'col-retain'];
        resizableCols.forEach(id => {
            const th = document.getElementById(id);
            if (!th) return;
            th.style.position = 'relative';
            const handle = document.createElement('div');
            handle.style.cssText = 'position: absolute; right: 0; top: 0; bottom: 0; width: 5px; cursor: col-resize; user-select: none; z-index: 10;';
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                let startX = e.clientX;
                let startW = th.getBoundingClientRect().width;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                const onMouseMove = (moveEv) => {
                    const newW = Math.max(30, startW + (moveEv.clientX - startX));
                    th.style.width = `${newW}px`;
                };

                const onMouseUp = () => {
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });
            th.appendChild(handle);
        });
    }

    attachHorizontalResizer(handle, onResize) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            let lastX = e.clientX;
            const onMouseMove = (moveEv) => {
                const deltaX = moveEv.clientX - lastX;
                lastX = moveEv.clientX;
                onResize(deltaX);
            };

            const onMouseUp = () => {
                handle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    attachVerticalResizer(handle, onResize) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handle.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';

            let lastY = e.clientY;
            const onMouseMove = (moveEv) => {
                const deltaY = moveEv.clientY - lastY;
                lastY = moveEv.clientY;
                onResize(deltaY);
            };

            const onMouseUp = () => {
                handle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // =========================================================================
    // UI Event Listeners
    // =========================================================================

    setupEventListeners() {
        // Live subscriptions toggle button (top left)
        this.statusBadge?.addEventListener('click', () => {
            this.toggleLiveSubscriptions();
        });

        // Flash toggle
        this.toggleFlashBtn?.addEventListener('click', () => {
            this.flashEnabled = !this.flashEnabled;
            safeStorage.setItem(STORAGE_KEYS.FLASH_ENABLED, String(this.flashEnabled));
            this.setupFlashBtn();
        });

        // Archive selector change
        this.archiveSelect?.addEventListener('change', async (e) => {
            this.selectedArchiveGroup = e.target.value;
            safeStorage.setItem(STORAGE_KEYS.ARCHIVE_GROUP, this.selectedArchiveGroup);
            await this.browseRoot();
        });

        // Subscriptions dialog toggle
        this.subscriptionsBtn?.addEventListener('click', () => this.openSubscriptionsModal());
        this.subModalClose?.addEventListener('click', () => this.closeSubscriptionsModal());
        this.subModalDone?.addEventListener('click', () => this.closeSubscriptionsModal());
        this.subModalBackdrop?.addEventListener('click', () => this.closeSubscriptionsModal());

        this.subModalAddBtn?.addEventListener('click', () => this.handleAddSubscriptionFilter());
        this.subModalInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleAddSubscriptionFilter();
            }
        });

        this.subModalToggleActive?.addEventListener('click', () => {
            this.toggleLiveSubscriptions();
        });

        // Publish panel toggle
        this.togglePublishBtn?.addEventListener('click', () => this.togglePublishPane());
        this.closePublishBtn?.addEventListener('click', () => this.togglePublishPane(false));

        // Publish actions
        this.pubFormatJsonBtn?.addEventListener('click', () => this.formatPublishPayload());
        this.pubSubmitBtn?.addEventListener('click', () => this.doPublish());
        this.pubPayloadInput?.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.doPublish();
            }
        });
        this.pubTopicInput?.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.doPublish();
            }
        });

        // AI panel toggle & options
        this.toggleAiBtn?.addEventListener('click', () => this.toggleAiPanel());
        this.closeAiBtn?.addEventListener('click', () => this.toggleAiPanel(false));
        this.clearAiBtn?.addEventListener('click', () => this.clearAiChat());
        this.aiSourceMode?.addEventListener('change', () => {
            safeStorage.setItem(STORAGE_KEYS.AI_SOURCE_MODE, this.aiSourceMode.value);
            this.updateAiContextDesc();
        });
        this.aiScopeMode?.addEventListener('change', () => {
            safeStorage.setItem(STORAGE_KEYS.AI_SCOPE_MODE, this.aiScopeMode.value);
            this.updateAiContextDesc();
        });
        this.aiSend?.addEventListener('click', () => this.sendAiQuestion());
        this.aiQuestion?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendAiQuestion();
            }
        });

        // Tree actions
        this.treeFilter?.addEventListener('input', () => this.filterTree());
        this.treeSortBtn?.addEventListener('click', () => {
            this.isSortedAZ = !this.isSortedAZ;
            this.treeSortBtn.classList.toggle('active', this.isSortedAZ);
            this.renderTree();
        });
        this.treeExpandAllBtn?.addEventListener('click', () => this.expandAllTree());
        this.treeCollapseAllBtn?.addEventListener('click', () => this.collapseAllTree());
        this.treeClearBtn?.addEventListener('click', () => this.browseRoot());

        // Table actions
        this.tableClearBtn?.addEventListener('click', () => this.clearTableLog());
        this.modeLiveBtn?.addEventListener('click', () => this.switchViewMode('live'));
        this.modeHistoryBtn?.addEventListener('click', () => this.switchViewMode('history'));
        this.tableAutoScrollBtn?.addEventListener('click', () => {
            this.autoScroll = !this.autoScroll;
            safeStorage.setItem(STORAGE_KEYS.AUTOSCROLL, String(this.autoScroll));
            this.tableAutoScrollBtn.classList.toggle('active', this.autoScroll);
        });
        this.tableFilter?.addEventListener('input', () => this.renderTableRows());

        // Detail pane tabs
        this.detailTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.detailTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.activeTab = tab.dataset.tab;
                this.renderDetailContent();
            });
        });

        this.detailCopyTopicBtn?.addEventListener('click', () => {
            if (!this.selectedTopic) return;
            navigator.clipboard?.writeText(this.selectedTopic);
            ui.showToast('Topic copied to clipboard', 'info');
        });

        this.detailQuickSubBtn?.addEventListener('click', () => {
            if (!this.selectedTopic) return;
            const filter = `${this.selectedTopic}/#`;
            if (!this.subscriptions.includes(filter)) {
                this.subscriptions.push(filter);
                safeStorage.setItem(STORAGE_KEYS.SUBSCRIPTIONS, JSON.stringify(this.subscriptions));
                this.renderSubscriptionTags();
                this.subEnabled = true;
                safeStorage.setItem(STORAGE_KEYS.SUB_ENABLED, 'true');
                this.connectWebSocket();
                ui.showToast(`Subscribed to ${filter}`, 'success');
            } else {
                ui.showToast(`Already subscribed to ${filter}`, 'info');
            }
        });
    }

    setupFlashBtn() {
        if (!this.toggleFlashBtn) return;
        this.toggleFlashBtn.classList.toggle('active', this.flashEnabled);
    }

    setupFetchSubnodesToggle() {
        this.updateFetchSubnodesUi();

        this.fetchSubnodesCheckbox?.addEventListener('change', () => {
            this.fetchSubnodes = !!this.fetchSubnodesCheckbox.checked;
            safeStorage.setItem(STORAGE_KEYS.FETCH_SUBNODES, String(this.fetchSubnodes));
            this.updateFetchSubnodesUi();
            if (this.selectedTopic) {
                this.handleTopicSelected(this.selectedTopic);
            }
        });

        this.treeFetchSubnodesBtn?.addEventListener('click', () => {
            this.fetchSubnodes = !this.fetchSubnodes;
            safeStorage.setItem(STORAGE_KEYS.FETCH_SUBNODES, String(this.fetchSubnodes));
            this.updateFetchSubnodesUi();
            if (this.selectedTopic) {
                this.handleTopicSelected(this.selectedTopic);
            }
        });
    }

    updateFetchSubnodesUi() {
        if (this.fetchSubnodesCheckbox) {
            this.fetchSubnodesCheckbox.checked = this.fetchSubnodes;
        }
        if (this.treeFetchSubnodesBtn) {
            this.treeFetchSubnodesBtn.classList.toggle('active', this.fetchSubnodes);
        }
    }

    setupViewModeButtons() {
        if (!this.modeLiveBtn || !this.modeHistoryBtn) return;
        this.modeLiveBtn.classList.toggle('active', this.viewMode === 'live');
        this.modeHistoryBtn.classList.toggle('active', this.viewMode === 'history');
    }

    setupTableAutoScroll() {
        if (!this.tableAutoScrollBtn) return;
        this.tableAutoScrollBtn.classList.toggle('active', this.autoScroll);
    }

    switchViewMode(mode) {
        this.viewMode = mode;
        safeStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);
        this.setupViewModeButtons();
        this.renderTableRows();
    }

    setupRateMeter() {
        this.rateInterval = setInterval(() => {
            const count = this.messageCountWindow;
            this.messageCountWindow = 0;
            if (this.statRate) {
                this.statRate.textContent = `${count} msg/s`;
            }
        }, 1000);
    }

    // =========================================================================
    // Archive Groups & Topic Browsing
    // =========================================================================

    async loadArchiveGroups() {
        try {
            const query = `
                query GetArchiveGroups {
                    archiveGroups(enabled: true, lastValTypeNotEquals: NONE) {
                        name
                    }
                }
            `;
            const response = await window.graphqlClient.query(query);
            if (response?.archiveGroups && response.archiveGroups.length > 0) {
                this.archiveSelect.innerHTML = '';
                response.archiveGroups.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.name;
                    opt.textContent = g.name;
                    this.archiveSelect.appendChild(opt);
                });
                if (response.archiveGroups.some(g => g.name === this.selectedArchiveGroup)) {
                    this.archiveSelect.value = this.selectedArchiveGroup;
                } else {
                    this.selectedArchiveGroup = response.archiveGroups[0].name;
                    this.archiveSelect.value = this.selectedArchiveGroup;
                }
            } else {
                this.archiveSelect.innerHTML = '<option value="Default">Default</option>';
            }
        } catch (e) {
            console.warn('Failed to load archive groups:', e);
            this.archiveSelect.innerHTML = '<option value="Default">Default</option>';
        }
    }

    async browseRoot() {
        this.treeNodes.clear();
        this.expandedPaths.clear();
        this.selectedTopic = null;
        this.selectedMessage = null;
        this.liveTopics.clear();
        this.historyMessages = [];
        this.renderTableRows();
        this.renderDetailContent();
        this.updateAiContextDesc();

        if (this.treeContent) {
            this.treeContent.innerHTML = '<div style="padding: 1rem; color: var(--text-muted); font-size: 0.75rem;">Loading topics&hellip;</div>';
        }

        try {
            await this.loadTopicLevel('+', '');
        } catch (err) {
            console.error('Failed to browse root topics:', err);
            if (this.treeContent) {
                this.treeContent.innerHTML = '<div style="padding: 1rem; color: var(--monster-red); font-size: 0.75rem;">Failed to load topics</div>';
            }
        } finally {
            this.updateAiContextDesc();
        }
    }

    async loadTopicLevel(pattern, parentPath = '') {
        const query = `
            query BrowseTopics($topic: String!, $archiveGroup: String!) {
                browseTopics(topic: $topic, archiveGroup: $archiveGroup) {
                    name
                    value {
                        topic
                        payload
                        format
                        timestamp
                        qos
                    }
                }
            }
        `;
        try {
            const response = await window.graphqlClient.query(query, {
                topic: pattern,
                archiveGroup: this.selectedArchiveGroup
            });

            const topics = response?.browseTopics || [];

            if (parentPath) {
                const parentNode = this.treeNodes.get(parentPath);
                if (parentNode) {
                    parentNode.childrenLoaded = true;
                    if (topics.length === 0) {
                        parentNode.canHaveChildren = false;
                        parentNode.isLeaf = true;
                    }
                }
            }

            topics.forEach(t => {
                const topicName = t.name;
                let childFullPath;
                if (!parentPath) {
                    childFullPath = topicName.split('/')[0];
                } else {
                    if (topicName.startsWith(parentPath + '/')) {
                        const remainder = topicName.slice(parentPath.length + 1);
                        const nextSegment = remainder.split('/')[0];
                        childFullPath = `${parentPath}/${nextSegment}`;
                    } else {
                        const remainder = topicName.replace(new RegExp(`^${parentPath}/?`), '');
                        const nextSegment = remainder.split('/')[0] || topicName;
                        childFullPath = `${parentPath}/${nextSegment}`;
                    }
                }

                // If this topic has a value, store it as messageData on the node
                let messageData = null;
                if (t.value) {
                    messageData = {
                        id: ++this.messageIdCounter,
                        topic: t.value.topic || childFullPath,
                        payload: t.value.payload || '',
                        format: t.value.format || 'TEXT',
                        qos: t.value.qos || 0,
                        retain: true,
                        timestamp: Number(t.value.timestamp) || Date.now(),
                        isNew: false,
                        source: 'archive'
                    };
                }

                this.ensureTreeNode(childFullPath, false, messageData, 'archive');
                const node = this.treeNodes.get(childFullPath);
                if (node && !node.childrenLoaded) {
                    node.canHaveChildren = true;
                }

                if (parentPath) {
                    const parentNode = this.treeNodes.get(parentPath);
                    if (parentNode) {
                        parentNode.children.add(childFullPath);
                        parentNode.canHaveChildren = true;
                        parentNode.childrenLoaded = true;
                        parentNode.isLeaf = false;
                    }
                }
            });

            this.renderTree();
        } catch (err) {
            console.error('Failed to load topic level:', err);
            if (parentPath) {
                const parentNode = this.treeNodes.get(parentPath);
                if (parentNode) {
                    parentNode.childrenLoaded = true;
                }
            }
            this.renderTree();
        }
    }

    ensureTreeNode(fullPath, isLeaf = false, messageData = null, source = 'archive') {
        const parts = fullPath.split('/');
        let currentPath = '';
        let treeChanged = false;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const prevPath = currentPath;
            currentPath = i === 0 ? part : `${currentPath}/${part}`;
            const leaf = (i === parts.length - 1) && isLeaf;

            let node = this.treeNodes.get(currentPath);
            if (!node) {
                treeChanged = true;
                node = {
                    path: currentPath,
                    name: part,
                    depth: i,
                    isLeaf: leaf,
                    children: new Set(),
                    expanded: false,
                    canHaveChildren: !leaf,
                    childrenLoaded: false,
                    messageCount: 0,
                    lastMessage: null,
                    updatedAt: 0,
                    source: (i === parts.length - 1) ? source : (source === 'subscription' ? 'subscription' : 'archive')
                };
                this.treeNodes.set(currentPath, node);

                if (prevPath) {
                    const parentNode = this.treeNodes.get(prevPath);
                    if (parentNode) {
                        parentNode.children.add(currentPath);
                        parentNode.isLeaf = false;
                        parentNode.canHaveChildren = true;
                        parentNode.childrenLoaded = true;
                    }
                }
            } else {
                if (prevPath) {
                    const parentNode = this.treeNodes.get(prevPath);
                    if (parentNode) {
                        if (!parentNode.children.has(currentPath)) {
                            treeChanged = true;
                        }
                        parentNode.children.add(currentPath);
                        parentNode.isLeaf = false;
                        parentNode.canHaveChildren = true;
                    }
                }
            }

            if (source === 'subscription') {
                if (i === parts.length - 1) {
                    node.source = 'subscription';
                }
            } else if (!node.source) {
                node.source = 'archive';
            }

            if (i === parts.length - 1 && messageData) {
                node.messageCount = Math.max(1, node.messageCount + 1);
                node.lastMessage = messageData;
                node.updatedAt = messageData.timestamp || Date.now();
                if (messageData.source) {
                    node.source = messageData.source;
                }
            }
        }

        return treeChanged;
    }

    // =========================================================================
    // Tree Rendering & Filtering
    // =========================================================================

    filterTree() {
        this.renderTree();
    }

    async expandAllTree() {
        const toLoad = [];
        for (const [path, node] of this.treeNodes.entries()) {
            if (node.canHaveChildren && !node.childrenLoaded) {
                toLoad.push(path);
            }
        }
        for (const path of toLoad) {
            await this.loadTopicLevel(`${path}/+`, path);
        }
        for (const [path, node] of this.treeNodes.entries()) {
            if (node.children.size > 0 || (node.canHaveChildren && !node.childrenLoaded)) {
                node.expanded = true;
                this.expandedPaths.add(path);
            }
        }
        this.renderTree();
    }

    collapseAllTree() {
        for (const [path, node] of this.treeNodes.entries()) {
            node.expanded = false;
        }
        this.expandedPaths.clear();
        this.renderTree();
    }

    async toggleNode(path) {
        const node = this.treeNodes.get(path);
        if (!node) return;

        if (!node.expanded) {
            node.expanded = true;
            this.expandedPaths.add(path);
            if (node.canHaveChildren && !node.childrenLoaded) {
                await this.loadTopicLevel(`${path}/+`, path);
            }
        } else {
            node.expanded = false;
            this.expandedPaths.delete(path);
        }
        this.renderTree();
    }

    renderTree() {
        if (!this.treeContent) return;
        this.treeRowElements.clear();
        this.treeContent.innerHTML = '';

        const filter = (this.treeFilter?.value || '').trim().toLowerCase();
        const rootPaths = [];

        for (const [path, node] of this.treeNodes.entries()) {
            if (node.depth === 0) rootPaths.push(path);
        }

        if (this.isSortedAZ) {
            rootPaths.sort();
        }

        const fragment = document.createDocumentFragment();
        for (const path of rootPaths) {
            this.renderTreeNode(path, fragment, filter);
        }

        if (fragment.children.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding: 1rem; color: var(--text-muted); font-size: 0.75rem;';
            empty.textContent = filter ? 'No matching topics' : 'No topics found';
            fragment.appendChild(empty);
        }

        this.treeContent.appendChild(fragment);

        if (this.aiPanel && this.aiPanel.style.display !== 'none') {
            this.updateAiContextDesc();
        }
    }

    renderTreeNode(path, parentEl, filter) {
        const node = this.treeNodes.get(path);
        if (!node) return;

        // Check if this node or any descendant matches filter
        if (filter && !this.nodeMatchesFilter(node, filter)) {
            return;
        }

        const isExpanded = filter ? true : (node.expanded || this.expandedPaths.has(path));
        const isSelected = this.selectedTopic === path;
        const canExpand = node.children.size > 0 || (node.canHaveChildren && !node.childrenLoaded);

        const row = document.createElement('div');
        row.className = `tree-item-row ${isSelected ? 'selected' : ''}`;
        row.style.paddingLeft = `${node.depth * 14 + 6}px`;
        row.dataset.topic = path;
        this.treeRowElements.set(path, row);

        // Chevron
        const chevron = document.createElement('span');
        chevron.className = `tree-chevron ${canExpand ? '' : 'hidden'} ${isExpanded ? 'expanded' : ''}`;
        chevron.innerHTML = '<svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" style="display: block;"><path d="M3 1.5l4 3.5-4 3.5z"/></svg>';
        chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleNode(path);
        });
        row.appendChild(chevron);

        // Icon
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = canExpand ? '📁' : '📄';
        if (canExpand) {
            icon.style.cursor = 'pointer';
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(path);
            });
        }
        row.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.name;
        row.appendChild(label);

        // Source badge (ARC vs SUB)
        if (node.source) {
            const srcBadge = document.createElement('span');
            const isSub = node.source === 'subscription';
            srcBadge.className = `tree-badge-source ${isSub ? 'source-sub' : 'source-arc'}`;
            srcBadge.textContent = isSub ? 'SUB' : 'ARC';
            srcBadge.title = isSub ? 'Received via live subscription' : 'Loaded from Archive last value store';
            row.appendChild(srcBadge);
        }

        // Count badge
        if (node.messageCount > 0) {
            const count = document.createElement('span');
            count.className = 'tree-badge-count';
            count.textContent = String(node.messageCount);
            row.appendChild(count);
        }

        // Row Click: select topic
        row.addEventListener('click', () => {
            this.handleTopicSelected(path);
        });

        // Double click: toggle expand/collapse
        row.addEventListener('dblclick', () => {
            if (canExpand) {
                this.toggleNode(path);
            }
        });

        parentEl.appendChild(row);

        // Render children if expanded
        if (isExpanded && node.children.size > 0) {
            const children = Array.from(node.children);
            if (this.isSortedAZ) children.sort();
            for (const childPath of children) {
                this.renderTreeNode(childPath, parentEl, filter);
            }
        }
    }

    nodeMatchesFilter(node, filter) {
        if (node.path.toLowerCase().includes(filter)) return true;
        for (const childPath of node.children) {
            const childNode = this.treeNodes.get(childPath);
            if (childNode && this.nodeMatchesFilter(childNode, filter)) return true;
        }
        return false;
    }

    isDirectChild(parentTopic, childTopic) {
        if (!parentTopic || !childTopic) return false;
        const prefix = parentTopic + '/';
        if (!childTopic.startsWith(prefix)) return false;
        const remainder = childTopic.slice(prefix.length);
        return remainder.length > 0 && !remainder.includes('/');
    }

    getTreeRowByTopic(topic) {
        if (!this.treeContent || !topic) return null;
        if (typeof CSS !== 'undefined' && CSS.escape) {
            try {
                return this.treeContent.querySelector(`.tree-item-row[data-topic="${CSS.escape(topic)}"]`);
            } catch (e) {
                // Ignore selector error and fall back to manual scan
            }
        }
        const rows = this.treeContent.querySelectorAll('.tree-item-row');
        for (const r of rows) {
            if (r.dataset.topic === topic) return r;
        }
        return null;
    }

    updateTreeBadgeAndFlash(topic, node) {
        let row = this.treeRowElements?.get(topic);
        if (!row || !row.isConnected) {
            row = this.getTreeRowByTopic(topic);
            if (row && this.treeRowElements) {
                this.treeRowElements.set(topic, row);
            }
        }
        if (!row) return;

        // Update or insert source badge
        let srcBadge = row.querySelector('.tree-badge-source');
        if (node.source) {
            if (!srcBadge) {
                srcBadge = document.createElement('span');
                const countBadge = row.querySelector('.tree-badge-count');
                if (countBadge) {
                    row.insertBefore(srcBadge, countBadge);
                } else {
                    row.appendChild(srcBadge);
                }
            }
            const isSub = node.source === 'subscription';
            srcBadge.className = `tree-badge-source ${isSub ? 'source-sub' : 'source-arc'}`;
            srcBadge.textContent = isSub ? 'SUB' : 'ARC';
            srcBadge.title = isSub ? 'Received via live subscription' : 'Loaded from Archive last value store';
        }

        let countBadge = row.querySelector('.tree-badge-count');
        if (node.messageCount > 0) {
            if (!countBadge) {
                countBadge = document.createElement('span');
                countBadge.className = 'tree-badge-count';
                row.appendChild(countBadge);
            }
            countBadge.textContent = String(node.messageCount);
        } else if (countBadge) {
            countBadge.remove();
        }

        if (this.flashEnabled) {
            row.classList.remove('row-updated');
            void row.offsetWidth;
            row.classList.add('row-updated');
        }
    }

    scheduleRenderTree() {
        if (this._renderTreeTimer) return;
        this._renderTreeTimer = setTimeout(() => {
            this._renderTreeTimer = null;
            this.renderTree();
        }, 150);
    }

    async handleTopicSelected(topic) {
        this.selectedTopic = topic;
        this.renderTree();

        // Update Topic string in Detail strip
        if (this.detailTopicText) {
            this.detailTopicText.textContent = topic;
            this.detailTopicText.title = topic;
        }

        // If publish panel auto-sync is on, populate publish topic
        if (this.pubAutofillCheckbox?.checked && this.pubTopicInput) {
            this.pubTopicInput.value = topic;
        }

        // Refresh AI context indicator if open
        this.updateAiContextDesc();

        const node = this.treeNodes.get(topic);

        if (this.fetchSubnodes) {
            await this.fetchDeepSubnodes(topic);
        } else {
            // If this node can have children and they haven't been loaded yet, load them first
            if (node && node.canHaveChildren && !node.childrenLoaded) {
                await this.loadTopicLevel(`${topic}/+`, topic);
            }

            // Clear table first
            this.liveTopics.clear();
            this.historyMessages = [];

            // Check if node has direct children (one level deep)
            if (node && node.children && node.children.size > 0) {
                const childPaths = Array.from(node.children);
                childPaths.sort();
                for (const childPath of childPaths) {
                    const childNode = this.treeNodes.get(childPath);
                    const msg = childNode?.lastMessage || {
                        id: ++this.messageIdCounter,
                        topic: childPath,
                        payload: '',
                        format: 'TEXT',
                        qos: 0,
                        retain: false,
                        timestamp: childNode?.updatedAt || null,
                        source: childNode?.source || 'archive'
                    };
                    if (!msg.source) {
                        msg.source = childNode?.source || 'archive';
                    }
                    this.liveTopics.set(childPath, msg);
                    this.historyMessages.push(msg);
                }
                this.selectedMessage = this.liveTopics.get(childPaths[0]) || null;
                this.renderDetailContent();
                this.renderTableRows();
            } else {
                // Leaf node: show this topic itself
                const existingMsg = node?.lastMessage;
                if (existingMsg) {
                    if (!existingMsg.source) {
                        existingMsg.source = node?.source || 'archive';
                    }
                    this.liveTopics.set(topic, existingMsg);
                    this.historyMessages.push(existingMsg);
                    this.selectedMessage = existingMsg;
                    this.renderDetailContent();
                    this.renderTableRows();
                } else {
                    // Fetch currentValue from GraphQL
                    await this.fetchTopicCurrentValue(topic);
                }
            }
        }

        // Highlight matching table row
        this.highlightSelectedTableRow();

        if (this.aiPanel && this.aiPanel.style.display !== 'none') {
            this.updateAiContextDesc();
        }
    }

    async fetchDeepSubnodes(topic) {
        this.liveTopics.clear();
        this.historyMessages = [];

        const node = this.treeNodes.get(topic);
        const query = `
            query GetDeepSubnodes($topicFilter: String!, $archiveGroup: String!) {
                currentValues(topicFilter: $topicFilter, archiveGroup: $archiveGroup, limit: 500) {
                    topic
                    payload
                    format
                    timestamp
                    qos
                }
            }
        `;
        try {
            const res = await window.graphqlClient.query(query, {
                topicFilter: `${topic}/#`,
                archiveGroup: this.selectedArchiveGroup
            });

            const items = res?.currentValues || [];

            // If the selected topic itself has a message, add it as well
            if (node?.lastMessage) {
                if (!node.lastMessage.source) {
                    node.lastMessage.source = node.source || 'archive';
                }
                this.liveTopics.set(topic, node.lastMessage);
                this.historyMessages.push(node.lastMessage);
            }

            for (const cv of items) {
                const msg = {
                    id: ++this.messageIdCounter,
                    topic: cv.topic,
                    payload: cv.payload || '',
                    format: cv.format || 'TEXT',
                    qos: cv.qos || 0,
                    retain: true,
                    timestamp: Number(cv.timestamp) || Date.now(),
                    isNew: false,
                    source: 'archive'
                };
                this.ensureTreeNode(cv.topic, true, msg, 'archive');
                this.liveTopics.set(cv.topic, msg);
                this.historyMessages.push(msg);
            }

            if (node) {
                node.childrenLoaded = true;
                node.expanded = true;
                this.expandedPaths.add(topic);
            }

            if (this.historyMessages.length > 0) {
                this.selectedMessage = this.historyMessages[0];
            } else {
                // If no subtopics returned, attempt to fetch current value for the topic itself
                await this.fetchTopicCurrentValue(topic);
            }

            this.renderTree();
            this.renderDetailContent();
            this.renderTableRows();
        } catch (err) {
            console.error('Failed to fetch deep subnodes:', err);
            if (node && node.canHaveChildren && !node.childrenLoaded) {
                await this.loadTopicLevel(`${topic}/+`, topic);
            }
            this.renderTableRows();
        }
    }

    async fetchTopicCurrentValue(topic) {
        try {
            const query = `
                query GetCurrentValue($topic: String!, $archiveGroup: String!) {
                    currentValue(topic: $topic, archiveGroup: $archiveGroup) {
                        topic
                        payload
                        format
                        timestamp
                        qos
                    }
                }
            `;
            const res = await window.graphqlClient.query(query, {
                topic,
                archiveGroup: this.selectedArchiveGroup
            });
            if (res?.currentValue) {
                const cv = res.currentValue;
                const msg = {
                    id: ++this.messageIdCounter,
                    topic: cv.topic,
                    payload: cv.payload,
                    format: cv.format,
                    qos: cv.qos || 0,
                    retain: true,
                    timestamp: Number(cv.timestamp) || Date.now(),
                    source: 'archive'
                };
                this.ensureTreeNode(topic, true, msg, 'archive');
                this.liveTopics.set(topic, msg);
                this.selectedMessage = msg;
                this.renderDetailContent();
                this.renderTableRows();
            } else {
                this.selectedMessage = {
                    topic,
                    payload: '',
                    format: 'TEXT',
                    qos: 0,
                    retain: false,
                    timestamp: null,
                    source: 'archive'
                };
                this.renderDetailContent();
            }
        } catch (e) {
            console.warn('Failed to fetch currentValue for topic:', e);
        }
    }

    // =========================================================================
    // Table (Live vs History)
    // =========================================================================

    handleIncomingMessage(update) {
        if (!update || !update.topic) return;
        this.messageCountWindow++;

        const msg = {
            id: ++this.messageIdCounter,
            topic: update.topic,
            payload: update.payload || '',
            format: update.format || 'TEXT',
            qos: update.qos || 0,
            retain: !!update.retained,
            timestamp: Number(update.timestamp) || Date.now(),
            isNew: true,
            source: 'subscription'
        };

        // Update Tree node
        const treeChanged = this.ensureTreeNode(msg.topic, true, msg, 'subscription');
        const targetNode = this.treeNodes.get(msg.topic);
        if (targetNode) {
            this.updateTreeBadgeAndFlash(msg.topic, targetNode);
        }

        if (treeChanged) {
            this.scheduleRenderTree();
        }

        // Active table check
        if (this.tableActiveCheckbox && !this.tableActiveCheckbox.checked) {
            return;
        }

        // If a topic is selected, filter incoming messages:
        // When fetchSubnodes is enabled: accept self and any descendant topic
        // When fetchSubnodes is disabled: accept self and direct children (one level deep)
        if (this.selectedTopic) {
            const isSelf = msg.topic === this.selectedTopic;
            const matches = this.fetchSubnodes
                ? (isSelf || msg.topic.startsWith(this.selectedTopic + '/'))
                : (isSelf || this.isDirectChild(this.selectedTopic, msg.topic));
            if (!matches) {
                return;
            }
        }

        // Update Live store
        this.liveTopics.set(msg.topic, msg);

        // Update History store
        this.historyMessages.push(msg);
        if (this.historyMessages.length > this.maxHistory) {
            this.historyMessages.shift();
        }

        // If this is currently selected topic, update detail pane live
        if (this.selectedTopic === msg.topic) {
            this.selectedMessage = msg;
            this.renderDetailContent();
        }

        this.renderTableRows();
    }

    getTableMessages() {
        const filter = (this.tableFilter?.value || '').trim().toLowerCase();
        let messages = [];

        if (this.viewMode === 'live') {
            messages = Array.from(this.liveTopics.values());
            // Sort by topic
            messages.sort((a, b) => a.topic.localeCompare(b.topic));
        } else {
            messages = this.historyMessages || [];
        }

        // Filter by selected topic namespace if one is selected
        if (this.selectedTopic) {
            messages = messages.filter(m => {
                const isSelf = m.topic === this.selectedTopic;
                return this.fetchSubnodes
                    ? (isSelf || m.topic.startsWith(this.selectedTopic + '/'))
                    : (isSelf || this.isDirectChild(this.selectedTopic, m.topic));
            });
        }

        if (filter) {
            messages = messages.filter(m =>
                m.topic.toLowerCase().includes(filter) ||
                (typeof m.payload === 'string' && m.payload.toLowerCase().includes(filter))
            );
        }

        return messages;
    }

    renderTableRows() {
        if (!this.tableBody) return;

        const messages = this.getTableMessages();

        if (this.tableRowCount) {
            this.tableRowCount.textContent = `${messages.length} rows`;
        }

        this.tableBody.innerHTML = '';
        const fragment = document.createDocumentFragment();

        messages.forEach(msg => {
            const tr = document.createElement('tr');
            if (this.selectedTopic === msg.topic) {
                tr.classList.add('selected');
            }
            if (this.flashEnabled && msg.isNew) {
                tr.classList.add('row-updated');
                msg.isNew = false;
            }

            // Time
            const tdTime = document.createElement('td');
            tdTime.textContent = msg.timestamp ? this.formatTimestamp(msg.timestamp) : '-';
            tr.appendChild(tdTime);

            // Topic
            const tdTopic = document.createElement('td');
            tdTopic.textContent = msg.topic;
            tr.appendChild(tdTopic);

            // Source
            const tdSource = document.createElement('td');
            tdSource.style.textAlign = 'center';
            const isSub = msg.source === 'subscription';
            const srcBadge = document.createElement('span');
            srcBadge.className = `badge-source ${isSub ? 'badge-source-sub' : 'badge-source-arc'}`;
            srcBadge.textContent = isSub ? 'SUB' : 'ARC';
            srcBadge.title = isSub ? 'Received via live subscription' : 'Loaded from Archive last value store';
            tdSource.appendChild(srcBadge);
            tr.appendChild(tdSource);

            // QoS
            const tdQos = document.createElement('td');
            tdQos.style.textAlign = 'center';
            tdQos.textContent = String(msg.qos ?? 0);
            tr.appendChild(tdQos);

            // Retain
            const tdRetain = document.createElement('td');
            tdRetain.style.textAlign = 'center';
            tdRetain.innerHTML = msg.retain ? '<span class="badge-retain">R</span>' : '';
            tr.appendChild(tdRetain);

            // Payload preview
            const tdPayload = document.createElement('td');
            tdPayload.textContent = this.truncatePayload(msg.payload);
            tr.appendChild(tdPayload);

            // Click row: select and inspect in detail pane
            tr.addEventListener('click', () => {
                this.selectedTopic = msg.topic;
                this.selectedMessage = msg;
                if (this.detailTopicText) {
                    this.detailTopicText.textContent = msg.topic;
                }
                if (this.pubAutofillCheckbox?.checked && this.pubTopicInput) {
                    this.pubTopicInput.value = msg.topic;
                }
                this.renderTree();
                this.renderDetailContent();
                this.highlightSelectedTableRow();
            });

            // Double click: navigate into topic
            tr.addEventListener('dblclick', () => {
                this.handleTopicSelected(msg.topic);
            });

            fragment.appendChild(tr);
        });

        this.tableBody.appendChild(fragment);

        // Auto-scroll
        if (this.autoScroll && this.viewMode === 'history') {
            const scrollContainer = this.tableBody.closest('.table-scroll');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }

        if (this.aiPanel && this.aiPanel.style.display !== 'none') {
            this.updateAiContextDesc();
        }
    }

    highlightSelectedTableRow() {
        if (!this.tableBody) return;
        const rows = this.tableBody.querySelectorAll('tr');
        rows.forEach(tr => {
            const topicCell = tr.children[1];
            if (topicCell && topicCell.textContent === this.selectedTopic) {
                tr.classList.add('selected');
            } else {
                tr.classList.remove('selected');
            }
        });
    }

    clearTableLog() {
        if (this.viewMode === 'live') {
            this.liveTopics.clear();
        } else {
            this.historyMessages = [];
        }
        this.renderTableRows();
    }

    // =========================================================================
    // Detail Pane
    // =========================================================================

    renderDetailContent() {
        if (!this.detailBody) return;
        const msg = this.selectedMessage;

        if (!msg) {
            this.detailBody.innerHTML = '<div style="color: var(--text-muted); padding: 1rem 0;">Click a topic in the tree or message table to inspect its payload</div>';
            if (this.detailSourceBadge) {
                this.detailSourceBadge.style.display = 'none';
            }
            return;
        }

        // Info strip badges
        if (this.detailSourceBadge) {
            const isSub = msg.source === 'subscription';
            this.detailSourceBadge.style.display = 'inline-block';
            this.detailSourceBadge.className = `badge-source ${isSub ? 'badge-source-sub' : 'badge-source-arc'}`;
            this.detailSourceBadge.textContent = isSub ? 'Subscription' : 'Archive LastVal';
            this.detailSourceBadge.title = isSub ? 'Received via live WebSocket subscription' : 'Loaded from Archive last value store';
        }
        if (this.detailPayloadSize) {
            const byteLength = typeof msg.payload === 'string' ? msg.payload.length : (msg.payload?.byteLength || 0);
            this.detailPayloadSize.textContent = this.formatBytes(byteLength);
        }
        if (this.detailQosBadge) {
            this.detailQosBadge.textContent = `QoS ${msg.qos ?? 0}`;
        }
        if (this.detailRetainBadge) {
            this.detailRetainBadge.style.display = msg.retain ? 'inline' : 'none';
        }

        const payloadStr = typeof msg.payload === 'string' ? msg.payload : '';

        switch (this.activeTab) {
            case 'formatted': {
                const jsonObj = this.tryParseJson(payloadStr);
                if (jsonObj !== null) {
                    this.detailBody.innerHTML = `<pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">${this.formatJsonColored(jsonObj)}</pre>`;
                } else {
                    this.detailBody.innerHTML = `<pre style="margin: 0; white-space: pre-wrap; word-break: break-all; color: var(--text-primary);">${this.escapeHtml(payloadStr)}</pre>`;
                }
                break;
            }
            case 'raw': {
                this.detailBody.innerHTML = `<pre style="margin: 0; white-space: pre-wrap; word-break: break-all; color: var(--text-primary);">${this.escapeHtml(payloadStr)}</pre>`;
                break;
            }
            case 'hex': {
                this.detailBody.innerHTML = `<pre style="margin: 0; white-space: pre-wrap; word-break: break-all; color: #94a3b8; font-family: monospace;">${this.payloadToHex(payloadStr)}</pre>`;
                break;
            }
            case 'pic': {
                const imgData = this.detectImage(payloadStr);
                if (imgData) {
                    this.detailBody.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem;">
                            <img src="${imgData.url}" alt="Payload Image" style="max-width: 100%; max-height: 400px; border-radius: 6px; border: 1px solid var(--dark-border); background: #000;" />
                            <div style="font-size: 0.75rem; color: var(--text-muted);">${imgData.mime}</div>
                        </div>
                    `;
                } else {
                    this.detailBody.innerHTML = '<div style="color: var(--text-muted);">Payload does not appear to be an image (JPEG, PNG, GIF, WebP).</div>';
                }
                break;
            }
        }
    }

    // =========================================================================
    // Publish Panel
    // =========================================================================

    togglePublishPane(forceState = null) {
        if (!this.publishPane) return;
        const isHidden = this.publishPane.style.display === 'none';
        const show = forceState !== null ? forceState : isHidden;

        this.publishPane.style.display = show ? 'flex' : 'none';
        if (this.resizerCenterPublish) {
            this.resizerCenterPublish.style.display = show ? 'block' : 'none';
        }
        if (this.togglePublishBtn) {
            this.togglePublishBtn.classList.toggle('active', show);
        }

        // Close AI panel if opening publish panel
        if (show && this.aiPanel) {
            this.toggleAiPanel(false);
        }

        if (show && this.pubTopicInput && this.selectedTopic && this.pubAutofillCheckbox?.checked) {
            this.pubTopicInput.value = this.selectedTopic;
        }
    }

    formatPublishPayload() {
        if (!this.pubPayloadInput) return;
        try {
            const parsed = JSON.parse(this.pubPayloadInput.value);
            this.pubPayloadInput.value = JSON.stringify(parsed, null, 2);
        } catch {
            ui.showToast('Invalid JSON payload', 'warning');
        }
    }

    async doPublish() {
        const topic = (this.pubTopicInput?.value || '').trim();
        const payload = this.pubPayloadInput?.value || '';
        const qosRadio = document.querySelector('input[name="pub-qos"]:checked');
        const qos = qosRadio ? parseInt(qosRadio.value, 10) : 0;
        const retain = !!document.getElementById('pub-retain-checkbox')?.checked;

        if (!topic) {
            ui.showToast('Please specify a topic to publish', 'warning');
            return;
        }

        if (topic.includes('+') || topic.includes('#')) {
            ui.showToast('Topic wildcard (+ or #) not allowed when publishing', 'error');
            return;
        }

        try {
            const mutation = `
                mutation PublishMessage($input: PublishInput!) {
                    publish(input: $input) {
                        success
                        error
                    }
                }
            `;

            const res = await window.graphqlClient.query(mutation, {
                input: {
                    topic,
                    payload,
                    qos,
                    retained: retain
                }
            });

            if (res?.publish?.success) {
                ui.showToast(`Published to ${topic}`, 'success');
            } else {
                ui.showToast(`Publish failed: ${res?.publish?.error || 'Unknown error'}`, 'error');
            }
        } catch (err) {
            console.error('Publish error:', err);
            ui.showToast(`Publish failed: ${err.message}`, 'error');
        }
    }

    // =========================================================================
    // AI Analysis Panel (GenAiQuery.analyzeTopics)
    // =========================================================================

    getAiTopicPattern(scope = null) {
        const sc = scope || this.aiScopeMode?.value || 'selected';
        if (sc === 'all') {
            return '#';
        }
        if (this.selectedTopic && this.selectedTopic !== 'root') {
            const node = this.treeNodes.get(this.selectedTopic);
            const hasChildren = node && node.children && node.children.size > 0;
            if (hasChildren) {
                return this.selectedTopic.endsWith('/#') ? this.selectedTopic : `${this.selectedTopic}/#`;
            }
            return this.selectedTopic;
        }
        return '#';
    }

    getAiTopicData(scope = null) {
        const sc = scope || this.aiScopeMode?.value || 'selected';
        const topicDataMap = new Map();

        if (sc === 'selected') {
            // 1. Gather all messages visible in the table
            const tableMsgs = this.getTableMessages();
            for (const msg of tableMsgs) {
                if (msg && msg.topic) {
                    const val = (msg.payload !== undefined && msg.payload !== null)
                        ? (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload))
                        : '';
                    topicDataMap.set(msg.topic, val);
                }
            }

            // 2. Also check treeNodes matching this selected hierarchy
            if (this.selectedTopic && this.selectedTopic !== 'root') {
                const prefix = `${this.selectedTopic}/`;
                for (const [path, node] of this.treeNodes.entries()) {
                    if (path === this.selectedTopic || path.startsWith(prefix)) {
                        if (!topicDataMap.has(path) && node.lastMessage && node.lastMessage.payload !== undefined && node.lastMessage.payload !== null) {
                            topicDataMap.set(path, typeof node.lastMessage.payload === 'string'
                                ? node.lastMessage.payload
                                : JSON.stringify(node.lastMessage.payload));
                        }
                    }
                }
            }
        } else {
            // All topics: collect everything known across treeNodes and liveTopics
            for (const [path, node] of this.treeNodes.entries()) {
                if (node.lastMessage && node.lastMessage.payload !== undefined && node.lastMessage.payload !== null) {
                    topicDataMap.set(path, typeof node.lastMessage.payload === 'string'
                        ? node.lastMessage.payload
                        : JSON.stringify(node.lastMessage.payload));
                }
            }
            for (const [topic, msg] of this.liveTopics.entries()) {
                if (msg && msg.payload !== undefined && msg.payload !== null) {
                    topicDataMap.set(topic, typeof msg.payload === 'string'
                        ? msg.payload
                        : JSON.stringify(msg.payload));
                }
            }
        }

        // Always ensure currently selected detail message is included
        if (this.selectedMessage && this.selectedMessage.topic) {
            const topic = this.selectedMessage.topic;
            if (sc === 'all' || !this.selectedTopic || this.selectedTopic === 'root' || topic === this.selectedTopic || topic.startsWith(`${this.selectedTopic}/`)) {
                if (!topicDataMap.has(topic) && this.selectedMessage.payload !== undefined && this.selectedMessage.payload !== null) {
                    topicDataMap.set(topic, typeof this.selectedMessage.payload === 'string'
                        ? this.selectedMessage.payload
                        : JSON.stringify(this.selectedMessage.payload));
                }
            }
        }

        return Array.from(topicDataMap.entries()).map(([topic, value]) => ({
            topic,
            value
        }));
    }

    updateAiContextDesc() {
        if (!this.aiContextDesc) return;
        const sourceMode = this.aiSourceMode?.value || 'live';
        const scopeMode = this.aiScopeMode?.value || 'selected';
        const topicData = this.getAiTopicData(scopeMode);
        const pattern = this.getAiTopicPattern(scopeMode);
        const grp = this.selectedArchiveGroup || 'Default';
        const selLabel = scopeMode === 'all' ? 'all (#)' : (this.selectedTopic && this.selectedTopic !== 'root' ? this.selectedTopic : 'root (#)');

        if (sourceMode === 'archive') {
            this.aiContextDesc.textContent = `Archive (${grp}): ${pattern} | LastValueStore`;
        } else {
            this.aiContextDesc.textContent = `Live UI: ${topicData.length} topics | Scope: ${selLabel}`;
        }
    }

    clearAiChat() {
        if (this.aiChatHistory) {
            this.aiChatHistory.innerHTML = '';
        }
        this.aiChatMessages = [];
        ui.showToast('Conversation cleared', 'info');
    }

    toggleAiPanel(forceState = null) {
        if (!this.aiPanel) return;
        const isHidden = this.aiPanel.style.display === 'none';
        const show = forceState !== null ? forceState : isHidden;

        this.aiPanel.style.display = show ? 'flex' : 'none';
        if (this.toggleAiBtn) {
            this.toggleAiBtn.classList.toggle('active', show);
        }

        // Close Publish panel if opening AI panel
        if (show && this.publishPane) {
            this.togglePublishPane(false);
        }

        if (show) {
            this.updateAiContextDesc();
            this.initAiQuickActions();
            if (this.aiQuestion) this.aiQuestion.focus();
        }
    }

    initAiQuickActions() {
        if (!this.aiQuickActions || this.aiQuickActions.children.length > 0) return;
        const actions = [
            { label: 'Summarize', prompt: 'Provide a concise overview of the topics in this tree.' },
            { label: 'Structure', prompt: 'Analyze the hierarchy and naming conventions of these topics.' },
            { label: 'Anomalies', prompt: 'Are there any unusual or outlier topic patterns or values?' }
        ];
        actions.forEach(a => {
            const btn = document.createElement('button');
            btn.className = 'explorer-btn';
            btn.style.fontSize = '0.7rem';
            btn.textContent = a.label;
            btn.addEventListener('click', () => {
                if (this.aiQuestion) this.aiQuestion.value = a.prompt;
                this.sendAiQuestion();
            });
            this.aiQuickActions.appendChild(btn);
        });
    }

    async sendAiQuestion() {
        const question = (this.aiQuestion?.value || '').trim();
        if (!question || !this.aiChatHistory) return;

        // Render user message
        const userMsg = document.createElement('div');
        userMsg.style.cssText = 'background: rgba(124, 58, 237, 0.2); padding: 0.4rem 0.6rem; border-radius: 6px; margin-bottom: 0.5rem; color: #fff;';
        userMsg.textContent = question;
        this.aiChatHistory.appendChild(userMsg);
        this.aiQuestion.value = '';

        // Query AI analysis via GraphQL
        const botMsg = document.createElement('div');
        botMsg.style.cssText = 'background: rgba(255, 255, 255, 0.05); padding: 0.4rem 0.6rem; border-radius: 6px; margin-bottom: 0.5rem; color: var(--text-secondary);';
        botMsg.innerHTML = 'Thinking&hellip;';
        this.aiChatHistory.appendChild(botMsg);
        this.aiChatHistory.scrollTop = this.aiChatHistory.scrollHeight;

        const sourceMode = this.aiSourceMode?.value || 'live';
        const scopeMode = this.aiScopeMode?.value || 'selected';
        const topicData = this.getAiTopicData(scopeMode);
        const topicPattern = this.getAiTopicPattern(scopeMode);
        const isFollowUp = this.aiChatMessages && this.aiChatMessages.length > 0;

        let archiveGroupParam = null;
        let topicPatternParam = null;
        let topicDataParam = null;

        if (sourceMode === 'archive') {
            archiveGroupParam = this.selectedArchiveGroup || 'Default';
            topicPatternParam = topicPattern;
            topicDataParam = null;
        } else {
            // live UI & subscriptions
            archiveGroupParam = null;
            topicPatternParam = null;
            topicDataParam = topicData;
            if (topicData.length === 0) {
                botMsg.textContent = 'No topic data available in UI for the selected scope. Try "Archive Store Only" or subscribe/load topics first.';
                return;
            }
        }

        const query = `
            query AnalyzeTopics(
                $archiveGroup: String
                $topicPattern: String
                $topicData: [TopicDataInput!]
                $question: String!
                $maxTopics: Int
                $maxValueLength: Int
                $chatHistory: [ChatMessage!]
            ) {
                genai {
                    analyzeTopics(
                        archiveGroup: $archiveGroup
                        topicPattern: $topicPattern
                        topicData: $topicData
                        question: $question
                        maxTopics: $maxTopics
                        maxValueLength: $maxValueLength
                        chatHistory: $chatHistory
                    ) {
                        response
                        topicsAnalyzed
                        model
                        error
                    }
                }
            }
        `;

        try {
            const res = await window.graphqlClient.query(query, {
                archiveGroup: archiveGroupParam,
                topicPattern: topicPatternParam,
                topicData: topicDataParam,
                question,
                maxTopics: 0,
                maxValueLength: 0,
                chatHistory: isFollowUp ? this.aiChatMessages : null
            });

            const analysis = res?.genai?.analyzeTopics;
            if (!analysis) {
                botMsg.textContent = 'GenAI is not available or returned no data. Check your broker GenAI configuration.';
            } else if (analysis.error) {
                botMsg.textContent = `Error: ${analysis.error}`;
            } else {
                const responseHtml = window.marked 
                    ? window.marked.parse(analysis.response) 
                    : `<pre style="margin: 0; white-space: pre-wrap; font-family: inherit;">${this.escapeHtml(analysis.response)}</pre>`;
                
                const statsInfo = `<div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.45rem; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.3rem;">Analyzed ${analysis.topicsAnalyzed} topics (${analysis.model || 'AI'})</div>`;
                botMsg.innerHTML = responseHtml + statsInfo;

                if (!this.aiChatMessages) this.aiChatMessages = [];
                this.aiChatMessages.push({ role: 'user', content: question });
                this.aiChatMessages.push({ role: 'assistant', content: analysis.response });
            }
        } catch (e) {
            botMsg.textContent = `Analysis error: ${e.message}`;
        }
        this.aiChatHistory.scrollTop = this.aiChatHistory.scrollHeight;
    }

    // =========================================================================
    // Subscriptions & WebSocket (graphql-transport-ws)
    // =========================================================================

    openSubscriptionsModal() {
        if (!this.subModalDialog || !this.subModalBackdrop) return;
        this.subModalDialog.style.display = 'flex';
        this.subModalBackdrop.style.display = 'block';
        this.renderSubscriptionTags();
        this.updateSubscriptionActiveButton();
        if (this.subModalInput) this.subModalInput.focus();
    }

    closeSubscriptionsModal() {
        if (!this.subModalDialog || !this.subModalBackdrop) return;
        this.subModalDialog.style.display = 'none';
        this.subModalBackdrop.style.display = 'none';
    }

    updateSubscriptionActiveButton() {
        if (!this.subModalToggleActive) return;
        this.subModalToggleActive.textContent = this.subEnabled ? 'Pause Subscriptions' : 'Resume Subscriptions';
        this.subModalToggleActive.style.background = this.subEnabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
        this.subModalToggleActive.style.color = this.subEnabled ? '#ef4444' : '#10b981';
    }

    toggleLiveSubscriptions() {
        this.subEnabled = !this.subEnabled;
        safeStorage.setItem(STORAGE_KEYS.SUB_ENABLED, String(this.subEnabled));
        this.updateSubscriptionActiveButton();
        if (this.subEnabled) {
            if (this.subscriptions.length === 0) {
                this.updateConnectionStatus(false, 'Live Off (No Filters)');
                this.openSubscriptionsModal();
                ui.showToast('Please add at least one subscription filter (e.g. #)', 'info');
            } else {
                this.connectWebSocket();
                ui.showToast('Live subscriptions enabled', 'success');
            }
        } else {
            this.disconnectWebSocket();
            this.updateConnectionStatus(false, 'Live Off');
            ui.showToast('Live subscriptions paused', 'info');
        }
    }

    handleAddSubscriptionFilter() {
        if (!this.subModalInput) return;
        const filter = this.subModalInput.value.trim();
        if (!filter) return;

        if (!this.subscriptions.includes(filter)) {
            this.subscriptions.push(filter);
            safeStorage.setItem(STORAGE_KEYS.SUBSCRIPTIONS, JSON.stringify(this.subscriptions));
            this.renderSubscriptionTags();
            this.subModalInput.value = '';

            // Auto-enable when adding filter
            this.subEnabled = true;
            safeStorage.setItem(STORAGE_KEYS.SUB_ENABLED, 'true');
            this.updateSubscriptionActiveButton();
            this.connectWebSocket();
        }
    }

    renderSubscriptionTags() {
        if (this.subCountBadge) {
            this.subCountBadge.textContent = String(this.subscriptions.length);
        }
        if (!this.subModalTags) return;
        this.subModalTags.innerHTML = '';

        if (this.subscriptions.length === 0) {
            this.subModalTags.innerHTML = '<span style="color: var(--text-muted); font-size: 0.75rem;">No active topic filters</span>';
            return;
        }

        this.subscriptions.forEach((filter, idx) => {
            const chip = document.createElement('div');
            chip.style.cssText = 'display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.15rem 0.5rem; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; color: #38bdf8; font-family: monospace; font-size: 0.75rem;';
            chip.textContent = filter;

            const removeBtn = document.createElement('span');
            removeBtn.style.cssText = 'cursor: pointer; opacity: 0.7; font-weight: bold; margin-left: 2px;';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', () => {
                this.subscriptions.splice(idx, 1);
                safeStorage.setItem(STORAGE_KEYS.SUBSCRIPTIONS, JSON.stringify(this.subscriptions));
                this.renderSubscriptionTags();
                if (this.subscriptions.length === 0) {
                    this.disconnectWebSocket();
                    this.updateConnectionStatus(false, 'Live Off');
                } else if (this.subEnabled) {
                    this.sendSubscribe();
                }
            });
            chip.appendChild(removeBtn);

            this.subModalTags.appendChild(chip);
        });
    }

    connectWebSocket() {
        this.disconnectWebSocket();
        if (this.subscriptions.length === 0) {
            this.updateConnectionStatus(false, 'No Filters');
            return;
        }

        let wsUrl = 'ws://localhost:4000/graphql';
        if (window.brokerManager) {
            wsUrl = window.brokerManager.getWsEndpoint();
        } else {
            const loc = window.location;
            const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${wsProto}//${loc.host}/graphql`;
        }

        this.updateConnectionStatus(false, 'Connecting&hellip;');

        try {
            this.ws = new WebSocket(wsUrl, 'graphql-transport-ws');

            this.ws.onopen = () => {
                const payload = {};
                const token = safeStorage.getItem('monstermq_token');
                if (token && token !== 'null') {
                    payload.authorization = `Bearer ${token}`;
                }
                this.ws.send(JSON.stringify({ type: 'connection_init', payload }));
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this.handleWsMessage(msg);
                } catch (e) {
                    console.error('WS parse error:', e);
                }
            };

            this.ws.onerror = (err) => {
                console.warn('WS error:', err);
                this.updateConnectionStatus(false, 'Live Error');
            };

            this.ws.onclose = () => {
                this.updateConnectionStatus(false, this.subEnabled ? 'Reconnecting&hellip;' : 'Live Off');
                if (this.subEnabled && this.subscriptions.length > 0) {
                    this.wsReconnectTimer = setTimeout(() => this.connectWebSocket(), 3000);
                }
            };
        } catch (e) {
            console.error('Failed to create WebSocket:', e);
            this.updateConnectionStatus(false, 'Live Failed');
        }
    }

    disconnectWebSocket() {
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.onclose = null;
                this.ws.close();
            } catch {}
            this.ws = null;
        }
    }

    handleWsMessage(msg) {
        switch (msg.type) {
            case 'connection_ack':
                this.updateConnectionStatus(true, 'Live On');
                this.sendSubscribe();
                break;
            case 'next':
                if (msg.payload?.data?.topicUpdates) {
                    this.handleIncomingMessage(msg.payload.data.topicUpdates);
                }
                break;
            case 'error':
                console.error('WS subscription error:', msg.payload);
                break;
        }
    }

    sendSubscribe() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const filters = this.subscriptions.filter(f => typeof f === 'string' && f.trim());
        if (filters.length === 0) return;

        this.wsSubscriptionId++;
        const query = `
            subscription($filters: [String!]!) {
                topicUpdates(topicFilters: $filters) {
                    topic
                    payload
                    format
                    timestamp
                    qos
                    retained
                }
            }
        `;

        this.ws.send(JSON.stringify({
            id: String(this.wsSubscriptionId),
            type: 'subscribe',
            payload: {
                query,
                variables: { filters }
            }
        }));
    }

    updateConnectionStatus(connected, text) {
        if (this.statusBadge) {
            this.statusBadge.classList.toggle('offline', !connected);
            this.statusBadge.title = this.subEnabled
                ? 'Live subscriptions active. Click to turn off.'
                : 'Live subscriptions paused. Click to turn on.';
        }
        if (this.statusText) {
            this.statusText.innerHTML = text;
        }
    }

    // =========================================================================
    // Formatters & Utility Functions
    // =========================================================================

    formatTimestamp(ts) {
        const d = new Date(ts);
        const pad = (n) => String(n).padStart(2, '0');
        const ms = String(d.getMilliseconds()).padStart(3, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
    }

    formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    truncatePayload(payload) {
        if (typeof payload !== 'string') return '';
        const clean = payload.replace(/\r?\n|\r/g, ' ');
        return clean.length > 120 ? clean.substring(0, 117) + '...' : clean;
    }

    tryParseJson(str) {
        if (!str || typeof str !== 'string') return null;
        const trimmed = str.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
        try {
            return JSON.parse(trimmed);
        } catch {
            return null;
        }
    }

    formatJsonColored(obj) {
        const jsonStr = JSON.stringify(obj, null, 2);
        return this.escapeHtml(jsonStr)
            .replace(/&quot;(.*?)&quot;(?=\s*:)/g, '<span class="json-key">"$1"</span>')
            .replace(/: &quot;(.*?)&quot;/g, ': <span class="json-string">"$1"</span>')
            .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
            .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
            .replace(/: (null)/g, ': <span class="json-null">$1</span>');
    }

    payloadToHex(str) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        const hex = [];
        const ascii = [];
        let output = '';

        for (let i = 0; i < bytes.length; i++) {
            hex.push(bytes[i].toString(16).padStart(2, '0'));
            ascii.push(bytes[i] >= 32 && bytes[i] <= 126 ? String.fromCharCode(bytes[i]) : '.');

            if ((i + 1) % 16 === 0 || i === bytes.length - 1) {
                const offset = (Math.floor(i / 16) * 16).toString(16).padStart(4, '0');
                const hexPart = hex.join(' ').padEnd(48, ' ');
                const asciiPart = ascii.join('');
                output += `${offset}  ${hexPart}  |${asciiPart}|\n`;
                hex.length = 0;
                ascii.length = 0;
            }
        }
        return output || '(empty)';
    }

    detectImage(str) {
        if (!str || typeof str !== 'string') return null;
        const trimmed = str.trim();

        // Data URI
        if (trimmed.startsWith('data:image/')) {
            const mime = trimmed.substring(5, trimmed.indexOf(';'));
            return { url: trimmed, mime };
        }

        // Base64 detection
        if (trimmed.length > 50 && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) {
            if (trimmed.startsWith('/9j/')) return { url: `data:image/jpeg;base64,${trimmed}`, mime: 'image/jpeg' };
            if (trimmed.startsWith('iVBORw0KGgo')) return { url: `data:image/png;base64,${trimmed}`, mime: 'image/png' };
            if (trimmed.startsWith('R0lGOD')) return { url: `data:image/gif;base64,${trimmed}`, mime: 'image/gif' };
            if (trimmed.startsWith('UklGR')) return { url: `data:image/webp;base64,${trimmed}`, mime: 'image/webp' };
        }

        return null;
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    dispose() {
        this.disconnectWebSocket();
        if (this.rateInterval) {
            clearInterval(this.rateInterval);
            this.rateInterval = null;
        }
        if (this._renderTreeTimer) {
            clearTimeout(this._renderTreeTimer);
            this._renderTreeTimer = null;
        }
    }
}

// Instantiate and register disposal with page lifecycle
const explorer = new TopicExplorer();
page.addCleanup(() => explorer.dispose());

page.expose({
    get TopicExplorer() { return TopicExplorer; },
    get topicExplorer() { return explorer; }
});
page.ready();
return () => page.dispose();
}
