// Value imports of PURE catalog helpers (data-only projections over `Model`) plus pi's own model-scope
// resolver — dispatch stays on the shared `ModelRuntime` (SPEC §Allowed deps).
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type ModelRuntime,
	resolveModelScopeWithDiagnostics,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	type Model,
	type ModelCatalogEntry,
	modelRef,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import { getPiRuntime, refreshCatalogsDetached } from "./piRuntime";

/**
 * Project a `pi` `Model` down to the wire's **allowlist** (`WireModel`) — exactly the fields the UI renders.
 * An explicit projection (not a `{...rest}` denylist), so `baseUrl` (the jbcentral proxy secret when wired)
 * and `headers` (can carry auth) — and any future `Model` field — are excluded by default. The UI refers a
 * model back by `{provider,id}`, which the host re-resolves via `resolveWireModel`. This is the single choke
 * point that keeps secrets off every model-bearing wire frame (model.list/default, session.create result,
 * SessionSummary).
 */
export function toWireModel(model: Model<string>): WireModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		// Computed, not picked: pi's per-model effort-level truth (reasoning + thinkingLevelMap), so the
		// picker disables unsupported levels instead of relying on pi's silent clamp.
		thinkingLevels: getSupportedThinkingLevels(model),
	};
}

/**
 * Re-resolve a wire model reference back to the real `Model` (with its `baseUrl`) from the registry, matching
 * the picker's universe (`getAvailable()`). **Never trust a client-supplied `baseUrl`** — pi's `setModel` /
 * `createAgentSession` use it verbatim, so accepting it would let a client (esp. a remote V2 one) point the
 * agent's model traffic at an arbitrary URL. Throws if the ref isn't an available model.
 */
export async function resolveWireModel(
	ref: Pick<WireModel, "provider" | "id">,
): Promise<Model<string>> {
	const available = await (await getPiRuntime()).getAvailable();
	const model = available.find((m) => m.provider === ref.provider && m.id === ref.id);
	if (!model) throw new Error(`Unknown or unavailable model: ${ref.provider}/${ref.id}`);
	return model as unknown as Model<string>;
}

/**
 * pi's own clamp for a `{model, desired-level}` pair — `model.clampThinking`. The pre-session picker has
 * no session to ask, so without this it would need a policy of its own, and that path would then adjust
 * effort differently from `model.default` (which clamps just below) and from a live session (which gets
 * pi's answer via `thinking_level_changed`). Re-resolves the ref host-side like every other inbound
 * model ref, so an unavailable one throws rather than being guessed at.
 */
export async function clampThinkingForModel(
	ref: Pick<WireModel, "provider" | "id">,
	level: ThinkingLevel,
): Promise<ThinkingLevel> {
	return clampThinkingLevel(await resolveWireModel(ref), level);
}

/**
 * A trailing dated snapshot on a model id: `-20251101` or `-2024-05-13`. pi's catalogs ship both an alias
 * (`claude-opus-4-5`, named "… (latest)") and the pinned build it currently points at, which is what makes
 * the raw list read as duplicated.
 */
const DATE_SUFFIX = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

/** A model's ordering key: its version digits, whether it's a dated snapshot, and its id as tie-break. */
interface ModelSortKey {
	/** The numeric groups of the id, minus any dated suffix — `gpt-5.6-luna` → `[5, 6]`. */
	version: number[];
	dated: boolean;
	id: string;
}

/** @internal Exported for the unit suite — the ordering rule is worth pinning directly. */
export function parseModelSortKey(id: string): ModelSortKey {
	const date = DATE_SUFFIX.exec(id);
	const base = date ? id.slice(0, date.index) : id;
	return { version: (base.match(/\d+/g) ?? []).map(Number), dated: date !== null, id };
}

/**
 * Newest first. pi's `Model` carries **no release date and no deprecation flag** (and `getAvailable()`
 * filters only by provider), so a model's version digits are the only recency signal that exists: compare
 * them element-wise, descending, treating a missing element as lower (`gpt-5.1` [5,1] outranks `gpt-5` [5]).
 * A dated snapshot then sits directly under its alias, and the id breaks remaining ties so the order is
 * stable across reads.
 */
