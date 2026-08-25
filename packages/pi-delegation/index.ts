// The pi-delegation barrel — the package's ONLY public surface. The contract these exports form is
// specified in designs/TASK-delegation-core.md (spec leads code); boundary rules live in SPEC.md.

export { createDelegationService } from "./src/service";
export {
	DEFAULT_SCOPE,
	defaultDelegationRoot,
	delegationSessionDir,
	deriveChildSessionFile,
} from "./src/storage";
export {
	type ChildHandle,
	type ChildInfo,
	type CreateChildSpec,
	type DelegationBindings,
	DelegationError,
	type DelegationErrorCode,
	type DelegationRunDetails,
	type DelegationService,
	type LifecycleEvent,
	type RunLifecycleStatus,
	type RunOptions,
	type RunOutcome,
	type RunSnapshot,
	type RunStatus,
	type SessionOptions,
	type SpawnRecord,
	type WorkspaceProvider,
} from "./src/types";
