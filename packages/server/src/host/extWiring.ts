import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	EXT_NAME_PATTERN,
	type ExtActionContext,
	type ExtWsMethodMap,
	type Project,
	redactLaunchToken,
	type Workspace,
	WS_CHANNELS,
	type WsChannel,
} from "@thinkrail/contracts";
import {
	getSessionStats,
	listLiveSessionRefs,
	reloadSessionsForHostExtensions,
	setHostExtensionFactorySource,
} from "../agent";
import { createExtDevTools, createExtHost, EXT_SDK_GUIDE, type ExtHost } from "../ext";
import { logger } from "../log";
import { dataDir } from "../persistence";
import { getProjects } from "../projects";
import { listAllWorkspaceRecords } from "../workspaces";
import { setExtHandlers } from "./handlers";

const log = logger("ext");

const ASSET_PATH = new RegExp(
	`^/ext/(${EXT_NAME_PATTERN})/([0-9a-f]{16})/(${EXT_NAME_PATTERN}\\.(?:js|css))$`,
);
const IMMUTABLE = "private, max-age=31536000, immutable";
const WATCH_DEBOUNCE_MS = 300;

type ExtHandlers = Parameters<typeof setExtHandlers>[0];
type ExtPublish = (channel: WsChannel, data: unknown) => void;

const projectRoots = (projects: readonly Project[], trusted: boolean) =>
	projects
		.filter((project) => (project.trusted === true) === trusted && project.closed !== true)
		.map((project) => ({ projectId: project.id, path: project.path }));

const workspaceRef = (workspace: Workspace) => ({
	workspaceId: workspace.id,
	projectId: workspace.projectId,
	name: workspace.name,
	branch: workspace.branch,
	path: workspace.worktreePath,
});

const openWorkspaceRefs = () => {
	const open = new Set(
		getProjects()
			.filter((project) => project.closed !== true)
			.map((project) => project.id),
	);
	return listAllWorkspaceRecords()
		.filter((workspace) => open.has(workspace.projectId))
		.map(workspaceRef);
};

const record = (params: unknown): Record<string, unknown> =>
	typeof params === "object" && params !== null ? { ...params } : {};

const requireString = (params: Record<string, unknown>, key: string) => {
	const value = params[key];
	if (typeof value !== "string" || value === "") throw new Error(`${key} must be a string`);
	return value;
};

const actionContext = (value: unknown): ExtActionContext => {
	const raw = record(value);
	const pick = (key: keyof ExtActionContext) =>
		typeof raw[key] === "string" ? { [key]: raw[key] } : {};
	return { ...pick("projectId"), ...pick("workspaceId"), ...pick("sessionId") };
};

const extHandlers = (extHost: ExtHost) =>
	({
		"ext.list": () => extHost.list(),
		"ext.snapshot": (params) => {
			const keys = record(params).keys;
			if (keys === undefined) return extHost.snapshot();
			if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string"))
				throw new Error("keys must be a string array");
			return extHost.snapshot(keys);
		},
		"ext.action": (params) => {
			const p = record(params);
			return extHost.invokeAction({
				ext: requireString(p, "ext"),
				id: requireString(p, "id"),
				payload: p.payload,
				ctx: actionContext(p.ctx),
			});
		},
		"ext.reload": (params) => extHost.reload(requireString(record(params), "name")),
		"ext.reportError": (params) => {
			const p = record(params);
			const name = requireString(p, "name");
			if (!extHost.get(name)) throw new Error(`extension "${name}" is not loaded`);
			extHost.recordError(
				name,
				`view ${requireString(p, "surfaceId")}`,
				redactLaunchToken(requireString(p, "message")),
			);
			return { ok: true } as const;
		},
	}) satisfies Record<keyof ExtWsMethodMap, ExtHandlers[string]>;

const serveExtAsset = (extHost: ExtHost, req: Request, pathname: string) => {
	if (req.method !== "GET" && req.method !== "HEAD")
		return new Response("method not allowed", { status: 405 });
	const match = ASSET_PATH.exec(pathname);
	const asset = match ? extHost.asset(match[1] ?? "", match[2] ?? "", match[3] ?? "") : undefined;
	if (!asset) return new Response("not found", { status: 404 });
	return new Response(asset.body, {
		headers: {
			"content-type": asset.contentType,
			"cache-control": IMMUTABLE,
			"x-content-type-options": "nosniff",
		},
	});
};

const writeGuide = () => {
	const path = join(dataDir(), "ext-sdk", "README.md");
	try {
		if (existsSync(path) && readFileSync(path, "utf8") === EXT_SDK_GUIDE) return path;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, EXT_SDK_GUIDE);
	} catch (error) {
		log.warn("extension guide write failed", error);
	}
	return path;
};

export const installExtHost = ({ publish }: { publish?: ExtPublish } = {}) => {
	const extHost = createExtHost({
		watchDebounceMs: WATCH_DEBOUNCE_MS,
		userDir: join(dataDir(), "extensions"),
		storeDir: join(dataDir(), "ext-store"),
		sessions: {
			list: listLiveSessionRefs,
			get: (sessionId) => listLiveSessionRefs().find((ref) => ref.sessionId === sessionId),
			stats: getSessionStats,
		},
		workspaces: {
			list: openWorkspaceRefs,
			get: (workspaceId) => openWorkspaceRefs().find((ref) => ref.workspaceId === workspaceId),
		},
		onPiFactoriesChanged: () => void reloadSessionsForHostExtensions(),
		onChanged: (info) => publish?.(WS_CHANNELS.extChanged, info),
		onRemoved: (removed) => publish?.(WS_CHANNELS.extRemoved, removed),
		onChannel: (key, value) => publish?.(WS_CHANNELS.extChannel, { key, value }),
		onChannelsDropped: (name, keys) => publish?.(WS_CHANNELS.extChannelsDropped, { name, keys }),
		warn: (message) => log.warn(message),
	});
	const devTools = createExtDevTools({ host: extHost, docsPath: writeGuide() });
	setHostExtensionFactorySource({
		factories: () => [devTools, ...extHost.piFactories()],
		onError: (factory, error) => {
			const owner = extHost.piFactoryOwner(factory);
			if (owner) extHost.recordError(owner, "pi factory failed", error);
			else log.warn("pi factory failed", error);
		},
	});
	setExtHandlers(extHandlers(extHost));
	const syncProjectRoots = () => {
		const projects = getProjects();
		return extHost
			.setProjectRoots(projectRoots(projects, true), projectRoots(projects, false))
			.catch((error: unknown) => log.warn("extension rescan failed", error));
	};
	const dispose = async () => {
		setExtHandlers({});
		setHostExtensionFactorySource(undefined);
		await extHost.dispose();
	};
	return {
		extHost,
		syncProjectRoots,
		serveAsset: (req: Request, pathname: string) => serveExtAsset(extHost, req, pathname),
		dispose,
	};
};
