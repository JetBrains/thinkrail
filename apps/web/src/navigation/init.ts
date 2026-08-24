import { getTransport } from "../transport";
import { browserNavigationDriver, type NavigationDriver } from "./driver";
import { startNavigation } from "./restore";

let started = false;

export function initNavigation(driver: NavigationDriver = browserNavigationDriver()): void {
	if (started) return;
	started = true;
	startNavigation({
		driver,
		listWorkspaces: (projectId) =>
			getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	});
}
