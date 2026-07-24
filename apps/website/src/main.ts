// Progressive enhancement for the IDE-site. Everything here is optional garnish: the page reads
// complete with JS disabled, and every animation is gated on prefers-reduced-motion.

const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (motionOK) document.documentElement.classList.add("anim");

const editor = document.getElementById("editor-scroll");

/* ── Scroll-spy: active tab + file-tree row follow the section in view ──── */

const sections = Array.from(document.querySelectorAll<HTMLElement>(".file-section"));
const tabs = Array.from(document.querySelectorAll<HTMLAnchorElement>(".tabstrip .tab"));
const treeRows = Array.from(document.querySelectorAll<HTMLAnchorElement>(".filetree a.ft-row"));

function setActive(id: string): void {
	for (const el of [...tabs, ...treeRows]) {
		const active = el.getAttribute("href") === `#${id}`;
		el.classList.toggle("active", active);
		if (active && el.classList.contains("tab")) {
			el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
		}
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
			if (best) setActive(best.id);
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
		const index = items.findIndex((item) => item === document.activeElement);
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
