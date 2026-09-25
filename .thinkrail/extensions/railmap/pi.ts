import { resolve } from "node:path";
import type { PiExtensionFactory } from "@thinkrail/ext";
import { Type } from "typebox";
import { DRIFT_LABEL, DRIFT_MESSAGE, type Drift, type DriftMessageDetails } from "./model";
import type { Roots } from "./roots";
import { mayImport, verdictText } from "./verdict";

const MESSAGE_ITEMS = 40;
const WRITE_TOOLS = new Set(["edit", "write"]);

const MayImportParams = Type.Object({
	from: Type.String({
		description: "Importing side: a repo path (file or directory) or a spec id.",
	}),
	to: Type.String({
		description:
			"Imported side: a spec id, a repo path, a workspace package specifier, or an import specifier relative to the `from` file.",
	}),
});

const driftText = (items: readonly Drift[]) =>
	[
		`Railmap: this run added ${items.length} spec drift item${items.length === 1 ? "" : "s"}:`,
		...items.slice(0, MESSAGE_ITEMS).map((item) => `- ${DRIFT_LABEL[item.kind]}: ${item.detail}`),
		...(items.length > MESSAGE_ITEMS ? [`- … ${items.length - MESSAGE_ITEMS} more`] : []),
		"Fix the imports or update the owning SPEC.md `depends-on`; `may_import(from, to)` checks one edge.",
	].join("\n");

export const railmapPi =
	({
		roots,
		isWorkspaceRoot,
	}: {
		roots: Roots;
		isWorkspaceRoot: (cwd: string) => boolean;
	}): PiExtensionFactory =>
	(pi) => {
		let baseline: Promise<Set<string> | undefined> | undefined;
		const reported = new Set<string>();
		const touched = new Set<string>();

		pi.registerTool({
			name: "may_import",
			label: "May import",
			description:
				"Check one import edge against the SPEC.md module graph (railmap): is `from` allowed to import `to` by the specs' depends-on, and does it go through the target module's barrel?",
			parameters: MayImportParams,
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const analysis = await roots.current(ctx.cwd);
				const result = mayImport(analysis, params);
				return { content: [{ type: "text", text: verdictText(result) }], details: result };
			},
		});

		pi.on("agent_start", (_event, ctx) => {
			if (baseline || !isWorkspaceRoot(ctx.cwd)) return;
			baseline = roots
				.current(ctx.cwd)
				.then((analysis) =>
					analysis.graph.modules.length > 0
						? new Set(analysis.graph.drift.map((item) => item.key))
						: undefined,
				)
				.catch(() => undefined);
		});

		pi.on("tool_result", (event, ctx) => {
			const path = event.input.path;
			if (WRITE_TOOLS.has(event.toolName) && typeof path === "string")
				touched.add(resolve(ctx.cwd, path));
		});

		pi.on("agent_before_settle", async (event, ctx) => {
			const before = await baseline;
			if (!before) return undefined;
			const analysis = await roots.current(ctx.cwd, [...touched]).catch(() => undefined);
			if (!analysis) return undefined;
			const fresh = analysis.graph.drift.filter(
				(item) => !before.has(item.key) && !reported.has(item.key),
			);
			if (fresh.length === 0) return undefined;
			for (const item of fresh) reported.add(item.key);
			const details: DriftMessageDetails = {
				root: analysis.graph.root,
				items: fresh.slice(0, MESSAGE_ITEMS),
				total: fresh.length,
			};
			return {
				entries: [
					...event.entries,
					{
						type: "custom_message",
						customType: DRIFT_MESSAGE,
						content: driftText(fresh),
						display: true,
						details,
					},
				],
			};
		});

		pi.on("agent_settled", () => {
			baseline = undefined;
			reported.clear();
			touched.clear();
		});
	};
