import { getTransport } from "../transport";
import { browserNavigationDriver, type NavigationDriver } from "./driver";
import { startNavigation } from "./restore";

let started = false;

/**
 * Initialize the navigation layer against the app's transport singleton — called once from `main.tsx`,
 * after `initTransport()`. Idempotent: a duplicate call is a no-op, and because the coordinator checks the
 * store's current `welcomeGeneration` before subscribing to its edges, an init that runs after a welcome
 * already installed cannot miss it. Tests drive `startNavigation` directly with fake deps instead.
 */
export function initNavigation(driver: NavigationDriver = browserNavigationDriver()): void {
	if (started) return;
	started = true;
	startNavigation({
		driver,
		// The light authoritative list: complete membership/order, no per-workspace diff-stat fan-out.
		listWorkspaces: (projectId) =>
			getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	});
}
