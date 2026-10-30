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
import { type BundledFaces, familiesOf, fontStack } from "./stack";

export type FontPreference = FontSettings;

export const DEFAULT_FONT_PREFERENCE: FontPreference = normalizeFontSettings(DEFAULT_CONFIG);

const FAMILY_TOKEN: Record<FontRole, string> = {
	interface: "--tr-font-family-interface",
	code: "--tr-font-family-code",
};
const CODE_SIZE_TOKEN = "--tr-font-size-code";
const CODE_ROW_TOKEN = "--tr-code-row-height";
const WEIGHT_OFFSET_TOKEN = "--tr-font-weight-offset";
const LIGATURES_TOKEN = "--tr-font-ligatures-code";

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
let faceRevision = 0;

function write(root: HTMLElement, token: string, value: string | null): void {
	if (value === null) root.style.removeProperty(token);
	else root.style.setProperty(token, value);
}

function denseCodeRowHeight(root: HTMLElement): number {
	const probe = document.createElement("span");
	probe.style.setProperty("font-size", "var(--tr-font-size-code-dense)");
	probe.style.setProperty("position", "absolute");
	probe.style.setProperty("visibility", "hidden");
	root.append(probe);
	const size = Number.parseFloat(getComputedStyle(probe).fontSize);
	probe.remove();
	const lineHeight = Number.parseFloat(
		getComputedStyle(root).getPropertyValue("--tr-line-height-default"),
	);
	return Math.round(size * lineHeight);
}

function revisionOf(root: HTMLElement): string {
	const tokens = [
		...FONT_ROLES.map((role) => FAMILY_TOKEN[role]),
		CODE_SIZE_TOKEN,
		WEIGHT_OFFSET_TOKEN,
		LIGATURES_TOKEN,
	].map((token) => root.style.getPropertyValue(token));
	let hash = 5381;
	for (const char of `${tokens.join("|")}|${faceRevision}`) {
		hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
	}
	return (hash >>> 0).toString(36);
}

function publish(root: HTMLElement): void {
	const revision = revisionOf(root);
	if (root.dataset.fonts !== revision) root.dataset.fonts = revision;
}

export function applyFontPreference(preference: FontPreference): void {
	applied = preference;
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	const faces = bundledFaces();
	for (const role of FONT_ROLES) {
		const choice = role === "interface" ? preference.interfaceFont : preference.codeFont;
		write(root, FAMILY_TOKEN[role], fontStack(choice, role, faces));
	}
	const sized = preference.codeFontSize !== DEFAULT_FONT_PREFERENCE.codeFontSize;
	write(root, CODE_SIZE_TOKEN, sized ? `${preference.codeFontSize}px` : null);
	write(root, CODE_ROW_TOKEN, sized ? `${denseCodeRowHeight(root)}px` : null);
	write(
		root,
		WEIGHT_OFFSET_TOKEN,
		preference.fontWeightOffset === DEFAULT_FONT_PREFERENCE.fontWeightOffset
			? null
			: String(preference.fontWeightOffset),
	);
	write(
		root,
		LIGATURES_TOKEN,
		preference.codeLigatures === DEFAULT_FONT_PREFERENCE.codeLigatures
			? null
			: preference.codeLigatures
				? "normal"
				: "none",
	);
	publish(root);
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
