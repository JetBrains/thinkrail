import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	createSession,
	disposeAllSessions,
	getSessionMessages,
	promptSession,
	setSkillAdmissionResolver,
	settleSessionsForShutdown,
	toWireModel,
	withSessionResources,
} from "./agentSessionManager";
import { getSessionResources } from "./chatResources";
import { delegationServiceFor } from "./delegation";
import { configurePiRuntime } from "./piRuntime";
import { admissionContextFor } from "./skillAdmission";

const [mode, root] = process.argv.slice(2);
if (!root || !["start", "resume", "verify"].includes(mode ?? ""))
	throw new Error("Expected fixture mode and root");
const cwd = join(root, "workspace");
const workspaceId = "restart-workspace";
const faux = createFauxCore({ provider: "restart-faux", models: [{ id: "restart" }] });
const runtime = await ModelRuntime.create({
	credentials: new InMemoryCredentialStore(),
	modelsPath: null,
	allowModelNetwork: false,
});
runtime.registerProvider("restart-faux", {
	api: faux.api,
	apiKey: "local-test",
	baseUrl: "http://faux.local",
	streamSimple: faux.streamSimple,
	models: faux.models,
});
configurePiRuntime(runtime);
setSkillAdmissionResolver(() => admissionContextFor({ piResourceTrust: "granted" }));

if (mode === "start") {
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			compaction: { enabled: false },
			...(process.env.SHELL ? { shellPath: process.env.SHELL } : {}),
		}),
	);
	const { sessionId } = await createSession({
		workspaceId,
		cwd,
		model: toWireModel(faux.getModel()),
	});
	faux.setResponses([fauxAssistantMessage("READY")]);
	await promptSession(sessionId, "Remember this chat before restart.");
	const commandId = await withSessionResources(
		workspaceId,
		sessionId,
		cwd,
		(commands) =>
			commands.start({
				name: "PROCESS_RESTART_COMMAND",
				command: "echo ready > command-ready; while [ -e keep-running ]; do sleep 0.1; done",
			}).id,
	);
	const entered = Promise.withResolvers<void>();
	faux.setResponses([
		async () => {
			entered.resolve();
			await new Promise<void>(() => {});
			return fauxAssistantMessage("UNREACHABLE");
		},
	]);
	const child = await delegationServiceFor(workspaceId).createChild({
		parent: sessionId,
		visibility: "hidden",
		info: { createdBy: "test", roleName: "PROCESS_RESTART_CHILD", detached: true },
		session: { model: { provider: "restart-faux", id: "restart" } },
	});
	void child.runQueued("Inspect the cross-process recovery schema.");
	await entered.promise;
	const deadline = Date.now() + 10_000;
	while (!existsSync(join(cwd, "command-ready"))) {
		if (Date.now() > deadline) throw new Error("Background shell fixture did not start");
		await Bun.sleep(10);
	}
	const resources = await getSessionResources(workspaceId, sessionId, cwd);
	if (
		resources.commands.find((command) => command.id === commandId)?.status !== "running" ||
		resources.subagents.find((agent) => agent.childSessionId === child.sessionId)?.status !==
			"running"
	)
		throw new Error("Fixture work must be running at the crash boundary");
	writeFileSync(
		join(root, "start.tmp"),
		JSON.stringify({ pid: process.pid, sessionId, commandId, childSessionId: child.sessionId }),
	);
	renameSync(join(root, "start.tmp"), join(root, "start.json"));
	setInterval(() => {}, 1000);
} else {
	const { sessionId, commandId, childSessionId } = JSON.parse(
		readFileSync(join(root, "start.json"), "utf8"),
	) as { sessionId: string; commandId: string; childSessionId: string };
	const resources = await getSessionResources(workspaceId, sessionId, cwd);
	await getSessionMessages(sessionId, workspaceId, cwd);
	const callsOnOpen = faux.state.callCount;
	const receipts = async () => {
		const info = (await SessionManager.list(cwd)).find((row) => row.id === sessionId);
		if (!info) throw new Error("Missing restored transcript");
		return SessionManager.open(info.path)
			.getBranch()
			.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === "thinkrail/resource-interruptions",
			);
	};
	const before = (await receipts()).length;
	let providerInput = "";
	faux.setResponses([
		(context) => {
			providerInput = JSON.stringify(context.messages);
			return fauxAssistantMessage("CONTINUED");
		},
	]);
	await promptSession(sessionId, "Continue after restarting the host.");
	writeFileSync(
		join(root, `${mode}.json`),
		JSON.stringify({
			pid: process.pid,
			callsOnOpen,
			callsAfterPrompt: faux.state.callCount,
			before,
			after: await receipts(),
			commandInterrupted: resources.commands.find((command) => command.id === commandId)
				?.interrupted,
			childInterrupted: resources.subagents.find((agent) => agent.childSessionId === childSessionId)
				?.interrupted,
			commandInRequest: providerInput.includes("PROCESS_RESTART_COMMAND"),
			childInRequest: providerInput.includes("PROCESS_RESTART_CHILD"),
		}),
	);
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
}
