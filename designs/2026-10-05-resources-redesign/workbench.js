/* Workbench-wide mock: where G's status vocabulary lands outside the chat column.
   Builds on mock.js globals (icon, rowHTML, dockHTML, sheetHTML, state, RENDERERS, …).
   Chat-level state mirrors contracts' SessionState: execution · needsInput(kind) · completionUnread. */

/* ------------------------------------------------------------------ workspace fixture */
const OTHER_CHAT_ROWS = {
	changes: [
		{ kind: "command", id: "x1", name: "api server", command: "bun run dev:server", status: "running", startedAt: m(25), tail: ["[host] listening on port 27580", "GET /ws 101 Switching Protocols", "session.resources 12ms"] },
		{ kind: "subagent", id: "x2", roleName: "worker", task: "Port the Changes toolbar to the shared ToggleSegment", status: "running", createdAt: m(7), activity: "edit apps/web/src/panels/ChangesPanel.tsx", model: "sonnet-4.5", tokens: 18_400 },
	],
	theme: [
		{ kind: "command", id: "x3", name: "storybook", command: "bun run storybook --ci", status: "running", startedAt: m(41), tail: ["info => Starting manager…", "Storybook 9.1 for react-vite started", "Local: http://localhost:6006/"] },
		{ kind: "subagent", id: "x4", roleName: "scout", task: "Audit every bg-/text- utility against colors.json", status: "completed", createdAt: m(50), finishedAt: m(44), model: "haiku-4.5", tokens: 61_000 },
	],
};
state.extraRows = [...OTHER_CHAT_ROWS.changes, ...OTHER_CHAT_ROWS.theme];

function chats() {
	const live = allLive(state.data);
	return {
		open: [
			{ id: "resource-ui", title: "Resource UI", execution: live.length ? "running" : "idle", needsInput: null, completionUnread: false, active: true, rows: () => [...state.data.commands, ...state.data.subagents] },
			{ id: "changes", title: "Changes toolbar", execution: "running", needsInput: null, completionUnread: false, rows: () => OTHER_CHAT_ROWS.changes },
			{ id: "specs", title: "Spec import", execution: "running", needsInput: { kind: "question", text: "Which module owns the review anchors?" }, completionUnread: false, rows: () => [] },
			{ id: "flaky", title: "Flaky e2e", execution: "idle", needsInput: null, completionUnread: true, rows: () => [] },
		],
		closed: [
			{ id: "theme", title: "Theme audit", execution: "running", needsInput: null, completionUnread: false, closedAgo: "12 min", rows: () => OTHER_CHAT_ROWS.theme },
			{ id: "pierre", title: "Pierre diff review", execution: "idle", needsInput: null, completionUnread: true, closedAgo: "1 h", rows: () => [] },
			{ id: "onboard", title: "Onboarding copy", execution: "idle", needsInput: null, completionUnread: false, closedAgo: "yesterday", rows: () => [] },
		],
	};
}
function chatStatus(c) {
	if (c.needsInput) return "needs";
	if (c.execution === "running") return "working";
	if (c.completionUnread) return "unread";
	return "idle";
}
function rollup(list) {
	return {
		working: list.filter((c) => c.execution === "running").length,
		needs: list.filter((c) => c.needsInput).length,
		unread: list.filter((c) => c.completionUnread && c.execution !== "running").length,
	};
}
function statsHTML(r, { showUnread = true } = {}) {
	const parts = [];
	if (r.working) parts.push(`<span class="stat working" title="${r.working} chat${r.working > 1 ? "s" : ""} working"><span class="sdot working"></span>${r.working}</span>`);
	if (r.needs) parts.push(`<span class="stat needs" title="${r.needs} chat${r.needs > 1 ? "s" : ""} need${r.needs > 1 ? "" : "s"} you"><span class="sdot needs"></span>${r.needs}</span>`);
	if (showUnread && r.unread) parts.push(`<span class="stat unread" title="${r.unread} result${r.unread > 1 ? "s" : ""} unread"><span class="sdot unread"></span>${r.unread}</span>`);
	return parts.length ? `<span class="stats">${parts.join("")}</span>` : "";
}
function chatGlyph(c, cls = "") {
	const st = chatStatus(c);
	return `<span class="${st === "working" ? "glyph-working" : ""} ${cls}" ${st === "working" ? `role="img" aria-label="Agent working"` : ""}>${icon("RiChat1Line")}</span>`;
}
function chatMark(c) {
	const st = chatStatus(c);
	if (st === "needs") return `<span class="sdot needs" role="img" aria-label="Needs you"></span>`;
	if (st === "unread") return `<span class="sdot unread" role="img" aria-label="Result unread"></span>`;
	return "";
}

