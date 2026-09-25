import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "artifact-probe";
const PROBE_VALUE = "artifact-probe-ready";

const FILES = {
	"extension.json": JSON.stringify({
		name: NAME,
		surfaces: [{ id: "main", slot: "panel" }],
	}),
	"index.ts": `import { defineExtension } from "@thinkrail/ext";
export default defineExtension((tr) => {
	tr.publish("state", "${PROBE_VALUE}");
});
`,
	"main.tsx": `import { useChannel } from "@thinkrail/ext/view";
export default function Main() {
	return <div className="p-8 text-text-muted">{useChannel<string>("state")}</div>;
}
`,
};

export const writeProbeExtension = (dataDir: string) => {
	const dir = join(dataDir, "extensions", NAME);
	mkdirSync(dir, { recursive: true });
	for (const [file, body] of Object.entries(FILES)) writeFileSync(join(dir, file), body);
};

interface ProbeInfo {
	name?: string;
	status?: string;
	build?: string | null;
	error?: string;
}

export const assertProbeExtensionServed = async ({
	request,
	assetUrl,
}: {
	request: (method: string, params: unknown) => Promise<unknown>;
	assetUrl: (path: string) => string;
}) => {
	const list = (await request("ext.list", {})) as ProbeInfo[];
	const info = list.find((entry) => entry.name === NAME);
	if (info?.status !== "active" || !info.build)
		throw new Error(`probe extension did not load: ${JSON.stringify(info)}`);
	const snapshot = (await request("ext.snapshot", {})) as Record<string, unknown>;
	if (snapshot[`${NAME}:state`] !== PROBE_VALUE)
		throw new Error("probe extension host half did not publish");
	const base = `/ext/${NAME}/${info.build}/main`;
	const js = await fetch(assetUrl(`${base}.js`));
	const jsText = await js.text();
	if (!js.ok || !jsText.includes("__thinkrail_runtime__"))
		throw new Error(`probe view bundle is wrong (${js.status})`);
	const css = await fetch(assetUrl(`${base}.css`));
	const cssText = await css.text();
	if (!css.ok || !cssText.includes("color: var(--text-muted)"))
		throw new Error(`probe view stylesheet is wrong (${css.status})`);
};
