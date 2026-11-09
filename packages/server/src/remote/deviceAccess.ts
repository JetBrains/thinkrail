import type { RemoteDeviceAccess, WsMethodName } from "@thinkrail/contracts";

/** The requests a read-only device may make: they read projects, chats and models and change nothing. */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set<WsMethodName>([
	"project.list",
	"workspace.list",
	"session.list",
	"session.stateList",
	"session.getMessages",
	"session.getStats",
	"session.getCommands",
	"session.resources",
	"skills.state",
	"model.list",
	"model.default",
	"git.listBranches",
]);

/** Whether a paired device with `access` may make the request `method`; anything not known to be a read is a write. */
export const deviceMayRequest = (access: RemoteDeviceAccess, method: string): boolean =>
	access === "write" || READ_ONLY_METHODS.has(method);
