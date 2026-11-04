import {
	DEFAULT_CONFIG,
	FONT_ROLES,
	FONT_WEIGHT_OFFSET,
	type FontRole,
	type FontSettings,
	normalizeFontSettings,
	type UserFontFile,
	type UserFontFileOk,
} from "@thinkrail/contracts";
import {
	BASE_FONT_SIZES,
	BASE_TOPBAR_HEIGHTS,
	CODE_DENSE_INSET,
	clampFontScale,
	codeRowHeight,
	codeSize,
	DEFAULT_FONT_SCALE,
	scaledFontSize,
} from "./scale";
import { type BundledFaces, familiesOf, fontStack } from "./stack";

export type FontPreference = FontSettings;

export const DEFAULT_FONT_PREFERENCE: FontPreference = normalizeFontSettings(DEFAULT_CONFIG);

const FAMILY_TOKEN: Record<FontRole, string> = {
	interface: "--tr-font-family-interface",
	code: "--tr-font-family-code",
};
const CODE_SIZE_TOKEN = "--tr-font-size-code";
const DENSE_SIZE_TOKEN = "--tr-font-size-code-dense";
const CODE_ROW_TOKEN = "--tr-code-row-height";
const WEIGHT_OFFSET_TOKEN = "--tr-font-weight-offset";
const LIGATURES_TOKEN = "--tr-font-ligatures-code";

/**
 * Tokens a runtime font scale writes. They are not preferences, but they change the size every
 * consumer measures, so they belong in the revision that tells those consumers to re-measure.
 */
const SCALE_TOKENS = [
	...Object.keys(BASE_FONT_SIZES).map((id) => `--tr-font-size-${id}`),
	CODE_SIZE_TOKEN,
	DENSE_SIZE_TOKEN,
	CODE_ROW_TOKEN,
	...Object.keys(BASE_TOPBAR_HEIGHTS),
];

let bundled: BundledFaces | null = null;

export function bundledFaces(): BundledFaces {
	if (bundled) return bundled;
	const style = getComputedStyle(document.documentElement);
	const faces = Object.fromEntries(
		FONT_ROLES.map((role) => [
			role,
			familiesOf(style.getPropertyValue(`${FAMILY_TOKEN[role]}-default`))[0] ?? "",
		]),
	) as Record<FontRole, string>;
	if (FONT_ROLES.every((role) => faces[role])) bundled = faces;
	return faces;
}

let applied: FontPreference = DEFAULT_FONT_PREFERENCE;
let appliedScale = DEFAULT_FONT_SCALE;
let faceRevision = 0;

function write(root: HTMLElement, token: string, value: string | null): void {
	if (value === null) root.style.removeProperty(token);
	else root.style.setProperty(token, value);
}

function revisionOf(root: HTMLElement): string {
	const tokens = [
		...FONT_ROLES.map((role) => FAMILY_TOKEN[role]),
		CODE_SIZE_TOKEN,
		WEIGHT_OFFSET_TOKEN,
		LIGATURES_TOKEN,
		...SCALE_TOKENS,
	].map((token) => root.style.getPropertyValue(token));
	let hash = 5381;
	for (const char of `${tokens.join("|")}|${faceRevision}`) {
		hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
	}
	return (hash >>> 0).toString(36);
}

function publish(root: HTMLElement): void {
	const revision = revisionOf(root);
	if (root.dataset.fonts === revision) return;
	root.dataset.fontFaces = String(faceRevision);
	root.dataset.fonts = revision;
}

/**
 * Writes every token this module owns, then publishes the revision. The reader's font preference and
 * the interface scale write the same tokens — the code size, the row height code is drawn on, the
 * sizes `typography.json` declares — so they are composed here and applied together. Applied
 * separately they would undo each other: a scale alone is dropped by the next preference write, and
 * a preference alone drops the scale's geometry.
 */
/**
 * Every size token a preference and a scale produce, as the values to write — or `null` to remove
 * the override and let the generated CSS stand. Pure on purpose: the composition of the reader's
 * preference with the interface scale is the part worth testing, and it needs no document.
 *
 * The code trio is written whenever it differs from the stylesheet, which is either because the
 * scale moved it or because the reader picked a size. Its three values derive from one another, so
 * the text and the rows it sits on can never drift apart.
 */
