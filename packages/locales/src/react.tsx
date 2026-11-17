import i18next, { type TFunction } from "i18next";
import { type ComponentProps, useSyncExternalStore } from "react";
import { Trans } from "react-i18next";
import {
	BUNDLED_LOCALES,
	baseLanguage,
	bundledCatalog,
	type Catalog,
	canonicalLocale,
	completePlurals,
	EN,
	type EnglishCatalog,
	type ExtensionNamespace,
	type ExtensionTranslations,
	extensionNamespace,
	fallbackChain,
	loadBundledCatalog,
	validateCatalog,
} from "./index";

declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "translation";
		resources: { translation: EnglishCatalog } & Record<ExtensionNamespace, Record<string, string>>;
		keySeparator: false;
		nsSeparator: false;
		returnEmptyString: false;
	}
}

const NAMESPACE = "translation";

export const i18n = i18next.createInstance();

void i18n.init({
	lng: "en",
	fallbackLng: (code: string) => fallbackChain(code).slice(1),
	load: "currentOnly",
	resources: { en: { [NAMESPACE]: EN } },
	initAsync: false,
	keySeparator: false,
	nsSeparator: false,
	returnEmptyString: false,
	interpolation: { escapeValue: false },
});

export const t = i18n.t.bind(i18n);

export type ExtensionTranslator = TFunction<ExtensionNamespace>;
export type Translator = TFunction<"translation">;

const languages = new WeakMap<Translator | ExtensionTranslator, string>();
const scopedTranslators = new WeakMap<Translator, Map<string, ExtensionTranslator>>();

interface RegisteredTranslations {
	defaultLocale: string;
	catalogs: ReadonlyMap<string, Catalog>;
	languages: Set<string>;
}

const extensions = new Map<string, RegisteredTranslations>();
let currentOverlays: LocaleOverlays = {};

function createTranslator(): Translator {
	const created = i18n.getFixedT(null, NAMESPACE);
	languages.set(created, i18n.language || "en");
	return created;
}

export function extensionTranslator(translate: Translator, name: string): ExtensionTranslator {
	let scoped = scopedTranslators.get(translate);
	if (!scoped) {
		scoped = new Map();
		scopedTranslators.set(translate, scoped);
	}
	let created = scoped.get(name);
	if (!created) {
		const locale = localeOf(translate);
		const fallback = extensions.get(name)?.defaultLocale ?? locale;
		const chain = [...new Set([locale, baseLanguage(locale), fallback, baseLanguage(fallback)])];
		created = i18n.getFixedT(chain, extensionNamespace(name));
		scoped.set(name, created);
		languages.set(created, locale);
	}
	return created;
}

let translator: Translator = createTranslator();
const listeners = new Set<() => void>();

function subscribeLocale(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function currentTranslator(): Translator {
	return translator;
}

function publishLocaleChange(): void {
	translator = createTranslator();
	for (const listener of listeners) listener();
}

export function useT(extension: string): ExtensionTranslator;
export function useT(): Translator;
export function useT(extension?: string): Translator | ExtensionTranslator {
	const translate = useSyncExternalStore(subscribeLocale, currentTranslator, currentTranslator);
	return extension === undefined ? translate : extensionTranslator(translate, extension);
}

export function T(props: ComponentProps<typeof Trans>) {
	const translate = useT();
	const tOptions = props.tOptions ?? {};
	return (
		<Trans
			{...props}
			t={translate}
			i18n={i18n}
			tOptions={{ ...tOptions, interpolation: { ...tOptions.interpolation, escapeValue: true } }}
			shouldUnescape
		/>
	);
}

export function currentLocale(): string {
	return i18n.language || "en";
}

export function localeOf(translate: Translator | ExtensionTranslator): string {
	return languages.get(translate) ?? currentLocale();
}

export type LocaleOverlays = Readonly<Record<string, Catalog>>;

function installExtension(name: string, entry: RegisteredTranslations): void {
	const namespace = extensionNamespace(name);
	const prefix = `${namespace}:`;
	const reference = entry.catalogs.get(entry.defaultLocale) ?? {};
	const languages = new Set([
		...entry.languages,
		...entry.catalogs.keys(),
		...Object.keys(currentOverlays),
	]);
	for (const language of languages) {
		const raw = Object.fromEntries(
			Object.entries(currentOverlays[language] ?? {})
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, value]) => [key.slice(prefix.length), value]),
		);
		const validated = validateCatalog(raw, reference);
		const overlay = validated.ok ? completePlurals(language, validated.strings, reference) : {};
		i18n.removeResourceBundle(language, namespace);
		i18n.addResourceBundle(language, namespace, { ...entry.catalogs.get(language), ...overlay });
	}
	entry.languages = languages;
}

