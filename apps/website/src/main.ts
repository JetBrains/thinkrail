// Progressive enhancement for the IDE-site. Everything here is optional garnish: the page reads
// complete with JS disabled, and every animation is gated on prefers-reduced-motion.

import { initAnalytics } from "./analytics";
import { initGtm } from "./gtm";

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

/* ── Status bar: a line counter that tracks scroll like a cursor ────────── */

const TOTAL_LINES = 2431;
const lnEl = document.getElementById("sb-ln");
if (editor && lnEl) {
	let ticking = false;
	const update = () => {
		ticking = false;
		const range = editor.scrollHeight - editor.clientHeight;
		const ratio = range > 0 ? editor.scrollTop / range : 0;
		lnEl.textContent = `Ln ${Math.max(1, Math.round(ratio * TOTAL_LINES))}, Col 1`;
	};
	editor.addEventListener("scroll", () => {
		if (!ticking) {
			ticking = true;
			requestAnimationFrame(update);
		}
	});
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

/* ── Theme dropdown: chip shows the current palette, menu picks one ─────── */

const themeTrigger = document.getElementById("theme-trigger");
const themeMenu = document.getElementById("theme-menu");
if (themeTrigger && themeMenu) {
	const items = Array.from(
		themeMenu.querySelectorAll<HTMLButtonElement>(".theme-item[data-theme-id]"),
	);
	const currentLabel = document.getElementById("theme-current");
	const triggerSwatch = themeTrigger.querySelector<HTMLElement>(".theme-swatch");

	const apply = (id: string) => {
		document.documentElement.setAttribute("data-theme", id);
		for (const item of items) {
			const active = item.dataset.themeId === id;
			item.setAttribute("aria-checked", String(active));
			if (active) {
				// The item's visible label is the single source of the theme's display name.
				if (currentLabel) currentLabel.textContent = item.textContent?.trim() ?? id;
				triggerSwatch?.setAttribute("data-swatch", id);
			}
		}
		// The palette lives in CSS ([data-theme] custom properties) — read it back rather than
		// duplicating hex values here.
		const chrome = getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim();
		if (chrome) {
			document
				.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
				?.setAttribute("content", chrome);
		}
		try {
			localStorage.setItem("thinkrail-site-theme", id);
		} catch {
			// storage unavailable (private mode) — the switch still applies for this visit
		}
	};

	const setOpen = (open: boolean) => {
		themeMenu.hidden = !open;
		themeTrigger.setAttribute("aria-expanded", String(open));
	};
	const isOpen = () => themeTrigger.getAttribute("aria-expanded") === "true";

	apply(document.documentElement.getAttribute("data-theme") ?? "dark");

	themeTrigger.addEventListener("click", () => {
		const opening = !isOpen();
		setOpen(opening);
		if (opening) items.find((item) => item.getAttribute("aria-checked") === "true")?.focus();
	});
	for (const item of items) {
		item.addEventListener("click", () => {
			apply(item.dataset.themeId ?? "dark");
			setOpen(false);
			themeTrigger.focus();
		});
	}
	themeMenu.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const { activeElement } = document;
		const index = activeElement instanceof HTMLButtonElement ? items.indexOf(activeElement) : -1;
		const delta = event.key === "ArrowDown" ? 1 : -1;
		items[(index + delta + items.length) % items.length]?.focus();
	});
	document.addEventListener("click", (event) => {
		if (!isOpen() || !(event.target instanceof Node)) return;
		if (!themeTrigger.contains(event.target) && !themeMenu.contains(event.target)) setOpen(false);
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isOpen()) {
			setOpen(false);
			themeTrigger.focus();
		}
	});
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
		<svg class="i" aria-hidden="true"><use href="#i-github" /></svg>
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
			// Terminal: to the left of terminal, bottom-aligned with statusbar
			const statusbarRect = statusbar.getBoundingClientRect();
			left = triggerRect.left - tooltipRect.width - 12;
			top = statusbarRect.top - tooltipRect.height;
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
