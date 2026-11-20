import { expect, test } from "bun:test";
import { useAppStore } from "./appStore";

type AppState = ReturnType<typeof useAppStore.getState>;

/**
 * Every data key the store holds that survives a host switch. Anything else must be host-scoped (reset by
 * `resetHostState`); a new field lands in one or the other on purpose.
 */
const CLIENT_SCOPED: readonly (keyof AppState & string)[] = [
	"connectionGeneration",
	"welcomeGeneration",
	"routeChatTargetGeneration",
	"layoutProjectionEpoch",
	"sessionStateClock",
	"providerVersion",
	"providerStatusVersion",
	"templatesVersion",
	"packagesVersion",
	"mcpRevision",
	"resourceRevision",
	"workbenchFrame",
	"layoutStateReady",
	"localLayoutPreferences",
	"hiddenModels",
	"artifactsShowIgnored",
	"artifactsView",
	"changesView",
	"changesLayout",
	"filesMode",
	"chatMessageOrder",
	"markdownOutlineSide",
	"markdownOutlineVisible",
	"doubleShiftSearch",
	"onboardingWizard",
	"settingsOpen",
	"settingsSection",
	"settingsTarget",
	"surveyWindowOpen",
	"notificationPromptOpen",
	"searchOpen",
	"searchSession",
	"shortcutsOpen",
	"toasts",
];

test("every store field is either reset on a host switch or listed as client-scoped", () => {
	const SENTINEL = Symbol("untouched");
	const before = useAppStore.getState();
	const fields = before as unknown as Record<string, unknown>;
	const dataKeys = Object.keys(fields).filter((key) => typeof fields[key] !== "function");
	useAppStore.setState(
		Object.fromEntries(dataKeys.map((key) => [key, SENTINEL])) as unknown as Partial<AppState>,
	);
	useAppStore.getState().resetHostState();
	const after = useAppStore.getState() as unknown as Record<string, unknown>;
	const survived = dataKeys.filter((key) => after[key] === SENTINEL);
	useAppStore.setState(before, true);
	expect([...survived].sort()).toEqual([...CLIENT_SCOPED].sort());
});
