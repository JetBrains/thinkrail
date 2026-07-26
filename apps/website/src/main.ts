// Progressive enhancement for the IDE-site. Everything here is optional garnish: the page reads
// complete with JS disabled, and every animation is gated on prefers-reduced-motion.

const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (motionOK) document.documentElement.classList.add("anim");

const editor = document.getElementById("editor-scroll");

/* ── Scroll-spy: active tab + file-tree row follow the section in view ──── */

const sections = Array.from(document.querySelectorAll<HTMLElement>(".file-section"));
const tabs = Array.from(document.querySelectorAll<HTMLAnchorElement>(".tabstrip .tab"));
const treeRows = Array.from(document.querySelectorAll<HTMLAnchorElement>(".filetree a.ft-row"));
const rulerTicks = Array.from(document.querySelectorAll<HTMLAnchorElement>(".ruler .ruler-tick"));
// Every affordance that highlights with the section in view: tab strip, files rail, overview ruler.
const navLinks = [...tabs, ...treeRows, ...rulerTicks];

// A section's one-shot replay, played the moment that section becomes the one in view. The spy is the
// single owner of "what's on screen" — demos hang off it rather than each running its own observer.
const replays = new Map<string, () => void>();
let spyRunning = false;

function setActive(id: string): void {
	for (const el of navLinks) {
		const active = el.getAttribute("href") === `#${id}`;
		el.classList.toggle("active", active);
		if (active && el.classList.contains("tab")) {
			el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
		}
	}
	const replay = replays.get(id);
	if (replay) {
		replays.delete(id); // one-shot: scrolling back past a demo doesn't restart it
		replay();
	}
}

