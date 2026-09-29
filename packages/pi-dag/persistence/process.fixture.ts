import { DagError } from "../domain/index.ts";
import { snapshot } from "./fixtures.ts";
import { createDagStore } from "./index.ts";

const [storageRoot, scope, mode] = process.argv.slice(2);
if (!storageRoot || !scope || !mode) throw new Error("Missing persistence fixture arguments");
const store = createDagStore({ storageRoot, scope });

try {
	if (mode === "reader") {
		const state = await store.read("dag");
		let claim: string | undefined;
		let put: string | undefined;
		try {
			await store.claim("dag");
		} catch (error) {
			if (!(error instanceof DagError)) throw error;
			claim = error.failure.code;
		}
		try {
			await store.put("dag", "unowned");
		} catch (error) {
			if (!(error instanceof DagError)) throw error;
			put = error.failure.code;
		}
		process.stdout.write(`${JSON.stringify({ version: state?.version, claim, put })}\n`);
	} else {
		const lease = await store.claim("dag");
		if (mode === "create") await lease.save(await snapshot(store, scope), undefined);
		process.stdout.write(`${JSON.stringify({ claimed: true, pid: process.pid })}\n`);
		process.stdin.resume();
		await new Promise<void>((resolve) => process.stdin.once("end", resolve));
		await lease.release();
	}
} catch (error) {
	if (!(error instanceof DagError)) throw error;
	process.stdout.write(`${JSON.stringify({ claimed: false, code: error.failure.code })}\n`);
}
