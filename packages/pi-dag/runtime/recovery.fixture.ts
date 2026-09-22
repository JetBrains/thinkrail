import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createDelegationService, type DelegationService } from "pi-delegation";
import { createDagService } from "../index";
import { createTestRuntime, faux, model } from "./provider.fixture";

const [root, scope, mode] = process.argv.slice(2);
if (!root || !scope || !mode) throw new Error("Missing recovery fixture arguments");
process.env.PI_CODING_AGENT_DIR = join(root, "recovery-agent");
process.env.PI_OFFLINE = "1";
faux.setResponses([
	fauxAssistantMessage(
		mode === "input"
			? fauxToolCall("dag_request_input", { question: "What next?" })
			: fauxToolCall("dag_submit_result", {
					outputs: { result: { kind: "text", text: "DURABLE_BEFORE_CRASH" } },
				}),
	),
]);
const runtime = await createTestRuntime();
const core = createDelegationService({
	delegationRoot: join(root, "children"),
	scope: "shared-core",
});
let dagId: string;
const delegation: DelegationService = {
	...core,
	async registerResource(id, context, options) {
		const resource = await core.registerResource(id, context, options);
		return {
			...resource,
			async createChild(spec) {
				const child = await resource.createChild(spec);
				return {
					...child,
					async runQueued(task, options) {
						const outcome = await child.runQueued(task, options);
						process.stdout.write(`${JSON.stringify({ dagId })}\n`);
						await new Promise<void>(() => {});
						return outcome;
					},
				};
			},
		};
	},
};
const service = createDagService({ storageRoot: join(root, "dags"), scope, delegation });
const owner = service.bind({
	caller: { kind: "owner", ownerId: "host" },
	signal: new AbortController().signal,
	execution: { kind: "runtime", modelRuntime: runtime, cwd: root, model },
});
const created = await owner.execute({
	commandId: "create",
	command: {
		kind: "create",
		definition: {
			title: "Crash fixture",
			defaults: { tools: [] },
			nodes: [
				{
					id: "work",
					task: "Persist evidence before host death",
					outputs: { result: { kind: "text" } },
					...(mode === "proposal"
						? { approval: { authority: "human", question: "Review recovered output" } as const }
						: {}),
				},
			],
			connections: [],
		},
	},
});
if (!created.ok) throw new Error(JSON.stringify(created.error));
dagId = created.value.dagId;
const resumed = await owner.execute({
	commandId: "resume",
	dagId,
	expectedVersion: created.value.version,
	command: { kind: "resume" },
});
if (!resumed.ok) throw new Error(JSON.stringify(resumed.error));
process.stdin.resume();
