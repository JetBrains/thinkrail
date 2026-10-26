import { getCurrentTools } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	AgentSessionEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { CodedError } from "@thinkrail/shared/codedError";
import { registryExtensionName } from "../extensions";

const CUSTOM_TYPE = "thinkrail.registry-tool-withholding.v1";
const ACK_TYPE = "thinkrail.registry-tool-withholding-ack.v1";

interface ToolIdentity {
	owner: string;
	name: string;
}

interface WithheldTool extends ToolIdentity {
	restoring: boolean;
}

interface Acknowledgement {
	role: "system" | "user" | "assistant";
	timestamp: number;
	tools: ToolIdentity[];
}

function isIdentity(data: unknown): data is ToolIdentity {
	return (
		data !== null &&
		typeof data === "object" &&
		"owner" in data &&
		typeof data.owner === "string" &&
		"name" in data &&
		typeof data.name === "string"
	);
}

function isWithheldTools(data: unknown): data is WithheldTool[] {
	return (
		Array.isArray(data) &&
		data.every(
			(tool) => isIdentity(tool) && "restoring" in tool && typeof tool.restoring === "boolean",
		)
	);
}

function isAcknowledgement(data: unknown): data is Acknowledgement {
	return (
		data !== null &&
		typeof data === "object" &&
		"role" in data &&
		(data.role === "system" || data.role === "user" || data.role === "assistant") &&
		"timestamp" in data &&
		typeof data.timestamp === "number" &&
		"tools" in data &&
		Array.isArray(data.tools) &&
		data.tools.every(isIdentity)
	);
}

function identity(tool: ToolIdentity): string {
	return JSON.stringify([tool.owner, tool.name]);
}

function replay(branch: SessionEntry[]): { saved: WithheldTool[]; withheld: WithheldTool[] } {
	let saved: WithheldTool[] = [];
	let withheld: WithheldTool[] = [];
	let pending: { id: string; data: Acknowledgement } | undefined;
	for (const entry of branch) {
		if (
			pending &&
			entry.parentId === pending.id &&
			entry.type === "message" &&
			entry.message.role === pending.data.role &&
			entry.message.timestamp === pending.data.timestamp
		) {
			const acknowledged = new Set(pending.data.tools.map(identity));
			withheld = withheld.filter((tool) => !tool.restoring || !acknowledged.has(identity(tool)));
		}
		pending = undefined;
		if (entry.type !== "custom") continue;
		if (entry.customType === CUSTOM_TYPE && isWithheldTools(entry.data)) {
			saved = entry.data;
			withheld = saved.map((tool) => ({ ...tool }));
		} else if (entry.customType === ACK_TYPE && isAcknowledgement(entry.data)) {
			pending = { id: entry.id, data: entry.data };
		}
	}
	return { saved, withheld };
}

function toolOwners(session: AgentSession): Map<string, string> {
	const owners = new Map<string, string>();
	for (const tool of session.getAllTools()) {
		const owner = registryExtensionName(tool.sourceInfo.path);
		if (owner !== undefined && tool.exposure !== "hidden") owners.set(tool.name, owner);
	}
	return owners;
}

export class RegistryToolWithholding {
	private restored = new Set<string>();
	private leafId: string | null = null;
	private failure: CodedError | undefined;

	constructor(private readonly onWriteFailure: (error: CodedError) => void = () => {}) {}

	reset(): void {
		if (this.failure) throw this.failure;
		this.restored.clear();
	}

	private append(session: AgentSession, type: string, data: unknown): void {
		if (this.failure) throw this.failure;
		const manager = session.sessionManager;
		try {
			manager.appendCustomEntry(type, data);
		} catch (cause) {
			const failure = new CodedError(
				"RESOURCE_UNAVAILABLE",
				"Registry tool selection could not be saved. This chat was detached; reopen it before continuing.",
			);
			failure.cause = cause;
			this.failure = failure;
			// Pi advances ancestry before writing; quarantine before any reentrant shutdown or SDK callback.
			for (const method of [
				"appendMessage",
				"appendThinkingLevelChange",
				"appendModelChange",
				"appendUsage",
				"appendCompaction",
				"appendCustomEntry",
				"appendSessionInfo",
				"appendCustomMessageEntry",
				"appendContextEdit",
				"appendLabelChange",
				"branch",
				"resetLeaf",
				"branchWithSummary",
				"createBranchedSession",
				"setSessionFile",
				"newSession",
			] as const) {
				manager[method] = () => {
					throw failure;
				};
			}
			this.onWriteFailure(failure);
			throw failure;
		}
	}

	observeMessage(session: AgentSession, event: AgentSessionEvent): void {
		if (this.failure) throw this.failure;
		if (event.type !== "message_end" || this.restored.size === 0) return;
		const message = event.message;
		if (message.role !== "system" && message.role !== "user" && message.role !== "assistant")
			return;
		const branch = session.sessionManager.getBranch();
		const { withheld } = replay(branch);
		const owners = toolOwners(session);
		const active = new Set(session.getActiveToolNames());
		const declared = new Set(
			getCurrentTools(
				branch.flatMap((entry) =>
					entry.type === "message" && entry.message.role === "system" ? [entry.message] : [],
				),
			).map((tool) => tool.name),
		);
		const tools = withheld
			.filter(
				(tool) =>
					tool.restoring &&
					this.restored.has(identity(tool)) &&
					owners.get(tool.name) === tool.owner &&
					(message.role === "system"
						? message.toolsAdded?.some((added) => added.name === tool.name)
						: !active.has(tool.name) || declared.has(tool.name)),
			)
			.map(({ owner, name }) => ({ owner, name }));
		if (tools.length > 0) {
			this.append(session, ACK_TYPE, { role: message.role, timestamp: message.timestamp, tools });
		}
	}

	apply(session: AgentSession, disabled: ReadonlySet<string>): void {
		if (this.failure) throw this.failure;
		const manager = session.sessionManager;
		const branch = manager.getBranch();
		if (this.leafId && !branch.some((entry) => entry.id === this.leafId)) this.reset();
		const { saved, withheld: replayed } = replay(branch);
		const owners = toolOwners(session);
		const previous = session.getActiveToolNames();
		let withheld = replayed.filter(
			(tool) =>
				owners.get(tool.name) !== tool.owner ||
				!this.restored.has(identity(tool)) ||
				previous.includes(tool.name),
		);
		const active = new Set(previous);
		for (const name of previous) {
			const owner = owners.get(name);
			if (owner === undefined || !disabled.has(owner)) continue;
			active.delete(name);
			if (!withheld.some((tool) => tool.owner === owner && tool.name === name)) {
				withheld.push({ owner, name, restoring: false });
			}
		}
		const restored = new Set<string>();
		withheld = withheld.map((tool) => {
			if (owners.get(tool.name) !== tool.owner || disabled.has(tool.owner)) {
				return { ...tool, restoring: false };
			}
			active.add(tool.name);
			restored.add(identity(tool));
			return { ...tool, restoring: true };
		});
		if (JSON.stringify(saved) !== JSON.stringify(withheld)) {
			this.append(session, CUSTOM_TYPE, withheld);
		}
		if (active.size !== previous.length || previous.some((name) => !active.has(name))) {
			session.setActiveToolsByName([...active]);
		}
		this.restored = restored;
		this.leafId = manager.getLeafId();
	}
}
