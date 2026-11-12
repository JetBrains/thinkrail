import { expect, test } from "bun:test";
import { removalFlag } from "./SettledRemovalDialog";

test("only a complete clean check clears a row for removal", () => {
	const ready = {
		kind: "ready" as const,
		byId: new Map([
			["clean", { id: "clean", dirty: 0, unpushed: 0 }],
			["dirty", { id: "dirty", dirty: 2, unpushed: 0 }],
			["ahead", { id: "ahead", dirty: 0, unpushed: 1 }],
			["unknown", { id: "unknown", dirty: null, unpushed: 0 }],
		]),
	};
	expect(removalFlag({ kind: "checking" }, "clean")).toBe("checking");
	expect(removalFlag({ kind: "failed" }, "clean")).toBe("unchecked");
	expect(removalFlag(ready, "clean")).toBeNull();
	expect(removalFlag(ready, "dirty")).toBe("dirty");
	expect(removalFlag(ready, "ahead")).toBe("unpushed");
	expect(removalFlag(ready, "unknown")).toBe("unchecked");
	expect(removalFlag(ready, "missing")).toBe("unchecked");
});