/* ------------------------------------------------------------------ pieces */
function topbarHTML(all) {
	const r = rollup([...all.open, ...all.closed]);
	return `<div class="topbar">
		<span class="mark">TR</span>
		<span class="scope"><b>sample-project</b> <span class="sep">›</span> <b>Resources UI</b> <span class="sep">${icon("RiGitBranchLine")}</span> redesign-resources-ui <span class="sep">· from main</span></span>
		<span class="spacer"></span>
		<button class="fleet" title="Across all open projects (proposed)">${statsHTML(r)} <span style="color:var(--text-subtle)">this project</span></button>
		<span class="conn"><span class="d"></span> Connected</span>
		<span class="gear">${icon("RiSettings3Line")}</span>
	</div>`;
}
function railHTML(all) {
	const ws = rollup([...all.open, ...all.closed]);
	const needsChat = [...all.open, ...all.closed].find((c) => c.needsInput);
	return `<div class="side left">
		<div class="group-head"><span class="tab active">${icon("RiFolderLine")} Projects</span><span class="spacer"></span><button class="gh-btn">${icon("RiAddLine")}</button></div>
		<div class="rail">
			<div class="rail-head">Projects <span class="spacer"></span>
				<button class="gh-btn ${ws.needs ? "attn" : ""}" title="Jump to the next chat that needs you (⌥⇧N) — proposed">${icon("RiFocus3Line")}</button>
				<button class="gh-btn">${icon("RiAddLine")}</button>
			</div>
			<div class="prow">${icon("RiArrowDownSLine")}${icon("RiFolderLine")}<span class="name">sample-project</span>${icon("RiAddLine")}</div>
			<div class="wrow">${icon("RiHome5Line")}<div><div class="l1">Default</div><div class="l2">main</div></div>${statsHTML({ working: 0, needs: 0, unread: 0 })}</div>
			<div class="wrow active">${ws.working ? `<span class="glyph-working" role="img" aria-label="Agent working">${icon("RiGitBranchLine")}</span>` : icon("RiGitBranchLine")}<div style="min-width:0"><div class="l1">Resources UI</div><div class="l2">redesign-resources-ui</div>${needsChat ? `<div class="l3" title="Waiting on a ${esc(needsChat.needsInput.kind)} in “${esc(needsChat.title)}”">${icon("RiQuestionFill")} waiting: ${esc(needsChat.needsInput.kind)} in “${esc(needsChat.title)}”</div>` : ""}</div>${statsHTML(ws)}</div>
			<div class="wrow">${icon("RiGitBranchLine")}<div><div class="l1">Model picker favorites</div><div class="l2">feat/model-favorites</div></div>${statsHTML({ working: 0, needs: 0, unread: 1 })}</div>
			<div class="prow" style="margin-top:6px">${icon("RiArrowRightSLine")}${icon("RiFolderLine")}<span class="name">pi-visualize</span>${statsHTML({ working: 1, needs: 1, unread: 0 })}<span style="color:var(--text-subtle);font:370 12px/1 var(--font-ui)">3</span></div>
			<div class="prow">${icon("RiArrowRightSLine")}${icon("RiFolderLine")}<span class="name">website</span><span style="color:var(--text-subtle);font:370 12px/1 var(--font-ui)">1</span></div>
		</div>
	</div>`;
}
function tabStripHTML(all, ui) {
	const tabs = all.open.map((c) => `<span class="tab ${c.active ? "active" : ""}" data-kind="chat" title="${esc(c.title)} — ${chatStatus(c) === "needs" ? "needs you" : chatStatus(c) === "working" ? "agent working" : chatStatus(c) === "unread" ? "result unread" : "idle"}">
		<span class="tt">${chatGlyph(c)}<span class="title">${esc(c.title)}</span>${chatMark(c)}</span><span class="close">${icon("RiCloseLine")}</span>
	</span>`).join("");
	const closedRoll = rollup(all.closed);
	return `<div class="group-head">
		${tabs}
		<span class="spacer"></span>
		<button class="gh-btn ${ui.historyOpen ? "open" : ""}" data-act="toggle-history" title="Reopen a closed chat">${icon("RiHistoryLine")}${closedRoll.working || closedRoll.needs ? `<span class="sdot ${closedRoll.needs ? "needs" : "working"}" style="position:absolute;margin:-10px 0 0 12px"></span>` : ""}</button>
		<button class="gh-btn" title="New chat">${icon("RiAddLine")}</button>
	</div>`;
}
function historyMenuHTML(all, ui) {
	const rows = all.closed.map((c) => {
		const st = chatStatus(c);
		const live = c.rows().filter(isLive);
		const sub = st === "needs" ? `needs you · ${esc(c.needsInput.kind)}`
			: st === "working" ? `still working${live.length ? ` · ${live.length} resource${live.length > 1 ? "s" : ""} running` : ""}`
			: st === "unread" ? "finished · result unread" : "idle";
		return `<div class="hrow" data-act="noop">
			<span class="glyph">${chatGlyph(c)}${st !== "idle" ? `<span class="sdot ${st}"></span>` : ""}</span>
			<span class="main"><span class="name">${esc(c.title)}</span><span class="sub ${st}">${sub}</span></span>
			<span class="ago">closed ${c.closedAgo} ago</span>
			<span class="actions">${live.length ? `<button class="icon-btn-sm" title="Inspect its resources" data-act="inspect-scope" data-id="${live[0].id}">${icon("RiLayoutRightLine")}</button>` : ""}<button class="icon-btn-sm" title="Reopen">${icon("RiExternalLinkLine")}</button><button class="icon-btn-sm danger" title="Delete">${icon("RiCloseLine")}</button></span>
		</div>`;
	}).join("");
	return `<div class="hmenu ${ui.historyOpen ? "open" : ""}" role="menu" aria-label="Closed chats">
		<div class="mh">Closed chats <span class="n">· ${all.closed.length}</span><span class="spacer"></span><span class="n">closing never stops work</span></div>
		${rows}
	</div>`;
}
function trayHTML(data, ui) {
	const queue = [
		{ kind: "steering", label: "Steering", text: "Skip the Pierre renderer for now — focus on the registry.", hint: "delivers at the agent's next step" },
		{ kind: "followUp", label: "Follow-up", text: "When done, run the chat-resources e2e spec.", hint: "runs after the agent finishes" },
	];
	const dock = dockHTML(data, ui, { inspectable: true });
	if (!queue.length) return dock;
	const q = queue.map((item, index) => `<div class="tray-row" data-kind="${item.kind}" title="${esc(item.text)} — ${item.hint}">
		<span class="glyph">${icon(item.kind === "steering" ? "RiSendPlane2Line" : "RiTimeLine")}</span>
		<span class="text"><span class="lbl">${item.label}</span><span class="msg">${esc(item.text)}</span></span>
		<span class="meta"><span class="hide-on-hover">${item.kind === "steering" ? "next step" : "after turn"}</span><span class="actions"><button class="icon-btn-sm" title="Edit">${icon("RiCodeLine")}</button><button class="icon-btn-sm" title="Remove" data-act="noop">${icon("RiCloseLine")}</button></span></span>
	</div>`).join("");
	if (!dock) return `<div class="dock">${q}</div>`;
	// splice the queue rows above the dock's live rows, inside the same tray
	return dock.replace('<div class="dock">', `<div class="dock">${q}<div class="tray-sep"></div>`);
}
function rightSideHTML(all) {
	return `<div class="side right">
		<div class="group-head"><span class="tab active">${icon("RiFileListLine")} Specs</span><span class="tab">${icon("RiFolderLine")} Files</span><span class="spacer"></span><button class="gh-btn">${icon("RiAddLine")}</button></div>
		<div class="side-tree">
			<div class="ti">${icon("RiArrowDownSLine")}${icon("RiFileListLine")} ThinkRail</div>
			<div class="ti sub">${icon("RiFileListLine")} architecture</div>
			<div class="ti sub">${icon("RiFileListLine")} module-web</div>
			<div class="ti sub" style="padding-left:40px">${icon("RiFileListLine")} submodule-web-chat-resources</div>
		</div>
		<div class="group-head"><span class="tab active">${icon("RiGitBranchLine")} Changes</span><span class="tab">${icon("RiEyeLine")} Review <span class="badge needs" title="2 review comments waiting for you">2</span></span><span class="spacer"></span><button class="gh-btn">${icon("RiAddLine")}</button></div>
		<div>
			<div class="changes-bar">${icon("RiFilterLine")} All changes ${icon("RiArrowDownSLine")} <span>${icon("RiGitBranchLine")} vs main ${icon("RiArrowDownSLine")}</span><span class="spacer"></span></div>
			<div class="side-tree">
				<div class="ti" style="color:var(--text-muted)">${icon("RiFileCodeLine")}<span class="path">chat/resources/ResourcesContent.tsx</span><span class="plus">+118</span><span class="minus">−92</span></div>
				<div class="ti" style="color:var(--text-muted)">${icon("RiFileCodeLine")}<span class="path">chat/resources/SPEC.md</span><span class="plus">+31</span><span class="minus">−12</span></div>
			</div>
		</div>
	</div>`;
}

