// Progressive enhancement for the IDE-site. Everything here is optional garnish: the page reads
// complete with JS disabled, and every animation is gated on prefers-reduced-motion.

import { initAnalytics } from "./analytics";
import { initGtm } from "./gtm";
import { detectInstallPlatform, type InstallPlatform } from "./installPlatform";

// Production-only, cookieless PostHog (self-gates on hostname). See src/analytics.ts.
initAnalytics();
// Production-only Google Tag Manager (self-gates on hostname). See src/gtm.ts.
initGtm();

const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (motionOK) document.documentElement.classList.add("anim");

const editor = document.getElementById("editor-scroll");

/* ── Top tabs: mirror the right-rail file tree (Table of Contents) ──────── */
// The `.filetree` is the single static source of truth for navigation; the top
// tabs are generated from it so labels + #anchors can never drift into a second
// hardcoded list. Both light up together via the shared scroll-spy below.

const sections = Array.from(document.querySelectorAll<HTMLElement>(".file-section"));
const treeRows = Array.from(document.querySelectorAll<HTMLAnchorElement>(".filetree a.ft-row"));
const tabstrip = document.querySelector<HTMLElement>(".tabstrip");
const tabRows: HTMLAnchorElement[] = [];

if (tabstrip) {
	for (const row of treeRows) {
		const href = row.getAttribute("href");
		if (!href) continue;
		const tab = document.createElement("a");
		tab.className = "tab";
		tab.href = href;
		// Copy the row's leading icon (SVG sprite) so tabs match the tree glyphs.
		const icon = row.querySelector("svg.i");
		if (icon) tab.appendChild(icon.cloneNode(true));
		tab.appendChild(document.createTextNode(row.textContent?.trim() ?? ""));
		tabstrip.appendChild(tab);
		tabRows.push(tab);
	}
}

/* ── Scroll-spy: file-tree rows + top tabs follow the section in view ───── */

function setActiveTreeRow(id: string): void {
	for (const el of [...treeRows, ...tabRows]) {
		const active = el.getAttribute("href") === `#${id}`;
		el.classList.toggle("active", active);
	}
}

if (editor && sections.length > 0) {
	const visible = new Map<string, number>();
	const spy = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
			}
			let best: { id: string; ratio: number } | null = null;
			for (const [id, ratio] of visible) {
				if (ratio > 0 && (best === null || ratio > best.ratio)) best = { id, ratio };
			}
			if (best) setActiveTreeRow(best.id);
		},
		{ root: editor, threshold: [0.05, 0.2, 0.5, 0.8] },
	);
	for (const section of sections) spy.observe(section);
}

/* ── Terminal: OS-synced install replay + ThinkRail logo banner ─────────── */
// The hero install picker is the single source of truth for the command (see the picker block
// below, which calls publishInstallSelection). The terminal subscribes, so it always types the
// command for the OS/shell selected in the hero. On load / OS change it types that command, shows a
// short install sequence, then draws the logo. Clicking the finished terminal replays the logo alone
// plus a GitHub CTA — never the install. Clicks mid-animation are ignored, and prefers-reduced-motion
// renders each end state with no typing or per-line stagger.

interface InstallSelection {
	command: string;
	platform: InstallPlatform;
}
let installSelection: InstallSelection | null = null;
const installSelectionListeners: ((selection: InstallSelection) => void)[] = [];
function publishInstallSelection(selection: InstallSelection): void {
	installSelection = selection;
	for (const listener of installSelectionListeners) listener(selection);
}
function onInstallSelection(listener: (selection: InstallSelection) => void): void {
	installSelectionListeners.push(listener);
	if (installSelection) listener(installSelection);
}

