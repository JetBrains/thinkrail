import { deriveEditorTabs } from "./editorTabs";
import { detectInstallPlatform, type InstallPlatform } from "./installPlatform";
import { initThemeToggle } from "./theme";

const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (motionOK) document.documentElement.classList.add("anim");

const editor = document.getElementById("editor-scroll");

const sections = Array.from(document.querySelectorAll<HTMLElement>(".file-section"));
const treeRows = Array.from(document.querySelectorAll<HTMLAnchorElement>(".filetree a.ft-row"));
const tabstrip = document.querySelector<HTMLElement>(".tabstrip");
const tabRows: HTMLAnchorElement[] = [];

if (tabstrip) {
	const iconFor = new Map(
		treeRows.map((row) => [row.getAttribute("href"), row.querySelector("svg.i")] as const),
	);
	for (const { href, label } of deriveEditorTabs(
		treeRows.map((row) => ({
			href: row.getAttribute("href"),
			label: row.textContent?.trim() ?? "",
		})),
	)) {
		const tab = document.createElement("a");
		tab.className = "tab";
		tab.href = href;
		const icon = iconFor.get(href);
		if (icon) tab.appendChild(icon.cloneNode(true));
		tab.appendChild(document.createTextNode(label));
		tabstrip.appendChild(tab);
		tabRows.push(tab);
	}
}

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

	let generation = 0;
	let animating = false;
	let initialDone = false;

	const maxLogoLen = Math.max(...TERMINAL_LOGO.map((line) => line.length));
	const fitLogo = () => {
		const avail = termScreen.clientWidth - 28;
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

	window.addEventListener("resize", fitLogo);

	terminal.addEventListener("click", () => {
		void replayLogo();
	});
	const replayButton = terminal.querySelector<HTMLButtonElement>("[data-term-replay]");
	replayButton?.addEventListener("click", (event) => {
		event.stopPropagation();
		void replayLogo();
	});
	onInstallSelection((selection) => {
		void runInstall(selection).then(() => {
			if (replayButton && initialDone) replayButton.hidden = false;
		});
	});
}

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

initThemeToggle();

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
	const platformTabs = document.querySelectorAll<HTMLButtonElement>("[data-install-platform]");
	const platformPanels = document.querySelectorAll<HTMLElement>("[data-install-panel]");
	const shellTabs = document.querySelectorAll<HTMLButtonElement>("[data-windows-shell]");
	const shellPanels = document.querySelectorAll<HTMLElement>("[data-windows-shell-panel]");
	const shellSwitcher = installPicker.querySelector<HTMLElement>(".windows-shell-tabs");

	const syncActiveCommand = () => {
		const osPanel = Array.from(platformPanels).find((panel) => !panel.hidden);
		const shellPanel = osPanel?.querySelector<HTMLElement>(
			"[data-windows-shell-panel]:not([hidden])",
		);
		const code = (shellPanel ?? osPanel)?.querySelector(".install-line code");
		const command = code?.textContent?.trim() ?? "";
		publishInstallSelection({ command, platform: selectedPlatform });
	};
	let selectedPlatform: InstallPlatform = detectedPlatform ?? "linux";
	const initialShell: WindowsShell = "powershell";

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
		if (shellSwitcher) shellSwitcher.hidden = platform !== "windows";
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

for (const el of document.querySelectorAll<HTMLElement>("[data-copy]")) {
	el.addEventListener("click", async () => {
		const value = el.dataset.copy;
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			el.classList.add("copied");
			setTimeout(() => el.classList.remove("copied"), 1400);
		} catch {}
	});
}

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
		.catch(() => {});
}

const railNote = document.getElementById("rail-note");
const railNoteDismiss = document.getElementById("rail-note-dismiss");
if (railNote && railNoteDismiss) {
	const SHOWN_KEY = "thinkrail-rail-note-shown";
	const DISMISSED_KEY = "thinkrail-rail-note-dismissed";
	const REVEAL_DELAY = 5000;

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
		} catch {}
	};

	const dismissed = readFlag(() => window.localStorage, DISMISSED_KEY);
	const shownThisSession = readFlag(() => window.sessionStorage, SHOWN_KEY);

	if (dismissed || shownThisSession) {
		railNote.classList.remove("pending");
		railNote.classList.add("hidden");
	} else {
		const timerId = window.setTimeout(() => {
			railNote.classList.remove("pending");
			writeFlag(() => window.sessionStorage, SHOWN_KEY);
		}, REVEAL_DELAY);

		window.addEventListener("pagehide", () => window.clearTimeout(timerId), { once: true });
	}

	railNoteDismiss.addEventListener("click", () => {
		railNote.classList.add("hidden");
		writeFlag(() => window.sessionStorage, SHOWN_KEY);
		writeFlag(() => window.localStorage, DISMISSED_KEY);
	});
}

