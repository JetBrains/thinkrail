import { remixicon, type SurfaceProps, ui } from "@thinkrail/ext/view";
import { useState } from "react";
import { useNow, useRunner, useTests } from "./hooks";
import { formatAgo, formatDuration, type Running, type RunResult, type TestsState } from "./model";
import { CountChips, Empty, FailureCard, OutcomeLabel, OutputTail } from "./parts";

const { RiFlaskLine, RiPlayLine, RiStopLine, RiLoader4Line } = remixicon;

const RunningLine = ({ running }: { running: Running }) => {
	const now = useNow(1_000);
	return (
		<div
			data-testid="test-runner-running"
			className="flex flex-col gap-4 rounded-md border border-border-muted bg-control-bg px-12 py-8"
		>
			<span className="flex items-center gap-8 tr-text-ui text-text-default">
				<RiLoader4Line className="size-14 shrink-0 animate-spin text-primary" />
				Running {running.command}
				<span className="ml-auto shrink-0 tabular-nums text-text-muted">
					{formatDuration(Math.max(0, now - running.startedAt))}
				</span>
			</span>
			{running.by === "agent" && (
				<span className="tr-text-metadata text-text-muted">Started by the agent</span>
			)}
			{running.lastLine && (
				<span className="truncate tr-code-text text-text-muted" title={running.lastLine}>
					{running.lastLine}
				</span>
			)}
		</div>
	);
};

const ResultView = ({ result, previous }: { result: RunResult; previous: boolean }) => {
	const now = useNow(30_000);
	const hidden = result.failuresTotal - result.failures.length;
	const showOutput =
		result.outcome === "error" ||
		result.outcome === "timeout" ||
		(result.outcome === "failed" && result.failures.length === 0);
	return (
		<div data-testid="test-runner-result" className="flex flex-col gap-12">
			<div className="flex flex-col gap-8">
				{previous && <h3 className="tr-text-metadata text-text-muted">Last run</h3>}
				<div className="flex items-center gap-8">
					<OutcomeLabel outcome={result.outcome} />
					<span className="ml-auto truncate tr-text-metadata text-text-muted">
						{formatDuration(result.durationMs)} ·{" "}
						{formatAgo(Math.max(0, now - result.startedAt - result.durationMs))}
						{result.by === "agent" ? " · by agent" : ""}
					</span>
				</div>
				<span className="truncate tr-code-text text-text-subtle" title={result.command}>
					{result.command}
				</span>
				{result.message && (
					<span className="tr-text-metadata text-feedback-warning">{result.message}</span>
				)}
				<CountChips counts={result.counts} />
			</div>
			{result.failures.length > 0 && (
				<ul className="flex flex-col gap-8">
					{result.failures.map((failure, index) => (
						<FailureCard key={`${index}:${failure.name}`} failure={failure} result={result} />
					))}
				</ul>
			)}
			{hidden > 0 && (
				<p className="tr-text-metadata text-text-muted">{hidden} more failing tests not shown.</p>
			)}
			{showOutput && <OutputTail output={result.output} />}
		</div>
	);
};

const Controls = ({ state, initial }: { state: TestsState; initial: string }) => {
	const [filter, setFilter] = useState(initial);
	const { run, cancel, reply } = useRunner();
	const ready = state.runner.state === "ready";
	return (
		<div className="flex flex-col gap-8">
			<form
				className="flex items-center gap-8"
				onSubmit={(event) => {
					event.preventDefault();
					if (ready && !state.running) run(filter);
				}}
			>
				<ui.Input
					data-testid="test-runner-filter"
					aria-label="Filter test files"
					placeholder="Filter by file path"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					className="min-w-0 flex-1"
				/>
				{state.running ? (
					<ui.Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="test-runner-cancel"
						onClick={cancel}
					>
						<RiStopLine className="size-14" /> Cancel
					</ui.Button>
				) : (
					<ui.Button type="submit" size="sm" data-testid="test-runner-run" disabled={!ready}>
						<RiPlayLine className="size-14" /> Run
					</ui.Button>
				)}
			</form>
			{reply && !reply.started && reply.reason && (
				<p className="tr-text-metadata text-feedback-warning">{reply.reason}</p>
			)}
		</div>
	);
};

const RunnerPanel = ({ host }: SurfaceProps) => {
	const { workspaceId } = host;
	const state = useTests(workspaceId);
	if (!workspaceId) return <Empty title="Open a workspace to run its tests." />;
	if (!state) return <Empty title="Looking for tests…" />;
	const { runner, running, last } = state;
	return (
		<div
			data-testid="test-runner"
			data-state={running ? "running" : (last?.outcome ?? "idle")}
			className="flex h-full min-h-0 flex-col bg-container-workspace-bg"
		>
			<header className="flex shrink-0 flex-col gap-8 border-b border-border-muted px-12 py-12">
				<div className="flex min-w-0 items-center gap-8">
					<RiFlaskLine className="size-16 shrink-0 text-primary" />
					<h2 className="tr-title-compact text-text-default">Tests</h2>
					<span
						data-testid="test-runner-label"
						className="ml-auto min-w-0 truncate tr-code-text text-text-muted"
						title={runner.state === "ready" ? runner.label : runner.message}
					>
						{runner.state === "ready" ? runner.label : "no runner"}
					</span>
				</div>
				<Controls key={workspaceId} state={state} initial={last?.filter ?? ""} />
				{runner.state === "error" && (
					<p className="tr-text-metadata text-feedback-error">{runner.message}</p>
				)}
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-12 overflow-y-auto p-12">
				{running && <RunningLine running={running} />}
				{last ? (
					<ResultView result={last} previous={Boolean(running)} />
				) : (
					!running && (
						<Empty
							title="No test run yet"
							detail="Run the tests here, or ask the agent to call run_tests."
						/>
					)
				)}
			</div>
		</div>
	);
};

export default RunnerPanel;