// The ThinkRail logo banner, drawn one line at a time — preserved exactly.
const TERMINAL_LOGO: readonly string[] = [
	"–––––––––––––––––––––––––––––––––^  R–––––––––7^",
	"–––––––––––––––––––––––––––––––:  7–––––––––––––5~",
	"                ...                       .:~R–––R.",
	"–––––––––––––––^  :––––––––––––––––––––––7~.  :5–––T",
	"–––––––––––––––R  ~–––––––––––––––––––––––––^  :––––.",
	"––––––––––~T–––T  .~~~~–––––––––––––––––5–––Y  .––––.",
	"           T–––R  .:::.                 !–––?  .––––.",
	"           T–––R  ^––––.                !–––?,  .––––.",
	"           T–––R  ^––––.                !–––?  ––––.",
	"           T–––R  ^––––.               .T–––?  ––––.",
	"           T–––R  ^––––:^!RY55–––––––––––––~  .––––",
	"           T–––R  ^––––––––––––––––––––––––R:   T–––!",
	"           T–––R  ^––––––R7~^^::::::^^^:.  .~5–––7",
	"           T–––R  ^––––!   :^~~~~~~~^   .T5––––~",
	"           T–––R  ^––––^  ~5––––––––––:  !–––––^",
	"           T–––R  ^––––  .––––––RRR5––––!  :5––––!",
	"           T–––R  ^–––5  :––––~     7––––T   R––––R.",
	"           T–––R  ^–––5  :––––:      ^5––––:  !––––5:",
	"           T–––R  ^–––5  :––––:       .R––––~  ^–––––!",
	"           T–––R  ^–––5  :––––:         !––––7  .Y––––T",
	"           T–––R  ^–––5  :––––:          :5––––.  7––––5:",
	"           T–––R  ^–––5  :––––:            R––––:  ~–––––^",
];

const GITHUB_URL = "https://github.com/JetBrains/thinkrail";
const INSTALL_ARCH: Record<InstallPlatform, string> = {
	macos: "macos-arm64",
	linux: "linux-x64",
	windows: "windows-x64",
};

const terminal = document.querySelector<HTMLElement>(".terminal");
const termScreen = document.getElementById("term-screen");
if (terminal && termScreen) {
	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	const makeLine = (className: string, text = "") => {
		const el = document.createElement("span");
		el.className = className;
		if (text) el.textContent = text;
		return el;
	};

	// A generation counter: each new sequence invalidates any still-running one (so an OS change
	// restarts cleanly). `animating` gates clicks; the initial sequence must finish before replays.
	let generation = 0;
	let animating = false;
	let initialDone = false;

	// The logo is wider than the narrow terminal: fit the longest line to the available width by
	// shrinking the font — the characters are never touched, only the size.
	const maxLogoLen = Math.max(...TERMINAL_LOGO.map((line) => line.length));
	const fitLogo = () => {
		const avail = termScreen.clientWidth - 28; // .term-screen horizontal padding
		if (avail <= 0) return;
		const px = Math.max(4, Math.min(11, Math.floor(avail / (maxLogoLen * 0.6))));
		termScreen.style.setProperty("--term-logo-fs", `${px}px`);
	};

	const typeCommand = async (command: string, gen: number) => {
		const row = makeLine("term-line");
		const prompt = makeLine("term-prompt", "❯");
		const cmd = makeLine("term-cmd");
		const caret = makeLine("term-caret");
		row.append(prompt, document.createTextNode(" "), cmd, caret);
		termScreen.append(row);
		if (motionOK) {
			for (let i = 1; i <= command.length; i += 1) {
				if (gen !== generation) return;
				cmd.textContent = command.slice(0, i);
				await wait(14 + Math.random() * 26);
			}
		} else {
			cmd.textContent = command;
		}
		caret.remove();
	};

	const drawLines = async (
		lines: readonly string[],
		className: string,
		perLineMs: number,
		gen: number,
	) => {
		for (const text of lines) {
			if (gen !== generation) return;
			termScreen.append(makeLine(className, text));
			termScreen.scrollTop = termScreen.scrollHeight;
			if (motionOK && perLineMs > 0) await wait(perLineMs);
		}
	};

	const runInstall = async (selection: InstallSelection) => {
		generation += 1;
		const gen = generation;
		animating = true;
		termScreen.replaceChildren();
		fitLogo();
		await typeCommand(selection.command, gen);
		if (gen !== generation) return;
		await drawLines(
			[
				`⬇ thinkrail latest (${INSTALL_ARCH[selection.platform]}) · sha256 verified ✓`,
				"✓ installed — starting ThinkRail …",
			],
			"term-out",
			420,
			gen,
		);
		if (gen !== generation) return;
		await drawLines(TERMINAL_LOGO, "term-out term-logo", 60, gen);
		if (gen !== generation) return;
		animating = false;
		initialDone = true;
	};

	const replayLogo = async () => {
		if (animating || !initialDone) return;
		generation += 1;
		const gen = generation;
		animating = true;
		termScreen.replaceChildren();
		fitLogo();
		await drawLines(TERMINAL_LOGO, "term-out term-logo", 60, gen);
		if (gen !== generation) return;
		const cta = makeLine("term-out term-cta");
		cta.append(document.createTextNode("Ready for the real thing? → "));
		const link = document.createElement("a");
		link.href = GITHUB_URL;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = "GitHub";
		link.addEventListener("click", (event) => event.stopPropagation());
		cta.append(link);
		termScreen.append(cta);
		termScreen.scrollTop = termScreen.scrollHeight;
		animating = false;
	};

	terminal.addEventListener("click", () => {
		void replayLogo();
	});
	onInstallSelection((selection) => {
		void runInstall(selection);
	});
}

