import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_EXTENSIONS_DIR } from "./paths";
import { E2eWire } from "./wire";

export const DEMO_EXTENSION = "e2e-demo";

const SOURCE = new URL("./extension-demo/", import.meta.url);
const demoDir = () => join(E2E_EXTENSIONS_DIR, DEMO_EXTENSION);

export const demoSource = (file: string) =>
	readFileSync(new URL(`${file}.fixture`, SOURCE), "utf8");

export const installDemoExtension = () => {
	rmSync(demoDir(), { recursive: true, force: true });
	cpSync(SOURCE, demoDir(), { recursive: true });
	for (const file of readdirSync(demoDir())) {
		if (!file.endsWith(".fixture")) continue;
		const target = join(demoDir(), file.slice(0, -".fixture".length));
		cpSync(join(demoDir(), file), target);
		rmSync(join(demoDir(), file));
	}
};

export const writeDemoFile = (file: string, content: string) =>
	writeFileSync(join(demoDir(), file), content);

const withWire = async <T>(run: (wire: E2eWire) => Promise<T>) => {
	const wire = await E2eWire.connect();
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
};

export const reloadDemoExtension = () =>
	withWire((wire) => wire.request("ext.reload", { name: DEMO_EXTENSION }, 30_000));

export const invokeDemoAction = (id: string, payload?: unknown) =>
	withWire((wire) => wire.request("ext.action", { ext: DEMO_EXTENSION, id, payload }));

export const removeDemoExtension = async () => {
	rmSync(demoDir(), { recursive: true, force: true });
	await withWire((wire) => wire.request("ext.reload", { name: DEMO_EXTENSION })).catch(() => {});
};
