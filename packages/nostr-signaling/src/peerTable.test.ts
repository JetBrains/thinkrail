import { expect, test } from "bun:test";
import { createPeerTable } from "./peerTable";

test("keeps at most max peers, dropping the least recently used", () => {
	const created: string[] = [];
	const table = createPeerTable(2, (peer) => {
		created.push(peer);
		return { peer };
	});
	const a = table.use("a");
	table.use("b");
	expect(table.use("a")).toBe(a);
	table.use("c");
	expect(table.size).toBe(2);
	expect(table.use("a")).toBe(a);
	table.use("b");
	expect(created).toEqual(["a", "b", "c", "b"]);
	table.delete("b");
	expect(table.size).toBe(1);
});
