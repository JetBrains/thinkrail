import { expect, test } from "bun:test";
import { attributionClaimOnFirstReadiness } from "./attributionReadiness";

test("desktop attribution does not open before delayed dom readiness and starts only once", async () => {
	let externalOpens = 0;
	const signalDomReady = attributionClaimOnFirstReadiness(() => {
		externalOpens++;
	});

	await Bun.sleep(1_100);
	expect(externalOpens).toBe(0);
	signalDomReady();
	expect(externalOpens).toBe(1);
	signalDomReady();
	expect(externalOpens).toBe(1);
});