function compareSortKeys(a: ModelSortKey, b: ModelSortKey): number {
	const depth = Math.max(a.version.length, b.version.length);
	for (let i = 0; i < depth; i++) {
		const av = a.version[i];
		const bv = b.version[i];
		if (av === bv) continue;
		if (av === undefined) return 1;
		if (bv === undefined) return -1;
		return bv - av;
	}
	if (a.dated !== b.dated) return a.dated ? 1 : -1;
	return a.id.localeCompare(b.id);
}

/** Group by provider (asc), newest first within each — the order every client renders. */
export function orderModels<T extends { provider: string; id: string }>(models: readonly T[]): T[] {
	return models
		.map((model) => ({ model, key: parseModelSortKey(model.id) }))
		.sort(
			(a, b) => a.model.provider.localeCompare(b.model.provider) || compareSortKeys(a.key, b.key),
		)
		.map((entry) => entry.model);
}

/**
 * Refs of dated snapshots whose alias is also available under the same provider
 * (`anthropic/claude-opus-4-5-20251101` while `anthropic/claude-opus-4-5` is listed). The two entries are
 * the same model, so the picker folds the pinned one into its "Show all" tier — no judgment about what is
 * outdated, just de-duplication.
 */
export function collapsedRefs(models: readonly { provider: string; id: string }[]): Set<string> {
	const refs = new Set(models.map(modelRef));
	const collapsed = new Set<string>();
	for (const model of models) {
		const date = DATE_SUFFIX.exec(model.id);
		if (!date) continue;
		if (refs.has(modelRef({ provider: model.provider, id: model.id.slice(0, date.index) }))) {
			collapsed.add(modelRef(model));
		}
	}
	return collapsed;
}

/** pi's `enabledModels` patterns as configured (merged global + project), read at the host's cwd. */
function enabledPatterns(): string[] | undefined {
	return SettingsManager.create(process.cwd()).getEnabledModels();
}

/**
 * The user's allowlist resolved to `"provider/id"` refs, or `null` for "no allowlist — everything is
 * enabled". Resolution is **pi's own** (`resolveModelScopeWithDiagnostics`: globs over `provider/id` and
 * bare ids, cross-pattern dedupe, alias preferred over dated snapshots), so the app and pi's CLI/TUI agree
 * on what a stored pattern means.
 *
 * **Fails open.** Unmatched patterns come back as diagnostics (pi never throws here) — logged and
 * swallowed; and an allowlist whose every pattern is stale (a provider signed out, a model retired)
 * resolves to nothing, which must read as "no allowlist" rather than an empty picker.
 */
async function resolveEnabledRefs(runtime: ModelRuntime): Promise<Set<string> | null> {
	const patterns = enabledPatterns();
	if (!patterns || patterns.length === 0) return null;
	const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(
		[...patterns],
		runtime,
	);
	for (const diagnostic of diagnostics) console.warn(`enabledModels: ${diagnostic.message}`);
	if (scopedModels.length === 0) return null;
	return new Set(scopedModels.map((scoped) => modelRef(scoped.model)));
}

/**
 * The model picker's catalog (`model.list`): every model with configured auth, in the host's order, each
 * tagged with the two facts the picker splits its tiers on — `enabled` (in pi's `enabledModels` allowlist)
 * and `collapsed` (a dated snapshot folded under its alias). One read serves the picker's default tier, its
 * "Show all" tier AND the Settings → Models manager, so those three can't disagree.
 *
 * Also fires the detached catalog refresh (issue #98): the read below returns the current snapshot
 * immediately — never awaiting the network — and a later `model.list` picks up whatever the refresh landed.
 */
