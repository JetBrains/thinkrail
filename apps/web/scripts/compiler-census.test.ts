import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { baselineEntries, censusFile } from "./compiler-census";

const FIXTURE = join(import.meta.dir, "fixture.tsx");

const row = (bails: boolean) => `memo(() => {
	const ref = useRef(0);
	${bails ? "ref.current = 1;" : ""}
	return <p />;
})`;

const entries = (firstBails: boolean, secondBails: boolean) =>
	baselineEntries(
		censusFile(
			FIXTURE,
			`import { memo, useRef } from "react";
export const First = ${row(firstBails)};
export const Second = ${row(secondBails)};
`,
		).bailouts,
	);

describe("baselineEntries", () => {
	it("keeps same-named functions in one file apart", () => {
		expect(entries(true, false)).toEqual(["scripts/fixture.tsx memo(…)"]);
		expect(entries(false, true)).toEqual(["scripts/fixture.tsx memo(…)#2"]);
		expect(entries(true, true)).toEqual([
			"scripts/fixture.tsx memo(…)",
			"scripts/fixture.tsx memo(…)#2",
		]);
		expect(entries(false, false)).toEqual([]);
	});
});
