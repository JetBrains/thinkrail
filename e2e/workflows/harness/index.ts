// The workflow-test harness barrel — the only import surface for spec files (module rule: siblings
// import through the barrel). Architecture + contracts: ../SPEC.md (module-workflow-tests).
export { type Check, type CheckContext, type CheckResult, checks, runChecks } from "./checks";
export {
	type AnsweredRound,
	attachDialog,
	type DialogConfig,
	type DialogRung,
	type DialogScriptEntry,
	parsePersonaReply,
	pickRecommended,
	skipAll,
} from "./dialog";
export { type CapturedToolCall, captureEvents, EventLog } from "./events";
export { type JudgeItem, type JudgeResult, judgeTranscript, parseJudgeReply } from "./judge";
export {
	applyArtifactPreset,
	FIXTURE_MD_SUFFIX,
	includeInFixtureSnapshot,
	isRecordMode,
	maskFixtureMarkdown,
	recordFixture,
	unmaskFixtureMarkdown,
	useTranscriptFixture,
} from "./presets";
export { appendRunRecord, type RunRecord } from "./runlog";
export {
	defineScenario,
	runScenario,
	type ScenarioDef,
	type ScenarioResult,
	workflowTest,
} from "./scenario";
export { endAllSessions, endSession, promptTurn, startSession, stopTurn } from "./session";
export {
	type Signal,
	type SignalHit,
	signals,
	type ToolCallMatcher,
	watchSignals,
} from "./signals";
export {
	nextUserMessage,
	openingMessage,
	parseSimReply,
	SIM_DONE,
	type UserSimConfig,
} from "./userSim";
export {
	assessOnTrack,
	checkBudget,
	DEFAULT_BUDGET,
	parseOnTrackReply,
	type WatchdogBudget,
	type WatchdogConfig,
} from "./watchdog";
export { seedWorkspace, type WorkspaceKind, type WorkspaceSeed } from "./workspace";
