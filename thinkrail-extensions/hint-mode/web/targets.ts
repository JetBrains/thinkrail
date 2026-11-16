export interface HintRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface HintRoot<E> {
	querySelectorAll(selector: string): Iterable<E>;
}

export interface HintElement<E> {
	readonly tagName: string;
	readonly parentElement: E | null;
	readonly shadowRoot: HintRoot<E> | null;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	matches(selector: string): boolean;
	getBoundingClientRect(): HintRect;
	checkVisibility?(options?: { opacityProperty?: boolean; visibilityProperty?: boolean }): boolean;
}

export interface HintEnv<E> {
	isTextEntry(element: E): boolean;
	clips(element: E): boolean;
	viewport: { readonly width: number; readonly height: number };
}

export type HintAction = "press" | "focus" | "widget";

interface Scope<E> {
	readonly host: E;
	readonly outer: Scope<E> | null;
}

export interface HintTarget<E> {
	readonly element: E;
	readonly anchor: E;
	readonly action: HintAction;
	readonly scope: Scope<E> | null;
}

const PRESS_ROLES = [
	"button",
	"tab",
	"treeitem",
	"option",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"switch",
	"checkbox",
	"radio",
	"link",
	"combobox",
];
const FOCUS_ROLES = ["listbox", "slider"];
const WIDGET_CLASSES = ["monaco-editor", "xterm"];
const PRESSED_TAGS = new Set(["BUTTON", "A", "AREA", "SUMMARY"]);
const BUTTON_INPUTS = new Set([
	"button",
	"checkbox",
	"color",
	"file",
	"image",
	"radio",
	"reset",
	"submit",
]);

export const HINT_SELECTOR = [
	"a[href]",
	"area[href]",
	"button",
	"input:not([type='hidden'])",
	"select",
	"textarea",
	"summary",
	"[contenteditable]:not([contenteditable='false'])",
	"[tabindex]:not([tabindex^='-'])",
	"[role='feed'] article",
	"[role='feed'] [role='article']",
	...[...PRESS_ROLES, ...FOCUS_ROLES].map((role) => `[role='${role}']`),
	...WIDGET_CLASSES.map((name) => `.${name}`),
].join(", ");

const SHADOW_HOST_SELECTOR = "*";

function hasClass<E extends HintElement<E>>(element: E, name: string): boolean {
	return (element.getAttribute("class") ?? "").split(/\s+/).includes(name);
}

function isWidget<E extends HintElement<E>>(element: E): boolean {
	return WIDGET_CLASSES.some((name) => hasClass(element, name));
}

function isEmpty(rect: HintRect): boolean {
	return rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0;
}

function isReviewProxy<E extends HintElement<E>>(element: E): boolean {
	return element.hasAttribute("data-review-surface") && isEmpty(element.getBoundingClientRect());
}

export function hintAction<E extends HintElement<E>>(
	element: E,
	isTextEntry: (element: E) => boolean,
): HintAction {
	if (isWidget(element)) return "widget";
	const role = element.getAttribute("role") ?? "";
	if (FOCUS_ROLES.includes(role) || isReviewProxy(element)) return "focus";
	const tag = element.tagName.toUpperCase();
	if (tag === "INPUT" && BUTTON_INPUTS.has((element.getAttribute("type") ?? "").toLowerCase())) {
		return "press";
	}
	if (isTextEntry(element)) return "focus";
	if (PRESSED_TAGS.has(tag) || PRESS_ROLES.includes(role)) return "press";
	return "focus";
}

export function isPointerDuplicate<E extends HintElement<E>>(element: E): boolean {
	return (
		element.getAttribute("aria-hidden") === "true" && element.getAttribute("tabindex") === "-1"
	);
}

export function intersect(a: HintRect, b: HintRect): HintRect {
	return {
		left: Math.max(a.left, b.left),
		top: Math.max(a.top, b.top),
		right: Math.min(a.right, b.right),
		bottom: Math.min(a.bottom, b.bottom),
	};
}