export async function listModelCatalog(): Promise<ModelCatalogEntry[]> {
	const runtime = await getPiRuntime();
	refreshCatalogsDetached(runtime);
	const available = orderModels(await runtime.getAvailable());
	const enabled = await resolveEnabledRefs(runtime);
	// An explicit allowlist IS the curation — never fold entries the user asked for.
	const collapsed = enabled ? new Set<string>() : collapsedRefs(available);
	return available.map((model) => ({
		model: toWireModel(model as unknown as Model<string>),
		enabled: enabled ? enabled.has(modelRef(model)) : true,
		collapsed: collapsed.has(modelRef(model)),
	}));
}

let publishCatalog: (entries: ModelCatalogEntry[]) => void = () => {};
/** Host seam: fan a catalog change out to every client (`model.catalogChanged`). */
export function setModelCatalogPublisher(fn: (entries: ModelCatalogEntry[]) => void): void {
	publishCatalog = fn;
}

/**
 * Replace pi's `enabledModels` allowlist (the Settings → Models manager's write), then broadcast the fresh
 * catalog so every client converges on the push instead of guessing locally.
 *
 * Semantics are pi's, deliberately: the refs are written to the **global** `settings.json` (the file pi's
 * CLI/TUI reads), and "no filter" is stored as an absent setting — `null`, an empty list, and the full
 * available set all clear it, exactly like pi's own `/models` manager. Refs are filtered against the
 * available set first: this writes into the user's real pi config, so nothing unresolvable lands there.
 *
 * Consequence, matching pi: the list the client sends is the whole truth, so hand-written glob patterns are
 * expanded into explicit ids on the first save (the manager's copy says so).
 */
export async function setEnabledModels(refs: string[] | null): Promise<void> {
	const available = await (await getPiRuntime()).getAvailable();
	const availableRefs = new Set(available.map(modelRef));
	const next = (refs ?? []).filter((ref) => availableRefs.has(ref));
	const clears = next.length === 0 || next.length === availableRefs.size;
	SettingsManager.create(process.cwd()).setEnabledModels(clears ? undefined : next);
	publishCatalog(await listModelCatalog());
}

/** The model + thinking level a new session resolves to (see `getDefaultModel`). */
export interface DefaultModelResult {
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

/**
 * The default the *next* session would start with — so the New-Workspace dialog can show the exact model
 * pre-session (not a "Default" placeholder). Mirrors pi's resolution for a fresh session, with the
 * allowlist folded in: the settings default when it's available **and enabled**, else the first **enabled**
 * model, else the first available one (all reads over the catalog's order, so the fallback is the newest
 * model rather than a catalog-order accident). Disabling a model in Settings → Models therefore also stops
 * new chats from preselecting it. Passing the result back to `session.create` is a no-op vs. omitting it,
 * so an `@agent` test that doesn't touch the picker still lands on the pinned model.
 *
 * The result is **self-consistent**: the settings' thinking level is clamped (pi's own
 * `clampThinkingLevel`) onto the resolved model's supported set, so the dialog never shows a level the
 * model can't do as selected (e.g. a `high` saved from a reasoning model while the default is a
 * non-reasoning one — pi would silently clamp the created session to `off` otherwise).
 */
export async function getDefaultModel(): Promise<DefaultModelResult> {
	const runtime = await getPiRuntime();
	const available = orderModels(await runtime.getAvailable());
	const enabledRefs = await resolveEnabledRefs(runtime);
	const isEnabled = (model: { provider: string; id: string }) =>
		!enabledRefs || enabledRefs.has(modelRef(model));
	const settings = SettingsManager.create(process.cwd());
	const provider = settings.getDefaultProvider();
	const modelId = settings.getDefaultModel();
	const pinned =
		provider && modelId
			? available.find((m) => m.provider === provider && m.id === modelId && isEnabled(m))
			: undefined;
	const resolved = (pinned ??
		available.find(isEnabled) ??
		available[0] ??
		null) as Model<string> | null;
	const saved = settings.getDefaultThinkingLevel() ?? "medium";
	const thinkingLevel = resolved ? clampThinkingLevel(resolved, saved) : saved;
	return { model: resolved ? toWireModel(resolved) : null, thinkingLevel };
}