/* workspace-scoped inspector: sections per chat, pool across chats */
function workspaceSections(all) {
	const groups = [];
	const self = all.open.find((c) => c.active);
	const section = (c, suffix) => {
		const rows = c.rows();
		const live = sortLive(rows.filter(isLive));
		const settled = sortSettled(rows.filter((r) => !isLive(r)));
		const out = [];
		const groupLabel = `<span class="dotp"></span> ${esc(c.title)} <span style="color:var(--text-subtle);font-weight:370">· ${suffix}</span>`;
		if (live.length) out.push({ head: "Active", rows: live, group: groupLabel });
		if (settled.length) out.push({ head: "Finished", rows: settled, group: live.length ? undefined : groupLabel });
		return out;
	};
	groups.push(...section(self, "this chat"));
	for (const c of all.open.filter((c) => !c.active && c.rows().length)) groups.push(...section(c, "open"));
	for (const c of all.closed.filter((c) => c.rows().length)) groups.push(...section(c, `closed ${c.closedAgo} ago`));
	return groups;
}
function scopeToolbarHTML(ui) {
	const ws = ui.scope === "workspace";
	return `<div class="side-toolbar" style="padding:2px 8px 6px">
		<button class="scope-pill" data-act="toggle-scope" title="Switch between this chat and the whole workspace (workspace scope needs a workspace-level resources read)">${ws ? icon("RiGitBranchLine") : icon("RiChat1Line")} ${ws ? "Workspace" : "This chat"} ${icon("RiArrowDownSLine")}</button>
		<span class="spacer"></span>
		${ws ? `<span style="color:var(--text-subtle);font:370 11px/1.4 var(--font-ui)">incl. closed chats</span>` : ""}
	</div>`;
}