export function scaledTokens(
	preference: FontPreference,
	scale: number,
): Record<string, string | null> {
	const scaled = scale !== DEFAULT_FONT_SCALE;
	const custom = preference.codeFontSize !== DEFAULT_FONT_PREFERENCE.codeFontSize;
	const size = codeSize(preference.codeFontSize, scale);
	const dense = Math.max(1, size - CODE_DENSE_INSET);
	const tokens: Record<string, string | null> = {};
	for (const [id, base] of Object.entries(BASE_FONT_SIZES)) {
		tokens[`--tr-font-size-${id}`] = scaled ? `${scaledFontSize(base, scale)}px` : null;
	}
	tokens[CODE_SIZE_TOKEN] = scaled || custom ? `${size}px` : null;
	tokens[DENSE_SIZE_TOKEN] = scaled || custom ? `${dense}px` : null;
	tokens[CODE_ROW_TOKEN] =
		scaled || custom ? `${codeRowHeight(preference.codeFontSize, scale)}px` : null;
	for (const [token, base] of Object.entries(BASE_TOPBAR_HEIGHTS)) {
		tokens[token] = scaled ? `${Math.round(base * scale)}px` : null;
	}
	return tokens;
}

/**
 * Writes every token this module owns, then publishes the revision. The reader's font preference and
 * the interface scale write the same tokens, so they are composed here and applied together: applied
 * separately they undo each other — a scale alone is dropped by the next preference write, and a
 * preference alone drops the scale's geometry.
 */
function writeFonts(): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	const faces = bundledFaces();
	for (const role of FONT_ROLES) {
		const choice = role === "interface" ? applied.interfaceFont : applied.codeFont;
		write(root, FAMILY_TOKEN[role], fontStack(choice, role, faces));
	}
	for (const [token, value] of Object.entries(scaledTokens(applied, appliedScale))) {
		write(root, token, value);
	}
	write(
		root,
		WEIGHT_OFFSET_TOKEN,
		applied.fontWeightOffset === DEFAULT_FONT_PREFERENCE.fontWeightOffset
			? null
			: String(applied.fontWeightOffset),
	);
	write(
		root,
		LIGATURES_TOKEN,
		applied.codeLigatures === DEFAULT_FONT_PREFERENCE.codeLigatures
			? null
			: applied.codeLigatures
				? "normal"
				: "none",
	);
	publish(root);
}

/** The scale the interface is currently drawn at, as stored by `applyFontScale`. */
export function currentFontScale(): number {
	return appliedScale;
}

/** The dense size code is drawn at right now — what Monaco and Pierre have to agree with. */
export function currentCodeSize(): number {
	return codeSize(applied.codeFontSize, appliedScale);
}

export function applyFontScale(scale: number): number {
	const next = clampFontScale(scale);
	appliedScale = next;
	writeFonts();
	return next;
}

export function applyFontPreference(preference: FontPreference): void {
	applied = preference;
	writeFonts();
}

export function textWeightRange(): readonly [number, number, number] {
	const root = document.documentElement;
	const current = Number.parseFloat(getComputedStyle(document.body).fontWeight);
	const offset = Number(root.style.getPropertyValue(WEIGHT_OFFSET_TOKEN)) || 0;
	const base = current - offset;
	return [base + FONT_WEIGHT_OFFSET.min, base, base + FONT_WEIGHT_OFFSET.max];
}

export function previewFontWeightOffset(offset: number | null): void {
	if (typeof document === "undefined") return;
	if (offset === null) {
		applyFontPreference(applied);
		return;
	}
	const root = document.documentElement;
	write(root, WEIGHT_OFFSET_TOKEN, offset === 0 ? null : String(offset));
	publish(root);
}

const registered = new Map<string, FontFace>();
const faceListeners = new Set<() => void>();

export function subscribeFontFaces(listener: () => void): () => void {
	faceListeners.add(listener);
	return () => faceListeners.delete(listener);
}

export function fontFacesRevision(): number {
	return faceRevision;
}

function weightDescriptor({ min, max }: UserFontFileOk["face"]["weight"]): string {
	return min === max ? String(min) : `${min} ${max}`;
}

export function installUserFonts(
	files: readonly UserFontFile[],
	resolveUrl: (path: string) => string = (path) => path,
): void {
	if (typeof document === "undefined" || typeof FontFace === "undefined") return;
	const wanted = new Map(
		files.filter((file): file is UserFontFileOk => file.ok).map((file) => [file.url, file]),
	);
	let changed = false;
	for (const [url, face] of registered) {
		if (wanted.has(url)) continue;
		document.fonts.delete(face);
		registered.delete(url);
		changed = true;
	}
	for (const [url, file] of wanted) {
		if (registered.has(url)) continue;
		const face = new FontFace(file.face.family, `url("${resolveUrl(url)}")`, {
			style: file.face.style,
			weight: weightDescriptor(file.face.weight),
			display: "block",
		});
		document.fonts.add(face);
		registered.set(url, face);
		changed = true;
	}
	if (!changed) return;
	faceRevision += 1;
	publish(document.documentElement);
	for (const listener of faceListeners) listener();
}