if (editor && sections.length > 0) {
	spyRunning = true;
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

/* ── Keyboard: ↑/↓ step the editor through the sections, tile by tile ───── */

if (editor && sections.length > 0) {
	const EPS = 4; // a stop we're already parked on must not count as "the next one"

	/**
	 * Every position ↑/↓ can land on, in scroll order: each section's top, plus a second stop for any
	 * section taller than the pane (its end, aligned to the bottom) so a tall tile is never half-read.
	 * A tile only earns that second stop when what it hides is more than its own bottom padding —
	 * otherwise the extra stop is a few dead pixels and the key looks broken.
	 */
	const stops = (): number[] => {
		const paneTop = editor.getBoundingClientRect().top;
		const max = editor.scrollHeight - editor.clientHeight;
		const clamp = (n: number) => Math.min(Math.max(Math.round(n), 0), max);
		const set = new Set<number>();
		for (const section of sections) {
			const rect = section.getBoundingClientRect();
			const top = rect.top - paneTop + editor.scrollTop;
			const end = top + rect.height - editor.clientHeight;
			const padding = Number.parseFloat(getComputedStyle(section).paddingBottom) || 0;
			set.add(clamp(top));
			if (end - top > padding) set.add(clamp(end));
		}
		return [...set].sort((a, b) => a - b);
	};

	/** Move one stop in `dir`; false when there is none (so the key keeps its default behaviour). */
	const step = (dir: 1 | -1): boolean => {
		const at = editor.scrollTop;
		const list = stops();
		const target =
			dir === 1
				? list.find((stop) => stop > at + EPS)
				: list.reverse().find((stop) => stop < at - EPS);
		if (target === undefined) return false;
		editor.scrollTo({ top: target }); // CSS owns the easing (`scroll-behavior`, off under reduced motion)
		return true;
	};

	document.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		// The theme menu owns ↑/↓ for moving between its items.
		if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
		if (step(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
	});
}

/* ── Scroll position: the status bar's cursor-like line counter, and retiring
   the scroll cue at the end of the document. One listener, one rAF. ─────── */

const TOTAL_LINES = 2431;
const lnEl = document.getElementById("sb-ln");
if (editor) {
	let ticking = false;
	const update = () => {
		ticking = false;
		const range = editor.scrollHeight - editor.clientHeight;
		const ratio = range > 0 ? editor.scrollTop / range : 0;
		if (lnEl) lnEl.textContent = `Ln ${Math.max(1, Math.round(ratio * TOTAL_LINES))}, Col 1`;
		// The cue's chevron promises more below — take it back once there isn't any.
		document.documentElement.classList.toggle("at-end", ratio > 0.995);
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
const typeTarget = document.querySelector<HTMLElement>(".term-cmd");
if (motionOK && terminal && typeTarget) {
	terminal.classList.add("armed");
	// The command ships in the markup — a JS-less (or reduced-motion) visitor must not get output
	// under a bare prompt. Reading it back and clearing is what makes the typing a pure enhancement.
	const text = typeTarget.textContent ?? "";
	typeTarget.textContent = "";
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

/* ── Chat demos: replay when their section is the one you're looking at ──── */

/**
 * Hide a demo's steps and hand its replay to the scroll-spy, which plays it once its section becomes
 * the section in view. Returns whether it armed — without the spy nothing is hidden, so the finished
 * state stays on screen (the same state a JS-less visitor gets).
 */
function armOnFocus(el: HTMLElement, play: () => void): boolean {
	const sectionId = el.closest<HTMLElement>(".file-section")?.id;
	if (!spyRunning || !sectionId) return false;
	el.classList.add("armed");
	replays.set(sectionId, play);
	return true;
}

const chat = document.getElementById("chat-demo");
if (motionOK && chat) {
	const steps = Array.from(chat.querySelectorAll<HTMLElement>("[data-step]"));
	armOnFocus(chat, () => {
		steps.forEach((step, index) => {
			setTimeout(() => step.classList.add("on"), 250 + index * 550);
		});
	});
}

/* ── Why chat: typed question → send → the tab titles itself → the map builds
   itself from YOU outward. Static HTML ships the finished state; this replay
   exists only when motion is allowed. */

const whyChat = document.getElementById("why-chat");
const whyTyped = document.getElementById("why-typed");
const whyCaret = document.getElementById("why-caret");
const whyPlaceholder = document.getElementById("why-placeholder");
// The tab and its files-rail row carry the same name, so the self-titling renames both at once.
const whyNames = Array.from(document.querySelectorAll<HTMLElement>(".why-name"));
if (motionOK && whyChat && whyTyped && whyCaret && whyPlaceholder && whyNames.length > 0) {
	const setWhyName = (name: string) => {
		for (const el of whyNames) el.textContent = name;
	};
	const stepOn = (name: string) =>
		whyChat.querySelector(`[data-step="${name}"]`)?.classList.add("on");
	const build = (selector: string, cls: string) =>
		whyChat.querySelector(selector)?.classList.add(cls);
	const question = "Why ThinkRail? One map, please — not a wall of text.";

	const armed = armOnFocus(whyChat, () => {
		let i = 0;
		const typeNext = () => {
			if (i <= question.length) {
				whyTyped.textContent = question.slice(0, i);
				i += 1;
				setTimeout(typeNext, 16 + Math.random() * 30);
				return;
			}
			setTimeout(() => {
				const send = document.getElementById("why-send");
				send?.classList.add("pressed");
				setTimeout(() => send?.classList.remove("pressed"), 180);
				whyTyped.textContent = "";
				whyTyped.hidden = true;
				whyCaret.hidden = true;
				whyPlaceholder.hidden = false;
				stepOn("user");
				setTimeout(() => setWhyName("Why ThinkRail?"), 500);
				setTimeout(() => stepOn("act"), 800);
				setTimeout(() => stepOn("line1"), 1500);
				const T = 2100;
				setTimeout(() => stepOn("map"), T);
				setTimeout(() => build(".metro-hub", "in"), T + 260);
				// Right side top-to-bottom, then left side top-to-bottom.
				[".ln-spec", ".ln-work", ".ln-ide", ".ln-eng", ".ln-rail", ".ln-open"].forEach((sel, k) => {
					setTimeout(() => build(sel, "built"), T + 700 + k * 560);
				});
				setTimeout(() => build(".ln-orbit", "built"), T + 4600);
				setTimeout(() => build(".ln-stub", "built"), T + 5350);
				setTimeout(() => build(".metro-trains", "go"), T + 5750);
				setTimeout(() => stepOn("done"), T + 6600);
			}, 350);
		};
		setTimeout(typeNext, 600);
	});

	// Rewind to the pre-replay state — but only once the replay is guaranteed to run, so a missing
	// spy leaves the finished chat (named tab, idle composer) rather than a permanently blank one.
	if (armed) {
		setWhyName("chat");
		whyPlaceholder.hidden = true;
		whyTyped.hidden = false;
		whyCaret.hidden = false;
	}
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

	apply(document.documentElement.getAttribute("data-theme") ?? "light");

	themeTrigger.addEventListener("click", () => {
		const opening = !isOpen();
		setOpen(opening);
		if (opening) items.find((item) => item.getAttribute("aria-checked") === "true")?.focus();
	});
	for (const item of items) {
		item.addEventListener("click", () => {
			apply(item.dataset.themeId ?? "light");
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
// The drawer's three state writes always travel together, so closing it is one call — the decoy
// handler below needs it too (tapping a fake control inside the drawer must reveal what it points at).
let closeRail = (): void => {};
if (navToggle && railRight && backdrop) {
	const setOpen = (open: boolean) => {
		railRight.classList.toggle("open", open);
		backdrop.hidden = !open;
		navToggle.setAttribute("aria-expanded", String(open));
	};
	closeRail = () => setOpen(false);
	navToggle.addEventListener("click", () => setOpen(!railRight.classList.contains("open")));
	backdrop.addEventListener("click", () => setOpen(false));
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") setOpen(false);
	});
	for (const row of treeRows) row.addEventListener("click", () => setOpen(false));
}

/* ── Decoys: every fake control sells the install ────────────────────────── */

const installLine = document.querySelector<HTMLElement>(".install-line");
const installHint = document.getElementById("install-hint");
if (installLine && installHint) {
	const HINT_MS = 9600; // the staged reveal eats ~2s of this before the answer is up
	const hintSteps = Array.from(installHint.querySelectorAll<HTMLElement>("[data-step]"));
	const typing = installHint.querySelector<HTMLElement>(".hint-typing");
	let timers: number[] = [];
	const after = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
	const stepOn = (name: string) =>
		installHint.querySelector(`[data-step="${name}"]`)?.classList.add("on");

	/**
	 * Take the whole thing down: pending beats, the callout, the spotlight, and the listeners that
	 * watch for the interruption. Doubles as the dismiss handler, so the next click or key ends it —
	 * an 8-second overlay you cannot get out of is worse than one you miss.
	 */
	const hide = (): void => {
		for (const timer of timers) clearTimeout(timer);
		timers = [];
		installLine.classList.remove("nudge");
		installHint.classList.remove("on");
		document.documentElement.classList.remove("hint-on");
		document.removeEventListener("click", hide);
		document.removeEventListener("keydown", hide);
	};

	// One delegated listener rather than a handler per decoy — the marked set is `[data-demo]` in the
	// markup, so adding a fake control never means remembering to wire it here.
	document.addEventListener("click", (event) => {
		if (!(event.target instanceof Element)) return;
		if (!event.target.closest("[data-demo]")) return;
		event.preventDefault(); // some decoys sit inside a real link (the tab close glyphs)
		// Clearing first also detaches the dismiss listeners, so this very click can't cut short the
		// replay it just asked for — a removed listener is skipped for the event already in flight.
		hide();
		closeRail();
		document.getElementById("readme")?.scrollIntoView();
		installHint.classList.add("on");
		document.documentElement.classList.add("hint-on"); // spotlight: dim the rest of the shell
		// Re-arm across a frame so a second click replays the sweep instead of doing nothing.
		requestAnimationFrame(() => installLine.classList.add("nudge"));

		if (motionOK) {
			// The exchange plays out: question, the agent thinking, the answer, then the arrows. Without
			// motion the CSS never hid any of it, so there is nothing to stage.
			for (const step of hintSteps) step.classList.remove("on");
			typing?.classList.remove("gone");
			after(250, () => stepOn("q"));
			after(800, () => stepOn("typing"));
			after(1800, () => {
				typing?.classList.add("gone");
				stepOn("a");
			});
			after(2300, () => stepOn("arrows"));
		}
		// Armed a tick later so the opening click is long past before anything listens for the next one.
		after(0, () => {
			document.addEventListener("click", hide);
			document.addEventListener("keydown", hide);
		});
		after(HINT_MS, hide);
	});
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
