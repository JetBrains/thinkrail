import { expect, test } from "bun:test";
import type { Project, Workspace } from "@thinkrail/contracts";
import type { RemoteSessionItem } from "@thinkrail/remote-client";
import { EMPTY_PLACES, placeIn, recordPlaces } from "./chats";

const item = (hostKey: string, workspaceId: string) =>
	({ hostKey, record: { sessionId: "s", workspaceId } }) as unknown as RemoteSessionItem;
const place = {
	project: { id: "p" } as Project,
	workspace: { id: "w" } as Workspace,
};

test("a chat whose computer's read failed says why instead of loading forever, until a read lands", () => {
	expect(placeIn(EMPTY_PLACES, item("a", "w"))).toBeUndefined();
	const failed = recordPlaces(EMPTY_PLACES, "a", { failed: "timeout" });
	expect(placeIn(failed, item("a", "w"))).toEqual({ failed: "timeout" });
	expect(placeIn(failed, item("b", "w"))).toBeUndefined();
	const landed = recordPlaces(failed, "a", { found: [place] });
	expect(placeIn(landed, item("a", "w"))).toBe(place);
	expect(landed.failures.size).toBe(0);
});

test("a later failure keeps the places already found on screen", () => {
	const found = recordPlaces(EMPTY_PLACES, "a", { found: [place] });
	const failed = recordPlaces(found, "a", { failed: "down" });
	expect(placeIn(failed, item("a", "w"))).toBe(place);
	expect(placeIn(failed, item("a", "other"))).toEqual({ failed: "down" });
});