const mockElements = document.querySelectorAll<HTMLElement>("[data-mock-hint]");
if (mockElements.length > 0) {
	const tooltip = document.createElement("div");
	tooltip.className = "mock-tooltip";
	tooltip.id = "mock-tooltip";
	tooltip.setAttribute("role", "tooltip");

	const text = document.createElement("div");
	text.className = "mock-tooltip-text";
	tooltip.appendChild(text);

	const cta = document.createElement("div");
	cta.className = "mock-tooltip-cta";
	cta.innerHTML = `<a class="btn" href="https://github.com/JetBrains/thinkrail" target="_blank" rel="noopener noreferrer">
		<svg class="i i-fill" aria-hidden="true"><use href="#i-github" /></svg>
		Open on GitHub
	</a>`;
	tooltip.appendChild(cta);

	document.body.appendChild(tooltip);

	let currentTarget: HTMLElement | null = null;

	const GAP = 8;
	const MARGIN = 8;
	const RAIL_OFFSET = 12;
	const titlebar = document.querySelector(".titlebar");
	const railRight = document.getElementById("rail-right");

	const positionTooltip = (trigger: HTMLElement) => {
		const triggerRect = trigger.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left: number;
		let top: number;

		if (trigger.classList.contains("rail-tabs") && titlebar && railRight) {
			const titlebarRect = titlebar.getBoundingClientRect();
			const railRect = railRight.getBoundingClientRect();
			left = railRect.left - tooltipRect.width - RAIL_OFFSET;
			top = titlebarRect.bottom + RAIL_OFFSET;
		} else {
			left = triggerRect.right + GAP;
			top = triggerRect.bottom + GAP;

			const fitsRight = left + tooltipRect.width + MARGIN <= vw;
			if (!fitsRight) {
				left = triggerRect.left - tooltipRect.width - GAP;
			}
		}

		const fitsBelow = top + tooltipRect.height + MARGIN <= vh;
		if (!fitsBelow) {
			top = triggerRect.top - tooltipRect.height - GAP;
		}

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

		if (currentTarget && currentTarget !== target) {
			currentTarget.setAttribute("aria-expanded", "false");
			currentTarget.removeAttribute("aria-describedby");
		}
		currentTarget = target;
		text.textContent = hint;
		tooltip.classList.add("visible");
		target.setAttribute("aria-expanded", "true");
		target.setAttribute("aria-describedby", tooltip.id);
		positionTooltip(target);
	};

	const hideTooltip = () => {
		tooltip.classList.remove("visible");
		if (currentTarget) {
			currentTarget.setAttribute("aria-expanded", "false");
			currentTarget.removeAttribute("aria-describedby");
		}
		currentTarget = null;
	};

	for (const el of mockElements) {
		el.style.pointerEvents = "auto";
		el.tabIndex = 0;
		el.setAttribute("role", "button");
		const label = el.dataset.mockLabel;
		if (label) el.setAttribute("aria-label", label);
		el.setAttribute("aria-expanded", "false");
		el.setAttribute("aria-controls", tooltip.id);
		const toggle = () => {
			if (currentTarget === el) hideTooltip();
			else showTooltip(el);
		};
		el.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			toggle();
		});
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				toggle();
			}
		});
	}

	document.addEventListener("click", (e) => {
		if (!currentTarget) return;
		const node = e.target as Node | null;
		if (node && (tooltip.contains(node) || currentTarget.contains(node))) return;
		hideTooltip();
	});

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && currentTarget) {
			const trigger = currentTarget;
			hideTooltip();
			trigger.focus();
		}
	});

	window.addEventListener("resize", () => {
		if (currentTarget) positionTooltip(currentTarget);
	});
}
