# Button system migration — old → new

Generated from the per-area migration reports of this change. Mapping rule: the nearest variant by look, then the nearest height
(old `default` 32px → `l`, `sm` 28px → `m`, `icon` → `IconButton m`; raw ≈18–22px → `s`, ≈24px → `m`, ≈28–32px → `l`; a tie goes to the smaller size). Exceptions are listed.

Legacy names removed: variant `default` → `primary`, `soft` → `soft-primary`; sizes `sm` / `icon` / `default` / `lg` → `s` / `m` / `l` + `IconButton`.

## shell (41 sites)

| Site | Before | After | Notes |
| --- | --- | --- | --- |
| `auth/LoginDialog.tsx:130` | <a> buttonVariants({ className: 'flex-1' }) (old default fill) + icon size-16 | <a> buttonVariants primary l (+ flex-1) | Not in packet rawButtons list (buttonVariantsCalls: 1, audit SHELL-058); icon size class removed |
| `auth/LoginDialog.tsx:140` | Button outline default, Check/Copy icon elements size-16 | Button outline l | icon swap kept via iconLeft={copied ? Check : Copy} |
| `auth/LoginDialog.tsx:250` | Button default default | Button primary l |  |
| `auth/LoginDialog.tsx:281` | Button outline default | Button outline l |  |
| `auth/LoginDialog.tsx:285` | Button outline default | Button outline l |  |
| `shell/Shell.tsx:178` | raw size-28 transparent muted icon button in IconTooltip | IconButton ghost m | label 'Settings' (aria), tooltip keeps the shortcut text |
| `shell/WorkspaceChatHistory.tsx:36` | PopoverTrigger w-panel-header-row border-l muted icon trigger, manual Loader2 spinner while chatStarting, IconTooltip wrapTrigger | PopoverTrigger asChild > IconButton ghost m (wrapTrigger, loading={chatStarting}, self-center) | Not in packet rawButtons list (audit SHELL-038, Radix trigger). Manual spinner replaced by loading; loading also disables the trigger while a chat is starting (old trigger stayed clickable). border-l divider dropped. |
| `shell/WorkspaceChatHistory.tsx:190` | raw cn(menuItemClass,'shrink-0 px-4 text-text-muted') icon button (~26px) | IconButton ghost m | aria name 'Rename <title>', tooltip 'Rename chat' |
| `shell/locationBar/BranchSegment.tsx:153` | raw rowActionClass (size-24 muted ghost icon button) | IconButton ghost m | rowActionClass constant deleted |
| `shell/locationBar/BranchSegment.tsx:217` | <a> scope-review-open with rowActionClass | <a> buttonVariants ghost m shape icon (+ shrink-0) | Not in packet list; shared the deleted rowActionClass, kept inside its IconTooltip |
| `shell/layout/workbenchCenter.tsx:100` | raw w-panel-header-row (28 square) muted icon button, disabled skin | IconButton ghost m (self-center) | tooltip keeps the unavailable reason; no wrapTrigger (old code had none) |
| `shell/layout/workbenchCenter.tsx:115` | raw w-panel-header-row muted icon button | IconButton ghost m (self-center) |  |
| `shell/layout/AuxiliaryPaneHeader.tsx:71` | raw w-panel-header-row muted icon button (Hide pane) | IconButton ghost m (self-center) | aria-controls / aria-expanded kept |
| `shell/layout/workbenchTabs.tsx:674` | raw p-2 + 14px icon (~18px) tab close, hover-reveal | IconButton ghost s | tabIndex -1 and opacity-0 group-hover:opacity-100 focus:opacity-100 reveal kept; now gains a tooltip 'Close <name>' from label |
| `shell/layout/workbenchTabs.tsx:287` | PopoverTrigger w-panel-header-row border-l 'Search open tabs' in IconTooltip wrapTrigger | PopoverTrigger asChild > IconButton ghost m (wrapTrigger, self-center) | Not in packet list (audit SHELL-101); border-l divider dropped |
| `shell/layout/workbenchBottom.tsx:64` | DropdownMenuTrigger w-panel-header-row border-l icon trigger with native title | DropdownMenuTrigger asChild > IconButton ghost m (wrapTrigger, self-center) | Not in packet list (audit SHELL-111); native title became the IconButton tooltip; wrapTrigger added because the Dropdown trigger and the new tooltip trigger share the element (same pattern as the codebase's other trigger+tooltip sites) |
| `shell/layout/workbenchBottom.tsx:207` | raw border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui (~26px) | Button outline m |  |
| `shell/layout/workbenchSide.tsx:184` | DropdownMenuTrigger w-panel-header-row border-l '+' trigger in IconTooltip wrapTrigger | DropdownMenuTrigger asChild > IconButton ghost m (wrapTrigger, self-center) | Not in packet list (audit SHELL-112); border-l divider dropped |
| `shell/layout/workbenchSide.tsx:258` | raw w-panel-header-row muted icon button, disabled skin | IconButton ghost m (self-center) | tooltip keeps the unavailable reason |
| `shell/LayoutSettings.tsx:226` | raw p-2 + 14 icon (~18px) muted, text-only hover | IconButton ghost s | long explanatory text passed as tooltip; aria label 'About the default layout' |
| `shell/LayoutSettings.tsx:268` | raw p-4 + 14 icon (~22px) transparent text-primary (save name) | IconButton soft-primary s | green ghost; 22px tie 20/24 → s |
| `shell/LayoutSettings.tsx:277` | raw p-4 muted icon (cancel rename) | IconButton ghost s |  |
| `shell/LayoutSettings.tsx:287` | raw p-4 muted icon (rename) | IconButton ghost s |  |
| `shell/LayoutSettings.tsx:322` | Button outline sm | Button outline m |  |
| `shell/LayoutSettings.tsx:344` | Button default sm | Button primary m |  |
| `shell/LayoutSettings.tsx:418` | Button ghost sm | Button ghost m |  |
| `shell/LayoutSettings.tsx:426` | Button default sm (type=submit) | Button primary m | type submit + aria-label kept |
| `shell/LayoutSettings.tsx:446` | Button outline sm | Button outline m |  |
| `shell/WorkspaceWorkbench.tsx:219` | raw border-border-default transparent px-8 py-4 tr-text-ui (Retry) | Button outline m |  |
| `shell/WorkspaceWorkbench.tsx:707` | raw bordered elevated px-12 py-4, manual Loader2 swap while chatStarting | Button outline m, iconLeft MessageSquarePlus, loading={chatStarting} | label swap 'Starting chat…'/'New chat', disabled, data-starting kept; mt-4 kept |
| `shell/WorkspaceWorkbench.tsx:740` | raw w-panel-header-row border-l muted icon button | IconButton ghost m (self-center) | border-l divider dropped |
| `updates/UpdateSettings.tsx:253` | Button outline default + Refresh size-14 | Button outline l | 'Checking…' label + disabled kept (no spinner existed, so no loading) |
| `updates/UpdateSettings.tsx:264` | Button outline default | Button outline l |  |
| `updates/UpdateSettings.tsx:270` | Button default default | Button primary l |  |
| `updates/UpdateSettings.tsx:276` | Button default default | Button primary l |  |
| `updates/UpdateSettings.tsx:284` | Button default/outline (spread conditional variant) default | Button primary\|outline l | variant={hostFailed ? 'outline' : 'primary'}, iconLeft conditional |
| `updates/UpdateReadyButton.tsx:85` | Button ghost sm + className text-primary | Button soft-primary m | green ghost; className override removed; label span keeps hidden md:inline |
| `components/ErrorBoundary.tsx:92` | raw bordered elevated px-12 py-4 (Reload page) | Button outline m |  |
| `components/ErrorBoundary.tsx:101` | raw bordered elevated px-12 py-4 (Try again) | Button outline m |  |
| `notifications/NotificationPermissionPrompt.tsx:58` | Button outline default | Button outline l |  |
| `notifications/NotificationPermissionPrompt.tsx:61` | Button default default | Button primary l |  |

## projects (31 sites)

| Site | Before | After | Notes |
| --- | --- | --- | --- |
| `panels/ConfirmDialog.tsx:62` | Button outline (default 32) | Button outline l | unchanged source; already valid |
| `panels/ConfirmDialog.tsx:65` | Button destructive\|default (32) | Button destructive\|primary l | 'default' -> 'primary' |
| `panels/ConfirmPopover.tsx:59` | Button outline sm | Button outline m |  |
| `panels/ConfirmPopover.tsx:62` | Button destructive\|default sm | Button destructive\|primary m |  |
| `panels/NoticeDialog.tsx:43` | Button default (32) | Button primary l | relies on component defaults; source unchanged |
| `panels/OpenProjectPathDialog.tsx:77` | Button outline (32) | Button outline l | source unchanged |
| `panels/OpenProjectPathDialog.tsx:80` | Button default submit (32) | Button primary l | source unchanged; type=submit kept |
| `panels/Toaster.tsx:63` | Button outline sm inside ToastAction asChild | Button outline m |  |
| `panels/NewWorkspaceDialog.tsx:554` | Button outline sm (Trust project) | Button outline m |  |
| `panels/NewWorkspaceDialog.tsx:674` | raw <button> h-32 bg-control-primary-bg px-12 tr-text-action, manual Loader2 spinner while creating | Button primary l loading={creating} | manual spinner removed; 'Creating…'/'Starting…' label swap kept (label stays invisible under the centred spinner, per component); ↵ kbd hint span kept as content; disabled={!submitEnabled} kept; className shrink-0 |
| `panels/ProviderWarningBanner.tsx:35` | Button outline sm shrink-0 | Button outline m |  |
| `panels/ProjectTrustNotice.tsx:43` | Button ghost sm (Stop trusting) | Button ghost m | neutral ghost, not red text |
| `panels/ProjectTrustNotice.tsx:112` | Button outline sm | Button outline m |  |
| `panels/BranchPicker.tsx:86` | raw icon <button> size-24 muted ghost, title+aria-label, RefreshCw spins while refreshing | IconButton ghost m label='Refresh branches' loading={refreshing} | spinning icon -> loading spinner; while refreshing the button now blocks re-activation (old allowed re-click) |
| `panels/ExistingWorktreeDialog.tsx:123` | Button outline sm + inline RefreshCw | Button outline m iconLeft=RefreshCw |  |
| `panels/ExistingWorktreeDialog.tsx:199` | Button outline (32) | Button outline l | source unchanged |
| `panels/PrComposeDialog.tsx:69` | Button default (32), icon swapped for Loader2 while busy | Button primary l iconLeft=GitPullRequestArrow loading={busy} | manual spinner removed |
| `panels/PrSetupDialog.tsx:41` | Button ghost icon (28), Copy/Check(success-coloured) swap, aria-label | IconButton ghost m label='Copy command' | icon={copied ? CopiedIcon : Copy}; CopiedIcon is a module-level wrapper keeping text-feedback-success on the check glyph; now also gets the shared tooltip |
| `panels/PrSetupDialog.tsx:49` | Button outline sm + Play, title tooltip | Button outline m iconLeft=Play | explanatory title ('Run this command in a workspace terminal — answer its prompts there') dropped per rule (text button, not a truncation fallback) — see decisions |
| `panels/PrSetupDialog.tsx:205` | <a> buttonVariants({variant:'outline'}) + svg size-14 | <a> buttonVariants({variant:'outline', size:'l'}) | svg size class removed (component sizes svg), aria-hidden added |
| `panels/PrSetupDialog.tsx:211` | Button default (32) + RefreshCw child | Button primary l iconLeft=RefreshCw |  |
| `panels/ProjectTree.tsx:274` | Button ghost icon size-panel-row (22) inside AddProjectMenu DropdownMenuTrigger asChild, aria-label | IconButton ghost s label='Add project' | ref kept; gains shared tooltip; open menu -> selected via data-state=open |
| `panels/ProjectTree.tsx:594` | IconTooltip + Button ghost icon size-panel-row shrink-0 | IconButton ghost s label=CREATE_WORKSPACE_LABEL className=shrink-0 |  |
| `panels/ProjectTree.tsx:810` | IconTooltip 'Keep active' + raw <button> HOVER_CONTROL_CLASS (size-20) | IconButton ghost s label='Keep {name} active' tooltip='Keep active' | HOVER_CONTROL_CLASS reduced to layout + hover-reveal only |
| `panels/ProjectTree.tsx:821` | IconTooltip + raw <button> HOVER_CONTROL_CLASS with disabled:opacity-0 disabled:pointer-events-none | IconButton ghost s label='Settle {name}' tooltip={blocked ? 'Finish or read the result first' : 'Settle'} wrapTrigger | disabled:opacity-0 dropped (decision 2): blocked Settle now stays visible with disabled skin; wrapTrigger added so the 'Finish or read the result first' tooltip is reachable on the disabled button |
| `panels/ProjectTree.tsx:899` | DropdownMenuTrigger (renders <button>) with HOVER_CONTROL_CLASS, kebab | DropdownMenuTrigger asChild > IconButton ghost s label='Actions for {name}' | not listed as raw <button> in packet but shares HOVER_CONTROL_CLASS (audit PROJ-096); migrated so the shared class can be layout-only; gains tooltip; open -> selected; e2e hover-gated opacity check still satisfied |
| `panels/InterviewPromptDialog.tsx:65` | Button ghost (32) | Button ghost l | source unchanged |
| `panels/InterviewPromptDialog.tsx:74` | Button outline (32) with ref | Button outline l | source unchanged |
| `panels/InterviewPromptDialog.tsx:90` | <a> buttonVariants() + 'pointer-events-none opacity-50' when pending | <a> buttonVariants({variant:'primary', size:'l'}) + data-disabled when pending | call-site disabled skin replaced with the component's data-disabled skin (also pointer-events-none); aria-disabled kept; cn import removed |
| `panels/AnalyticsConsentDialog.tsx:51` | Button default (32) | Button primary l | source unchanged; 'Saving…' label logic kept |
| `panels/HeaderIconButton.tsx:37` | raw icon <button> size-24, active = bg-container-elevated-bg, IconTooltip | IconButton ghost m, selected={active}, aria-pressed={active}, data-active kept | API kept (testid/label/active/disabled/onClick/children-as-icon-element) because all call sites (ChangesReviewPane, DiffPane, ChangesFileSection) are outside this packet; children rendered through a stable context-backed icon component (span display:contents, aria-hidden) so no remounts; optional new `icon?: ButtonIcon` prop added for call sites to migrate to later |

## settings (41 sites)

| Site | Before | After | Notes |
| --- | --- | --- | --- |
| `panels/ProvidersSettings.tsx:141` | Button ghost sm, RefreshCw icon spinning while refreshing, disabled={refreshing} | Button ghost m iconLeft=RefreshCw loading={refreshing} | animate-spin icon swap replaced by loading; aria-label kept; unused cn import removed |
| `panels/ProvidersSettings.tsx:214` | Button outline sm (Show N more) | Button outline m |  |
| `panels/ProvidersSettings.tsx:297` | Button soft sm + LogOut (Sign out) | Button soft-primary m iconLeft=LogOut | exemplar |
| `panels/ProvidersSettings.tsx:342` | Button soft sm + LogIn (Sign in) | Button soft-primary m iconLeft=LogIn | exemplar |
| `panels/ProvidersSettings.tsx:355` | Button outline sm + KeyRound (API key) | Button outline m iconLeft=KeyRound | exemplar |
| `panels/ModelsSettings.tsx:117` | Button ghost sm (Retry) | Button ghost m |  |
| `panels/GithubSettings.tsx:37` | Button outline sm, RefreshCw spinning while refreshing, disabled={refreshing} | Button outline m iconLeft=RefreshCw loading={refreshing} | unused cn import removed |
| `panels/FeedbackSettings.tsx:17` | <a> buttonVariants() (old default/default) + size-14 icon | <a> buttonVariants primary l, self-start | icon size class removed (component sizes svg) |
| `panels/NotificationsSettings.tsx:109` | Button outline sm (Allow in browser) | Button outline m |  |
| `panels/ModelContextSettings.tsx:279` | Button ghost sm (Retry) | Button ghost m | disabled={pending} kept (no spinner before) |
| `panels/AppearanceSettings.tsx:99` | Button outline default + className h-32 justify-between, ChevronDown size-16 child (DropdownMenuTrigger asChild) | Button outline l iconRight=ChevronDown | select-like trigger; h-32/justify-between removed (content-sized in SettingsRow control slot, so justify-between had no effect); truncate label span kept |
| `panels/McpSettings.tsx:303` | Button ghost sm (secondary row action) | Button ghost m |  |
| `panels/McpSettings.tsx:315` | Button (review\|sign-in ? default : outline) sm | Button (review\|sign-in ? primary : outline) m |  |
| `panels/McpSettings.tsx:335` | IconTooltip > DropdownMenuTrigger asChild > Button ghost icon + aria-label (More for …) | DropdownMenuTrigger asChild > IconButton ghost m icon=MoreVertical label='More for …' |  |
| `panels/McpSettings.tsx:439` | IconTooltip > Button ghost icon className size-20, Close size-12 (revoke always-allowed tool) | IconButton ghost s icon=Close label='Ask again before … in this project' | disabled={inert} kept |
| `panels/McpSettings.tsx:618` | Button outline sm + Plus (empty-state preset Add) | Button outline m iconLeft=Plus |  |
| `panels/McpSettings.tsx:632` | Button default sm + Plus (Add a server) | Button primary m iconLeft=Plus |  |
| `panels/McpSettings.tsx:642` | Button outline sm (Import mcpServers JSON) | Button outline m |  |
| `panels/McpSettings.tsx:905` | Button default sm + Plus (Add server) | Button primary m iconLeft=Plus |  |
| `panels/McpSettings.tsx:945` | Button outline sm (Retry) | Button outline m |  |
| `panels/TemplatesSettings.tsx:198` | Button soft sm + Plus (New, project) | Button soft-primary m iconLeft=Plus |  |
| `panels/TemplatesSettings.tsx:281` | Button soft sm + Plus (New, global) | Button soft-primary m iconLeft=Plus |  |
| `panels/TemplatesSettings.tsx:298` | Button outline sm + MagicWand (Add starter templates) | Button outline m iconLeft=MagicWand | disabled={adding} kept |
| `panels/TemplatesSettings.tsx:392` | IconTooltip > raw button size-24 muted ghost (Open as file) | IconButton ghost m icon=FileText label='Open as file' |  |
| `panels/TemplatesSettings.tsx:399` | IconTooltip > raw button size-24 muted ghost (Edit) | IconButton ghost m icon=Pencil label='Edit' |  |
| `panels/JetBrainsAiCard.tsx:238` | Button default sm disabled + spinning Loader2 + '{action}…' (jetbrains-configuring) | Button primary m iconLeft=Loader2 loading | iconLeft is required so the spinner takes the icon slot and the '{action}…' label stays visible (loading without an icon hides the label); renders loading skin instead of disabled skin |
| `panels/JetBrainsAiCard.tsx:251` | Button default sm + RefreshCw (Retry) | Button primary m iconLeft=RefreshCw |  |
| `panels/JetBrainsAiCard.tsx:267` | Button ghost sm + RefreshCw (Recheck, header) | Button ghost m iconLeft=RefreshCw |  |
| `panels/JetBrainsAiCard.tsx:325` | ActionButton: Button (disconnect ? outline : default) sm + conditional LogOut/Wrench/Play icon | Button (disconnect ? outline : primary) m, conditional iconLeft | iconLeft passed only when an icon exists (exactOptionalPropertyTypes) |
| `panels/JetBrainsAiCard.tsx:356` | Button ghost sm self-start + RefreshCw (Recheck, install body) | Button ghost m iconLeft=RefreshCw self-start |  |
| `panels/JetBrainsAiCard.tsx:444` | SignInButton: Button soft sm self-start, ExternalLink swapped for spinning Loader2 while signingIn, disabled={signingIn} | Button soft-primary m iconLeft=ExternalLink loading={signingIn} self-start |  |
| `panels/JetBrainsAiCard.tsx:564` | raw button size-24 muted ghost, aria-label 'Copy: cmd', title 'Copy', Copy/Check(text-feedback-success) swap | IconButton ghost m icon={copied ? CopiedCheck : Copy} label='Copy: cmd' tooltip='Copy' shrink-0 | native title became the tooltip; small local CopiedCheck component keeps the green success check colour |
| `panels/McpServerDialogs.tsx:246` | Button ghost icon aria-label Remove + Trash2 | IconButton ghost m icon=Trash2 label='Remove' | now also shows a 'Remove' tooltip (IconButton label is the tooltip) |
| `panels/McpServerDialogs.tsx:255` | Button ghost sm self-start + Plus (Add header/variable) | Button ghost m iconLeft=Plus self-start |  |
| `panels/McpServerDialogs.tsx:487` | Button outline sm + Plus (preset Add/Added) | Button outline m iconLeft=Plus |  |
| `panels/McpServerDialogs.tsx:525` | Button outline sm (Use recipe) | Button outline m |  |
| `panels/McpServerDialogs.tsx:760,763,773,777,781,920,923,933,936,1062,1065,1156,1224` | dialog footer Button default/outline at default size (32) | Button primary l / outline l (via component defaults) | no source change needed: old default variant/size map 1:1 to the new defaults primary/l; disabled={saving…} kept (no spinner before) |
| `panels/SubagentSettings.tsx SourceTag 'Custom ↺'` | raw accent-text link-action tag | Button soft-primary s iconRight=RiArrowGoBackLine | green → soft-primary |
| `panels/EnvironmentSettings.tsx:196` | Button ghost icon, Eye/EyeOff swap, aria-label Show/Hide value | IconButton ghost m icon={shown ? EyeOff : Eye} label=Show/Hide value | added on main after this change branched (#912); now also shows the label as a tooltip |
| `panels/EnvironmentSettings.tsx:207` | Button ghost icon aria-label Remove + Trash2 | IconButton ghost m icon=Trash2 label='Remove' | added on main (#912) |
| `panels/EnvironmentSettings.tsx:232` | Button ghost sm self-start + Plus (Add variable) | Button ghost m iconLeft=Plus self-start | added on main (#912) |

## chat (29 sites)

| Site | Before | After | Notes |
| --- | --- | --- | --- |
| `chat/QueueStrip.tsx:47` | raw icon button size-20 rounded-xs neutral hover (Pencil size-12) | IconButton ghost s | aria-label -> label (now also tooltip); data-testid kept; shrink-0 kept |
| `chat/QueueStrip.tsx:56` | raw icon button size-20 rounded-xs neutral hover (X size-12) | IconButton ghost s | same as edit |
| `chat/CopyButton.tsx:20` | raw icon button h-lh w-24 muted, hover wash, hover-reveal, native title | IconButton ghost s | h-lh ≈ 20px → s (m overflowed the message line); icon swaps Copy/Check via icon prop; title -> tooltip (label); data-copied kept; hover-reveal opacity-0 group-hover/focus-visible/data-[copied]:opacity-100 kept; caller layout classes (absolute z-10 position) still passed through |
| `chat/SkillsButton.tsx:18` | raw text button px-8 py-2 tr-text-metadata muted, neutral hover (~19px), BookOpen size-14 | Button ghost s iconLeft=BookOpen | kept IconTooltip wrapper (text button with tooltip), data-testid/data-stale, stale badge dot child; className prop still merged (NewWorkspaceDialog passes ml-auto) |
| `chat/ChatTranscript.tsx:698` | raw text button border-border-default bg-container-elevated-bg px-8 py-4 tr-text-metadata (~25px) + shadow-md, floating | Button outline m iconLeft=ArrowUp\|ArrowDown | positioning kept (-translate-x-1/2 absolute bottom-12 left-1/2); shadow-[var(--shadow-md)] dropped as non-layout — floating button no longer has elevation shadow |
| `chat/SkillsDialog.tsx:252` | Button outline sm (Reload, RefreshCw child) | Button outline m iconLeft=RefreshCw | IconTooltip wrapTrigger kept (disabled while streaming) |
| `chat/SkillsDialog.tsx:293` | Button outline sm (Trust project) | Button outline m |  |
| `chat/SkillsDialog.tsx:410` | Button default sm (Enable, ShieldCheck child) | Button primary m iconLeft=ShieldCheck |  |
| `chat/ToolResultImages.tsx:30` | raw icon button border-border-default bg-container-elevated-bg p-4, icon 14 (~24px), native title 'Full screen' | IconButton outline m | label = old aria-label, tooltip = old title; still the DialogTrigger asChild child; absolute top-4 right-4 kept |
| `chat/ModelEffortPicker.tsx:428` | raw icon toggle size-16, text-feedback-warning when pinned else subtle + hover-reveal | IconButton ghost s selected={favorite} | aria-pressed kept + selected; Star fill/line swap via icon prop; mt-2 shrink-0 + hover-reveal (only when not pinned) kept; yellow (feedback-warning) pinned colour dropped — pinned now reads via selected skin + filled star; grows 16->20px |
| `chat/ModelEffortPicker.tsx:658` | raw outline-look button control-border/control-bg px-8 py-4 tr-text-metadata (~25px), RefreshCw animate-spin while refreshing | Button outline m iconLeft=RefreshCw loading={refreshing} | manual spin replaced by loading; 'Updating…' label swap, disabled={refreshing}, data-refreshing kept |
| `chat/promptImages.tsx:206` | raw icon button (remove image), no padding, X size-12, muted->default | IconButton ghost s | now has tooltip 'Remove image'; 20px square inside FileChip trailing slot makes the image chip ~30px tall instead of ~25px (see decisions) |
| `chat/TemplateEditorDialog.tsx:219` | Button outline default-size | Button outline l | no code change needed (default size is l) |
| `chat/TemplateEditorDialog.tsx:226` | Button default default-size | Button primary l | no code change needed (defaults) |
| `chat/ModelSelector.tsx:130` | raw icon toggle size-16, text-feedback-warning when pinned else subtle + hover-reveal | IconButton ghost s selected={isPinned} | same as ModelEffortPicker favorite toggle (warning colour dropped) |
| `chat/ModelSelector.tsx:248` | raw outline-look button px-8 py-4 tr-text-metadata + shadow-sm, RefreshCw animate-spin | Button outline m iconLeft=RefreshCw loading={refreshing} | pointer-events-auto kept (needed inside pointer-events-none gradient footer); shadow-sm dropped |
| `chat/ChatView.tsx:855` | Button ghost default-size | Button ghost l | no code change needed |
| `chat/ChatView.tsx:858` | Button default default-size | Button primary l | no code change needed |
| `chat/ExtUiPrompt.tsx:157` | Button outline sm + OPTION_BUTTON (h-auto min-h-28 justify-start whitespace-normal break-words py-4 text-left) | Button outline m className=max-w-full | OPTION_BUTTON reduced to layout-only 'max-w-full' |
| `chat/ExtUiPrompt.tsx:174` | Button outline sm + OPTION_BUTTON (Cancel) | Button outline m className=max-w-full |  |
| `chat/ExtUiPrompt.tsx:183` | Button default sm + OPTION_BUTTON (OK/Submit) | Button primary m className=max-w-full |  |
| `chat/turns.tsx:584` | Button outline sm (Try again, RotateCw child) | Button outline m iconLeft=RotateCw |  |
| `chat/Composer.tsx:661` | Button ghost icon rounded-full under IconTooltip 'Search history' | IconButton ghost m label='Search history' | IconTooltip wrapper folded into IconButton; aria-label same text; circle -> 24px square |
| `chat/Composer.tsx:673` | raw STOP_PILL: h-28 rounded-full ghost pill, tr-text-action muted, hover wash, StopFill size-12; @max-md square 28 icon | Button ghost m iconLeft=StopFill className=shrink-0 | STOP_PILL constant removed; aria-label='Stop' kept; WIDE_ONLY label span kept as child; compact (@max-md) mode is now a 24px-high ~34px-wide icon-only button, no longer a 28px circle |
| `chat/HistoryOverlay.tsx:168` | raw icon button p-4 icon 14 (~22px) muted, hover elevated-bg, hover-reveal, IconTooltip | IconButton ghost s | label='Save as template', tooltip='Save as template (shortcut)'; opacity reveal + isSelected opacity-100 kept |
| `chat/HistoryOverlay.tsx:194` | raw icon button p-4 icon 14 (~22px) muted, hover-reveal, IconTooltip '⇧⏎ go to chat' | IconButton ghost s | label='Go to chat', tooltip='⇧⏎ go to chat' |
| `chat/TodoList.tsx:124` | raw icon button size-24 muted neutral hover, IconTooltip | IconButton ghost m | label='Open the plan page', tooltip kept; no-op focus-visible:opacity-100 dropped (button was never hidden) |
| `chat/TodoList.tsx:427` | raw icon button p-2 icon 14 (~18px) muted, hover control-bg-selected, hover-reveal, IconTooltip | IconButton ghost s | opacity-0 group-hover:opacity-100 focus:opacity-100 kept; unused IconTooltip import removed |
| `chat/ExtUiPrompt.tsx options` | Button outline sm (+ wrapping overrides) | Button outline m; select options keep a documented wrapping override | guard OVERRIDES entry |

## tools (11 sites)

| Site | Before | After | Notes |
| --- | --- | --- | --- |
| `chat/tools/AskUserQuestionCard.tsx:667` | raw <button> ask-skip: transparent, text-text-muted, hover text-default, px-4 tr-text-ui (~18px) | Button ghost l | size l via sizeException (footer pair with Next/Submit); disabled={!actions} kept; className shrink-0 |
| `chat/tools/AskUserQuestionCard.tsx:678` | raw <button> ask-continue: bg-control-primary-bg px-12 py-8 tr-text-action (~34px) | Button primary l | label 'Next →' kept; className shrink-0 |
| `chat/tools/AskUserQuestionCard.tsx:688` | raw <button> ask-submit: bg-control-primary-bg px-12 py-8 + disabled skin (~34px) | Button primary l | disabled={!canSubmit} kept; disabled:cursor-not-allowed skin dropped (component owns disabled) |
| `chat/tools/AskUserQuestionCard.tsx:1012` | raw <button> ask-note-toggle: transparent text-text-muted tr-text-metadata, hover text-default, Pencil size-12 (~15px) | Button ghost s iconLeft=Pencil | aria-label kept; audit family link-action but not underlined/not prose — looks like a ghost text button with icon |
| `chat/resources/ResourcesButton.tsx:35` | Button ghost sm + h-panel-header-control (24px) gap-4 tr-text-metadata aria-expanded:bg-control-bg-selected, icon child size-14 with motion-safe:animate-working when live | Button ghost m iconLeft={Stack icon} selected={open} | aria-expanded:bg-control-bg-selected replaced by selected={open}; breathing animation kept via module-level icon wrappers (breathing(RiStackFill/RiStackLine)) since iconLeft takes a component; IconTooltip wrapTrigger, aria-*, data-* kept |
| `chat/resources/CommandLogView.tsx:23` | Button ghost sm (28) | Button ghost m |  |
| `chat/resources/ResourcesInspector.tsx:298` | raw <button> resources-inspector-close: size-28 ghost-like, RiCloseLine size-16, aria-label 'Close resources', no tooltip | IconButton ghost m icon=RiCloseLine label='Close resources' | now gains a 'Close resources' tooltip (IconButton label = tooltip) |
| `chat/resources/ResourcesInspector.tsx:333` | Button outline sm (28) resources-retry | Button outline m |  |
| `chat/resources/ResultRow.tsx:163` | raw <button> background-result-open: transparent text-primary px-4 py-2 tr-text-metadata (~19px), hover fill, RiFileList3Line size-12 | Button soft-primary s iconLeft=RiFileList3Line | green ghost; className shrink-0 |
| `chat/resources/mcpRow.tsx:119` | raw <button> resource-mcp-<id>: transparent text-primary px-4, hover:bg-control-bg, inherited tr-text-metadata (~15px) | Button soft-primary s | green ghost; disabled condition and aria-describedby kept; disabled:hover:bg-transparent dropped |
| `chat/resources/mcpRow.tsx:164` | raw <button> resources-mcp-settings: transparent text-primary px-4 tr-text-metadata, hover:bg-control-bg (~15px) | Button soft-primary s | green ghost |

## workbench (17 sites)

| Site | Before | After | Notes |
| --- | --- | --- | --- |
| `panels/HeaderIconButton.tsx` | raw icon button (children icon), active state | IconButton ghost m, active → selected + aria-pressed | children API replaced by icon prop at all 10 call sites (DiffPane, ChangesReviewPane, ChangesFileSection) |
| `panels/DiffPane.tsx diff-copy` | HeaderIconButton with Check/Copy children | HeaderIconButton icon={copied ? CopiedCheck : Copy} | success-tinted check kept |
| `panels/ChangesReviewGuide.tsx` | raw prev/next/apply buttons, bg-primary next, outline prev/apply (24px) | IconButton outline m (prev) · Button primary m iconRight (next) · Button outline m iconLeft (Apply fixes) · Button primary s (empty-state action) | title restored on Apply fixes |
| `panels/ChangesReviewPane.tsx` | raw retry (quiet text), Viewed toggle with border-primary when on, HeaderIconButtons | Button ghost s (retry) · Button outline m iconLeft=Check selected={viewed} · HeaderIconButton icon= | viewed = persistent selected state, not pressed |
| `panels/TerminalWorkbench.tsx terminal-add` | raw icon button | IconButton outline s label='New terminal' | position classes only |
| `panels/TerminalInstance.tsx` | raw outline-ish 24px buttons | Button outline m |  |
| `panels/PlanPane.tsx plan-next-action-go ×5` | NEXT_ACTION_BUTTON_CLASS (primary fill, 28px) | Button primary m | 28 → 24 (tie rule n/a: nearest is 24/32 → 24); local class constant removed |
| `panels/PlanPane.tsx plan-start-review` | raw primary 24px, hover-revealed | Button primary m | reveal opacity classes kept (allowed) |
| `panels/PlanPane.tsx plan-add-task` | raw quiet 24px with Plus | Button ghost m iconLeft=Plus |  |
| `panels/PlanPane.tsx plan-review-comments` | raw quiet 32px | Button ghost l iconLeft=MessageSquare |  |
| `panels/PlanPane.tsx plan-pr-chip (<a>)` | <a> quiet 32px | <a> buttonVariants ghost l | stays a link |
| `panels/PlanPane.tsx plan-open-pr` | raw 32px, primary or quiet by state, Loader2 swap | Button primary\|ghost l iconLeft=GitPullRequestArrow loading={prBusy} | manual spinner swap replaced by loading |
| `panels/SendReviewButton.tsx` | raw primary h-panel-header-control (24px), busy → disabled | Button primary m iconLeft=Send loading={busy} |  |
| `panels/ChangesPanel.tsx changes-retry` | raw quiet text | Button ghost s |  |
| `panels/DiffSurface.tsx diff-open-file` | Button ghost sm | Button ghost m |  |
| `panels/SpecsPanel.tsx specs-retry` | Button ghost sm + RefreshCw child | Button ghost m iconLeft=RefreshCw |  |
| `panels/ReviewPanel.tsx review-comment-send / -file / -chat` | raw bare icon buttons + IconTooltip | IconButton ghost s (label = tooltip) |  |

## renderers (31 sites)

| Site | Before | After | Notes |
| --- | --- | --- | --- |
| `packages/resource-renderers/src/support/ReviewComposer.tsx:106` | raw <button> .review-composer-btn tr-text-action (Save draft; elevated bg + border-default, py-2 px-8 ≈ 21.6px) | Button outline s | disabled condition, data-testid, onClick kept |
| `packages/resource-renderers/src/support/ReviewComposer.tsx:115` | raw <button> .review-composer-btn-primary (Send now; bg-primary + text-on-primary, ≈21.6px) | Button primary s | Hover now uses control-primary-bg-hovered with control-primary-text, so the label stays legible (old .review-composer-btn:hover repainted background to control-bg-hovered while keeping text-on-primary) |
| `packages/resource-renderers/src/support/ReviewComposer.tsx:124` | raw <button> .review-composer-btn-quiet (Cancel; transparent, text-subtle, ≈21.6px) | Button ghost s |  |
| `packages/resource-renderers/src/support/ReviewThreadCard.tsx:102` | IconTooltip wrapTrigger + raw <button> .review-thread-action (20px, transparent, text-subtle) send | IconButton ghost s (wrapTrigger) | disabled:pointer-events-none dropped (component owns disabled skin) |
| `packages/resource-renderers/src/support/ReviewThreadCard.tsx:118` | IconTooltip wrapTrigger + raw <button> .review-thread-action delete | IconButton ghost s (wrapTrigger) |  |
| `packages/resource-renderers/src/renderers/pdf/PdfToolbar.tsx:24` | Button ghost icon (28) Previous page | IconButton ghost m | aria-label → label (now also a tooltip) |
| `packages/resource-renderers/src/renderers/pdf/PdfToolbar.tsx:33` | Button ghost icon Next page | IconButton ghost m |  |
| `packages/resource-renderers/src/renderers/pdf/PdfToolbar.tsx:39` | Button ghost icon Zoom out | IconButton ghost m | icon 14 → 16 (component-owned) |
| `packages/resource-renderers/src/renderers/pdf/PdfToolbar.tsx:43` | Button ghost icon Zoom in | IconButton ghost m | icon 14 → 16 |
| `packages/resource-renderers/src/renderers/image/View.tsx:85` | Button ghost icon Fit image | IconButton ghost m | data-testid image-fit kept |
| `packages/resource-renderers/src/renderers/image/View.tsx:91` | Button ghost icon with text span '1:1' (28 square) | Button ghost m (text '1:1', aria-label kept) | Text content cannot be an IconButton icon; now a 24px text button (px-8) instead of a 28 square |
| `packages/resource-renderers/src/renderers/image/View.tsx:100` | Button ghost icon Zoom out | IconButton ghost m |  |
| `packages/resource-renderers/src/renderers/image/View.tsx:104` | Button ghost icon Zoom in | IconButton ghost m |  |
| `packages/resource-renderers/src/renderers/json/JsonTree.tsx:73` | Button ghost icon className size-24 shrink-0 (expand/collapse node) | IconButton ghost m className shrink-0 | aria-expanded kept; icon swaps ChevronDown/ChevronRight via icon prop; now has a tooltip (see openIssues: mcpCards.test.ts) |
| `packages/resource-renderers/src/renderers/code/PierreFile.tsx:166` | IconTooltip + raw <button> size-24 bg-primary text-on-primary (review-add-icon gutter) | IconButton primary m | onPointerDown/onClick kept |
| `packages/resource-renderers/src/renderers/code/PierreDiff.tsx:156` | IconTooltip + raw toggle <button> h-24 px-8 tr-text-metadata, kept → text-feedback-success (hunk-keep) | Button ghost m iconLeft=Check selected={kept} | aria-pressed kept + selected={kept}; the green 'kept' text colour is replaced by the shared selected skin; IconTooltip kept around the Button |
| `packages/resource-renderers/src/renderers/code/PierreDiff.tsx:170` | IconTooltip + raw <button> size-24 ghost (hunk-revert) | IconButton ghost m | disabled={reverting} kept (old code had no spinner, so no loading) |
| `packages/resource-renderers/src/renderers/code/PierreDiff.tsx:177` | IconTooltip + raw <button> size-24 ghost (hunk-ask-agent) | IconButton ghost m |  |
| `packages/resource-renderers/src/renderers/code/PierreDiff.tsx:428` | IconTooltip + raw <button> size-24 bg-primary (review-add-icon gutter) | IconButton primary m |  |
| `packages/resource-renderers/src/renderers/RegionReviewSurface.tsx:218` | IconTooltip + raw <button> absolute size-24 bg-primary (review-add-icon on region) | IconButton primary m className 'pointer-events-auto absolute -right-12 -bottom-12' |  |
| `packages/resource-renderers/src/renderers/notebook/Diff.tsx:76` | IconTooltip + raw <button> size-24 ghost (notebook-comment-cell-${side}) | IconButton ghost m |  |
| `packages/resource-renderers/src/renderers/notebook/View.tsx:108` | IconTooltip + raw <button> size-24 ghost (notebook-comment-cell) | IconButton ghost m |  |
| `packages/resource-renderers/src/support/UnplacedReviewStrip.tsx:92` | raw <button> ml-12 px-8 py-4 tr-text-action text-primary hover:bg-control-bg-hovered (≈23.6px) | Button soft-primary m className ml-12 | green ghost |
| `packages/resource-renderers/src/support/ExpensiveDiffNotice.tsx:18` | Button outline sm | Button outline m |  |
| `packages/resource-renderers/src/support/PreviewCommenting.tsx:197` | portal raw <button> .review-add-icon .review-add-icon-float (22px, border-default, elevated bg, primary icon, drop shadow, native title) | IconButton outline s className review-add-icon-float | title → IconButton tooltip (same text as label); ref kept; the .closest('.review-add-icon') pointerdown check now uses iconRef.current.contains(target); review-add-icon-float (fixed positioning + imperative data-visible/data-dragging visibility) kept as layout class. Skin differences vs old: icon now text-default instead of primary, no drop shadow |
| `thinkrail-extensions/visualize/web/MermaidView.tsx:67` | raw <button> absolute p-4 border-default elevated bg text-muted (≈24px), title 'Full screen' | IconButton outline m className 'absolute top-4 right-4', tooltip 'Full screen' | aria-label 'View diagram full screen' → label |
| `thinkrail-extensions/visualize/web/PanZoomView.tsx:121` | raw <button className={btn}> p-4 ghost, icon 16 (24px) Zoom out | IconButton ghost m | local btn const removed; now has tooltip |
| `thinkrail-extensions/visualize/web/PanZoomView.tsx:133` | raw btn Zoom in (24px) | IconButton ghost m |  |
| `thinkrail-extensions/visualize/web/PanZoomView.tsx:139` | raw btn Reset zoom, icon 14 (22px) | IconButton ghost m | see sizeExceptions |
| `thinkrail-extensions/visualize/web/FileCard.tsx:44` | CardAction: IconTooltip + raw <button> size-24 ghost (children icon element) | IconButton ghost m | CardAction now takes icon: ButtonIcon instead of children; both call sites (tool-visualize-open-tab, tool-visualize-fullscreen) updated |
| `packages/resource-renderers/src/support/reviewWidgets.ts review-add-icon / thread actions (plain DOM)` | .review-add-icon / .review-thread-action CSS skins | buttonVariants({variant:'outline', size:'s', shape:'icon'}) class string + data-slot/variant/size | index.css rules removed; holder/float positioning kept |

## Green (accent-text) ghost actions → `soft-primary`

- `shell/LayoutSettings.tsx:268 — Save <preset> name (check icon)`
- `updates/UpdateReadyButton.tsx:85 — Update available / Update ready / … (topbar update affordance)`
- `chat/resources/ResultRow.tsx:163 — Open log / Transcript`
- `chat/resources/mcpRow.tsx:119 — MCP row actions (Disable in this chat / Enable in this chat / Reconnect / Sign in / Review / Edit)`
- `chat/resources/mcpRow.tsx:164 — Settings (MCP servers section header)`
- `packages/resource-renderers/src/support/UnplacedReviewStrip.tsx:92 — Show in {renderer}`
- `panels/SubagentSettings.tsx — SourceTag "Custom ↺" (accent text link-action)`

## Size exceptions

- `chat/tools/AskUserQuestionCard.tsx:667` → `l`: Skip sits in the card footer action pair beside Next/Submit (primary l, 32px); as a ghost it now shows a hover fill, so a 20px Skip next to a 32px primary would misalign the button pair. Nearest-height rule alone would give s (~18px).
- `thinkrail-extensions/visualize/web/PanZoomView.tsx:139` → `m`: Was 22px (tie → s), but it sits in one zoom toolbar with the 24px zoom-out/zoom-in buttons; m keeps the row uniform

## Remaining exceptions (kept as-is, need a variant decision)

- `shell/WorkspaceChatHistory.tsx:208`: red-text action (no variant) — closed-chat-delete turns red on focus (focus:text-feedback-error)
- `shell/LayoutSettings.tsx:297`: red-text action (no variant) — delete preset is red only on hover (hover:bg-feedback-error-subtle hover:text-feedback-error)
- `panels/TemplatesSettings.tsx:402`: red-text action (no variant) — template Delete icon button, muted with hover:text-feedback-error (PopoverTrigger asChild inside IconTooltip wrapTrigger); left unchanged
- `chat/HistoryOverlay.tsx:88`: red-text action (no variant) — history-delete-chat turns text-feedback-error on hover
- `chat/promptImages.tsx:184`: red-text action (no variant) — dismiss inside tone=error FileChip inherits text-feedback-error
- `chat/resources/resourceRow.tsx:267`: red-text action (no variant) — RowActionButton (resource-stop) is ghost with red only on hover (danger); left unchanged as raw <button>
- `chat/resources/ResourcesInspector.tsx:107`: red-text action (no variant) — resource-detail-stop is outline with text-feedback-error. Old props no longer compile, so only the removed size name was translated (sm→m) and the icon moved to iconLeft (gap-4/size-14 dropped); the text-feedback-error colour override was KEPT. Needs a decision (e.g. a destructive-outline/destructive-ghost variant).
- `chat/resources/ResourcesInspector.tsx:279`: red-text action (no variant) — resources-stop-all is ghost icon with text-feedback-error. Old size="icon" no longer compiles, so it became IconButton ghost m (icon=RiStopFill, label = old aria-label/title, native title → tooltip) with the className text-feedback-error hover:text-feedback-error KEPT. Needs a decision.
- `chat/resources/ResourcesButton.tsx:58`: warning-text action (no variant) — ResourcesAttention is ghost icon with text-feedback-warning (amber, analogous to the red-text case). Old size="icon" no longer compiles, so it became IconButton ghost m (label = old IconTooltip label/aria-label) with className shrink-0 text-feedback-warning hover:text-feedback-warning KEPT. Needs a decision.
- `panels/ReviewPanel.tsx review-clear, review-comment-delete`: red-text action (no variant) — red on hover
- `panels/ReviewPanel.tsx review-file-done, review-comment-resolve`: success-tinted hover icon action (no variant)

## Spec overrides retired

- `shell/layout/workbenchCenter.tsx:100,115; workbenchSide.tsx:184,258; workbenchBottom.tsx:64; workbenchTabs.tsx:287; AuxiliaryPaneHeader.tsx:71; WorkspaceWorkbench.tsx:740; WorkspaceChatHistory.tsx:36`: full-height 28px (w-panel-header-row) strip/header actions, several with a border-l hairline divider; now 24px centred squares with no divider (apps/web/src/shell/layout/SPEC.md ('Full-height strip actions share that width.' in Layout grammar))
- `shell/WorkspaceChatHistory.tsx:36`: chat-history trigger 'spins' while a chat starts but stayed clickable; `loading` now also disables it while spinning (apps/web/src/shell/SPEC.md (chat-start pending state paragraph))
- `components/ErrorBoundary.tsx:92,101`: components module now imports @thinkrail/ui/button, which is not in its 'Allowed deps' list (React, @remixicon/react, @thinkrail/ui/utils, lib, constants) (apps/web/src/components/SPEC.md (Allowed deps))
- `chat/Composer.tsx:661`: rounded-full 28px ghost circle (History: `Button variant="ghost" size="icon"` under IconTooltip) (apps/web/src/chat/SPEC.md (Composer trailing controls))
- `chat/Composer.tsx:673`: Stop as rounded-full h-28 ghost pill; compact mode collapses to a 28px icon circle (@max-md:w-28 px-0) (apps/web/src/chat/SPEC.md (Composer trailing controls / Compact mode))
- `chat/ExtUiPrompt.tsx:15`: OPTION_BUTTON h-auto min-h-28 whitespace-normal break-words justify-start text-left py-4 — 'Option buttons wrap long labels' (apps/web/src/chat/SPEC.md (Extension dialogs ask inside the chat))
- `chat/tools/AskUserQuestionCard.tsx:667,678,688,1012`: focus-visible:ring-2 ring-primary focus ring on Skip/Next/Submit/Add note — SPEC says every focus indicator in the card is the app-wide `focus-visible:ring-2` + `ring-primary` ring; the shared Button uses an offset `outline-primary` focus outline instead (still accent) (apps/web/src/chat/tools/SPEC.md ("Every focus indicator in the card is the app-wide accent focus ring"))
- `chat/resources/mcpRow.tsx:164`: SPEC calls the section header's Settings a "link" (`resources-mcp-settings`); it is now a soft-primary s button (wording only) (apps/web/src/chat/resources/SPEC.md (MCP servers paragraph))

## Specialized buttons not converted

| Area | Site | Why |
| --- | --- | --- |
| shell | `auth/LoginDialog.tsx:200` | login-option: full-width selectable option row (audit list-row), like a radio option |
| shell | `auth/LoginDialog.tsx:215` | login-paste-toggle: underlined text link-like action (audit link-action) |
| shell | `shell/WorkspaceChatHistory.tsx:165` | closed-chat-item: menu row (menuItemClass, row-wide click target) |
| shell | `shell/locationBar/BranchSegment.tsx:116` | scope-remote-unpushed: chip (chipClass) |
| shell | `shell/locationBar/BranchSegment.tsx:127` | scope-remote-behind: chip (chipClass) |
| shell | `shell/NativeWindowControls.tsx:33` | native window control (minimize), SPEC-documented 46x40 caption button |
| shell | `shell/NativeWindowControls.tsx:42` | native window control (maximize/restore) |
| shell | `shell/NativeWindowControls.tsx:52` | native window control (close) |
| shell | `shell/JbcentralQuotaIndicator.tsx:41` | 'Quota unavailable · Retry': plain-text topbar status readout acting as a link-like retry (audit link-action); shell SPEC describes it as a readout |
| shell | `shell/JbcentralQuotaIndicator.tsx:87` | stale quota readout: same element as the non-button available readout (span) with identical plain-text styling; a Button would make the readout change geometry between available/stale — treated as a link-like inline action (DECISION NEEDED, audit calls it 'button') |
| shell | `shell/layout/AuxiliaryRail.tsx:51` | edge-rail tool selector: tab grammar turned sideways (roving toolbar, aria-pressed, frame-owned selection fill + accent indicator per shell/layout SPEC) |
| shell | `shell/layout/workbenchTabs.tsx:554` | WorkbenchTab tab button (role=tab) / its rail-mode selector — tab strip |
| shell | `shell/layout/workbenchRails.tsx:101` | rail group selector + drop target (tab-like rail entry, see AuxiliaryRail) |
| shell | `shell/LayoutSettings.tsx:365` | layout-add-new: large clickable card (PopoverTrigger) |
| shell | `shell/LayoutSettings.tsx:459` | layout-advanced-toggle: disclosure header |
| projects | `panels/WelcomePanel.tsx:205` | large clickable Welcome card |
| projects | `panels/ExistingWorktreeDialog.tsx:153` | large clickable candidate card / list row (PROJ-055) |
| projects | `panels/ProjectTree.tsx:434` | settled-shelf-toggle: disclosure header (aria-expanded) |
| projects | `panels/ProjectTree.tsx:459` | settled-shelf-more: full-width list row / link-like action (PROJ-089) |
| projects | `panels/ProjectTree.tsx:549` | project-expand: tree disclosure chevron |
| projects | `panels/ProjectTree.tsx:574` | project-name: tree row click target |
| projects | `panels/ProjectTree.tsx:870` | workspace identity: tree row click target |
| settings | `panels/SettingsDialog.tsx:71` | settings section nav items — tab strip (SET-004) |
| settings | `panels/SettingsDialog.tsx:93` | Feedback nav card: a section-nav entry with selected state that sits in the rail tab list, with wrapping multi-line promo text in the 192px rail; a fixed-height nowrap Button would overflow (SET-005) — needs a decision if it should become a Button |
| settings | `panels/McpSettings.tsx:475` | ExposureMenu trigger styled as a status chip (CHIP_CLASS), select-family (SET-081) |
| settings | `panels/VisibleModelsSettings.tsx:37` | row disclosure header (SET-037) |
| settings | `panels/ModelContextSettings.tsx:315` | row disclosure header 'By each model' (SET-037) |
| settings | `panels/AppearanceSettings.tsx:148` | theme list radio-like options with aria-pressed (SET-054) |
| settings | `panels/AppearanceSettings.tsx:194` | Disclosure header (SET-055) |
| settings | `panels/NotificationsSettings.tsx:21` | 'How to enable' disclosure toggle with aria-expanded (SET-036) |
| settings | `panels/SettingsSwitch.tsx:17` | switch (SET-006) |
| chat | `chat/ReviewPackageComments.tsx:30` | disclosure row toggle (CHAT-029) |
| chat | `chat/assistantLinks.tsx:59` | underlined inline text link in prose (CHAT-041) |
| chat | `chat/ModelEffortPicker.tsx:269` | segmented effort slider option (CHAT-111) |
| chat | `chat/ModelEffortPicker.tsx:630` | FOOTER_LINK link-action per audit (CHAT-112) — see decisions: looks like a ghost s button |
| chat | `chat/ModelEffortPicker.tsx:647` | FOOTER_LINK link-action per audit (CHAT-112) — see decisions |
| chat | `chat/TemplateEditorDialog.tsx:264` | segmented scope option (CHAT-157) |
| chat | `chat/ThinkingSelector.tsx:40` | menu item row (CHAT-121) |
| chat | `chat/activityBreadcrumbs.tsx:115` | expander chevron (rotating) inside composite breadcrumb segment whose wrapper owns the hover fill; disclosure control (CHAT-021) — see decisions |
| chat | `chat/activityBreadcrumbs.tsx:126` | breadcrumb jump link-action (CHAT-022) |
| chat | `chat/ActivityGroup.tsx:208` | disclosure header (CHAT-060) |
| chat | `chat/ActivityGroup.tsx:422` | disclosure header (CHAT-061) |
| chat | `chat/turns.tsx:371` | Show more/less disclosure (CHAT-025) |
| chat | `chat/turns.tsx:408` | disclosure card header (CHAT-027) |
| chat | `chat/turns.tsx:548` | compaction disclosure divider (CHAT-048) |
| chat | `chat/turns.tsx:710` | ArtifactChip chip in turn divider (CHAT-053) |
| chat | `chat/turns.tsx:759` | artifact list row (CHAT-054) |
| chat | `chat/turns.tsx:888` | turn-divider Review chip (CHAT-055) — green-ghost look, see decisions |
| chat | `chat/turns.tsx:905` | turn-divider 'N still running' rounded-full chip (CHAT-056) |
| chat | `chat/Composer.tsx:497` | mention menu item (CHAT-082) |
| chat | `chat/Composer.tsx:521` | slash-templates-empty menu row (CHAT-085) |
| chat | `chat/Composer.tsx:689` | composer send pill main segment chat-send (documented exception) |
| chat | `chat/Composer.tsx:711` | composer send pill chevron segment send-menu (documented exception) |
| chat | `chat/Composer.tsx:729` | send-mode menu row (CHAT-094) |
| chat | `chat/FileChip.tsx:46` | chip (FileChip button branch) |
| chat | `chat/HistoryOverlay.tsx:142` | row-wide click target (PromptRow pick) |
| chat | `chat/HistoryOverlay.tsx:247` | row-wide click target (MessageRow pick) |
| chat | `chat/HistoryOverlay.tsx:589` | full-width border-t footer strip hint (history-expand-hint), row-wide target — see decisions |
| chat | `chat/ToolCard.tsx:59` | disclosure header (CHAT-059) |
| chat | `chat/TodoList.tsx:282` | DoneGroup disclosure (CHAT-168) |
| chat | `chat/TodoList.tsx:324` | text link-action (CHAT-169) |
| chat | `chat/TodoList.tsx:342` | text link-action path (CHAT-170) |
| chat | `prompt/SlashCommandCompletion.tsx:152` | template slot-hint chip (CHAT-086) |
| chat | `prompt/SlashCommandCompletion.tsx:188` | slash command menu item (CHAT-084) |
| tools | `chat/tools/AskUserQuestionCard.tsx:779` | TabChip (ask-tab) — tab strip |
| tools | `chat/tools/AskUserQuestionCard.tsx:1093` | OptionRow (ask-option) — radio/checkbox option card |
| tools | `chat/tools/AskUserQuestionCard.tsx:1174` | OtherOptionRow ask-custom-toggle — checkbox/radio indicator |
| tools | `chat/tools/AskUserQuestionCard.tsx:1299` | ask-unanswered — warning-coloured underlined text link |
| tools | `chat/tools/mcp/McpActions.tsx:33` | CliActionButton (ACTION_CLASS) — accent text link with hover:underline |
| tools | `chat/tools/mcp/McpActions.tsx:86` | mcp-full-output-retry (ACTION_CLASS) — underlined text link inside an error paragraph |
| tools | `chat/tools/mcp/McpActions.tsx:163` | mcp-full-output trigger (ACTION_CLASS) — accent text link with hover:underline |
| tools | `chat/tools/mcp/McpJsonTree.tsx:100` | JSON 'Show all N' — underlined text link inside tree |
| tools | `chat/tools/mcp/McpJsonTree.tsx:130` | JsonBranch — tree disclosure row |
| tools | `chat/tools/mcp/McpJsonTree.tsx:193` | mcp-structured-toggle — disclosure header |
| tools | `chat/tools/mcp/McpResourceCards.tsx:98` | 'Show all N resources' — underlined text link |
| tools | `chat/tools/Collapsible.tsx:34` | collapsible-toggle 'Show all N lines' — underlined text link / disclosure |
| tools | `chat/tools/subagent/AgentCard.tsx:75` | agent-report-toggle — disclosure (chevron swap) styled as underlined link |
| tools | `chat/tools/subagent/AgentCard.tsx:98` | agent-open-transcript — accent underlined text link |
| tools | `chat/tools/ToolFileLink.tsx:39` | ToolFileLink — file text link (truncating, hover:underline) |
| tools | `chat/resources/resourceRow.tsx:431` | resource-inspect — row-wide click target (name + activity) |
| tools | `chat/resources/ResultRow.tsx:146` | background-result-toggle — disclosure header / row-wide click target |
| tools | `chat/resources/ResourcesDock.tsx:70` | resources-dock-toggle — full-width disclosure summary row |
| workbench | `panels/planFileRow.tsx, TreeRow.tsx, ChangesPanel.tsx change-item, ReviewPanel.tsx review-file-row / review-comment-open, SpecsPanel.tsx spec-node` | list/tree rows — row-wide click targets |
| workbench | `panels/PlanPane.tsx plan-change-set-toggle, plan-item-toggle; ChangesFileSection.tsx changes-section-toggle; SpecsPanel.tsx spec-toggle` | disclosures |
| workbench | `panels/PlanPane.tsx plan-commit-chip, revision chip` | chips |
| workbench | `panels/PlanPane.tsx plan-item-changes-requested, plan-now-status ×2; ChangesFileSection.tsx expand/retry links` | inline text link-actions |
| workbench | `panels/PlanPane.tsx plan-now-idle` | full-width row affordance |
| workbench | `panels/ChangesFileSection.tsx changes-section-viewed` | checkbox (role/aria-checked) |
| renderers | `packages/resource-renderers/src/renderers/VisualDiff.tsx:256` | swipe divider / splitter (resize-handle class of control) |
| renderers | `packages/resource-renderers/src/renderers/code/PierreDiff.tsx:473` | 'Dismiss' underline-on-hover text link action inside the blocked-selection notice |
| renderers | `packages/resource-renderers/src/renderers/json/JsonTree.tsx:83` | tree row select click target (node label) |
| renderers | `packages/resource-renderers/src/renderers/json/JsonTree.tsx:97` | numbered comment marker pin (rounded-full 20px badge), not an action button |
| renderers | `packages/resource-renderers/src/renderers/csv/Diff.tsx:216` | CSV cell selection click target |
| renderers | `packages/resource-renderers/src/renderers/csv/Diff.tsx:240` | numbered comment marker pin (badge) |
| renderers | `packages/resource-renderers/src/renderers/csv/View.tsx:110` | CSV cell selection click target |
| renderers | `packages/resource-renderers/src/renderers/csv/View.tsx:120` | numbered comment marker pin (badge) |
| renderers | `packages/resource-renderers/src/renderers/RegionReviewSurface.tsx:199` | numbered region comment marker pin (rounded-full 24px badge on the region corner) |
| renderers | `packages/resource-renderers/src/support/ReviewThreadCard.tsx:83` | thread anchor label link-action (eyebrow text, activates the anchor) |
| renderers | `packages/resource-renderers/src/support/markdownLinks.tsx:142` | document file link styled as underlined link text (SPEC: 'a button styled as document-link text') |
| renderers | `packages/resource-renderers/src/support/RenderedDiff.tsx:186` | full-width disclosure for a collapsed hidden run (rendered-diff-collapsed) |
| renderers | `thinkrail-extensions/visualize/web/FileCard.tsx:22` | FileLink: inline path text link (hover underline) |

## Second pass — button-like controls moved onto the system

| Site | Before | After |
| --- | --- | --- |
| `chat/turns.tsx` `turn-divider-<kind>` (artifact chip) | transparent accent-text chip, `px-4`, hover wash, expanded = selected fill | `Button soft-primary s` (`iconLeft` kind icon, `iconRight` chevron when it lists several) |
| `chat/turns.tsx` `turn-divider-review` | transparent accent-text chip | `Button soft-primary s` `iconLeft={Eye}` |
| `chat/turns.tsx` `turn-divider-running` | `rounded-full` accent-tint pill | `Button soft-primary s`, the working animation kept on the icon |
| `panels/ChangesFileSection.tsx` `changes-section-toggle` | hand-rolled 20px ghost chevron | `IconButton ghost s` (`aria-expanded` kept) |
| `panels/ChangesFileSection.tsx` `changes-section-viewed` | hand-rolled 24px ghost + drawn checkbox square | `Button ghost m` `selected` + `aria-pressed`, Remix checkbox icons |
| `panels/ChangesFileSection.tsx` `changes-section-menu` | hand-rolled 24px ghost menu trigger | `DropdownMenuTrigger asChild` → `IconButton ghost m` |
| `panels/ChangeRowActions.tsx` `change-row-menu` | hand-rolled 20px hover-revealed trigger | `IconButton ghost s` (reveal kept) |
| `panels/PlanPane.tsx` `plan-menu` | hand-rolled 32px ghost trigger | `IconButton ghost l` |
| `panels/ChangesScopeMenu.tsx` `changes-scope-trigger` | hand-rolled 24px ghost text trigger | `Button ghost m` (`iconLeft` GitCompare, `iconRight` chevron) |
| `panels/PlanCommitsMenu.tsx` `plan-commits-trigger` | hand-rolled 24px ghost text trigger | `Button ghost m` |
| `chat/ModelEffortPicker.tsx` `model-set-default`, `thinking-reset` | `FOOTER_LINK` ghost text buttons | `Button ghost s` (the constant removed) |
| `prompt/SlashCommandCompletion.tsx` `slot-hint` | bordered elevated hint button | `Button outline s` + elevation shadow token |

Not moved, by design: model / thinking selector triggers (select family, `data-[open]` border), the history scope chip, and every red / amber / green-text action (no variant yet).

## Remaining raw `<button>` elements (current code)

Generated from the working copy (raw `<button>` outside `packages/ui`; `web/` = apps/web/src, `rr/` = packages/resource-renderers/src, `ext/` = thinkrail-extensions): 123 elements, grouped by why they are not `Button` / `IconButton`.

### Panel tool rails — on the button system (ghost M skin via `buttonVariants`), raw element kept (3)

_Why:_ roving toolbar, drag-and-drop targets and adornments live on the element; it wears the shared skin and `data-selected` for the open panel.

- `web/shell/layout/AuxiliaryRail.tsx:76` `tool-rail-${entry.tool`
- `web/shell/layout/workbenchRails.tsx:127`
- `web/shell/layout/workbenchTabs.tsx:589`

### Red / amber / green-text actions — need a variant decision (10)

_Why:_ no variant carries a coloured label on a transparent surface.

- `web/chat/HistoryOverlay.tsx:102` `history-delete-chat`
- `web/chat/promptImages.tsx:187`
- `web/chat/resources/resourceRow.tsx:272` `testId`
- `web/panels/ReviewPanel.tsx:144` `review-clear`
- `web/panels/ReviewPanel.tsx:203` `review-file-done`
- `web/panels/ReviewPanel.tsx:463` `review-comment-delete`
- `web/panels/ReviewPanel.tsx:488` `review-comment-resolve`
- `web/panels/TemplatesSettings.tsx:430` `template-delete`
- `web/shell/LayoutSettings.tsx:303`
- `web/shell/WorkspaceChatHistory.tsx:216` `closed-chat-delete`

### Split action pills — documented exceptions (3)

_Why:_ two-part pills with their own tones: the composer send pill (chat/SPEC.md, Composer trailing controls) and the topbar ship split action (primary / warning tone + menu half), which no single Button variant expresses.

- `web/chat/Composer.tsx:686` `chat-send`
- `web/chat/Composer.tsx:710` `send-menu`
- `web/shell/locationBar/ShipSegments.tsx:90` `${testid`

### Tabs and navigation (3)

_Why:_ selection grammar of a tab strip / nav list.

- `web/chat/tools/AskUserQuestionCard.tsx:783` `ask-tab`
- `web/panels/SettingsDialog.tsx:74` `settings-nav-${id`
- `web/panels/SettingsDialog.tsx:96` `settings-nav-feedback`

### Options, segmented controls, checkbox, switch (9)

_Why:_ radio / checkbox / switch semantics.

- `web/chat/ModelEffortPicker.tsx:273` `thinking-option`
- `web/chat/TemplateEditorDialog.tsx:272` `template-scope-${id`
- `web/chat/ThinkingSelector.tsx:43` `thinking-option`
- `web/chat/tools/AskUserQuestionCard.tsx:1104` `ask-option`
- `web/chat/tools/AskUserQuestionCard.tsx:1186` `ask-custom-toggle`
- `web/panels/AppearanceSettings.tsx:169` `theme-option-${id`
- `web/panels/MergePrDialog.tsx:69`
- `web/panels/PrComposeDialog.tsx:81`
- `web/panels/SettingsSwitch.tsx:17` `testId`

### Disclosures (26)

_Why:_ full-width or inline expand/collapse headers and "show more" toggles.

- `web/chat/ActivityGroup.tsx:212` `${testId`
- `web/chat/ActivityGroup.tsx:428` `activity-step-toggle`
- `web/chat/HistoryOverlay.tsx:608` `history-expand-hint`
- `web/chat/ReviewPackageComments.tsx:30` `review-package-item-toggle`
- `web/chat/TodoList.tsx:293` `todo-group-done`
- `web/chat/ToolCard.tsx:61` `tool-card-toggle`
- `web/chat/activityBreadcrumbs.tsx:117`
- `web/chat/resources/ResourcesDock.tsx:72` `resources-dock-toggle`
- `web/chat/resources/ResultRow.tsx:150` `background-result-toggle`
- `web/chat/tools/Collapsible.tsx:36` `collapsible-toggle`
- `web/chat/tools/mcp/McpJsonTree.tsx:196` `mcp-structured-toggle`
- `web/chat/tools/subagent/AgentCard.tsx:76` `agent-report-toggle`
- `web/chat/turns.tsx:381` `user-message-toggle`
- `web/chat/turns.tsx:419` `skill-invocation-toggle`
- `web/chat/turns.tsx:575`
- `web/panels/AppearanceSettings.tsx:215` `testId`
- `web/panels/ModelContextSettings.tsx:340` `model-context-customize`
- `web/panels/NotificationsSettings.tsx:23`
- `web/panels/PlanPane.tsx:109` `plan-change-set-toggle`
- `web/panels/PlanPane.tsx:335` `plan-item-toggle`
- `web/panels/ProjectTree.tsx:437` `settled-shelf-toggle`
- `web/panels/ProjectTree.tsx:563` `project-expand`
- `web/panels/SpecsPanel.tsx:156` `spec-toggle`
- `web/panels/VisibleModelsSettings.tsx:39` `visible-models-toggle`
- `web/shell/LayoutSettings.tsx:467` `layout-advanced-toggle`
- `rr/support/RenderedDiff.tsx:188` `rendered-diff-collapsed`

### Rows, tree items, cards, menu rows (28)

_Why:_ row-wide click targets and selectable cards, not standalone actions.

- `web/auth/LoginDialog.tsx:210` `login-option`
- `web/chat/Composer.tsx:501` `mention-item`
- `web/chat/Composer.tsx:525` `slash-templates-empty`
- `web/chat/Composer.tsx:728` `mode.testid`
- `web/chat/HistoryOverlay.tsx:157`
- `web/chat/HistoryOverlay.tsx:255`
- `web/chat/resources/resourceRow.tsx:437` `resource-inspect`
- `web/chat/turns.tsx:803` `${testid`
- `web/panels/ChangesPanel.tsx:242` `change-item`
- `web/panels/ChangesReviewGuide.tsx:173` `changes-review-guide-step`
- `web/panels/ChangesReviewGuide.tsx:227`
- `web/panels/ExistingWorktreeDialog.tsx:152` `existing-worktree-candidate`
- `web/panels/PlanPane.tsx:807` `plan-now-idle`
- `web/panels/ProjectTree.tsx:466` `settled-shelf-more`
- `web/panels/ProjectTree.tsx:592` `project-name`
- `web/panels/ProjectTree.tsx:892`
- `web/panels/ReviewPanel.tsx:176` `review-file-row`
- `web/panels/ReviewPanel.tsx:388` `review-comment-open`
- `web/panels/SpecsPanel.tsx:173` `spec-node`
- `web/panels/TreeRow.tsx:49` `testid`
- `web/panels/WelcomePanel.tsx:205` `cta ? "welcome-cta" : "welcome-action"`
- `web/panels/planFileRow.tsx:17` `plan-file-row`
- `web/prompt/SlashCommandCompletion.tsx:190` `slash-command`
- `web/shell/LayoutSettings.tsx:371` `layout-add-new`
- `web/shell/WorkspaceChatHistory.tsx:174` `closed-chat-item`
- `rr/renderers/csv/Diff.tsx:215`
- `rr/renderers/csv/View.tsx:112`
- `rr/renderers/json/JsonTree.tsx:85`

### Chips (7)

_Why:_ status / metadata chips with their own shape.

- `web/chat/FileChip.tsx:46`
- `web/chat/TodoList.tsx:335` `todo-changes-chip`
- `web/panels/McpSettings.tsx:488` `mcp-server-exposure`
- `web/panels/PlanPane.tsx:125` `plan-commit-chip`
- `web/panels/PlanPane.tsx:223`
- `web/shell/locationBar/BranchSegment.tsx:163` `scope-remote-unpushed`
- `web/shell/locationBar/BranchSegment.tsx:174` `scope-remote-behind`

### Text links (26)

_Why:_ inline underlined or link-coloured text inside prose or metadata.

- `web/auth/LoginDialog.tsx:225` `login-paste-toggle`
- `web/chat/TodoList.tsx:353` `todo-change-path`
- `web/chat/activityBreadcrumbs.tsx:132`
- `web/chat/assistantLinks.tsx:108` `chat-file-link`
- `web/chat/tools/AskUserQuestionCard.tsx:1315` `ask-unanswered`
- `web/chat/tools/ToolFileLink.tsx:39` `tool-file-link`
- `web/chat/tools/mcp/McpActions.tsx:35` `mcp-cli-action`
- `web/chat/tools/mcp/McpActions.tsx:89` `mcp-full-output-retry`
- `web/chat/tools/mcp/McpActions.tsx:165` `mcp-full-output`
- `web/chat/tools/mcp/McpJsonTree.tsx:102`
- `web/chat/tools/mcp/McpJsonTree.tsx:132`
- `web/chat/tools/mcp/McpResourceCards.tsx:119`
- `web/chat/tools/subagent/AgentCard.tsx:99` `agent-open-transcript`
- `web/panels/ChangesFileSection.tsx:360` `changes-section-expand`
- `web/panels/ChangesFileSection.tsx:368`
- `web/panels/ChangesFileSection.tsx:383` `changes-section-retry`
- `web/panels/ChangesReviewPane.tsx:595`
- `web/panels/PlanPane.tsx:365` `plan-item-changes-requested`
- `web/panels/PlanPane.tsx:752` `plan-now-status`
- `web/panels/PlanPane.tsx:764` `plan-now-status`
- `web/shell/JbcentralQuotaIndicator.tsx:43` `jbcentral-quota`
- `web/shell/JbcentralQuotaIndicator.tsx:90` `jbcentral-quota`
- `rr/renderers/code/PierreDiff.tsx:474` `review-selection-blocked-close`
- `rr/support/ReviewThreadCard.tsx:85` `review-thread-anchor`
- `rr/support/markdownLinks.tsx:142` `markdown-file-link`
- `ext/visualize/web/FileCard.tsx:23` `tool-visualize-file-link`

### Native window controls (3)

_Why:_ platform caption buttons (46×40, shell/SPEC.md).

- `web/shell/NativeWindowControls.tsx:35` `window-minimize`
- `web/shell/NativeWindowControls.tsx:44` `window-maximize`
- `web/shell/NativeWindowControls.tsx:56` `window-close`

### Comment pins and handles (5)

_Why:_ numbered round badges on content, and the swipe-compare divider.

- `rr/renderers/RegionReviewSurface.tsx:202` `region-comment-marker`
- `rr/renderers/VisualDiff.tsx:280`
- `rr/renderers/csv/Diff.tsx:239`
- `rr/renderers/csv/View.tsx:122`
- `rr/renderers/json/JsonTree.tsx:99`
