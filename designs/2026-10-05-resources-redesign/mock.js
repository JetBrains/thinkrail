/* ThinkRail Resources redesign — interactive mockups.
   Pure DOM; no build step. Data shapes mirror packages/contracts (BackgroundCommandSummary,
   SubagentResourceSummary) plus a few clearly-marked *proposed* fields (activity, needsInput, parentId). */

const ICONS = window.ICONS;
const T0 = Date.now();
const m = (min) => T0 - min * 60_000;
const s = (sec) => T0 - sec * 1000;

function icon(name, cls = "") {
	const d = ICONS[name];
	if (!d) return `<svg class="ri ${cls}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>`;
	return `<svg class="ri ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}

/* ------------------------------------------------------------------ scenarios */
function baseCommands() {
	return [
		{ kind: "command", id: "c1", name: "vite dev server", command: "bun run dev:web --port 5173", status: "running", startedAt: m(4),
			tail: ["VITE v7.1.2  ready in 412 ms", "➜  Local:   http://localhost:5173/", "hmr update /src/chat/ChatView.tsx"] },
		{ kind: "command", id: "c2", name: "unit tests (watch)", command: "bun test --watch apps/web/src/chat", status: "stopping", startedAt: s(92),
			tail: ["✓ resources.test.tsx (14 tests) 212ms", "✓ ChatHeader.test.tsx (3 tests) 48ms", "Waiting for file changes…"] },
		{ kind: "command", id: "c3", name: "typecheck", command: "turbo run typecheck", status: "completed", startedAt: m(10), finishedAt: m(8), exitCode: 0,
			tail: ["Tasks:    9 successful, 9 total", "Cached:   7 cached, 9 total", "Time:     1m42s"] },
		{ kind: "command", id: "c4", name: "e2e shard", command: "bun run e2e -- e2e/chat-resources.spec.ts", status: "error", startedAt: m(20), finishedAt: m(15), exitCode: 1,
			errorMessage: "Process exited with code 1", tail: ["  ✘ 3 [chromium] › chat-resources.spec.ts:131 › popover (12.4s)", "  Error: expect(locator).toBeVisible() failed", "  1 failed, 4 passed (41.0s)"] },
	];
}
function baseSubagents() {
	return [
		{ kind: "subagent", id: "a1", roleName: "scout", task: "Find every call site of registerToolRenderer and summarise the renderer contract", status: "running", createdAt: m(2),
			activity: "grep registerToolRenderer apps/web/src", model: "sonnet-4.5", tokens: 31_200 },
		{ kind: "subagent", id: "a2", roleName: "reviewer", task: "Review the diff of apps/web/src/chat/resources against the SPEC", status: "queued", createdAt: s(30), model: "opus-4.1" },
		{ kind: "subagent", id: "a3", roleName: "worker", task: "Add dark/light screenshots to the mockup page", status: "completed", createdAt: m(12), finishedAt: m(5), model: "sonnet-4.5", tokens: 88_400 },
	];
}
const SCENARIOS = {
	busy: {
		label: "Busy",
		blurb: "2 commands (one stopping), 1 running + 1 queued subagent, 3 finished.",
		build: () => ({ stale: false, authoritative: true, error: null, commands: baseCommands(), subagents: baseSubagents() }),
	},
	needs: {
		label: "Needs you",
		blurb: "Same as Busy, plus a subagent blocked on a question (proposed `needsInput` field).",
		build: () => {
			const d = SCENARIOS.busy.build();
			d.subagents.unshift({ kind: "subagent", id: "a0", roleName: "worker", task: "Migrate the Resources popover rows to the new vocabulary", status: "running", createdAt: m(6),
				needsInput: true, activity: "Asking: “Should finished rows keep the Logs action?”", model: "sonnet-4.5", tokens: 54_000 });
			return d;
		},
	},
	many: {
		label: "Fan-out",
		blurb: "6 commands and 8 subagents incl. nested children — density and overflow.",
		build: () => {
			const d = SCENARIOS.busy.build();
			d.commands.unshift(
				{ kind: "command", id: "c5", name: "storybook", command: "bun run storybook --ci", status: "running", startedAt: m(1), tail: ["info => Starting manager..", "╭───────────╮", "│ Storybook 9.1 │"] },
				{ kind: "command", id: "c6", name: "lint (watch)", command: "biome check --watch .", status: "running", startedAt: s(40), tail: ["Checked 1420 files in 801ms. No fixes applied."] },
			);
			d.subagents.unshift(
				{ kind: "subagent", id: "a4", roleName: "planner", task: "Plan the migration of ResourcesContent to a unified row model", status: "running", createdAt: m(3), activity: "read apps/web/src/chat/resources/SPEC.md", model: "opus-4.1", tokens: 12_000 },
				{ kind: "subagent", id: "a5", roleName: "worker", task: "Implement the composer dock variant", status: "running", createdAt: m(1), activity: "edit apps/web/src/chat/resources/Dock.tsx", model: "sonnet-4.5", tokens: 9_300, parentId: "a4" },
				{ kind: "subagent", id: "a6", roleName: "worker", task: "Implement the popover variant", status: "queued", createdAt: s(20), model: "sonnet-4.5", parentId: "a4" },
				{ kind: "subagent", id: "a7", roleName: "scout", task: "Collect token names used by Changes and Review panels", status: "running", createdAt: s(55), activity: "rg 'text-feedback' apps/web/src/panels", model: "haiku-4.5", tokens: 4_100 },
				{ kind: "subagent", id: "a8", roleName: "reviewer", task: "Review PR #612 for accessibility regressions", status: "error", createdAt: m(9), finishedAt: m(7), abortReason: "Provider error: 529 overloaded", model: "opus-4.1", tokens: 22_000 },
			);
			return d;
		},
	},
	idle: {
		label: "Idle",
		blurb: "Nothing active; three finished entries retained on this host.",
		build: () => {
			const d = SCENARIOS.busy.build();
			d.commands = d.commands.filter((c) => c.status !== "running" && c.status !== "stopping");
			d.subagents = d.subagents.filter((a) => a.status !== "running" && a.status !== "queued");
			return d;
		},
	},
	stale: {
		label: "Stale",
		blurb: "Reconnecting: snapshot is stale, count unknown, controls disabled.",
		build: () => {
			const d = SCENARIOS.busy.build();
			d.stale = true; d.authoritative = false;
			return d;
		},
	},
};

/* ------------------------------------------------------------------ derived state */
function visualState(r) {
	if (r.kind === "command") {
		switch (r.status) {
			case "running": return "working";
			case "stopping": return "stopping";
			case "completed": return r.exitCode === 0 ? "done" : "error";
			case "error": return "error";
			case "stopped": return "stopped";
		}
	}
	if (r.needsInput && r.status === "running") return "needs";
	switch (r.status) {
		case "queued": return "queued";
		case "running": return "working";
		case "completed": return "done";
		case "error": return "error";
		case "aborted": return "stopped";
	}
	return "queued";
}
const LIVE = new Set(["working", "needs", "queued", "stopping"]);
const isLive = (r) => LIVE.has(visualState(r));
const startOf = (r) => r.startedAt ?? r.createdAt;
const ORDER = { needs: 0, working: 1, stopping: 2, queued: 3 };
function sortLive(rows) {
	const sorted = rows.slice().sort((a, b) => (ORDER[visualState(a)] - ORDER[visualState(b)]) || (startOf(a) - startOf(b)));
	return arrangeFamilies(sorted);
}
/* Children follow their parent when the parent is in the same list; otherwise they stand alone. */
function arrangeFamilies(sorted) {
	const ids = new Set(sorted.map((r) => r.id));
	const out = [];
	for (const r of sorted) {
		if (r.parentId && ids.has(r.parentId)) continue;
		out.push(r);
		for (const c of sorted) if (c.parentId === r.id) out.push(c);
	}
	return out;
}
function hasParentIn(r, rows) { return !!r.parentId && rows.some((x) => x.id === r.parentId); }
function sortSettled(rows) {
	return rows.slice().sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
}
function stateLabel(st, r) {
	switch (st) {
		case "working": return r?.kind === "subagent" ? "Working" : "Running";
		case "needs": return "Needs you";
		case "queued": return "Queued";
		case "stopping": return "Stopping…";
		case "done": return "Done";
		case "error": return "Failed";
		case "stopped": return "Stopped";
	}
	return st;
}
function stateIcon(st) {
	switch (st) {
		case "done": return icon("RiCheckboxCircleFill", "st-done");
		case "error": return icon("RiCloseCircleFill", "st-error");
		case "stopped": return icon("RiIndeterminateCircleLine", "st-stopped");
		case "needs": return icon("RiQuestionFill", "st-needs");
		case "stopping": return `<span class="spin st-stopping">${icon("RiLoader4Line")}</span>`;
		case "queued": return icon("RiTimeLine", "st-queued");
		default: return `<span class="st-working">${icon("RiCheckboxBlankCircleFill")}</span>`;
	}
}
function fmtElapsed(ms) {
	const sec = Math.max(0, Math.floor(ms / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ${String(sec % 60).padStart(2, "0")}s`;
	return `${Math.floor(min / 60)}h ${min % 60}m`;
}
function fmtAgo(ts) {
	const min = Math.round((Date.now() - ts) / 60_000);
	if (min < 1) return "just now";
	if (min < 60) return `${min} min ago`;
	return `${Math.round(min / 60)} h ago`;
}
function fmtTokens(n) { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k tok` : `${n} tok`; }
function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ------------------------------------------------------------------ shared row */
function rowHTML(r, opts = {}) {
	const st = visualState(r);
	const live = LIVE.has(st);
	const kindIcon = r.kind === "command" ? "RiTerminalBoxLine" : "RiRobot2Line";
	const name = r.kind === "command" ? r.name : (r.roleName ?? "Subagent");
	const act = r.kind === "command"
		? (live || opts.alwaysCommand ? `<code>${esc(r.command)}</code>` : esc(r.errorMessage ?? r.command))
		: (st === "needs" ? esc(r.activity) : (live && r.activity && opts.liveActivity !== false ? `${esc(r.activity)}` : esc(r.task)));
	const disabled = opts.disabled ? "disabled" : "";
	let meta = "";
	if (live) {
		const el = `<span class="elapsed" data-start="${startOf(r)}">${fmtElapsed(Date.now() - startOf(r))}</span>`;
		meta = `<span class="state hide-on-hover ${"st-" + st}">${stateIcon(st)} ${stateLabel(st, r)}</span>${st === "queued" ? "" : `<span class="hide-on-hover">${el}</span>`}`;
	} else {
		const dur = r.finishedAt ? fmtElapsed(r.finishedAt - startOf(r)) : "";
		const exit = r.kind === "command" && r.exitCode != null ? `<span class="exit ${r.exitCode === 0 ? "ok" : "bad"}">exit ${r.exitCode}</span>` : "";
		meta = `<span class="state hide-on-hover ${"st-" + st}">${stateIcon(st)} ${stateLabel(st, r)}</span><span class="hide-on-hover">${dur}</span>${exit}`;
	}
	const inspect = r.kind === "command"
		? `<button class="icon-btn-sm" title="Logs" data-act="logs">${icon("RiFileTextLine")}</button>`
		: `<button class="icon-btn-sm" title="Transcript" data-act="transcript">${icon("RiChat1Line")}</button>`;
	const stop = live && st !== "stopping"
		? `<button class="icon-btn-sm danger" title="Stop" data-act="stop" data-id="${r.id}" ${disabled}>${icon("RiStopFill")}</button>`
		: (st === "stopping" ? `<button class="icon-btn-sm" disabled title="Stopping…">${icon("RiStopFill")}</button>` : "");
	const retry = st === "error" && r.kind === "subagent" && opts.retry ? `<button class="icon-btn-sm" title="Retry (proposed)">${icon("RiRestartLine")}</button>` : "";
	const dismiss = !live && opts.dismiss ? `<button class="icon-btn-sm" title="Dismiss">${icon("RiCloseLine")}</button>` : "";
	const sub = r.kind === "subagent" && opts.subline
		? `<div class="act">${esc(r.task)}${r.model ? ` · <span>${esc(r.model)}</span>` : ""}${r.tokens ? ` · ${fmtTokens(r.tokens)}` : ""}</div>` : "";
	const act1 = r.kind === "subagent" && opts.subline && live && r.activity ? `<span class="act">${esc(r.activity)}</span>` : (opts.subline && r.kind === "subagent" ? "" : `<span class="act">${act}</span>`);
	const role = r.kind === "subagent" && opts.showRoleTag ? `<span class="role">subagent</span>` : "";
	const nested = !!opts.nest && (opts.nest === true ? !!r.parentId : hasParentIn(r, opts.nest));
	return `<div class="res-row ${live ? "live" : "settled"} ${st === "needs" ? "needs-you" : ""} ${nested ? "child" : ""} ${opts.selected ? "selected" : ""} ${sub ? "two-line" : ""} ${opts.compact ? "compact" : ""}" data-id="${r.id}" data-kind="${r.kind}" data-state="${st}" tabindex="0" role="listitem" aria-label="${esc(name)}, ${stateLabel(st, r)}">
		<span class="glyph">${icon(kindIcon)}<span class="st dot-${st}"></span></span>
		<span class="main">
			<span class="line1"><span class="name" title="${esc(r.kind === "command" ? r.command : r.task)}">${esc(name)}</span>${role}${act1}</span>
			${sub}
		</span>
		<span class="meta">${meta}<span class="actions">${inspect}${retry}${stop}${dismiss}</span></span>
	</div>`;
}
function tailHTML(r, lines = 2) {
	if (!r.tail) return "";
	const t = r.tail.slice(-lines);
	return `<div class="tail">${t.map((l, i) => `<span class="${i === t.length - 1 ? "cur" : ""}">${esc(l)}</span>`).join("\n")}</div>`;
}

/* ------------------------------------------------------------------ frame chrome */
function headerHTML({ trigger, extraRight = "" }) {
	return `<div class="chat-header">
		<div class="left"><span class="plan">${icon("RiArrowRightSLine")} <span class="tr-text-metadata">TODO list</span> <span class="n tr-text-metadata">3/5</span></span></div>
		<span class="stats tr-text-metadata">12.4k · $0.08</span>
		${trigger}
		${extraRight}
		<button class="ghost-btn">${icon("RiBookOpenLine")}<span class="hide-narrow">Skills</span><span class="attn" style="background:var(--primary)"></span></button>
	</div>`;
}
function triggerHTML(data, { open = false, style = "count" } = {}) {
	const live = allLive(data);
	const needs = live.filter((r) => visualState(r) === "needs").length;
	const n = data.authoritative ? live.length : null;
	const dot = n === null ? `<span class="count">—</span>` : n > 0 ? `<span class="dot pulse"></span><span class="count">${n}</span>` : `<span class="count">0</span>`;
	const attn = needs ? `<span class="attn" title="${needs} need${needs > 1 ? "" : "s"} you"></span>` : "";
	const label = style === "words"
		? (n === null ? "Resources" : n === 0 ? "No background work" : `${n} working${needs ? ` · ${needs} needs you` : ""}`)
		: "Resources";
	return `<button class="ghost-btn trigger ${open ? "open" : ""}" aria-expanded="${open}" aria-label="Resources, ${n === null ? "active count unavailable" : n + " active"}" data-act="toggle-popover">
		${icon(open ? "RiStackFill" : "RiStackLine")}<span class="hide-narrow">${label}</span>${style === "words" ? "" : dot}${attn}
	</button>`;
}
function messagesHTML(data, { inlineRoster = false, inspectable = false } = {}) {
	const live = allLive(data);
	const spawnLive = data.subagents.filter((a) => a.id !== "a3");
	const working = spawnLive.filter(isLive).length;
	const a1 = data.subagents.find((a) => a.id === "a1");
	const a1Live = !!a1 && isLive(a1);
	const c1 = data.commands.find((c) => c.id === "c1");
	const c1Live = !!c1 && isLive(c1);
	const inspectBtn = (id, liveRow) => inspectable
		? `<button class="inspect" data-act="inspect" data-id="${id}" title="Open in the Resources inspector">${liveRow ? `<span class="live-dot"></span>` : ""}Inspect ${icon("RiLayoutRightLine")}</button>`
		: "";
	const agentSum = a1Live
		? `scout · 3 turns · ${fmtTokens(a1.tokens ?? 31_200)} · <span class="elapsed" data-start="${startOf(a1)}">${fmtElapsed(Date.now() - startOf(a1))}</span> · ${esc(a1.activity ?? "")}`
		: `scout · done · 3 turns · 31k tok · 2m 04s`;
	const cmdSum = c1Live
		? `started “vite dev server” in the background · id c1`
		: `“vite dev server” ran in the background · id c1 · ${c1 && c1.exitCode != null ? `exit ${c1.exitCode}` : "finished"}`;
	const inline = inlineRoster ? `
		<div class="spawn-row ${working ? "" : "settled"}">
			${working ? `<span class="st-working">${icon("RiCheckboxBlankCircleFill")}</span>` : icon("RiCheckDoubleLine", "st-done")}
			<span class="txt"><div>${working ? "Kicked off" : "Ran"} ${spawnLive.length} subagents <span class="sub">· ${working ? `${working} working` : "all settled"} · ${fmtTokens(spawnLive.reduce((n, a) => n + (a.tokens ?? 0), 0))}</span></div></span>
			<button class="open" data-act="toggle-popover">Open resources ${icon("RiArrowRightSLine")}</button>
		</div>
		<div class="inline-sub">${sortLive(spawnLive.filter(isLive)).map((a) => rowHTML(a, { subline: false })).join("")}</div>
		${data.commands.filter((c) => c.status === "running" || c.status === "stopping").map((c) => `<div class="inline-cmd">${rowHTML(c)}${tailHTML(c, 3)}</div>`).join("")}
	` : `
		<div class="tool-card ${inspectable ? "inspectable" : ""}"><div class="tc-head tr-text-metadata">${icon("RiRobot2Line")} <span class="name">Agent</span> <span class="sum">${agentSum}</span> ${inspectBtn("a1", a1Live)} ${icon("RiArrowDownSLine")}</div></div>
		<div class="tool-card ${inspectable ? "inspectable" : ""}"><div class="tc-head tr-text-metadata">${icon("RiTerminalBoxLine")} <span class="name">background_command</span> <span class="sum">${cmdSum}</span> ${inspectBtn("c1", c1Live)} ${icon("RiArrowDownSLine")}</div></div>
	`;
	return `<div class="messages">
		<div class="msg-user tr-text-ui">Spin up the dev server and have a scout map the tool renderer contract while you review the diff.</div>
		<div class="msg-assistant tr-body"><p>Starting the dev server in the background and delegating the renderer survey. I'll keep reviewing the diff meanwhile.</p></div>
		${inline}
		<div class="activity-row tr-text-metadata">${icon("RiCornerDownRightLine")} 6 steps · read SPEC.md, rg registerToolRenderer, edit ResourcesContent.tsx …</div>
		<div class="msg-assistant tr-body"><p>The diff is consistent with <code>resources/SPEC.md</code>. Two findings so far — waiting on the scout's report before I touch the registry.</p></div>
		<div class="turn-divider tr-text-metadata"><span class="line"></span><span class="chip">2 files changed</span><span class="chip">1 spec</span>${live.length ? `<span class="chip live" ${inspectable ? `data-act="inspect" role="button" tabindex="0" title="Open in the Resources inspector"` : ""}>${live.length} still running</span>` : ""}<span class="line"></span></div>
		<div class="msg-user tr-text-ui">Nice. Also run the unit tests in watch mode.</div>
		<div class="msg-assistant tr-body"><p>Done — <code>bun test --watch</code> is running in the background; I'll report failures as they arrive.</p></div>
	</div>`;
}
function composerHTML(dockHTML = "") {
	return `<div class="composer-wrap">${dockHTML}<div class="composer">
		<div class="placeholder tr-text-ui">Message…</div>
		<div class="bar tr-text-metadata">
			<span class="model-pill"><span class="glyph">A</span> claude-sonnet-4.5 <span style="color:var(--text-subtle)">· high</span> ${icon("RiArrowDownSLine")}</span>
			<span class="spacer"></span>
			<span class="icon-btn">${icon("RiHistoryLine")}</span>
			<span class="send">${icon("RiArrowUpLine")}</span>
		</div>
	</div></div>`;
}
function allLive(data) { return sortLive([...data.commands, ...data.subagents].filter(isLive)); }
function allSettled(data) { return sortSettled([...data.commands, ...data.subagents].filter((r) => !isLive(r))); }

/* ------------------------------------------------------------------ Direction A: refined popover */
function popoverHTML(data, ui) {
	const live = allLive(data);
	const settled = allSettled(data);
	const needs = live.filter((r) => visualState(r) === "needs");
	const rest = live.filter((r) => visualState(r) !== "needs");
	const nc = live.filter((r) => r.kind === "command").length;
	const na = live.filter((r) => r.kind === "subagent").length;
	const disabled = !data.authoritative;
	const summary = data.authoritative
		? (live.length ? `<span class="summary-pill live"><span class="dot"></span>${live.length} working</span>` : `<span class="summary-pill">idle</span>`)
		: `<span class="summary-pill">${icon("RiLoader4Line", "spin")} reconnecting</span>`;
	return `<div class="popover ${ui.popoverOpen ? "open" : ""}" role="dialog" aria-label="Resources">
		<div class="pop-head">
			<span class="title">Resources ${summary}</span>
			<span class="spacer"></span>
			${na ? `<button class="ghost-btn" data-act="stop-all" ${disabled ? "disabled" : ""}>${icon("RiStopFill")} Stop all subagents</button>` : ""}
			<button class="menu-btn" title="More">${icon("RiMore2Line")}</button>
		</div>
		${data.stale ? `<div class="stale-banner">${icon("RiErrorWarningLine")} Snapshot is stale — controls return when the host reconnects.</div>` : ""}
		${data.error ? `<div class="error-banner">${icon("RiErrorWarningLine")} ${esc(data.error)} <button>Retry</button></div>` : ""}
		${needs.length ? `<div class="sec-head">Needs you <span class="n">· ${needs.length}</span></div><div role="list">${needs.map((r) => rowHTML(r, { disabled, nest: needs })).join("")}</div>` : ""}
		<div class="sec-head">Active <span class="n">· ${nc} command${nc === 1 ? "" : "s"} · ${na} subagent${na === 1 ? "" : "s"}</span></div>
		${rest.length ? `<div role="list">${rest.map((r) => rowHTML(r, { disabled, nest: rest })).join("")}</div>` : `<div class="empty-hint">Nothing is running in the background for this chat.</div>`}
		<div class="sec-head" style="padding-top:12px"><button data-act="toggle-finished" aria-expanded="${ui.finishedOpen}">${icon(ui.finishedOpen ? "RiArrowDownSLine" : "RiArrowRightSLine")} Finished <span class="n">· ${settled.length}</span></button><span class="spacer"></span>${ui.finishedOpen && settled.length ? `<button title="Clear finished (proposed)">Clear</button>` : ""}</div>
		${ui.finishedOpen ? (settled.length ? `<div role="list">${settled.map((r) => rowHTML(r, { disabled, retry: true })).join("")}</div>` : `<div class="empty-hint">No finished resources yet.</div>`) : ""}
		<div class="pop-foot">${icon("RiInformationLine")} Logs and transcripts are kept for this host session only. <span class="spacer"></span><kbd>⌃⇧R</kbd></div>
	</div>`;
}
function confirmHTML(ui, data) {
	const n = data.subagents.filter((a) => isLive(a)).length;
	return `<div class="confirm ${ui.confirmOpen ? "open" : ""}" role="alertdialog">
		<p><b>Stop ${n} active subagent${n === 1 ? "" : "s"}?</b> The main chat keeps running and can delegate again later. Partial results stay in each transcript.</p>
		<div class="row"><button class="btn-outline" data-act="confirm-cancel">Cancel</button><button class="btn-outline danger" data-act="confirm-stop-all">${icon("RiStopFill")} Stop ${n}</button></div>
	</div>`;
}
function renderDirectionA(root, data, ui) {
	root.innerHTML = `<div class="frame" data-dir="A">
		${headerHTML({ trigger: triggerHTML(data, { open: ui.popoverOpen }) })}
		${messagesHTML(data)}
		${composerHTML()}
		${popoverHTML(data, ui)}
		${confirmHTML(ui, data)}
	</div>`;
}

/* ------------------------------------------------------------------ Direction B: composer dock */
function dockHTML(data, ui, { inspectable = false } = {}) {
	const live = allLive(data);
	const recentFailed = allSettled(data).filter((r) => visualState(r) === "error" && (Date.now() - (r.finishedAt ?? 0)) < 30 * 60_000 && !ui.dismissed.has(r.id)).slice(0, 1);
	const rows = [...live, ...recentFailed];
	if (!rows.length) return "";
	const nc = live.filter((r) => r.kind === "command").length;
	const na = live.filter((r) => r.kind === "subagent").length;
	const needs = live.filter((r) => visualState(r) === "needs").length;
	const collapsed = ui.dockCollapsed ?? rows.length > 5;
	const summary = `<button class="dock-summary" data-act="toggle-dock" aria-expanded="${!collapsed}">
		${!data.authoritative ? `<span class="spin" style="color:var(--text-subtle)">${icon("RiLoader4Line")}</span>` : live.length ? `<span class="dot"></span>` : icon("RiCloseCircleFill", "st-error")}
		<span>${!data.authoritative ? `${live.length} working \u00b7 reconnecting` : live.length ? `${live.length} working` : "1 failed"}</span>
		<span class="sum-chips">${nc ? `<span class="chip">${icon("RiTerminalBoxLine")} ${nc}</span>` : ""}${na ? `<span class="chip">${icon("RiRobot2Line")} ${na}</span>` : ""}${needs ? `<span class="chip warn">${icon("RiQuestionFill")} ${needs} needs you</span>` : ""}</span>
		<span class="spacer"></span>
		<span style="color:var(--text-subtle)">${collapsed ? "show" : "hide"}</span>${icon(collapsed ? "RiArrowUpSLine" : "RiArrowDownSLine")}
	</button>`;
	const visible = collapsed ? rows.filter((r) => visualState(r) === "needs") : rows;
	const body = visible.map((r) => {
		const st = visualState(r);
		const liveRow = LIVE.has(st);
		const kindIcon = r.kind === "command" ? "RiTerminalBoxLine" : "RiRobot2Line";
		const name = r.kind === "command" ? r.name : r.roleName;
		const act = r.kind === "command" ? `<code>${esc(r.command)}</code>` : esc(st === "needs" ? r.activity : (r.activity ?? r.task));
		const el = liveRow && st !== "queued" ? `<span class="elapsed hide-on-hover" data-start="${startOf(r)}">${fmtElapsed(Date.now() - startOf(r))}</span>` : (liveRow ? "" : `<span class="hide-on-hover">${fmtAgo(r.finishedAt)}</span>`);
		const stateTxt = `<span class="hide-on-hover st-${st}" style="display:inline-flex;align-items:center;gap:4px">${stateIcon(st)}${liveRow && st === "working" ? "" : " " + stateLabel(st, r)}</span>`;
		const inspect = inspectable
			? `<button class="icon-btn-sm" title="Inspect" data-act="inspect" data-id="${r.id}">${icon("RiLayoutRightLine")}</button>`
			: (r.kind === "command" ? `<button class="icon-btn-sm" title="Logs">${icon("RiFileTextLine")}</button>` : `<button class="icon-btn-sm" title="Transcript">${icon("RiChat1Line")}</button>`);
		const stop = liveRow && st !== "stopping" ? `<button class="icon-btn-sm danger" title="${data.authoritative ? "Stop" : "Stop (unavailable while the snapshot is stale)"}" data-act="stop" data-id="${r.id}" ${data.authoritative ? "" : "disabled"}>${icon("RiStopFill")}</button>` : "";
		const dismiss = !liveRow ? `<button class="icon-btn-sm" title="Dismiss" data-act="dismiss" data-id="${r.id}">${icon("RiCloseLine")}</button>` : "";
		return `<div class="dock-row ${st === "needs" ? "needs-you" : ""}" data-id="${r.id}" ${inspectable ? `data-act="inspect" role="button" tabindex="0"` : ""}>
			<span class="glyph">${icon(kindIcon)}<span class="st dot-${st}"></span></span>
			<span class="text"><span class="name">${esc(name)}</span><span class="act">${act}</span></span>
			<span class="meta">${stateTxt}${el}<span class="actions">${inspect}${stop}${dismiss}</span></span>
		</div>`;
	}).join("");
	return `<div class="dock">${body}${summary}</div>`;
}
function renderDirectionB(root, data, ui) {
	root.innerHTML = `<div class="frame" data-dir="B">
		${headerHTML({ trigger: triggerHTML(data, { open: ui.popoverOpen }) })}
		${messagesHTML(data)}
		${composerHTML(dockHTML(data, ui))}
		${popoverHTML(data, { ...ui, finishedOpen: true })}
		${confirmHTML(ui, data)}
	</div>`;
}

/* ------------------------------------------------------------------ Direction C: side tool */
function sideToolHTML(data, ui) {
	const live = allLive(data);
	const settled = allSettled(data);
	const otherChat = [
		{ kind: "command", id: "x1", name: "api server", command: "bun run dev:server", status: "running", startedAt: m(25), tail: ["[host] listening on port 27580", "GET /ws 101"] },
		{ kind: "subagent", id: "x2", roleName: "worker", task: "Port the Changes toolbar to the new toggle", status: "running", createdAt: m(7), activity: "edit panels/ChangesPanel.tsx" },
	];
	const scopeWs = ui.scope === "workspace";
	const rowOpts = { subline: true, disabled: !data.authoritative };
	const liveRows = (rows) => rows.map((r) => rowHTML(r, { ...rowOpts, nest: rows }) + (r.kind === "command" && r.tail && isLive(r) ? tailHTML(r, 2) : "")).join("");
	return `<div class="side-col">
		<div class="side-head">
			<span class="tab">${icon("RiFileListLine")} Specs</span>
			<span class="tab">${icon("RiFolderLine")} Files</span>
			<span class="tab active">${icon("RiStackLine")} Activity <span class="badge">${live.length}</span></span>
			<span class="spacer"></span>
			<button class="menu-btn" title="Add">${icon("RiAddLine")}</button>
		</div>
		<div class="side-body">
			<div class="side-toolbar">
				<button class="scope-pill" data-act="toggle-scope">${scopeWs ? icon("RiGitBranchLine") : icon("RiChat1Line")} ${scopeWs ? "Workspace" : "This chat"} ${icon("RiArrowDownSLine")}</button>
				<span class="spacer"></span>
				${live.filter((r) => r.kind === "subagent").length ? `<button class="ghost-btn" data-act="stop-all" ${data.authoritative ? "" : "disabled"}>${icon("RiStopFill")} Stop all</button>` : ""}
			</div>
			${data.stale ? `<div class="stale-banner">${icon("RiErrorWarningLine")} Stale — reconnecting…</div>` : ""}
			${scopeWs ? `<div class="chat-group"><span class="dotp"></span> Resource UI <span style="color:var(--text-subtle);font-weight:370">· this chat</span></div>` : ""}
			${live.length ? `<div role="list">${liveRows(live)}</div>` : `<div class="empty-hint">Nothing running in the background.</div>`}
			${scopeWs ? `<div class="chat-group"><span class="dotp"></span> Changes toolbar refactor</div><div role="list">${liveRows(otherChat)}</div>` : ""}
			<div class="sec-head" style="padding-top:14px"><button data-act="toggle-finished" aria-expanded="${ui.finishedOpen}">${icon(ui.finishedOpen ? "RiArrowDownSLine" : "RiArrowRightSLine")} Finished <span class="n">· ${settled.length}</span></button><span class="spacer"></span><button>Clear</button></div>
			${ui.finishedOpen ? `<div role="list">${settled.map((r) => rowHTML(r, { ...rowOpts, retry: true })).join("")}</div>` : ""}
		</div>
	</div>`;
}
function renderDirectionC(root, data, ui) {
	const trigger = `<button class="ghost-btn" title="Show Activity pane" data-act="noop">${icon("RiLayoutRightLine")}<span class="hide-narrow">Activity</span>${allLive(data).length ? `<span class="dot pulse"></span><span class="count">${allLive(data).length}</span>` : ""}</button>`;
	root.innerHTML = `<div class="frame with-side" data-dir="C">
		<div class="chat-col">
			${headerHTML({ trigger })}
			${messagesHTML(data)}
			${composerHTML()}
		</div>
		${sideToolHTML(data, ui)}
		${confirmHTML(ui, data)}
	</div>`;
}

/* ------------------------------------------------------------------ Direction D: inline receipts */
function renderDirectionD(root, data, ui) {
	const live = allLive(data);
	root.innerHTML = `<div class="frame" data-dir="D">
		${headerHTML({ trigger: triggerHTML(data, { open: ui.popoverOpen }) })}
		${messagesHTML(data, { inlineRoster: true })}
		${live.length ? `<button class="floater" data-act="toggle-popover"><span class="dot"></span>${live.length} working · jump to latest</button>` : ""}
		${composerHTML()}
		${popoverHTML(data, { ...ui, finishedOpen: true })}
		${confirmHTML(ui, data)}
	</div>`;
}

/* ------------------------------------------------------------------ Direction E: pill bar */
function renderDirectionE(root, data, ui) {
	const live = allLive(data);
	const settled = allSettled(data);
	const sel = ui.selectedPill;
	const pill = (r) => {
		const st = visualState(r);
		const name = r.kind === "command" ? r.name : r.roleName;
		const el = st === "queued" ? "queued" : `<span class="elapsed" data-start="${startOf(r)}">${fmtElapsed(Date.now() - startOf(r))}</span>`;
		return `<button class="pill ${sel === r.id ? "active" : ""}" data-act="select-pill" data-id="${r.id}">${icon(r.kind === "command" ? "RiTerminalBoxLine" : "RiRobot2Line")}<span class="st dot-${st}"></span>${esc(name)} <span class="el">${el}</span></button>`;
	};
	const shown = live.slice(0, 5);
	const overflow = live.length - shown.length;
	const current = live.find((r) => r.id === sel) ?? settled.find((r) => r.id === sel);
	const body = current ? `<div class="child-view">
			<div class="cv-head tr-text-metadata">${icon(current.kind === "command" ? "RiTerminalBoxLine" : "RiRobot2Line")} <span class="name">${esc(current.kind === "command" ? current.name : current.roleName)}</span> <span class="st-${visualState(current)}" style="display:inline-flex;align-items:center;gap:4px">${stateIcon(visualState(current))} ${stateLabel(visualState(current), current)}</span> · <span class="elapsed" data-start="${startOf(current)}">${fmtElapsed(Date.now() - startOf(current))}</span>
				<span class="spacer"></span>
				${isLive(current) ? `<button class="btn-outline danger" data-act="stop" data-id="${current.id}">${icon("RiStopFill")} Stop</button>` : ""}
				<button class="btn-outline" data-act="select-pill" data-id="">${icon("RiArrowLeftSLine")} Back to chat</button>
			</div>
			<pre>${current.kind === "command" ? current.tail.map((l, i) => `<span class="${i === current.tail.length - 1 ? "cur" : ""}">${esc(l)}</span>`).join("\n") : `<span class="cur">▸ user</span>  ${esc(current.task)}\n\n<span class="cur">▸ assistant</span>  Scanning apps/web/src for registerToolRenderer…\n<span class="cur">▸ tool</span>  rg registerToolRenderer apps/web/src → 14 matches\n<span class="cur">▸ assistant</span>  ${esc(current.activity ?? "(queued)")}`}</pre>
		</div>`
		: messagesHTML(data);
	root.innerHTML = `<div class="frame pillbar-frame" data-dir="E">
		${headerHTML({ trigger: triggerHTML(data, { open: false }) })}
		<div class="pillbar">
			<button class="pill parent ${sel ? "" : "active"}" data-act="select-pill" data-id="">${icon("RiChat1Line")}<span class="st dot-working"></span>main</button>
			${shown.map(pill).join("")}
			${overflow > 0 ? `<span class="more">+${overflow} more</span>` : ""}
			<span class="spacer"></span>
			<button class="pill" data-act="toggle-popover">${icon("RiHistoryLine")} ${settled.length} finished</button>
		</div>
		${body}
		${composerHTML()}
		${popoverHTML(data, { ...ui, finishedOpen: true })}
		${confirmHTML(ui, data)}
	</div>`;
}

/* ------------------------------------------------------------------ Inspector sheet (F, reused by G) */
function defaultSelection(data) {
	const live = allLive(data);
	return (live.find((r) => visualState(r) === "needs") ?? live[0] ?? allSettled(data)[0])?.id ?? null;
}
function sheetOrder(data) {
	const live = allLive(data);
	return [...live.filter((r) => visualState(r) === "needs"), ...live.filter((r) => visualState(r) !== "needs"), ...allSettled(data)].map((r) => r.id);
}
/* opts.sections = [{ head, rows, group? }] overrides the default Needs you / Active / Finished list;
   opts.pool widens the selectable rows (other chats); opts.toolbar is HTML under the sheet head. */
function sheetHTML(data, ui, opts = {}) {
	const live = allLive(data);
	const settled = allSettled(data);
	const all = opts.pool ?? [...live, ...settled];
	const current = all.find((r) => r.id === ui.selectedRow) ?? all.find((r) => r.id === defaultSelection(data)) ?? all[0];
	const st = current ? visualState(current) : null;
	const detail = current ? `<div class="detail">
		<div class="d-head">${icon(current.kind === "command" ? "RiTerminalBoxLine" : "RiRobot2Line")}<span class="name">${esc(current.kind === "command" ? current.name : current.roleName)}</span><span class="state-inline st-${st}">${stateIcon(st)} ${stateLabel(st, current)}</span><span class="spacer"></span>
			${isLive(current) && st !== "stopping" ? `<button class="btn-outline danger" data-act="stop" data-id="${current.id}" ${data.authoritative ? "" : "disabled"}>${icon("RiStopFill")} Stop</button>` : ""}
			${current.kind === "subagent" ? `<button class="menu-btn" title="Open full transcript">${icon("RiExternalLinkLine")}</button>` : `<button class="menu-btn" title="Copy command">${icon("RiFileCodeLine")}</button>`}
			<button class="menu-btn" data-act="close-sheet" title="Close">${icon("RiCloseLine")}</button></div>
		<div class="d-meta">
			<span><b>${current.kind === "command" ? "Started" : "Created"}</b> ${fmtAgo(startOf(current))}</span>
			${isLive(current) ? `<span><b>Elapsed</b> <span class="elapsed" data-start="${startOf(current)}">${fmtElapsed(Date.now() - startOf(current))}</span></span>` : `<span><b>Duration</b> ${fmtElapsed((current.finishedAt ?? Date.now()) - startOf(current))}</span>`}
			${current.kind === "command" && current.exitCode != null ? `<span><b>Exit</b> <span class="exit ${current.exitCode === 0 ? "ok" : "bad"}">${current.exitCode}</span></span>` : ""}
			${current.model ? `<span><b>Model</b> ${esc(current.model)}</span>` : ""}
			${current.tokens ? `<span><b>Usage</b> ${fmtTokens(current.tokens)}</span>` : ""}
			${current.kind === "command" ? `<span style="flex-basis:100%"><b>Command</b> <code class="tr-code-text-small">${esc(current.command)}</code></span>` : `<span style="flex-basis:100%"><b>Task</b> ${esc(current.task)}</span>`}
			${current.abortReason ? `<span style="flex-basis:100%;color:var(--feedback-error)"><b>Reason</b> ${esc(current.abortReason)}</span>` : ""}
		</div>
		${current.needsInput && isLive(current) ? `<div class="needs-block">${icon("RiQuestionFill")}<div><div>${esc(current.activity)}</div><div class="hint">Answer in the chat — the question card is waiting in the transcript.</div></div></div>` : ""}
		<pre>${current.kind === "command" ? (current.tail ? current.tail.join("\n") + (isLive(current) ? "\n▌" : "") : "No output yet.") : `▸ user\n${esc(current.task)}\n\n▸ assistant\nStarting with the files this touches…\n\n▸ tool  ${esc(current.activity ?? "read apps/web/src/chat/resources/SPEC.md")}\n${isLive(current) ? "…" : "done"}\n\n▸ assistant\n${esc(st === "queued" ? "(queued — waiting for a slot)" : isLive(current) ? (current.activity ?? "Working…") : "Final report delivered to the parent.")}`}</pre>
		<div class="d-foot">${icon("RiInformationLine")} ${current.kind === "command" ? "Last 2,000 lines / 50 KB kept while this host runs." : "Read-only preview; steer from the chat."}<span class="spacer"></span><span><kbd>↑</kbd> <kbd>↓</kbd> switch · <kbd>Esc</kbd> close</span></div>
	</div>` : `<div class="detail"><div class="empty-hint">Nothing to inspect.</div></div>`;
	const listRows = (rows, head, group) => rows.length ? `${group ? `<div class="chat-group">${group}</div>` : ""}<div class="sec-head">${head} <span class="n">· ${rows.length}</span></div>${rows.map((r) => rowHTML(r, { selected: current && r.id === current.id, disabled: !data.authoritative, nest: rows, compact: true })).join("")}` : "";
	const sections = opts.sections ?? [
		{ head: "Needs you", rows: live.filter((r) => visualState(r) === "needs") },
		{ head: "Active", rows: live.filter((r) => visualState(r) !== "needs") },
		{ head: "Finished", rows: settled },
	];
	const liveCount = opts.pool ? opts.pool.filter(isLive).length : live.length;
	return `<div class="sheet ${ui.sheetOpen ? "open" : ""}" role="dialog" aria-label="Resources inspector">
			<div class="list" role="list">
				<div class="pop-head" style="padding:4px 8px 4px"><span class="title">Resources ${data.authoritative ? (liveCount ? `<span class="summary-pill live"><span class="dot"></span>${liveCount} working</span>` : `<span class="summary-pill">idle</span>`) : `<span class="summary-pill">reconnecting</span>`}</span><span class="spacer"></span>${live.filter((r) => r.kind === "subagent").length ? `<button class="menu-btn" title="Stop all subagents" data-act="stop-all">${icon("RiStopFill")}</button>` : ""}</div>
				${opts.toolbar ?? ""}
				${data.stale ? `<div class="stale-banner">${icon("RiErrorWarningLine")} Stale — controls disabled.</div>` : ""}
				${sections.map((sec) => listRows(sec.rows, sec.head, sec.group)).join("")}
			</div>
			${detail}
		</div>`;
}
function renderDirectionF(root, data, ui) {
	root.innerHTML = `<div class="frame tall" data-dir="F">
		${headerHTML({ trigger: triggerHTML(data, { open: ui.sheetOpen }) })}
		${messagesHTML(data)}
		${composerHTML()}
		<div class="scrim ${ui.sheetOpen ? "open" : ""}" data-act="close-sheet"></div>
		${sheetHTML(data, ui)}
		${confirmHTML(ui, data)}
	</div>`;
}

/* ------------------------------------------------------------------ Direction G: combined trigger · dock · inspector */
function renderDirectionG(root, data, ui, key) {
	root.innerHTML = `<div class="frame ${ui.sheetOpen ? "tall" : ""}" data-dir="G" data-ui="${key}">
		${headerHTML({ trigger: triggerHTML(data, { open: ui.sheetOpen }) })}
		<div class="body">
			${messagesHTML(data, { inspectable: true })}
			<div class="scrim ${ui.sheetOpen ? "open" : ""}" data-act="close-sheet"></div>
			${sheetHTML(data, ui)}
		</div>
		${composerHTML(ui.sheetOpen ? "" : dockHTML(data, ui, { inspectable: true }))}
		${confirmHTML(ui, data)}
	</div>`;
}

/* ------------------------------------------------------------------ trigger showcase */
function renderTriggers(root, data) {
	const idle = SCENARIOS.idle.build();
	const needs = SCENARIOS.needs.build();
	const stale = SCENARIOS.stale.build();
	const card = (lbl, html) => `<div class="trigger-card"><div class="demo">${html}</div><div class="lbl">${lbl}</div></div>`;
	root.innerHTML = `<div class="trigger-grid">
		${card("Today: icon · label · bare count. Count only when authoritative; <code>—</code> otherwise.", `<button class="ghost-btn">${icon("RiStackLine")} Resources <span class="count">4</span></button>`)}
		${card("A/B/F: breathing dot + count while anything is live; dot stops when idle.", triggerHTML(data))}
		${card("Needs-you marker (amber) rides on the trigger, so a blocked child is visible with the popover closed.", triggerHTML(needs))}
		${card("Idle: count 0, no motion. The control stays so the Finished list is reachable.", triggerHTML(idle))}
		${card("Unknown authority: em-dash, no motion, tooltip explains; controls disabled inside.", triggerHTML(stale))}
		${card("Wide header variant: words instead of a number.", triggerHTML(needs, { style: "words" }))}
	</div>`;
}

/* ------------------------------------------------------------------ app state + wiring */
const state = {
	theme: "dark",
	scenario: "busy",
	data: null,
	ui: {
		A: { popoverOpen: true, finishedOpen: false, confirmOpen: false },
		B: { popoverOpen: false, finishedOpen: true, confirmOpen: false, dockCollapsed: null, dismissed: new Set() },
		C: { finishedOpen: true, scope: "chat", confirmOpen: false },
		D: { popoverOpen: false, finishedOpen: true, confirmOpen: false },
		E: { popoverOpen: false, selectedPill: "", confirmOpen: false },
		F: { sheetOpen: true, selectedRow: "c1", confirmOpen: false },
		G1: { sheetOpen: false, selectedRow: null, confirmOpen: false, dockCollapsed: null, dismissed: new Set() },
		G2: { sheetOpen: true, selectedRow: "a1", confirmOpen: false, dockCollapsed: null, dismissed: new Set() },
	},
	activeUi: "G2",
};
const RENDERERS = {
	G1: (root, data, ui) => renderDirectionG(root, data, ui, "G1"),
	G2: (root, data, ui) => renderDirectionG(root, data, ui, "G2"),
	A: renderDirectionA, B: renderDirectionB, C: renderDirectionC, D: renderDirectionD, E: renderDirectionE, F: renderDirectionF,
};

function loadScenario(key) {
	state.scenario = key;
	state.data = SCENARIOS[key].build();
	document.querySelectorAll("[data-scenario-blurb]").forEach((el) => { el.textContent = SCENARIOS[key].blurb; });
	renderAll();
}
function renderAll() {
	for (const [k, fn] of Object.entries(RENDERERS)) {
		const root = document.querySelector(`[data-mount="${k}"]`);
		if (root) fn(root, state.data, state.ui[k]);
	}
	const tr = document.querySelector('[data-mount="triggers"]');
	if (tr) renderTriggers(tr, state.data);
}
function find(id) { return [...state.data.commands, ...state.data.subagents, ...(state.extraRows ?? [])].find((r) => r.id === id); }
function requestStop(id) {
	const r = find(id);
	if (!r) return;
	if (r.kind === "command") {
		r.status = "stopping";
		setTimeout(() => { if (r.status === "stopping") { r.status = "stopped"; r.finishedAt = Date.now(); r.exitCode = 130; renderAll(); } }, 1800);
	} else {
		r.status = "aborted"; r.finishedAt = Date.now(); r.abortReason = "Stopped by user";
	}
	renderAll();
}
function stopAllSubagents() {
	for (const a of state.data.subagents) if (isLive(a)) { a.status = "aborted"; a.finishedAt = Date.now(); a.abortReason = "Stopped by user"; }
	renderAll();
}

/* Directions whose trigger opens the inspector sheet instead of a popover. */
const SHEET_DIRS = new Set(["F", "G", "W"]);
function uiKeyOf(frame) { return frame?.dataset.ui ?? frame?.dataset.dir ?? null; }
/* Opening at an explicit row wins; otherwise a needs-you row wins; otherwise keep the last valid selection. */
function openSheet(ui, id) {
	ui.sheetOpen = true;
	if (id && find(id)) { ui.selectedRow = id; return; }
	const needs = allLive(state.data).find((r) => visualState(r) === "needs");
	if (needs) { ui.selectedRow = needs.id; return; }
	if (!(ui.selectedRow && find(ui.selectedRow))) ui.selectedRow = defaultSelection(state.data);
}
document.addEventListener("click", (e) => {
	const t = e.target.closest("[data-act]");
	if (!t) return;
	const frame = t.closest("[data-dir]");
	const dir = frame?.dataset.dir;
	const key = uiKeyOf(frame);
	const ui = key ? state.ui[key] : null;
	if (key) state.activeUi = key;
	const act = t.dataset.act;
	switch (act) {
		case "toggle-popover":
			if (!ui) break;
			if (SHEET_DIRS.has(dir)) { if (ui.sheetOpen) ui.sheetOpen = false; else openSheet(ui, null); }
			else ui.popoverOpen = !ui.popoverOpen;
			break;
		case "inspect": if (ui) openSheet(ui, t.dataset.id); break;
		case "toggle-finished": if (ui) ui.finishedOpen = !ui.finishedOpen; break;
		case "toggle-dock": if (ui) ui.dockCollapsed = !(ui.dockCollapsed ?? (allLive(state.data).length + 1 > 5)); break;
		case "toggle-scope": if (ui) ui.scope = ui.scope === "chat" ? "workspace" : "chat"; break;
		case "select-pill": if (ui) ui.selectedPill = t.dataset.id; break;
		case "close-sheet": if (ui) ui.sheetOpen = false; break;
		case "stop": requestStop(t.dataset.id); return;
		case "dismiss": if (ui) ui.dismissed.add(t.dataset.id); break;
		case "stop-all": if (ui) ui.confirmOpen = true; break;
		case "confirm-cancel": if (ui) ui.confirmOpen = false; break;
		case "confirm-stop-all": if (ui) ui.confirmOpen = false; stopAllSubagents(); return;
		case "noop": break;
	}
	renderAll();
});
document.addEventListener("click", (e) => {
	const row = e.target.closest("[data-dir] .sheet .list .res-row");
	if (!row || e.target.closest("[data-act]")) return;
	const key = uiKeyOf(row.closest("[data-dir]"));
	if (!key) return;
	state.activeUi = key;
	state.ui[key].selectedRow = row.dataset.id;
	renderAll();
});
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") { for (const ui of Object.values(state.ui)) { ui.popoverOpen = false; ui.confirmOpen = false; if ("sheetOpen" in ui) ui.sheetOpen = false; } renderAll(); return; }
	if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
	const ui = state.ui[state.activeUi];
	if (!ui || !ui.sheetOpen) return;
	const order = ui.sheetOrder ? ui.sheetOrder() : sheetOrder(state.data);
	if (!order.length) return;
	const cur = Math.max(0, order.indexOf(ui.selectedRow ?? defaultSelection(state.data)));
	const next = e.key === "ArrowDown" ? Math.min(order.length - 1, cur + 1) : Math.max(0, cur - 1);
	ui.selectedRow = order[next];
	e.preventDefault();
	renderAll();
});

/* theme + scenario controls */
document.querySelectorAll("[data-theme-pick]").forEach((b) => b.addEventListener("click", () => {
	state.theme = b.dataset.themePick;
	document.documentElement.dataset.theme = state.theme;
	document.querySelectorAll("[data-theme-pick]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
document.querySelectorAll("[data-scenario-pick]").forEach((b) => b.addEventListener("click", () => {
	document.querySelectorAll("[data-scenario-pick]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
	loadScenario(b.dataset.scenarioPick);
}));

/* live timers: write elapsed straight to the DOM (T3's trick) without re-rendering */
setInterval(() => {
	const now = Date.now();
	document.querySelectorAll(".elapsed[data-start]").forEach((el) => { el.textContent = fmtElapsed(now - Number(el.dataset.start)); });
}, 1000);

document.documentElement.dataset.theme = state.theme;
loadScenario("busy");
