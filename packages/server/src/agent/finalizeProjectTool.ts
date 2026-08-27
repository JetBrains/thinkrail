import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

export const FINALIZE_PROJECT_TOOL_NAME = "finalize_project";

export const FinalizeProjectSchema = Type.Object({
	name: Type.String({
		description:
			"The confirmed project display name the user chose (their words, casing preserved). Only call this once the user has approved the name.",
	}),
});

export type FinalizeProjectParams = Static<typeof FinalizeProjectSchema>;

const DESCRIPTION = `Finalize a brand-new project being set up from scratch: apply the user-confirmed display name and make the project appear in normal navigation. Only valid in the setup chat of a freshly created, not-yet-named project. Call it exactly once, AFTER the user has approved a name and you have written goal-and-requirements.md. Do NOT invent the name — it must be the name the user confirmed.`;

export interface FinalizeProjectOutcome {
	projectId: string;
	name: string;
}

let handler: (cwd: string, name: string) => FinalizeProjectOutcome = () => {
	throw new Error("There is no draft project to finalize on this host.");
};

export function setProjectFinalizeHandler(
	fn: (cwd: string, name: string) => FinalizeProjectOutcome,
): void {
	handler = fn;
}

export function createFinalizeProjectTool(): ToolDefinition<typeof FinalizeProjectSchema> {
	return {
		name: FINALIZE_PROJECT_TOOL_NAME,
		label: "Finalize Project",
		description: DESCRIPTION,
		parameters: FinalizeProjectSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const { name } = params as FinalizeProjectParams;
			const outcome = handler(ctx.cwd, name);
			return {
				content: [
					{
						type: "text",
						text: `Project finalized as "${outcome.name}". It now appears in navigation under that name; keep working here in the Default workspace.`,
					},
				],
				details: outcome,
			};
		},
	};
}

export function finalizeProjectToolExtension(pi: ExtensionAPI): void {
	pi.registerTool(createFinalizeProjectTool());
}
