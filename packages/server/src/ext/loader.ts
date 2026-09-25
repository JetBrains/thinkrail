import { join } from "node:path";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import type { ThinkRailExtension } from "@thinkrail/ext";
import * as sdk from "@thinkrail/ext";
import * as typebox from "typebox";

const virtualModules = {
	"@thinkrail/ext": sdk,
	"@earendil-works/pi-coding-agent": piCodingAgent,
	typebox,
};

const isFactory = (value: unknown): value is ThinkRailExtension => typeof value === "function";

export const importExtension = async (dir: string) => {
	const { createJiti } = await import("jiti/static");
	const jiti = createJiti(import.meta.url, { moduleCache: false, virtualModules });
	const loaded: unknown = await jiti.import(join(dir, "index.ts"), { default: true });
	if (!isFactory(loaded))
		throw new Error("index.ts must default-export defineExtension((tr) => { ... })");
	return loaded;
};
