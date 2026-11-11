import i18next, { type TFunction } from "i18next";
import { type ComponentProps, useSyncExternalStore } from "react";
import { Trans } from "react-i18next";
import {
	BUNDLED_LOCALES,
	bundledCatalog,
	type Catalog,
	completePlurals,
	EN,
	type EnglishCatalog,
	fallbackChain,
	loadBundledCatalog,
} from "./index";

declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "translation";
		resources: { translation: EnglishCatalog };
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

export type Translator = TFunction<"translation">;

const languages = new WeakMap<Translator, string>();

function createTranslator(): Translator {
	const created = i18n.getFixedT(null, NAMESPACE);
	languages.set(created, i18n.language || "en");
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

export function useT(): Translator {
	return useSyncExternalStore(subscribeLocale, currentTranslator, currentTranslator);
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

export function localeOf(translate: Translator): string {
	return languages.get(translate) ?? currentLocale();
}

export type LocaleOverlays = Readonly<Record<string, Catalog>>;

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
			(language) => bundledCatalog(language) || Object.keys(overlays[language] ?? {}).length > 0,
		) ?? "en";
	install(rendered, overlays, languages);
	throw failure.reason;
}

function install(tag: string, overlays: LocaleOverlays, languages: ReadonlySet<string>): void {
	for (const language of languages) {
		const bundled = bundledCatalog(language);
		const local = overlays[language];
		const overlay = local ? completePlurals(language, local) : undefined;
		i18n.removeResourceBundle(language, NAMESPACE);
		if (bundled || overlay) {
			i18n.addResourceBundle(language, NAMESPACE, { ...bundled, ...overlay }, false, true);
		}
	}
	touched = languages;
	if (i18n.language !== tag) void i18n.changeLanguage(tag);
	publishLocaleChange();
}
