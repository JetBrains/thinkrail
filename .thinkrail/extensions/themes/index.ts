import { defineExtension } from "@thinkrail/ext";
import { DRAFT_KEY, parseDraft } from "./model";

export default defineExtension(async (tr) => {
	const stored = parseDraft(await tr.store.get<unknown>(DRAFT_KEY));
	if (stored) tr.publish(DRAFT_KEY, stored);

	tr.action("saveDraft", async (payload) => {
		const draft = parseDraft(payload);
		if (!draft) return { ok: false, error: "Not a theme draft." };
		await tr.store.set(DRAFT_KEY, draft);
		tr.publish(DRAFT_KEY, draft);
		return { ok: true };
	});

	return undefined;
});