interface Ancestry {
	readonly inert: boolean;
	readonly widget: boolean;
	readonly tree: boolean;
	readonly clip: HintRect | null;
}

const NO_ANCESTRY: Ancestry = { inert: false, widget: false, tree: false, clip: null };

function ancestryReader<E extends HintElement<E>>(env: HintEnv<E>) {
	const memo = new Map<E, Ancestry>();
	const parentOf = (element: E, scope: Scope<E> | null): [E, Scope<E> | null] | null => {
		if (element.parentElement !== null) return [element.parentElement, scope];
		return scope ? [scope.host, scope.outer] : null;
	};
	const read = (element: E, scope: Scope<E> | null): Ancestry => {
		const known = memo.get(element);
		if (known) return known;
		const parent = parentOf(element, scope);
		const above = parent ? read(parent[0], parent[1]) : NO_ANCESTRY;
		const rect = element.getBoundingClientRect();
		const ownClip = env.clips(element) && !(rect.left === rect.right && rect.top === rect.bottom);
		const ancestry: Ancestry = {
			inert: above.inert || element.hasAttribute("inert"),
			widget: above.widget || isWidget(element),
			tree: above.tree || element.getAttribute("role") === "tree",
			clip: ownClip ? (above.clip ? intersect(above.clip, rect) : rect) : above.clip,
		};
		memo.set(element, ancestry);
		return ancestry;
	};
	return {
		above(element: E, scope: Scope<E> | null): Ancestry {
			const parent = parentOf(element, scope);
			return parent ? read(parent[0], parent[1]) : NO_ANCESTRY;
		},
		parentOf,
	};
}

function findCandidates<E extends HintElement<E>>(
	root: HintRoot<E>,
	scope: Scope<E> | null,
	out: { element: E; scope: Scope<E> | null }[],
): void {
	for (const element of root.querySelectorAll(HINT_SELECTOR)) out.push({ element, scope });
	for (const host of root.querySelectorAll(SHADOW_HOST_SELECTOR)) {
		if (host.shadowRoot) findCandidates(host.shadowRoot, { host, outer: scope }, out);
	}
}

function isShown<E extends HintElement<E>>(element: E): boolean {
	return element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
}

export function measureTargets<E extends HintElement<E>>(
	targets: readonly HintTarget<E>[],
	env: HintEnv<E>,
): (HintRect | null)[] {
	const ancestry = ancestryReader(env);
	const viewport = { left: 0, top: 0, right: env.viewport.width, bottom: env.viewport.height };
	return targets.map(({ element, anchor, scope }) => {
		if (!isShown(element)) return null;
		const { clip } = ancestry.above(anchor, scope);
		const rect = anchor.getBoundingClientRect();
		const box = intersect(clip ? intersect(rect, clip) : rect, viewport);
		return isEmpty(box) ? null : box;
	});
}

export function collectTargets<E extends HintElement<E>>(
	root: HintRoot<E>,
	env: HintEnv<E>,
): { targets: HintTarget<E>[]; boxes: HintRect[] } {
	const found: { element: E; scope: Scope<E> | null }[] = [];
	findCandidates(root, null, found);
	const ancestry = ancestryReader(env);
	const candidates: HintTarget<E>[] = [];
	for (const { element, scope } of found) {
		const above = ancestry.above(element, scope);
		if (above.inert || above.widget || element.hasAttribute("inert")) continue;
		if (above.tree && isPointerDuplicate(element)) continue;
		if (element.matches(":disabled")) continue;
		const action = hintAction(element, env.isTextEntry);
		const host = isReviewProxy(element) ? ancestry.parentOf(element, scope) : null;
		candidates.push(
			host
				? { element, anchor: host[0], action, scope: host[1] }
				: { element, anchor: element, action, scope },
		);
	}
	const measured = measureTargets(candidates, env);
	const targets: HintTarget<E>[] = [];
	const boxes: HintRect[] = [];
	candidates.forEach((target, index) => {
		const box = measured[index];
		if (!box) return;
		targets.push(target);
		boxes.push(box);
	});
	return { targets, boxes };
}