/* ── Chat demo: replay the captured session when it scrolls into view ───── */

const chat = document.getElementById("chat-demo");
if (motionOK && chat) {
	chat.classList.add("armed");
	const steps = Array.from(chat.querySelectorAll<HTMLElement>("[data-step]"));
	let played = false;
	const player = new IntersectionObserver(
		(entries) => {
			if (played || !entries.some((entry) => entry.isIntersecting)) return;
			played = true;
			player.disconnect();
			steps.forEach((step, index) => {
				setTimeout(() => step.classList.add("on"), 250 + index * 550);
			});
		},
		{ root: editor, threshold: 0.35 },
	);
	player.observe(chat);
}

/* ── Theme toggle: dark/light with system preference support ───────────── */

const themeToggle = document.getElementById("theme-toggle");
if (themeToggle) {
	const STORAGE_KEY = "thinkrail-site-theme";
	const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

	// Check if user has made an explicit choice. Legacy multi-theme values (darcula/gruvbox,
	// from the old 4-theme selector) are dark palettes — migrate them to "dark" since the
	// toggle and its icon CSS only understand dark/light.
	const getSavedTheme = (): string | null => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw === null) return null;
			return raw === "light" ? "light" : "dark";
		} catch {
			return null;
		}
	};

	// Get system preference
	const getSystemTheme = (): string => (mediaQuery.matches ? "light" : "dark");

	const apply = (theme: string, save: boolean) => {
		document.documentElement.setAttribute("data-theme", theme);

		// Update aria-label to describe the action
		const nextTheme = theme === "dark" ? "light" : "dark";
		themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);

		// Update theme-color meta tag
		const chrome = getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim();
		if (chrome) {
			document
				.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
				?.setAttribute("content", chrome);
		}

		// Only save if this is an explicit user choice
		if (save) {
			try {
				localStorage.setItem(STORAGE_KEY, theme);
			} catch {
				// storage unavailable (private mode)
			}
		}
	};

	// Initialize: prefer saved choice, fall back to system preference
	const savedTheme = getSavedTheme();
	const initialTheme = savedTheme ?? getSystemTheme();
	apply(initialTheme, false);

	// Toggle on click (always saves as explicit choice)
	themeToggle.addEventListener("click", () => {
		const current = document.documentElement.getAttribute("data-theme") ?? "dark";
		const next = current === "dark" ? "light" : "dark";
		apply(next, true);
	});

	// Follow system changes only if no explicit choice saved
	mediaQuery.addEventListener("change", () => {
		if (!getSavedTheme()) {
			apply(getSystemTheme(), false);
		}
	});
}

/* ── Install platform + Windows shell pickers ───────────────────────────── */

type WindowsShell = "powershell" | "cmd" | "wsl";

interface NavigatorUserAgentData {
	readonly platform?: string;
}

interface NavigatorWithUserAgentData extends Navigator {
	readonly userAgentData?: NavigatorUserAgentData;
}

function platformFrom(value: string | undefined): InstallPlatform | undefined {
	switch (value) {
		case "macos":
		case "linux":
		case "windows":
			return value;
		default:
			return undefined;
	}
}

function windowsShellFrom(value: string | undefined): WindowsShell | undefined {
	switch (value) {
		case "powershell":
		case "cmd":
		case "wsl":
			return value;
		default:
			return undefined;
	}
}

