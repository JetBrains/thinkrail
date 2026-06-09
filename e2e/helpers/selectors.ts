/**
 * Centralized CSS / role / placeholder selectors used across e2e specs.
 *
 * Funneling selectors through this file lets us absorb UI churn in one place
 * instead of chasing it across every spec.
 */

export const projectPicker = {
  pathInput: 'input[placeholder="/home/user/my-project"]',
  openButton: { role: "button", name: "Open Project" } as const,
  errorMessage: ".picker-error",
  suggestionList: ".picker-suggestions",
  recentItem: ".picker-recent-item",
};

export const appShell = {
  // Status bar text — also used as the "shell is ready" signal.
  statusSessionsLabel: /\d+ sessions?/,
  statusBar: ".status-bar",
};

export const chatStream = {
  errorBanner: ".chat-banner-error",
  // Any sign of forward progress in a session.
  activitySelectors:
    ".chat-assistant, .chat-tool, .chat-question, .chat-question-answered-table",
  toolCard: ".chat-tool",
  questionCard: ".chat-question",
};

export const newSession = {
  newButton: "button.session-tabs-new-btn",
  // Draft form widgets.
  modelSelect: "select.draft-config-select--model",
  // The perms <select> shares `.draft-config-select` with the model picker but
  // lacks the `--model` modifier — :not() narrows to the perms one.
  permissionSelect: "select.draft-config-select:not(.draft-config-select--model)",
  promptInputPlaceholder: /Type a message to start/,
  startButton: { role: "button", name: /Start Session/ } as const,
  // Skill picker (DraftConfigCard's Skill row → SkillGrid in a popover).
  skillRow: '.draft-config-row:has(.draft-config-label:text-is("Skill"))',
  skillSelectButton:
    '.draft-config-row:has(.draft-config-label:text-is("Skill")) .draft-config-action',
  skillGrid: ".skill-grid",
  skillCard: ".skill-card",
  skillCardName: ".skill-card-name",
  skillGroupLabel: ".skill-group-label",
};

export const sessionPanel = {
  // Status line at the bottom of the chat (model/mode/effort/end-session menu).
  statusLine: ".session-status-line",
  statusButton: ".session-status-line .ssl-status",
  statusDropdownItem: ".ssl-dropdown-item",
  // InputArea controls.
  inputTextarea: ".input-textarea",
  inputSend: "button.input-send",
  inputInterrupt: "button.input-interrupt",
  messagePlaceholder: /Message Claude/,
};

export const inputAutocomplete = {
  // The grouped suggestion popup rendered above the textarea when a `/token`
  // is active under the caret.
  popup: ".input-autocomplete",
  group: ".input-autocomplete-group",
  sectionHeader: ".input-autocomplete-section-header",
  item: ".input-autocomplete-item",
  active: ".input-autocomplete-active",
};

export const sessionManager = {
  panel: ".session-manager",
  card: ".sm-card",
  // The card has one explicit action: a hover-revealed trash icon.
  deleteBtn: "button.sm-icon-btn",
  ticketChip: ".sm-ticket-chip",
  ticketTitle: ".sm-ticket-title",
  ticketId: ".sm-ticket-id",
  ticketStripe: ".sm-ticket-stripe",
  statusDot: ".sm-dot",
  metricsTurns: ".sm-chip--turns",
  metricsCost: ".sm-chip--cost",
  ctxMenu: ".sm-ctx-menu",
  ctxMenuItem: ".sm-ctx-menu-item",
};

export const statusBar = {
  sessionsButton: "button.status-sessions-btn",
};

export const header = {
  logo: ".header-logo",
  themeButton: 'button.header-btn[title="Switch theme"]',
  themeOption: ".theme-option",
  serverInfoButton: 'button.header-btn[title="Server connection info"]',
  newButton: { role: "button", name: /\+ New/ } as const,
  settingsButton: 'button.header-settings-btn',
  // Center view switcher — drives uiStore.centerView ("board" | "sessions").
  boardTab: { role: "tab", name: /^Board( \d+)?$/ } as const,
  sessionsTab: { role: "tab", name: /^Sessions( \d+)?$/ } as const,
};

export const serverInfoDialog = {
  hostnameLabel: /Hostname/,
};

export const specTree = {
  row: ".st-row",
  selectedRow: ".st-row-selected",
  rowTitle: ".st-title",
  empty: ".st-empty",
  docHeader: ".st-doc-header",
  docRow: ".st-doc-row",
};

export const fileViewer = {
  root: ".fv",
  path: ".fv-path",
  editButton: "button.fv-btn-edit",
  saveButton: "button.fv-btn-save",
  editInPlaceItem: ".fv-dropdown-item:has-text('Edit in place')",
  monacoEditor: ".fv .monaco-editor",
  monacoViewLines: ".fv .monaco-editor .view-lines",
  markdownPreview: ".md-preview",
};

export const boardView = {
  root: ".board-view",
  newButton: "button.board-new-btn",
  kanbanColumns: ".kanban-columns",
  kanbanColumn: ".kanban-column",
  ticketCard: ".ticket-card",
  ticketCardTitle: ".ticket-card-title",
  ctxMenu: ".board-ctx-menu",
  ctxMenuItem: ".board-ctx-menu-item",
  // Tab in the SessionTabBar that toggles back to the board.
  sessionTabBoard: ".session-tab.board-tab",
  ticketTab: ".session-tab.ticket-tab",
};