export function registerExtensionTranslations(
	name: string,
	definition: ExtensionTranslations,
): () => void {
	const defaultLocale = canonicalLocale(definition.defaultLocale);
	if (!name || !defaultLocale)
		throw new Error("Extension translations need a name and default locale");
	const namespace = extensionNamespace(name);
	const catalogs = new Map<string, Catalog>();
	for (const [tag, catalog] of Object.entries(definition.catalogs)) {
		const canonical = canonicalLocale(tag);
		if (!canonical || catalogs.has(canonical)) throw new Error("Invalid extension catalog locale");
		catalogs.set(canonical, catalog);
	}
	const rawDefault = catalogs.get(defaultLocale);
	if (!rawDefault || typeof rawDefault !== "object" || Array.isArray(rawDefault)) {
		throw new Error("Extension translations need a default catalog");
	}
	const source = Object.fromEntries(
		Object.entries(rawDefault).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
	const validatedDefault = validateCatalog(source, source);
	if (
		!validatedDefault.ok ||
		Object.keys(validatedDefault.strings).length === 0 ||
		Object.keys(validatedDefault.strings).length !== Object.keys(rawDefault).length
	) {
		throw new Error("Extension translations need non-empty default strings");
	}
	for (const [tag, catalog] of catalogs) {
		const validated = validateCatalog(catalog, validatedDefault.strings);
		catalogs.set(
			tag,
			completePlurals(tag, validated.ok ? validated.strings : {}, validatedDefault.strings),
		);
	}
	const entry: RegisteredTranslations = {
		defaultLocale,
		catalogs,
		languages: extensions.get(name)?.languages ?? new Set(),
	};
	extensions.set(name, entry);
	installExtension(name, entry);
	publishLocaleChange();
	return () => {
		if (extensions.get(name) !== entry) return;
		extensions.delete(name);
		for (const language of entry.languages) {
			i18n.removeResourceBundle(language, namespace);
		}
		publishLocaleChange();
	};
}

let touched: ReadonlySet<string> = new Set(["en"]);
let latestApply = 0;

export async function applyLocale(tag: string, overlays: LocaleOverlays): Promise<void> {
	const chain = fallbackChain(tag);
	const languages = new Set([...touched, ...chain, ...Object.keys(overlays)]);
	const apply = ++latestApply;
	const pending = chain.filter(
		(language) => BUNDLED_LOCALES.includes(language) && !bundledCatalog(language),
	);
	if (pending.length === 0) {
		install(tag, overlays, languages);
		return;
	}
	const results = await Promise.allSettled(pending.map(loadBundledCatalog));
	if (apply !== latestApply) return;
	const failure = results.find((result) => result.status === "rejected");
	if (!failure) {
		install(tag, overlays, languages);
		return;
	}
	const rendered =
		chain.find(
			(language) =>
				bundledCatalog(language) ||
				Object.keys(overlays[language] ?? {}).some((key) => !key.startsWith("extension:")),
		) ?? "en";
	install(rendered, overlays, languages);
	throw failure.reason;
}

function install(tag: string, overlays: LocaleOverlays, languages: ReadonlySet<string>): void {
	for (const language of languages) {
		const bundled = bundledCatalog(language);
		const local = overlays[language];
		const overlay = local
			? completePlurals(
					language,
					Object.fromEntries(
						Object.entries(local).filter(([key]) => !key.startsWith("extension:")),
					),
				)
			: undefined;
		i18n.removeResourceBundle(language, NAMESPACE);
		if (bundled || overlay) {
			i18n.addResourceBundle(language, NAMESPACE, { ...bundled, ...overlay }, false, true);
		}
	}
	currentOverlays = overlays;
	for (const [name, entry] of extensions) installExtension(name, entry);
	touched = languages;
	if (i18n.language !== tag) void i18n.changeLanguage(tag);
	publishLocaleChange();
}
