import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	InMemoryCredentialStore,
	type Model,
	type ModelsRefreshResult,
} from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ModelCatalogEntry } from "@thinkrail/contracts";
import {
	clampThinkingForModel,
	collapsedRefs,
	getDefaultModel,
	listModelCatalog,
	orderModels,
	parseModelSortKey,
	setEnabledModels,
	setModelCatalogPublisher,
	toWireModel,
} from "./modelCatalog";
import { configurePiRuntime } from "./piRuntime";

/** A complete model definition for `registerProvider` (faux defaults are looser). */
function modelDef(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

// Two faux providers so provider grouping is observable; `catalog` carries the interesting id shapes
// (alias + its dated twin, two versions, a legacy family) that the ordering/collapse rules key on.
const CATALOG_IDS = ["alias-4-5", "alias-4-5-20251101", "alias-4-6", "legacy-2"];
const fauxCat = createFauxCore({
	provider: "catalog",
	api: "catalog",
	models: CATALOG_IDS.map(modelDef),
	tokensPerSecond: 2000,
});
const fauxOther = createFauxCore({
	provider: "aother",
	api: "aother",
	models: [modelDef("other-1")],
	tokensPerSecond: 2000,
});
// Registered only DURING the catalog-refresh test — the "newly shipped" model a refresh delivers.
const fauxNew = createFauxCore({
	provider: "znew",
	api: "znew",
	models: [modelDef("znew-1")],
	tokensPerSecond: 2000,
});

/** Provider config for `registerProvider` (baseUrl + apiKey are required when models are defined). */
const cfg = (faux: typeof fauxCat, ids: string[]) => ({
	api: faux.api,
	baseUrl: "http://faux.local",
	apiKey: "faux",
	streamSimple: faux.streamSimple,
	models: ids.map((id) => ({ ...modelDef(id), api: faux.api })),
});

/** This suite's own providers. A developer's ambient env auth (e.g. `ANTHROPIC_API_KEY`) adds real
 * providers to the same runtime, so every runtime-backed assertion is scoped to these two — the exact
 * ordering rule is pinned separately, on the pure `orderModels`. */
const FAUX_PROVIDERS = ["aother", "catalog"];
const fauxOnly = (catalog: ModelCatalogEntry[]) =>
	catalog.filter((entry) => FAUX_PROVIDERS.includes(entry.model.provider));

const tmpDirs: string[] = [];
function tmpDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let runtime: ModelRuntime;
let settingsPath: string;

/** pi's global settings file for this suite — where `enabledModels` and the model defaults live. */
function writeSettings(settings: Record<string, unknown>): void {
	writeFileSync(settingsPath, `${JSON.stringify(settings)}\n`);
}
function readSettings(): Record<string, unknown> {
	return existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
}

beforeAll(async () => {
	// Isolate pi's agent dir: `setEnabledModels` writes a REAL settings.json, never the developer's.
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = tmpDir("trpi-catalog-agentdir-");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	settingsPath = join(agentDir, "settings.json");

	// `listModelCatalog` fires a detached network catalog refresh (issue #98) — keep this suite hermetic
	// the same way e2e is, via pi's own PI_OFFLINE convention. The refresh tests lift it locally.
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	// A REAL runtime (in-memory credentials, no models.json, no network) with the faux providers
	// registered as extension providers.
	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("catalog", cfg(fauxCat, CATALOG_IDS));
	runtime.registerProvider("aother", cfg(fauxOther, ["other-1"]));
	configurePiRuntime(runtime);
});

afterEach(() => {
	rmSync(settingsPath, { force: true }); // no allowlist / no default leaks into the next case
	setModelCatalogPublisher(() => {});
});

afterAll(() => {
	configurePiRuntime(null);
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
});

// ─── ordering + collapsing (pure) ────────────────────────────────────────────────────────────────

test("a dated suffix is stripped from the version key, not parsed as a version", () => {
	// Both spellings pi's catalogs use. Without the strip, `-20251101` reads as a huge version component
	// and the pinned snapshot would outrank its own alias.
	expect(parseModelSortKey("claude-opus-4-5-20251101")).toEqual({
		version: [4, 5],
		dated: true,
		id: "claude-opus-4-5-20251101",
	});
	expect(parseModelSortKey("gpt-4o-2024-05-13")).toEqual({
		version: [4],
		dated: true,
		id: "gpt-4o-2024-05-13",
	});
	expect(parseModelSortKey("gpt-5.6-luna")).toEqual({
		version: [5, 6],
		dated: false,
		id: "gpt-5.6-luna",
	});
});

test("orderModels groups by provider and puts the newest version first", () => {
	// A slice of the real catalogs, deliberately shuffled: what the user complained about is that this
	// input order (pi's own) leads with gpt-4/o1-era models.
	const models = [
		{ provider: "openai", id: "gpt-4" },
		{ provider: "openai", id: "o1" },
		{ provider: "anthropic", id: "claude-opus-4-5-20251101" },
		{ provider: "openai", id: "gpt-4o-2024-05-13" },
		{ provider: "anthropic", id: "claude-opus-4-5" },
		{ provider: "openai", id: "gpt-5" },
		{ provider: "anthropic", id: "claude-opus-5" },
		{ provider: "openai", id: "gpt-4o" },
		{ provider: "openai", id: "o3-mini" },
		{ provider: "anthropic", id: "claude-sonnet-4-6" },
		{ provider: "openai", id: "gpt-5.1" },
	];

	expect(orderModels(models).map((m) => `${m.provider}/${m.id}`)).toEqual([
		// anthropic first (provider asc); within it newest first, and the pinned snapshot sits directly
		// under the alias it pins rather than above it.
		"anthropic/claude-opus-5",
		"anthropic/claude-sonnet-4-6",
		"anthropic/claude-opus-4-5",
		"anthropic/claude-opus-4-5-20251101",
		// openai: 5.1 > 5 > the 4-series > the o-series, so the legacy families sink on their own.
		// `gpt-4` and `gpt-4o` carry the same version digits ([4]) — the id tie-break decides, keeping the
		// order stable across reads rather than dependent on pi's catalog order.
		"openai/gpt-5.1",
		"openai/gpt-5",
		"openai/gpt-4",
		"openai/gpt-4o",
		"openai/gpt-4o-2024-05-13",
		"openai/o3-mini",
		"openai/o1",
	]);
});

test("collapsedRefs folds a dated snapshot only when its alias is available under the same provider", () => {
	const collapsed = collapsedRefs([
		{ provider: "anthropic", id: "claude-opus-4-5" },
		{ provider: "anthropic", id: "claude-opus-4-5-20251101" },
		// No alias listed → the pinned build is the only way to reach this model, so it must stay visible.
		{ provider: "anthropic", id: "claude-orphan-9-20240101" },
		// Same id shape, different provider: the alias next door must not collapse it.
		{ provider: "bedrock", id: "claude-opus-4-5-20251101" },
	]);

	expect([...collapsed]).toEqual(["anthropic/claude-opus-4-5-20251101"]);
});

// ─── the catalog read ────────────────────────────────────────────────────────────────────────────

test("listModelCatalog returns the configured (faux) models, ordered, everything enabled", async () => {
	const catalog = fauxOnly(await listModelCatalog());

	// Provider asc, newest first, dated twin under its alias — and no allowlist means all enabled.
	expect(catalog.map((e) => `${e.model.provider}/${e.model.id}`)).toEqual([
		"aother/other-1",
		"catalog/alias-4-6",
		"catalog/alias-4-5",
		"catalog/alias-4-5-20251101",
		"catalog/legacy-2",
	]);
	expect(catalog.every((e) => e.enabled)).toBe(true);
	// The dated twin is the one row the picker folds away by default.
	expect(catalog.filter((e) => e.collapsed).map((e) => e.model.id)).toEqual(["alias-4-5-20251101"]);
});

test("wire models expose only the allowlisted fields (no baseUrl/headers/other Model fields)", async () => {
	// The faux providers register with baseUrl "http://faux.local"; when JetBrains AI is wired the real
	// baseUrl is `.../wire/<SECRET>/...`. `toWireModel` is an allowlist projection, so a wire model carries
	// EXACTLY these keys — this pins the DTO shut (widening it, incl. re-adding a secret field, fails here).
	const catalog = fauxOnly(await listModelCatalog());
	expect(catalog.length).toBeGreaterThan(0);
	for (const entry of catalog) {
		expect(Object.keys(entry.model).sort()).toEqual([
			"contextWindow",
			"id",
			"name",
			"provider",
			"reasoning",
			"thinkingLevels",
		]);
		// Faux models declare `reasoning: false` — pi's support truth for those is exactly ["off"].
		expect(entry.model.thinkingLevels).toEqual(["off"]);
	}
});

test("thinkingLevels is pi's per-model support truth, not a reasoning boolean widened to all seven", () => {
	// Every registered faux model is non-reasoning, so `["off"]` alone can be satisfied by a constant.
	// `toWireModel` is a pure projection, so pin the interesting half directly: a reasoning model exposes
	// the escalation ladder, and `xhigh`/`max` appear ONLY when `thinkingLevelMap` maps them.
	const reasoner: Model<string> = {
		...modelDef("reasoner"),
		provider: "catalog",
		api: "catalog",
		baseUrl: "http://faux.local",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh" },
	};
	expect(toWireModel(reasoner).thinkingLevels).toEqual([
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
	]);

	// A level the model explicitly cannot do is dropped, even on a reasoning model.
	const alwaysThinks: Model<string> = { ...reasoner, thinkingLevelMap: { off: null } };
	expect(toWireModel(alwaysThinks).thinkingLevels).not.toContain("off");
});

/** Let a detached refresh task's `.then/.finally` chain settle (macrotask — nothing sleeps). */
const refreshSettled = () => new Promise<void>((r) => setTimeout(r, 0));

test("model.list is never blocked by a hanging catalog refresh (fire-and-forget, issue #98)", async () => {
	delete process.env.PI_OFFLINE;
	const originalRefresh = runtime.refresh.bind(runtime);
	let releaseHang = () => {};
	try {
		runtime.refresh = () =>
			new Promise<ModelsRefreshResult>((resolve) => {
				releaseHang = () => resolve({ aborted: false, errors: new Map() });
			});
		// Resolves immediately from the snapshot while the "network" refresh hangs unresolved.
		const ids = (await listModelCatalog()).map((e) => e.model.id);
		expect(ids).toContain("alias-4-6");
	} finally {
		releaseHang(); // frees the single-flight slot so this test leaves no pending state behind
		await refreshSettled();
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

test("a newly-shipped catalog model appears on a later model.list without a restart (issue #98)", async () => {
	delete process.env.PI_OFFLINE;
	const originalRefresh = runtime.refresh.bind(runtime);
	let landRefresh = () => {};
	let refreshCalls = 0;
	try {
		// The first "network" refresh delivers a new provider+model when it lands — deferred, so the first
		// read provably serves the pre-refresh snapshot. Any later trigger settles instantly and delivers
		// nothing, mirroring pi's freshness throttle.
		runtime.refresh = () => {
			refreshCalls += 1;
			if (refreshCalls > 1) return Promise.resolve({ aborted: false, errors: new Map() });
			return new Promise<ModelsRefreshResult>((resolve) => {
				landRefresh = () => {
					runtime.registerProvider("znew", cfg(fauxNew, ["znew-1"]));
					resolve({ aborted: false, errors: new Map() });
				};
			});
		};

		const before = (await listModelCatalog()).map((e) => e.model.id); // triggers the detached refresh
		expect(before).not.toContain("znew-1");

		landRefresh();
		await refreshSettled();

		const after = (await listModelCatalog()).map((e) => e.model.id);
		expect(after).toContain("znew-1");
	} finally {
		await refreshSettled(); // let the second trigger's instant refresh settle before restoring
		runtime.unregisterProvider("znew");
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

// ─── the enabledModels allowlist ─────────────────────────────────────────────────────────────────

test("pi's enabledModels allowlist decides `enabled`, glob patterns included", async () => {
	// A glob and an explicit ref, i.e. both shapes pi's own `--models` / settings accept.
	writeSettings({ enabledModels: ["catalog/alias-4-6", "aother/*"] });

	const enabled = (await listModelCatalog()).filter((e) => e.enabled).map((e) => e.model.id);
	expect(enabled.sort()).toEqual(["alias-4-6", "other-1"]);
});

test("an explicit allowlist is the curation: nothing is collapsed under it", async () => {
	// The user asked for the alias AND its pinned build — folding one away would silently undo that.
	writeSettings({ enabledModels: ["catalog/alias-4-5", "catalog/alias-4-5-20251101"] });

	const catalog = await listModelCatalog();
	expect(catalog.some((e) => e.collapsed)).toBe(false);
	expect(catalog.filter((e) => e.enabled).map((e) => e.model.id)).toEqual([
		"alias-4-5",
		"alias-4-5-20251101",
	]);
});

test("an allowlist whose patterns all went stale reads as no allowlist, never an empty picker", async () => {
	// e.g. the provider those patterns named was signed out. pi returns diagnostics (it never throws);
	// resolving to nothing must fail OPEN or the picker would offer no model at all.
	writeSettings({ enabledModels: ["retired-provider/*", "gone-9"] });

	const catalog = await listModelCatalog();
	expect(catalog.length).toBeGreaterThan(0);
	expect(catalog.every((e) => e.enabled)).toBe(true);
});

test("setEnabledModels writes pi's own settings and broadcasts the fresh catalog", async () => {
	const published: ModelCatalogEntry[][] = [];
	setModelCatalogPublisher((entries) => published.push(entries));

	await setEnabledModels(["catalog/alias-4-6", "aother/other-1"]);

	// Persisted where pi's CLI/TUI reads it, verbatim refs, in the order given.
	expect(readSettings().enabledModels).toEqual(["catalog/alias-4-6", "aother/other-1"]);
	// And every client hears about it — the initiator converges on this push, it doesn't guess.
	expect(published).toHaveLength(1);
	expect(
		published[0]
			?.filter((e) => e.enabled)
			.map((e) => e.model.id)
			.sort(),
	).toEqual(["alias-4-6", "other-1"]);
});

test("setEnabledModels drops refs the host can't resolve — nothing unresolvable lands in pi's config", async () => {
	await setEnabledModels(["catalog/alias-4-6", "attacker/evil"]);
	expect(readSettings().enabledModels).toEqual(["catalog/alias-4-6"]);
});

test("'everything enabled' clears the setting instead of pinning today's catalog (pi's own semantics)", async () => {
	writeSettings({ enabledModels: ["catalog/alias-4-6"] });

	// null, [] and the full available set are all "no filter" — and a cleared setting is what lets a
	// newly-authenticated provider's models show up without re-curating.
	await setEnabledModels(null);
	expect(readSettings().enabledModels).toBeUndefined();

	const everything = (await listModelCatalog()).map((e) => `${e.model.provider}/${e.model.id}`);
	await setEnabledModels(everything);
	expect(readSettings().enabledModels).toBeUndefined();

	await setEnabledModels([]);
	expect(readSettings().enabledModels).toBeUndefined();
});

// ─── the default a new session resolves to ───────────────────────────────────────────────────────

test("model.default prefers the saved default, then the first ENABLED model", async () => {
	// Saved default in the allowlist → it wins.
	writeSettings({
		defaultProvider: "catalog",
		defaultModel: "legacy-2",
		enabledModels: ["catalog/legacy-2", "catalog/alias-4-6"],
	});
	expect((await getDefaultModel()).model?.id).toBe("legacy-2");

	// Saved default disabled → the newest enabled model, NOT the disabled favourite and not the
	// catalog's first row (`aother/other-1`, which is out of the list too).
	writeSettings({
		defaultProvider: "catalog",
		defaultModel: "legacy-2",
		enabledModels: ["catalog/alias-4-6"],
	});
	expect((await getDefaultModel()).model?.id).toBe("alias-4-6");
});

test("model.default clamps the saved thinking level onto the resolved model's support set", async () => {
	// A `high` saved from a reasoning model plus a non-reasoning default model must not surface as a
	// disabled-but-selected level — the host returns a self-consistent pair, clamped with pi's own
	// `clampThinkingLevel` (faux models don't reason → exactly ["off"]).
	writeSettings({
		defaultProvider: "catalog",
		defaultModel: "alias-4-6",
		defaultThinkingLevel: "high",
	});

	const resolved = await getDefaultModel();
	expect(resolved.model?.thinkingLevels).toEqual(["off"]);
	expect(resolved.thinkingLevel).toBe("off");
});

// ─── pi's clamp for a model ref ──────────────────────────────────────────────────────────────────

test("model.clampThinking answers with pi's clamp, not a plausible client-side policy", async () => {
	// Review finding on the pre-session picker: any rule invented client-side diverges from pi. These are
	// the two shapes that separate pi's upward-then-downward clamp from the likely local heuristics — a
	// midpoint would say `medium` then `high`; "nearest below" would say `xhigh` then nothing.
	// A reasoning provider has to be registered for this: `clampThinkingForModel` re-resolves the ref,
	// and every other faux model is non-reasoning (supported set exactly `["off"]`, which every policy
	// agrees on and so proves nothing).
	const reasoning = (id: string, map: Record<string, string | null>) => ({
		...cfg(fauxCat, [id]),
		models: [{ ...modelDef(id), api: fauxCat.api, reasoning: true, thinkingLevelMap: map }],
	});

	runtime.registerProvider("clamp5", reasoning("clamp5", { xhigh: "xhigh" }));
	runtime.registerProvider(
		"clamp2",
		reasoning("clamp2", { off: null, minimal: null, medium: null }),
	);
	try {
		// `[off, minimal, low, medium, high, xhigh]` — `max` is unmapped, so upward is exhausted.
		expect(await clampThinkingForModel({ provider: "clamp5", id: "clamp5" }, "max")).toBe("xhigh");
		// `[low, high]` — nothing below `off`, so pi goes upward instead.
		expect(await clampThinkingForModel({ provider: "clamp2", id: "clamp2" }, "off")).toBe("low");
		// A level the model does support is returned untouched.
		expect(await clampThinkingForModel({ provider: "clamp2", id: "clamp2" }, "high")).toBe("high");
	} finally {
		runtime.unregisterProvider("clamp5");
		runtime.unregisterProvider("clamp2");
	}
});

test("model.clampThinking refuses a model ref the host can't resolve", async () => {
	await expect(clampThinkingForModel({ provider: "nope", id: "nope" }, "high")).rejects.toThrow(
		/Unknown or unavailable model/,
	);
});
