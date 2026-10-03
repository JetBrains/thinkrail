import { expect, test } from "bun:test";
import { requestClose, subscribeCloseRequest } from "./closeRequestChannel";

test("close requests reach only current subscribers", () => {
	let calls = 0;
	requestClose();
	const unsubscribe = subscribeCloseRequest(() => {
		calls += 1;
	});
	requestClose();
	requestClose();
	unsubscribe();
	requestClose();
	expect(calls).toBe(2);
});
