import { useChannel, useHostContext } from "@thinkrail/ext/view";
import { useMemo } from "react";
import { channelKey, type Note, planInjection } from "./model";

const NO_PROJECT = "no-project";

export const useNotes = () => {
	const { projectId } = useHostContext();
	const notes = useChannel<Note[]>(projectId ? channelKey(projectId) : NO_PROJECT);
	const plan = useMemo(() => planInjection(notes ?? []), [notes]);
	return { projectId, notes, plan };
};
