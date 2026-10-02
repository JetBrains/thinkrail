import { expect, test } from "bun:test";
import { CHANGE_MUTATIONS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { canOfferChangeMutations } from "./changeMutationAvailability";

test("change mutations require a mutable scope, host capability, and loaded metadata", () => {
	expect(
		canOfferChangeMutations({ kind: "uncommitted" }, CHANGE_MUTATIONS_PROTOCOL_VERSION, true),
	).toBe(true);
	expect(
		canOfferChangeMutations({ kind: "uncommitted" }, CHANGE_MUTATIONS_PROTOCOL_VERSION - 1, true),
	).toBe(false);
	expect(canOfferChangeMutations({ kind: "uncommitted" }, null, true)).toBe(false);
	expect(
		canOfferChangeMutations(
			{ kind: "commit", sha: "abc" },
			CHANGE_MUTATIONS_PROTOCOL_VERSION,
			true,
		),
	).toBe(false);
	expect(
		canOfferChangeMutations(
			{ kind: "pinned", baseRef: "abc" },
			CHANGE_MUTATIONS_PROTOCOL_VERSION,
			false,
		),
	).toBe(false);
});
