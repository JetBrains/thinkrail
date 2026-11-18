import type {
	ExtensionHostServices,
	ExtensionQuery,
	ServerExtension,
} from "@thinkrail/extension-api/server";
import { CodedError } from "@thinkrail/shared/codedError";
import type { ExtensionDisabled } from "./inline";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

export type ExtensionHostServicesFor = (
	extensionName: string,
	signal: AbortSignal,
) => ExtensionHostServices;

export interface ExtensionQueries {
	/** The `extension.query` dispatcher. */
	query(request: unknown): Promise<unknown>;
	/** Aborts and forgets the tables of the extensions switched off now; a later query rebuilds one. */
	releaseDisabled(): void;
}

type QueryTable = Readonly<Record<string, ExtensionQuery>>;

interface BuiltTable {
	table: QueryTable;
	controller: AbortController;
}

function unknownQuery(message: string): CodedError {
	return new CodedError("UNKNOWN_EXTENSION_QUERY", message);
}

function disabledError(name: string): CodedError {
	return new CodedError("EXTENSION_DISABLED", `The ${name} extension is switched off`);
}

function parseRequest(request: unknown): { extension: string; method: string; params: unknown } {
	if (typeof request !== "object" || request === null) {
		throw unknownQuery("extension.query needs { extension, method }");
	}
	const { extension, method, params } = request as Record<string, unknown>;
	if (typeof extension !== "string" || typeof method !== "string") {
		throw unknownQuery("extension.query needs { extension, method }");
	}
	return { extension, method, params };
}

export function createExtensionQueries(options: {
	isDisabled: ExtensionDisabled;
	services: ExtensionHostServicesFor;
	entries?: readonly ServerExtensionEntry[];
}): ExtensionQueries {
	const entries = options.entries ?? serverExtensions;
	const tables = new Map<ServerExtension, BuiltTable>();

	const tableOf = (extension: ServerExtension): QueryTable | undefined => {
		if (!extension.queries) return undefined;
		let built = tables.get(extension);
		if (!built) {
			const controller = new AbortController();
			built = {
				table: extension.queries(options.services(extension.name, controller.signal)),
				controller,
			};
			tables.set(extension, built);
		}
		return built.table;
	};

	return {
		async query(request) {
			const { extension: name, method, params } = parseRequest(request);
			const extension = entries.find((entry) => entry.extension.name === name)?.extension;
			if (!extension) throw unknownQuery(`No extension named ${name}`);
			if (options.isDisabled(name)) throw disabledError(name);
			const table = tableOf(extension);
			const query = table && Object.hasOwn(table, method) ? table[method] : undefined;
			if (typeof query !== "function") throw unknownQuery(`${name} answers no query ${method}`);
			return await query(params);
		},
		releaseDisabled() {
			for (const [extension, built] of tables) {
				if (!options.isDisabled(extension.name)) continue;
				tables.delete(extension);
				built.controller.abort(disabledError(extension.name));
			}
		},
	};
}