/* ------------------------------------------------------------------ frame */
function renderWorkbench(root, data, ui, key) {
	const all = chats();
	const sections = ui.scope === "workspace" ? workspaceSections(all) : undefined;
	const pool = ui.scope === "workspace" ? sections.flatMap((s) => s.rows) : undefined;
	ui.sheetOrder = () => (pool ?? [...allLive(data), ...allSettled(data)]).map((r) => r.id);
	root.innerHTML = `<div class="wb" data-dir="W" data-ui="${key}">
		${topbarHTML(all)}
		<div class="wb-body">
			${railHTML(all)}
			<div class="center">
				${tabStripHTML(all, ui)}
				<div class="frame" data-dir="W" data-ui="${key}">
					${headerHTML({ trigger: triggerHTML(data, { open: ui.sheetOpen }) })}
					<div class="body">
						${messagesHTML(data, { inspectable: true })}
						<div class="scrim ${ui.sheetOpen ? "open" : ""}" data-act="close-sheet"></div>
						${sheetHTML(data, ui, { sections, pool, toolbar: scopeToolbarHTML(ui) })}
					</div>
					${composerHTML(ui.sheetOpen ? "" : trayHTML(data, ui))}
					${confirmHTML(ui, data)}
				</div>
				${historyMenuHTML(all, ui)}
			</div>
			${rightSideHTML(all)}
		</div>
	</div>`;
	const sel = root.querySelector(".sheet.open .list .res-row.selected");
	const list = sel?.closest(".list");
	if (sel && list) {
		const top = sel.offsetTop - list.offsetTop;
		if (top + sel.offsetHeight > list.scrollTop + list.clientHeight - 8) list.scrollTop = top + sel.offsetHeight - list.clientHeight + 48;
	}
}