const installPicker = document.querySelector<HTMLElement>("[data-install-picker]");
if (installPicker) {
	const browserNavigator: NavigatorWithUserAgentData = navigator;
	const detectedPlatform = detectInstallPlatform({
		userAgentDataPlatform: browserNavigator.userAgentData?.platform,
		platform: browserNavigator.platform,
		userAgent: browserNavigator.userAgent,
		maxTouchPoints: browserNavigator.maxTouchPoints,
	});
	const platformLabel: Record<InstallPlatform, string> = {
		macos: "macOS",
		linux: "Linux",
		windows: "Windows",
	};

	const platformTabs = document.querySelectorAll<HTMLButtonElement>("[data-install-platform]");
	const platformPanels = document.querySelectorAll<HTMLElement>("[data-install-panel]");
	const shellTabs = document.querySelectorAll<HTMLButtonElement>("[data-windows-shell]");
	const shellPanels = document.querySelectorAll<HTMLElement>("[data-windows-shell-panel]");
	const copyButton = installPicker.querySelector<HTMLElement>(".copy-btn-tabbar");

	// The command currently on screen is the single source of truth for both the copy button and the
	// terminal simulation: visible OS panel -> its visible Windows shell panel (if any) -> the <code>.
	const syncActiveCommand = () => {
		const osPanel = Array.from(platformPanels).find((panel) => !panel.hidden);
		const shellPanel = osPanel?.querySelector<HTMLElement>(
			"[data-windows-shell-panel]:not([hidden])",
		);
		const code = (shellPanel ?? osPanel)?.querySelector(".install-line code");
		const command = code?.textContent?.trim() ?? "";
		if (copyButton) copyButton.dataset.copy = command;
		publishInstallSelection({ command, platform: selectedPlatform });
	};
	let selectedPlatform: InstallPlatform = detectedPlatform ?? "linux";
	const initialShell: WindowsShell = "powershell";

	const updateDetectionNote = () => {
		for (const note of document.querySelectorAll<HTMLElement>("[data-install-detection-note]")) {
			if (selectedPlatform === "windows") {
				note.textContent =
					detectedPlatform === "windows"
						? "Windows detected — choose your shell."
						: "Choose your Windows shell.";
			} else if (detectedPlatform) {
				note.textContent = `Detected ${platformLabel[detectedPlatform]}. You can switch at any time.`;
			} else {
				note.textContent = "Choose your OS. You can switch at any time.";
			}
		}
	};

	const selectPlatform = (platform: InstallPlatform) => {
		selectedPlatform = platform;
		for (const tab of platformTabs) {
			const selected = platformFrom(tab.dataset.installPlatform) === platform;
			tab.setAttribute("aria-selected", String(selected));
			tab.tabIndex = selected ? 0 : -1;
		}
		for (const panel of platformPanels) {
			panel.hidden = platformFrom(panel.dataset.installPanel) !== platform;
		}
		updateDetectionNote();
		syncActiveCommand();
	};

	const selectShell = (shell: WindowsShell) => {
		for (const tab of shellTabs) {
			const selected = windowsShellFrom(tab.dataset.windowsShell) === shell;
			tab.setAttribute("aria-selected", String(selected));
			tab.tabIndex = selected ? 0 : -1;
		}
		for (const panel of shellPanels) {
			panel.hidden = windowsShellFrom(panel.dataset.windowsShellPanel) !== shell;
		}
		syncActiveCommand();
	};

	const nextTab = (
		event: KeyboardEvent,
		button: HTMLButtonElement,
		selector: string,
		activate: (button: HTMLButtonElement) => void,
	) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		const tablist = button.closest<HTMLElement>("[role=tablist]");
		if (!tablist) return;
		const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>(selector));
		const index = tabs.indexOf(button);
		if (index < 0) return;

		let nextIndex = index;
		if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
		if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
		if (event.key === "Home") nextIndex = 0;
		if (event.key === "End") nextIndex = tabs.length - 1;
		const target = tabs[nextIndex];
		if (!target) return;
		event.preventDefault();
		activate(target);
		target.focus();
	};

	for (const tab of platformTabs) {
		const activate = (button: HTMLButtonElement) => {
			const platform = platformFrom(button.dataset.installPlatform);
			if (platform) selectPlatform(platform);
		};
		tab.addEventListener("click", () => activate(tab));
		tab.addEventListener("keydown", (event) =>
			nextTab(event, tab, "[data-install-platform]", activate),
		);
	}

	for (const tab of shellTabs) {
		const activate = (button: HTMLButtonElement) => {
			const shell = windowsShellFrom(button.dataset.windowsShell);
			if (shell) selectShell(shell);
		};
		tab.addEventListener("click", () => activate(tab));
		tab.addEventListener("keydown", (event) =>
			nextTab(event, tab, "[data-windows-shell]", activate),
		);
	}

	selectShell(initialShell);
	selectPlatform(selectedPlatform);
	document.documentElement.classList.add("install-tabs-ready");
}

