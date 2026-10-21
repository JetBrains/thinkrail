import i18next, { type TFunction } from "i18next";
import { type ComponentProps, useSyncExternalStore } from "react";
import { Trans } from "react-i18next";
import { bundledCatalog, type Catalog, EN, type EnglishCatalog, fallbackChain } from "./index";

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

let touched = new Set<string>(["en"]);

export function applyLocale(tag: string, overlays: LocaleOverlays): void {
	const chain = fallbackChain(tag);
	const languages = new Set([...touched, ...chain, ...Object.keys(overlays)]);
	for (const language of languages) {
		const bundled = bundledCatalog(language);
		const overlay = overlays[language];
		i18n.removeResourceBundle(language, NAMESPACE);
		if (bundled || overlay) {
			i18n.addResourceBundle(language, NAMESPACE, { ...bundled, ...overlay }, false, true);
		}
	}
	touched = languages;
	if (i18n.language !== tag) void i18n.changeLanguage(tag);
	publishLocaleChange();
}
