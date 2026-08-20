/**
 * navigation — client-local routes and restoration (see SPEC.md). The barrel is the module's only public
 * surface: the route type + fragment codec, the driver seam (native adapters implement it; the browser
 * driver is `initNavigation`'s default), and the one-shot `initNavigation` the composition root calls.
 */
export type { NavigationDriver } from "./driver";
export { initNavigation } from "./init";
export {
	MAIN_LOCATION,
	type NavigationLocation,
	parseFragment,
	serializeLocation,
} from "./location";
