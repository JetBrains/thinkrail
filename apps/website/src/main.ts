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

/* ── Scroll-spy: file-tree rows follow the section in view ─────────────── */
// Top tabs are now decorative editor tabs; scroll-spy only updates file tree navigation.

const sections = Array.from(document.querySelectorAll<HTMLElement>(".file-section"));
const treeRows = Array.from(document.querySelectorAll<HTMLAnchorElement>(".filetree a.ft-row"));

function setActiveTreeRow(id: string): void {
	for (const el of treeRows) {
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

/* ── Terminal: type the install command, then reveal the output ─────────── */

const terminal = document.querySelector<HTMLElement>(".terminal");
const typeTarget = document.querySelector<HTMLElement>(".term-cmd[data-type]");
if (motionOK && terminal && typeTarget) {
	terminal.classList.add("armed");
	const text = typeTarget.dataset.type ?? "";
	const outs = Array.from(terminal.querySelectorAll<HTMLElement>("[data-out]"));
	const caret = terminal.querySelector<HTMLElement>(".term-caret");
	let i = 0;
	const typeNext = () => {
		if (i <= text.length) {
			typeTarget.textContent = text.slice(0, i);
			i += 1;
			setTimeout(typeNext, 14 + Math.random() * 26);
			return;
		}
		outs.forEach((out, index) => {
			setTimeout(
				() => {
					out.style.visibility = "visible";
					if (index === outs.length - 1 && caret) caret.remove();
				},
				350 + index * 420,
			);
		});
	};
	setTimeout(typeNext, 900);
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

	for (const marker of document.querySelectorAll<HTMLElement>("[data-detected-platform]")) {
		marker.hidden = platformFrom(marker.dataset.detectedPlatform) !== detectedPlatform;
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
// Disabled mock UI elements show a rich callout encouraging visitors to try the real product.
// Tooltip is anchored to the trigger region, not the cursor.

const mockElements = document.querySelectorAll<HTMLElement>("[data-mock-hint]");
if (mockElements.length > 0) {
	// Create a shared tooltip element with icon, text, and CTA
	const tooltip = document.createElement("div");
	tooltip.className = "mock-tooltip";
	tooltip.setAttribute("role", "tooltip");

	// Info icon (uses the SVG sprite)
	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.setAttribute("class", "mock-tooltip-icon");
	icon.setAttribute("aria-hidden", "true");
	const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
	use.setAttribute("href", "#i-info");
	icon.appendChild(use);
	tooltip.appendChild(icon);

	// Text message (updated dynamically)
	const text = document.createElement("div");
	text.className = "mock-tooltip-text";
	tooltip.appendChild(text);

	// CTA button (reuses hero button styling)
	const cta = document.createElement("div");
	cta.className = "mock-tooltip-cta";
	cta.innerHTML = `<a href="https://github.com/JetBrains/thinkrail" target="_blank" rel="noopener noreferrer">
		<svg class="i i-fill" aria-hidden="true"><use href="#i-github" /></svg>
		Star on GitHub
	</a>`;
	tooltip.appendChild(cta);

	document.body.appendChild(tooltip);

	let hideTimeout: ReturnType<typeof setTimeout> | null = null;
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
		// Cancel any pending hide
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}

		// If already showing for this target, don't restart animation
		if (currentTarget === target) return;

		const hint = target.dataset.mockHint;
		if (!hint) return;

		currentTarget = target;
		text.textContent = hint;
		tooltip.classList.add("visible");
		positionTooltip(target);
	};

	const hideTooltip = () => {
		hideTimeout = setTimeout(() => {
			tooltip.classList.remove("visible");
			currentTarget = null;
		}, 200); // Grace delay allows moving cursor to tooltip
	};

	const cancelHide = () => {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
	};

	// Keep tooltip open when hovering the tooltip itself (for clicking the CTA)
	tooltip.addEventListener("mouseenter", cancelHide);
	tooltip.addEventListener("mouseleave", hideTooltip);

	for (const el of mockElements) {
		// Re-enable pointer events for hover detection, but prevent clicks
		el.style.pointerEvents = "auto";
		el.addEventListener("mouseenter", () => showTooltip(el));
		el.addEventListener("mouseleave", hideTooltip);
		// Block clicks on the element itself
		el.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
	}
}
