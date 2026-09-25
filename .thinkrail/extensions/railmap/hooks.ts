import { type HostContext, useAction, useChannel } from "@thinkrail/ext/view";
import { useEffect, useState } from "react";
import {
	type FileImport,
	type ImportSite,
	isRecord,
	type ModuleFile,
	type RailmapChannel,
} from "./model";

export const useRailmap = (host: HostContext) => {
	const { workspaceId } = host;
	const watch = useAction("watch");
	const channel = useChannel<RailmapChannel>(workspaceId ? `graph:${workspaceId}` : "");
	const missing = channel === undefined;
	useEffect(() => {
		if (workspaceId && missing) void watch().catch(() => {});
	}, [workspaceId, missing, watch]);
	return channel;
};

export const useActionResult = <T>(
	id: string,
	payload: unknown,
	enabled: boolean,
	parse: (value: unknown) => T | undefined,
) => {
	const run = useAction(id);
	const key = JSON.stringify(payload);
	const [state, setState] = useState<{ key: string; value: T | undefined; error?: string }>();
	useEffect(() => {
		if (!enabled) return;
		let current = true;
		void run(JSON.parse(key))
			.then((value) => {
				if (current) setState({ key, value: parse(value) });
			})
			.catch((error: unknown) => {
				if (current) setState({ key, value: undefined, error: String(error) });
			});
		return () => {
			current = false;
		};
	}, [run, key, enabled, parse]);
	const fresh = state?.key === key ? state : undefined;
	return { value: fresh?.value, error: fresh?.error, loading: enabled && !fresh };
};

const isSite = (value: unknown): value is ImportSite =>
	isRecord(value) &&
	typeof value.file === "string" &&
	typeof value.line === "number" &&
	typeof value.specifier === "string" &&
	typeof value.target === "string";

const isFileImport = (value: unknown): value is FileImport =>
	isRecord(value) && typeof value.target === "string" && typeof value.line === "number";

const isModuleFile = (value: unknown): value is ModuleFile =>
	isRecord(value) &&
	typeof value.path === "string" &&
	Array.isArray(value.imports) &&
	value.imports.every(isFileImport);

export const parseSites = (value: unknown) =>
	isRecord(value) && Array.isArray(value.sites) && typeof value.total === "number"
		? { sites: value.sites.filter(isSite), total: value.total }
		: undefined;

export const parseFiles = (value: unknown) =>
	isRecord(value) && Array.isArray(value.files) ? value.files.filter(isModuleFile) : undefined;
