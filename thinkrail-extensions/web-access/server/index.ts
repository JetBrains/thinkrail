import { defineServerExtension } from "@thinkrail/extension-api/server";
import piWebAccess from "./piWebAccess.js";

export default defineServerExtension({
	name: "web-access",
	title: "Web access",
	description:
		"Lets the agent search the web, fetch pages, GitHub repositories, PDFs and videos, and research open-source libraries with its librarian skill.",
	extensions: [piWebAccess],
	childExtensions: [piWebAccess],
	skillPackages: ["pi-web-access"],
});