/* ── Copy affordances ───────────────────────────────────────────────────── */

for (const el of document.querySelectorAll<HTMLElement>("[data-copy]")) {
	el.addEventListener("click", async () => {
		const value = el.dataset.copy;
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			el.classList.add("copied");
			setTimeout(() => el.classList.remove("copied"), 1400);
		} catch {
			// clipboard unavailable — leave the text selectable
		}
	});
}

/* ── Mobile drawer: the right rail slides in like the app's mobile nav ──── */

const navToggle = document.getElementById("nav-toggle");
const railRight = document.getElementById("rail-right");
const backdrop = document.getElementById("rail-backdrop");
if (navToggle && railRight && backdrop) {
	const setOpen = (open: boolean) => {
		railRight.classList.toggle("open", open);
		backdrop.hidden = !open;
		navToggle.setAttribute("aria-expanded", String(open));
	};
	navToggle.addEventListener("click", () => setOpen(!railRight.classList.contains("open")));
	backdrop.addEventListener("click", () => setOpen(false));
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") setOpen(false);
	});
	for (const row of treeRows) row.addEventListener("click", () => setOpen(false));
}

/* ── GitHub stars (best effort) ─────────────────────────────────────────── */

const stars = document.getElementById("gh-stars");
if (stars) {
	fetch("https://api.github.com/repos/JetBrains/thinkrail")
		.then((response) => (response.ok ? response.json() : null))
		.then((data: { stargazers_count?: number } | null) => {
			if (typeof data?.stargazers_count !== "number") return;
			const n = data.stargazers_count;
			stars.textContent = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
			stars.hidden = false;
		})
		.catch(() => {
			// rate-limited or offline — the star count is decorative
		});
}

/* ── Rail note (time-delayed reveal + dismiss) ─────────────────────────── */

const railNote = document.getElementById("rail-note");
const railNoteDismiss = document.getElementById("rail-note-dismiss");
if (railNote && railNoteDismiss) {
	const SHOWN_KEY = "thinkrail-rail-note-shown"; // sessionStorage: seen this session
	const DISMISSED_KEY = "thinkrail-rail-note-dismissed"; // localStorage: dismissed for good
	const REVEAL_DELAY = 5000; // 5 seconds

	// Storage is resolved inside the try — accessing window.localStorage/sessionStorage itself
	// can throw (e.g. a SecurityError when the browser blocks storage), not just getItem/setItem.
	const readFlag = (getStore: () => Storage, key: string): boolean => {
		try {
			return getStore().getItem(key) === "true";
		} catch {
			return false;
		}
	};
	const writeFlag = (getStore: () => Storage, key: string): void => {
		try {
			getStore().setItem(key, "true");
		} catch {
			// storage unavailable — non-fatal
		}
	};

	const dismissed = readFlag(() => window.localStorage, DISMISSED_KEY);
	const shownThisSession = readFlag(() => window.sessionStorage, SHOWN_KEY);

	if (dismissed || shownThisSession) {
		// Never render again — an inline script in index.html already applied "pending"
		// (opacity 0, no flash) before this module ran; collapse it entirely.
		railNote.classList.remove("pending");
		railNote.classList.add("hidden");
	} else {
		// Already "pending" (hidden, no flash) courtesy of the inline script — reveal once after the delay.
		const timerId = window.setTimeout(() => {
			railNote.classList.remove("pending");
			writeFlag(() => window.sessionStorage, SHOWN_KEY);
		}, REVEAL_DELAY);

		// One timer, cleared if the page unloads before it fires.
		window.addEventListener("pagehide", () => window.clearTimeout(timerId), { once: true });
	}

	railNoteDismiss.addEventListener("click", () => {
		railNote.classList.add("hidden");
		writeFlag(() => window.sessionStorage, SHOWN_KEY);
		writeFlag(() => window.localStorage, DISMISSED_KEY);
	});
}

/* ── Mock-disabled tooltips ─────────────────────────────────────────────── */
// Disabled mock UI elements show a compact callout encouraging visitors to try the real product.
// Click-to-open: clicking a disabled region toggles the tooltip; clicking outside (or Escape)
// closes it. The tooltip is anchored to the trigger region, not the cursor.

