#!/usr/bin/env bun
/**
 * i18n coverage report.
 *
 * Reports how much of the message registry each catalog covers, and — because a key the catalog
 * misses silently returns its English source — lists the untranslated keys so a partial translation
 * is a known quantity instead of an invisible one.
 *
 *   bun scripts/i18n-coverage.ts            # summary per locale
 *   bun scripts/i18n-coverage.ts --missing  # print the untranslated keys
 *   bun scripts/i18n-coverage.ts --check    # exit 1 when any locale is below --min (default 100)
 */
import { IDENTICAL_KEYS } from "../src/i18n/catalogs/zh-CN";
import { LOCALES, type Locale } from "../src/i18n/locale";
import { CATALOGS, type Catalog, MESSAGE_KEYS } from "../src/i18n/registry";

const args = new Set(process.argv.slice(2));
const listMissing = args.has("--missing");
const check = args.has("--check");
const minIndex = process.argv.indexOf("--min");
const min = minIndex >= 0 ? Number(process.argv[minIndex + 1]) : 100;

/**
 * A key is untranslated when the catalog omits it, or carries the English source unchanged — unless
 * it is one of the deliberately identical keys (product names, CLI commands, byte sizes).
 */
function missing(catalog: Catalog, locale: Locale): string[] {
	// English *is* the source copy — its keys are the text they stand for, so it cannot be missing any.
	if (locale === "en") return [];
	return MESSAGE_KEYS.filter(
		(key) => !IDENTICAL_KEYS.has(key) && (catalog[key] === undefined || catalog[key] === key),
	);
}

function unused(catalog: Catalog): string[] {
	const keys = new Set<string>(MESSAGE_KEYS);
	return Object.keys(catalog).filter((key) => !keys.has(key));
}

let failed = false;
for (const locale of LOCALES) {
	const catalog = CATALOGS[locale as Locale];
	const absent = missing(catalog, locale as Locale);
	const covered = MESSAGE_KEYS.length - absent.length;
	const percent = (covered / MESSAGE_KEYS.length) * 100;
	const stale = unused(catalog);
	// English *is* the source: its keys are the copy, so it is complete by construction.
	const complete = locale === "en" ? 100 : percent;
	console.log(
		`${locale}: ${complete === 100 && locale === "en" ? `${MESSAGE_KEYS.length}/${MESSAGE_KEYS.length} (source)` : `${covered}/${MESSAGE_KEYS.length} (${percent.toFixed(1)}%)`}` +
			`${stale.length > 0 ? `  · ${stale.length} catalog key(s) absent from the registry` : ""}`,
	);
	if (listMissing && absent.length > 0) {
		for (const key of absent) console.log(`  missing: ${key}`);
	}
	if (complete < min) failed = true;
}

if (check && failed) {
	console.error(`\ni18n-coverage: below the ${min}% floor`);
	process.exit(1);
}
