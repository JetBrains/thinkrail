import { defineServerExtension } from "@thinkrail/extension-api/server";
import {
	createPresentFilesExtension,
	PRESENT_FILES_TOOL_NAME,
	publishedPaths,
} from "./presentFiles";

export default defineServerExtension({
	name: "outputs",
	title: "Outputs",
	description:
		"Lets the agent publish the finished files it made for you to the Artifacts tab's Outputs view, shown as file cards in chat.",
	extensions: [],
	sessionExtensions: (session) => [createPresentFilesExtension(session.workspaceFiles)],
	artifactTools: { [PRESENT_FILES_TOOL_NAME]: { published: publishedPaths } },
});