export const createTicketModal = {
  root: ".create-ticket-modal",
  titleInput:
    ".create-ticket-modal input[placeholder=\"What do you want to build or fix?\"]",
  typeSelect: ".create-ticket-modal select",
  bodyTextarea: ".create-ticket-modal textarea",
  createButton: { role: "button", name: /^Create$/ } as const,
  cancelButton: { role: "button", name: "Cancel" } as const,
};

export const ticketDetail = {
  root: ".ticket-info-inner",
  rightArea: ".ticket-right-area",
  rightHeader: ".ticket-right-header",
  rightTitle: ".ticket-right-title",
  // Header card on the left sidebar.
  headerTitleInput: ".ticket-header-title-input",
  statusSelect: "select.ticket-header-badge--idea, select.ticket-header-badge--described, select.ticket-header-badge--specified, select.ticket-header-badge--planned, select.ticket-header-badge--executing, select.ticket-header-badge--done",
  // Sidebar sections.
  sectionTitle: ".ticket-section-title",
  sectionHeader: ".ticket-section-header",
  linkedItem: ".ticket-linked-item",
  linkedEmpty: ".ticket-linked-empty",
  // Progress bar.
  progressBar: ".ticket-progress-bar",
  progressDotCurrent: ".ticket-progress-dot--current",
  progressLabelCurrent: ".ticket-progress-label--current",
  progressPrimary: "button.ticket-progress-primary",
  progressMore: "button.ticket-progress-more",
  // Description view.
  descriptionEditorWrapper: ".ticket-right-body, .ticket-describe-editor",
  descriptionPreview: ".md-preview, .ticket-description-preview-text",
  descriptionAiButton: "button.ticket-describe-ai-btn",
  saveButtonPrimary: "button.ticket-section-action--primary",
  // Plan view.
  planTab: ".ticket-plan-tab",
  planTabActive: ".ticket-plan-tab--active",
  planContent: ".ticket-plan-content",
  planStep: ".ticket-plan-step",
  planFormStep: ".ticket-plan-form-step",
  planFormInput: ".ticket-plan-form-input",
  planSaveButton: "button.ticket-plan-save-btn",
  planAddBtn: "button.ticket-plan-add-btn",
};

export const leftPanel = {
  panelTab: ".panel-tab",
  panelTabActive: ".panel-tab-active",
  filesTab: "button.panel-tab:has-text('Files')",
  specsTab: "button.panel-tab:has-text('Specs')",
  sessionsTab: "button.panel-tab:has-text('Sessions')",
};

export const fileTree = {
  root: ".ft",
  row: ".ft-row",
  rowSelected: ".ft-row-selected",
  name: ".ft-name",
  arrow: ".ft-arrow",
  empty: ".ft-empty",
  collapseAllBtn: "button.ft-toolbar-btn[title='Collapse All']",
  expandAllBtn: "button.ft-toolbar-btn[title='Expand All']",
  showHiddenBtn: "button.ft-toolbar-btn[title*='hidden files']",
};

export const trashModal = {
  container: ".trash-container",
  title: ".trash-title",
  count: ".trash-count",
  pill: ".trash-pill",
  pillActive: ".trash-pill--active",
  list: ".trash-list",
  item: ".trash-item",
  itemName: ".trash-item-name",
  emptyMsg: ".trash-empty-msg",
  restoreBtn: "button.trash-btn--restore",
  deleteBtn: "button.trash-btn--delete",
  emptyAllBtn: "button.trash-empty-btn",
};

export const palette = {
  container: ".palette-container",
  input: ".palette-input",
  results: ".palette-results",
  item: ".palette-item",
  itemSelected: ".palette-item-selected",
  itemTitle: ".palette-item-title",
  itemBadge: ".palette-item-badge",
  empty: ".palette-empty",
};

export const visTab = {
  root: ".vis-tab",
  loading: ".vis-tab-loading",
  empty: ".vis-tab-empty",
  pct: ".vis-tab-pct",
  pctBar: ".vis-tab-pct-bar",
  refreshBtn: "button.vis-tab-refresh-btn",
  workflowStep: ".vis-tab-workflow-step",
};

export const contextPanel = {
  root: ".context-panel",
  dashBtn: ".context-panel__dash-btn",
  dashBtnActive: ".context-panel__dash-btn--active",
  modeLabel: ".context-panel__mode-label",
};

export const specDiffs = {
  list: ".spec-diffs-list",
  entry: ".spec-diffs-entry",
  op: ".spec-diffs-op",
  label: ".spec-diffs-label",
  discardBtn: "button.spec-diffs-discard",
  approveAll: "button.spec-view-save",
  tab: ".spec-view-tab",
  tabActive: ".spec-view-tab--active",
  count: ".spec-view-count",
  editor: ".spec-diffs-editor",
  monaco: ".spec-diffs-monaco",
  placeholder: ".ticket-placeholder",
};