const mockElements = document.querySelectorAll<HTMLElement>("[data-mock-hint]");
if (mockElements.length > 0) {
	// Create a shared tooltip element with text and CTA
	const tooltip = document.createElement("div");
	tooltip.className = "mock-tooltip";
	tooltip.setAttribute("role", "tooltip");

	// Text message (updated dynamically)
	const text = document.createElement("div");
	text.className = "mock-tooltip-text";
	tooltip.appendChild(text);

	// CTA button (reuses the site's shared `.btn` label typography; only sizing is overridden in CSS)
	const cta = document.createElement("div");
	cta.className = "mock-tooltip-cta";
	cta.innerHTML = `<a class="btn" href="https://github.com/JetBrains/thinkrail" target="_blank" rel="noopener noreferrer">
		<svg class="i i-fill" aria-hidden="true"><use href="#i-github" /></svg>
		Open on GitHub
	</a>`;
	tooltip.appendChild(cta);

	document.body.appendChild(tooltip);

	let currentTarget: HTMLElement | null = null;

	const GAP = 8; // Gap between trigger and tooltip
	const MARGIN = 8; // Viewport margin
	const titlebar = document.querySelector(".titlebar");
	const railRight = document.getElementById("rail-right");
	const statusbar = document.querySelector(".statusbar");

	const positionTooltip = (trigger: HTMLElement) => {
		const triggerRect = trigger.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left: number;
		let top: number;

		// Customize placement per region
		const isTopRegion =
			trigger.classList.contains("tabstrip") || trigger.classList.contains("rail-tabs");
		if (isTopRegion && titlebar && railRight) {
			// Top regions (editor tabs + rail tabs): 12px below titlebar, 12px to the left of right rail
			const titlebarRect = titlebar.getBoundingClientRect();
			const railRect = railRight.getBoundingClientRect();
			left = railRect.left - tooltipRect.width - 12;
			top = titlebarRect.bottom + 12;
		} else if (trigger.classList.contains("term-screen") && statusbar) {
			// Terminal: to the left of terminal, 12px above statusbar
			const statusbarRect = statusbar.getBoundingClientRect();
			left = triggerRect.left - tooltipRect.width - 12;
			top = statusbarRect.top - tooltipRect.height - 12;
		} else {
			// Left sidebar and others: right of trigger (original behavior)
			left = triggerRect.right + GAP;
			top = triggerRect.bottom + GAP;

			// Check if tooltip fits on the right of trigger
			const fitsRight = left + tooltipRect.width + MARGIN <= vw;
			if (!fitsRight) {
				left = triggerRect.left - tooltipRect.width - GAP;
			}
		}

		// Check if tooltip fits below trigger
		const fitsBelow = top + tooltipRect.height + MARGIN <= vh;
		if (!fitsBelow) {
			top = triggerRect.top - tooltipRect.height - GAP;
		}

		// Final clamp to ensure it stays in viewport
		if (left < MARGIN) left = MARGIN;
		if (left + tooltipRect.width > vw - MARGIN) {
			left = vw - tooltipRect.width - MARGIN;
		}
		if (top < MARGIN) top = MARGIN;
		if (top + tooltipRect.height > vh - MARGIN) {
			top = vh - tooltipRect.height - MARGIN;
		}

		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	};

	const showTooltip = (target: HTMLElement) => {
		const hint = target.dataset.mockHint;
		if (!hint) return;

		currentTarget = target;
		text.textContent = hint;
		tooltip.classList.add("visible");
		positionTooltip(target);
	};

	const hideTooltip = () => {
		tooltip.classList.remove("visible");
		currentTarget = null;
	};

	for (const el of mockElements) {
		// Re-enable pointer events so the disabled region is clickable.
		el.style.pointerEvents = "auto";
		// Click toggles the tooltip for this region; the disabled control never navigates.
		el.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (currentTarget === el) hideTooltip();
			else showTooltip(el);
		});
	}

	// Click outside the tooltip (and outside any trigger) closes it.
	document.addEventListener("click", (e) => {
		if (!currentTarget) return;
		const node = e.target as Node | null;
		if (node && (tooltip.contains(node) || currentTarget.contains(node))) return;
		hideTooltip();
	});

	// Escape closes it too.
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && currentTarget) hideTooltip();
	});
}