/* ------------------------------------------------------------------ legend */
function renderLegend(root) {
	const mkChat = (over) => ({ title: "Spec graph import", execution: "idle", needsInput: null, completionUnread: false, ...over });
	const rows = [
		{ state: "Working", mark: `<span class="sdot working"></span>`, chat: mkChat({ execution: "running" }), today: "<b>RunningIcon</b> — identity glyph breathes (kept)", res: rowHTML({ kind: "subagent", id: "l1", roleName: "scout", task: "…", status: "running", createdAt: m(2), activity: "grep registerToolRenderer" }, { compact: true }), rule: "primary + motion; reduced-motion falls back to a ring" },
		{ state: "Needs you", mark: `<span class="sdot needs"></span>`, chat: mkChat({ execution: "running", needsInput: { kind: "question" } }), today: "<b>AttentionDot</b> — <i>green</i> (change to amber)", res: rowHTML({ kind: "subagent", id: "l2", roleName: "worker", task: "…", status: "running", createdAt: m(6), needsInput: true, activity: "Asking: “Keep the Logs action?”" }, { compact: true }), rule: "warning, static; always sorts first; never the only signal (word + glyph)" },
		{ state: "Finished · unread", mark: `<span class="sdot unread"></span>`, chat: mkChat({ completionUnread: true }), today: "<b>AttentionDot</b> — green (kept)", res: rowHTML({ kind: "command", id: "l3", name: "typecheck", command: "turbo run typecheck", status: "completed", startedAt: m(10), finishedAt: m(8), exitCode: 0 }, { compact: true }), rule: "primary, static; clears when the result is read" },
		{ state: "Idle / settled", mark: `<span class="sdot idle"></span>`, chat: mkChat({}), today: "nothing (kept)", res: rowHTML({ kind: "command", id: "l4", name: "lint (watch)", command: "biome check --watch .", status: "stopped", startedAt: m(10), finishedAt: m(9), exitCode: 130 }, { compact: true }), rule: "no mark; stopped is neutral, failed is red" },
	];
	root.innerHTML = `<table class="legend">
		<thead><tr><th>State</th><th>Mark</th><th>Chat tab</th><th>Rail row</th><th>Resource row (dock / inspector)</th><th>Today</th><th>Rule</th></tr></thead>
		<tbody>${rows.map((r) => `<tr>
			<td>${r.state}</td>
			<td>${r.mark}</td>
			<td><span class="mini-tab">${chatGlyph(r.chat)} ${esc(r.chat.title)} ${chatMark(r.chat)}</span></td>
			<td><span class="cell">${r.state === "Working" ? `<span class="glyph-working">${icon("RiGitBranchLine")}</span>` : icon("RiGitBranchLine")} <span style="color:var(--text-default)">redesign</span> ${statsHTML({ working: r.state === "Working" ? 1 : 0, needs: r.state === "Needs you" ? 1 : 0, unread: r.state === "Finished · unread" ? 1 : 0 })}</span></td>
			<td><div style="background:var(--container-elevated-bg);border:1px solid var(--border-muted);border-radius:6px;padding:2px;min-width:300px">${r.res}</div></td>
			<td class="today">${r.today}</td>
			<td>${r.rule}</td>
		</tr>`).join("")}</tbody>
	</table>`;
}

/* ------------------------------------------------------------------ register with mock.js */
state.ui.W1 = { sheetOpen: false, selectedRow: null, confirmOpen: false, dockCollapsed: null, dismissed: new Set(), historyOpen: false, scope: "chat" };
state.ui.W2 = { sheetOpen: false, selectedRow: null, confirmOpen: false, dockCollapsed: null, dismissed: new Set(), historyOpen: true, scope: "chat" };
state.ui.W3 = { sheetOpen: true, selectedRow: "x3", confirmOpen: false, dockCollapsed: null, dismissed: new Set(), historyOpen: false, scope: "workspace" };
RENDERERS.W1 = (root, data, ui) => renderWorkbench(root, data, ui, "W1");
RENDERERS.W2 = (root, data, ui) => renderWorkbench(root, data, ui, "W2");
RENDERERS.W3 = (root, data, ui) => renderWorkbench(root, data, ui, "W3");
RENDERERS.legend = (root) => renderLegend(root);

document.addEventListener("click", (e) => {
	const t = e.target.closest("[data-act]");
	if (!t) return;
	const frame = t.closest("[data-ui]");
	const ui = frame ? state.ui[frame.dataset.ui] : null;
	if (!ui) return;
	if (t.dataset.act === "toggle-history") { ui.historyOpen = !ui.historyOpen; renderAll(); }
	if (t.dataset.act === "inspect-scope") { ui.historyOpen = false; ui.scope = "workspace"; openSheet(ui, t.dataset.id); renderAll(); }
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") for (const ui of Object.values(state.ui)) if ("historyOpen" in ui) ui.historyOpen = false; }, true);

renderAll();
