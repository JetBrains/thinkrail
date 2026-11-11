import type { LocalLocalesSnapshot } from "@thinkrail/contracts";
import { fallbackChain } from "@thinkrail/locales";
import { applyLocale, currentLocale, t } from "@thinkrail/locales/react";
import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";
import { useAppStore } from "../store";
import { effectiveLocale, localOverlays } from "./languages";
import { pushNativeMenuLabels } from "./nativeMenu";

function subscribeLanguages(onChange: () => void): () => void {
	window.addEventListener("languagechange", onChange);
	return () => window.removeEventListener("languagechange", onChange);
}

function readLanguages(): string {
	return typeof navigator === "undefined" ? "" : (navigator.languages ?? []).join(",");
}

export function useSystemLanguages(): string {
	return useSyncExternalStore(subscribeLanguages, readLanguages, readLanguages);
}

export function localeSignature(tag: string, snapshot: LocalLocalesSnapshot | null): string {
	const overlays = localOverlays(snapshot);
	return JSON.stringify([tag, fallbackChain(tag).map((language) => overlays[language] ?? null)]);
}

const INITIAL_SIGNATURE = localeSignature("en", null);

function syncLocale(
	applied: RefObject<string>,
	preference: string,
	snapshot: LocalLocalesSnapshot | null,
	systemLanguages: string,
): void {
	const tag = effectiveLocale(preference, snapshot, systemLanguages.split(","));
	const signature = localeSignature(tag, snapshot);
	if (signature === applied.current) return;
	applied.current = signature;
	void applyLocale(tag, localOverlays(snapshot))
		.catch((error: unknown) => {
			if (applied.current === signature) {
				applied.current = "";
				useAppStore.getState().pushToast({
					variant: "error",
					message: t("settings.language.loadFailed"),
					action: { label: t("common.retry"), onClick: () => retryLocale(applied) },
				});
			}
			throw error;
		})
		.finally(() => {
			document.documentElement.lang = currentLocale();
			pushNativeMenuLabels();
		});
}

function retryLocale(applied: RefObject<string>): void {
	const { locale, localLocales } = useAppStore.getState();
	syncLocale(applied, locale, localLocales, readLanguages());
}

export function useLocaleSync(): void {
	const preference = useAppStore((s) => s.locale);
	const snapshot = useAppStore((s) => s.localLocales);
	const systemLanguages = useSystemLanguages();
	const applied = useRef(INITIAL_SIGNATURE);
	useEffect(() => {
		syncLocale(applied, preference, snapshot, systemLanguages);
	}, [preference, snapshot, systemLanguages]);
}
