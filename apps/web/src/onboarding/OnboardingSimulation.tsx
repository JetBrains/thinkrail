import {
	Check,
	ChevronRight,
	FileText,
	Folder,
	FolderOpen,
	GitBranch,
	House,
	Loader2,
	type LucideIcon,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from "../components/ui/popover";
import { PRODUCT_NAME } from "../constants/branding";
import { cn } from "../lib";
import { useAppStore } from "../store";
import { useTargetRect } from "./anchor";

const TASK_1 = "Implement a search feature in my To Do app.";
const TASK_2 = "Add filtering by tags so I can quickly show tasks with a specific tag.";
const WS_NAMES = ["Search feature", "Tag filtering"];

const QUESTION = "Where should tag filters appear?";
const QUESTION_OPTIONS = ["Above the task list", "In the sidebar", "Next to the search field"];

type Activity =
	| { id: string; kind: "user" | "note" | "result"; text: string }
	| { id: string; kind: "tool"; text: string }
	| { id: string; kind: "working"; text: string }
	| { id: string; kind: "changes"; text: string };

const uid = () => crypto.randomUUID();

function ws1Working(): Activity[] {
	return [
		{ id: uid(), kind: "user", text: TASK_1 },
		{ id: uid(), kind: "tool", text: "Read index.html" },
		{ id: uid(), kind: "tool", text: "Read src/app.js" },
		{ id: uid(), kind: "note", text: "Plan: add a search box that filters tasks as you type." },
		{ id: uid(), kind: "working", text: "Implementing search…" },
	];
}

function ws1Done(): Activity[] {
	return [
		{ id: uid(), kind: "user", text: TASK_1 },
		{ id: uid(), kind: "tool", text: "Edit src/app.js" },
		{ id: uid(), kind: "tool", text: "Edit index.html" },
		{
			id: uid(),
			kind: "result",
			text: "Search is live — a searchTasks() filter wired to a new input; tasks narrow as you type.",
		},
		{ id: uid(), kind: "changes", text: "2 files changed · +38 −4" },
	];
}

function ws2Thinking(): Activity[] {
	return [
		{ id: uid(), kind: "user", text: TASK_2 },
		{ id: uid(), kind: "tool", text: "Read src/app.js" },
		{
			id: uid(),
			kind: "note",
			text: "Thinking about where the tag filters should live in the UI…",
		},
	];
}

function ws2Resume(choice: string): Activity[] {
	return [
		{ id: uid(), kind: "note", text: `Got it — placing the filters ${choice.toLowerCase()}.` },
		{ id: uid(), kind: "tool", text: "Edit src/app.js" },
		{ id: uid(), kind: "working", text: "Adding tag parsing and the filter row…" },
	];
}

type Step =
	| "intro"
	| "open"
	| "picker"
	| "ws1-create"
	| "ws1-working"
	| "ws2-create"
	| "ws2-working"
	| "ws2-question"
	| "ws2-resume"
	| "ws1-done"
	| "final";

const STEP_ORDER: Step[] = [
	"intro",
	"open",
	"picker",
	"ws1-create",
	"ws1-working",
	"ws2-create",
	"ws2-working",
	"ws2-question",
	"ws2-resume",
	"ws1-done",
	"final",
];

type WsStatus = "idle" | "working" | "done";

type CoachInfo = {
	selector: string;
	side: "top" | "right";
	scope: "card" | "viewport";
	title: string;
	body: string;
};

function activeCoach(step: Step, dialogOpen: boolean, dialogReady: boolean): CoachInfo | null {
	switch (step) {
		case "open":
			return {
				selector: '[data-sim="open-project"]',
				side: "top",
				scope: "card",
				title: "Open a project",
				body: "Choose a project folder from your computer.",
			};
		case "picker":
			return {
				selector: '[data-sim="folder"]',
				side: "top",
				scope: "card",
				title: "Choose your project folder",
				body: "Select the To Do App folder to open it in ThinkRail.",
			};
		case "ws1-create":
		case "ws2-create": {
			if (!dialogOpen)
				return {
					selector: '[data-sim="rail-add"]',
					side: "right",
					scope: "card",
					title: step === "ws1-create" ? "Create a workspace" : "Create a second workspace",
					body: "Each task runs in its own isolated worktree and branch. Open the New workspace dialog.",
				};
			if (!dialogReady) return null;
			return {
				selector: '[data-testid="create-workspace"]',
				side: "right",
				scope: "viewport",
				title: "Create the workspace",
				body: "The task is ready. Create the workspace to start it on its own branch.",
			};
		}
		case "ws1-working":
			return {
				selector: '[data-sim="rail-add"]',
				side: "right",
				scope: "card",
				title: "Now start a second task",
				body: "Your first agent keeps working here. Open a second workspace for the next task.",
			};
		case "ws2-question":
			return {
				selector: '[data-sim="question"]',
				side: "right",
				scope: "card",
				title: "Give the agent feedback",
				body: "Choose one of the suggestions or write your own.",
			};
		case "ws2-resume":
			return {
				selector: '[data-sim="ws-0"]',
				side: "right",
				scope: "card",
				title: "Your agents work in parallel",
				body: "Your first task kept running in another workspace. Check its progress.",
			};
		default:
			return null;
	}
}

export type CreateDialogArgs = {
	onCreate: () => void;
	onClose: () => void;
	onReady: () => void;
	prompt: string;
};

export function OnboardingSimulation({
	renderCreateDialog,
}: {
	renderCreateDialog: (args: CreateDialogArgs) => ReactNode;
}) {
	const open = useAppStore((s) => s.demoOpen);
	if (!open) return null;
	return <Simulation renderCreateDialog={renderCreateDialog} />;
}

function useElementRect(el: HTMLElement | null): DOMRect | null {
	const [rect, setRect] = useState<DOMRect | null>(null);
	useEffect(() => {
		if (!el) return;
		let frame = 0;
		const measure = () => {
			setRect(el.getBoundingClientRect());
			frame = requestAnimationFrame(measure);
		};
		measure();
		return () => cancelAnimationFrame(frame);
	}, [el]);
	return rect;
}

function Simulation({
	renderCreateDialog,
}: {
	renderCreateDialog: (args: CreateDialogArgs) => ReactNode;
}) {
	const closeDemo = useAppStore((s) => s.closeDemo);
	const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
	const cardRect = useElementRect(cardEl);
	const [step, setStep] = useState<Step>("intro");
	const startTour = useCallback(() => setStep("open"), []);
	const [workspaces, setWorkspaces] = useState<string[]>([]);
	const [activeWs, setActiveWs] = useState(0);
	const [messages, setMessages] = useState<Record<number, Activity[]>>({});
	const [status, setStatus] = useState<Record<number, WsStatus>>({});
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogReady, setDialogReady] = useState(false);
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	const after = useCallback((ms: number, fn: () => void) => {
		timers.current.push(setTimeout(fn, ms));
	}, []);
	useEffect(() => {
		const list = timers.current;
		return () => list.forEach(clearTimeout);
	}, []);

	const projectOpen = step !== "intro" && step !== "open" && step !== "picker";
	const coach = activeCoach(step, dialogOpen, dialogReady);
	const progress = STEP_ORDER.indexOf(step) / (STEP_ORDER.length - 1);

	const onRailAdd = () => {
		if (step === "ws1-working") setStep("ws2-create");
		if (step === "ws1-create" || step === "ws2-create" || step === "ws1-working") {
			setDialogReady(false);
			setDialogOpen(true);
		}
	};

	const onPreviewCreate = () => {
		if (step === "ws1-create") {
			setWorkspaces([WS_NAMES[0] as string]);
			setActiveWs(0);
			setStatus({ 0: "working" });
			setMessages({ 0: ws1Working() });
			setDialogOpen(false);
			setStep("ws1-working");
		} else if (step === "ws2-create") {
			setWorkspaces([WS_NAMES[0] as string, WS_NAMES[1] as string]);
			setActiveWs(1);
			setStatus({ 0: "working", 1: "working" });
			setMessages((m) => ({ ...m, 1: ws2Thinking() }));
			setDialogOpen(false);
			setStep("ws2-working");
			after(1600, () => setStep("ws2-question"));
		}
	};

	const onAnswer = (choice: string) => {
		if (step !== "ws2-question") return;
		setMessages((m) => ({
			...m,
			1: [...(m[1] ?? []), { id: uid(), kind: "user", text: choice }, ...ws2Resume(choice)],
		}));
		setStep("ws2-resume");
	};

	const onWsClick = (index: number) => {
		if (step === "ws2-resume" && index === 0) {
			setActiveWs(0);
			setStatus((s) => ({ ...s, 0: "done" }));
			setMessages((m) => ({ ...m, 0: ws1Done() }));
			setStep("ws1-done");
			after(1900, () => setStep("final"));
		}
	};

	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay p-lg">
			<div
				ref={setCardEl}
				role="dialog"
				aria-modal="true"
				aria-label="ThinkRail onboarding demo"
				data-testid="onboarding-sim"
				className="relative flex h-[90vh] w-[90vw] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-container-workspace-bg shadow-[var(--shadow-lg)]"
			>
				<Button
					variant="ghost"
					size="sm"
					data-testid="onboarding-close"
					onClick={() => closeDemo()}
					className="absolute top-sm right-sm z-50"
				>
					<X className="size-4" />
					Close demo
				</Button>
				<div className="flex h-11 shrink-0 items-center gap-md border-border-default border-b bg-container-header-bg px-lg">
					<span className="tr-title-card text-primary">{PRODUCT_NAME}</span>
					{projectOpen ? (
						<span className="tr-text-ui text-text-muted">
							To Do App
							{workspaces[activeWs] ? ` · ${workspaces[activeWs]}` : ""}
						</span>
					) : null}
				</div>

				<div className="flex min-h-0 flex-1">
					<SimLeftPanel
						projectOpen={projectOpen}
						workspaces={workspaces}
						activeWs={activeWs}
						status={status}
						step={step}
						onRailAdd={onRailAdd}
						onWsClick={onWsClick}
					/>
					<SimMain
						step={step}
						rows={messages[activeWs] ?? []}
						onOpenProject={() => setStep("picker")}
						onPickFolder={() => setStep("ws1-create")}
						onAnswer={onAnswer}
					/>
				</div>

				{step === "intro" ? <IntroScreen onStart={startTour} /> : null}
				{step === "final" ? <FinalScreen onFinish={() => closeDemo()} /> : null}
				{coach?.scope === "card" ? (
					<CardSpotlight
						cardRect={cardRect}
						selector={coach.selector}
						side={coach.side}
						title={coach.title}
						body={coach.body}
					/>
				) : null}
				{coach?.scope === "viewport" ? (
					<ViewportCoach
						selector={coach.selector}
						side={coach.side}
						title={coach.title}
						body={coach.body}
					/>
				) : null}
				{dialogOpen
					? renderCreateDialog({
							onCreate: onPreviewCreate,
							onClose: () => setDialogOpen(false),
							onReady: () => setDialogReady(true),
							prompt: step === "ws1-create" ? TASK_1 : TASK_2,
						})
					: null}

				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 h-px">
					<div
						data-testid="onboarding-progress"
						className="h-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
						style={{ width: `${progress * 100}%` }}
					/>
				</div>
			</div>
		</div>
	);
}

function SimLeftPanel({
	projectOpen,
	workspaces,
	activeWs,
	status,
	step,
	onRailAdd,
	onWsClick,
}: {
	projectOpen: boolean;
	workspaces: string[];
	activeWs: number;
	status: Record<number, WsStatus>;
	step: Step;
	onRailAdd: () => void;
	onWsClick: (index: number) => void;
}) {
	const parallel = step === "ws2-working" || step === "ws2-question" || step === "ws2-resume";
	return (
		<aside className="flex w-[220px] shrink-0 flex-col gap-sm border-border-default border-r bg-container-sidebar-bg p-md">
			<span className="tr-text-eyebrow text-text-muted">Projects</span>
			{projectOpen ? (
				<>
					<div className="flex h-7 items-center justify-between gap-xs pr-xs pl-sm">
						<span className="flex min-w-0 items-center gap-sm tr-text-ui text-text-default">
							<Folder className="size-4 shrink-0 text-primary" />
							<span className="truncate">To Do App</span>
						</span>
						<button
							type="button"
							data-sim="rail-add"
							data-testid="sim-add-workspace"
							aria-label="Create workspace"
							onClick={onRailAdd}
							className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition-colors hover:bg-container-elevated-bg hover:text-text-default"
						>
							<Plus className="size-4" />
						</button>
					</div>
					<ul className="flex flex-col">
						<li>
							<span className="flex h-7 items-center gap-sm rounded-[var(--radius-sm)] pr-xs pl-xl tr-text-ui text-text-muted">
								<House className="size-4 shrink-0" />
								Default
							</span>
						</li>
						{workspaces.map((name, index) => (
							<li key={name}>
								<button
									type="button"
									data-sim={`ws-${index}`}
									data-testid={`sim-ws-${index}`}
									onClick={() => onWsClick(index)}
									className={cn(
										"flex h-7 w-full items-center gap-sm rounded-[var(--radius-sm)] pr-xs pl-xl text-left tr-text-ui transition-colors",
										index === activeWs
											? "bg-control-bg-selected text-primary"
											: "text-text-muted hover:bg-control-bg-hovered",
									)}
								>
									<GitBranch className="size-4 shrink-0" />
									<span className="flex-1 truncate">{name}</span>
									{status[index] === "working" ? (
										<span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
									) : null}
									{status[index] === "done" ? (
										<Check className="size-3.5 shrink-0 text-feedback-success" />
									) : null}
								</button>
							</li>
						))}
					</ul>
					{parallel ? (
						<span className="mt-sm pl-sm text-text-subtle tr-text-metadata leading-snug">
							Each workspace keeps its own agent session — switching views never stops them.
						</span>
					) : null}
				</>
			) : (
				<span className="pl-sm text-text-subtle tr-text-metadata">No project open</span>
			)}
		</aside>
	);
}

function SimMain({
	step,
	rows,
	onOpenProject,
	onPickFolder,
	onAnswer,
}: {
	step: Step;
	rows: Activity[];
	onOpenProject: () => void;
	onPickFolder: () => void;
	onAnswer: (choice: string) => void;
}) {
	if (step === "open") {
		return (
			<Center>
				<h1 className="tr-brand-hero text-primary">{PRODUCT_NAME}</h1>
				<div className="relative mt-xl">
					<div
						aria-hidden
						className="pointer-events-none absolute -inset-3 rounded-[var(--radius-lg)] bg-primary-soft blur-xl"
					/>
					<button
						type="button"
						data-sim="open-project"
						data-testid="sim-open-project"
						onClick={onOpenProject}
						className="relative flex h-[150px] w-[220px] flex-col items-start justify-between rounded-[var(--radius-sm)] border border-primary-muted bg-clip-padding bg-primary-subtle p-lg text-left transition-colors hover:bg-primary-soft"
					>
						<span className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-text-on-primary">
							<FolderOpen className="size-4" />
						</span>
						<span className="w-full">
							<span className="block tr-title-card text-text-default">Open project</span>
							<span className="mt-0.5 block text-text-muted tr-text-metadata leading-snug">
								Choose a local git repository to work in.
							</span>
						</span>
					</button>
				</div>
			</Center>
		);
	}
	if (step === "picker") {
		return <FolderPicker onPickFolder={onPickFolder} />;
	}
	if (step === "ws1-create" || step === "ws2-create") {
		return (
			<Center>
				<p className="tr-title-card text-text-default">To Do App</p>
				<p className="mt-xs max-w-[420px] text-text-muted tr-text-metadata leading-snug">
					Create a workspace for each task. Every workspace is an isolated git worktree on its own
					branch, so two features never collide.
				</p>
			</Center>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col bg-container-content-bg">
			<div className="flex min-h-0 flex-1">
				<AgentChat rows={rows} question={step === "ws2-question"} onAnswer={onAnswer} />
				<WorkbenchSides />
			</div>
			<TerminalStrip />
		</div>
	);
}

function AgentChat({
	rows,
	question,
	onAnswer,
}: {
	rows: Activity[];
	question: boolean;
	onAnswer: (choice: string) => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-sm overflow-auto p-lg">
			{rows.map((row) => (
				<ActivityRow key={row.id} row={row} />
			))}
			{question ? <QuestionWidget onAnswer={onAnswer} /> : null}
		</div>
	);
}

function ActivityRow({ row }: { row: Activity }) {
	switch (row.kind) {
		case "user":
			return (
				<div className="max-w-[80%] self-end rounded-[var(--radius-md)] border border-bubble-user-border bg-bubble-user-bg px-md py-sm tr-text-ui text-text-default">
					{row.text}
				</div>
			);
		case "note":
			return <div className="max-w-[85%] self-start tr-text-ui text-text-default">{row.text}</div>;
		case "tool":
			return (
				<div className="inline-flex items-center gap-sm self-start rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-0.5 text-text-muted tr-code-text">
					<FileText className="size-3.5 shrink-0" />
					{row.text}
				</div>
			);
		case "working":
			return (
				<div className="inline-flex items-center gap-sm self-start text-text-muted tr-text-metadata">
					<span className="size-2 animate-pulse rounded-full bg-primary" />
					{row.text}
				</div>
			);
		case "result":
			return (
				<div className="flex max-w-[85%] items-start gap-sm self-start tr-text-ui text-text-default">
					<Check className="mt-0.5 size-4 shrink-0 text-feedback-success" />
					<span>{row.text}</span>
				</div>
			);
		case "changes":
			return (
				<div className="inline-flex items-center gap-sm self-start rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-0.5 text-text-muted tr-text-metadata">
					<GitBranch className="size-3.5 shrink-0" />
					{row.text}
				</div>
			);
	}
}

function QuestionWidget({ onAnswer }: { onAnswer: (choice: string) => void }) {
	const [custom, setCustom] = useState("");
	return (
		<div
			data-sim="question"
			data-testid="onboarding-question"
			className="w-full max-w-[85%] self-start rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-md"
		>
			<p className="tr-text-ui text-text-default">{QUESTION}</p>
			<div className="mt-sm flex flex-col gap-xs">
				{QUESTION_OPTIONS.map((option) => (
					<Button
						key={option}
						variant="outline"
						size="sm"
						data-testid="sim-question-option"
						className="justify-start"
						onClick={() => onAnswer(option)}
					>
						{option}
					</Button>
				))}
			</div>
			<div className="mt-sm flex items-end gap-sm rounded-[var(--radius-sm)] border border-control-border-default bg-container-workspace-bg p-sm">
				<input
					data-testid="sim-question-custom"
					value={custom}
					onChange={(event) => setCustom(event.target.value)}
					placeholder="Or write your own…"
					className="min-w-0 flex-1 bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-subtle"
				/>
				<Button
					size="sm"
					disabled={!custom.trim()}
					onClick={() => onAnswer(custom.trim())}
					data-testid="sim-question-send"
				>
					Send
				</Button>
			</div>
		</div>
	);
}

function WorkbenchSides() {
	return (
		<div className="hidden w-[220px] shrink-0 flex-col border-border-default border-l bg-container-sidebar-bg md:flex">
			<div className="flex h-8 shrink-0 items-center gap-md border-border-default border-b px-md tr-text-eyebrow text-text-muted">
				<span className="text-text-default">Files</span>
				<span>Specs</span>
				<span>Changes</span>
			</div>
			<ul className="flex flex-col gap-0.5 overflow-auto p-xs tr-text-ui text-text-muted">
				<SideRow name="index.html" />
				<SideRow name="styles.css" />
				<SideRow name="src/app.js" />
				<SideRow name="src/storage.js" />
				<SideRow name="SPEC.md" />
			</ul>
		</div>
	);
}

function SideRow({ name }: { name: string }) {
	return (
		<span className="flex h-6 items-center gap-sm rounded-[var(--radius-sm)] px-sm">
			<FileText className="size-3.5 shrink-0 text-text-subtle" />
			<span className="truncate">{name}</span>
		</span>
	);
}

function TerminalStrip() {
	return (
		<div className="h-[104px] shrink-0 border-border-default border-t bg-container-terminal-bg">
			<div className="flex h-7 items-center gap-sm border-border-default border-b px-md tr-text-eyebrow text-text-muted">
				<SquareTerminal className="size-3.5" />
				Terminal
			</div>
			<pre className="overflow-hidden px-md py-sm text-text-muted tr-code-text leading-relaxed">
				{"~/to-do-app "}
				<span className="text-text-subtle">(tag-filtering)</span>
				{" $ git status\nOn branch tag-filtering\nnothing to commit, working tree clean\n$ "}
				<span className="animate-pulse motion-reduce:animate-none">▊</span>
			</pre>
		</div>
	);
}

function FolderPicker({ onPickFolder }: { onPickFolder: () => void }) {
	return (
		<div className="flex min-h-0 flex-1 bg-container-content-bg p-lg">
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-inverse bg-container-inverse-bg text-text-on-inverse shadow-[var(--shadow-lg)]">
				<div className="flex h-10 shrink-0 items-center gap-xs border-border-inverse border-b px-md">
					<House className="size-4 shrink-0 text-text-on-inverse-muted" />
					<span className="tr-text-ui text-text-on-inverse">Your computer</span>
					<ChevronRight className="size-3.5 shrink-0 text-text-on-inverse-muted" />
					<span className="tr-text-ui text-text-on-inverse-muted">My Documents</span>
					<ChevronRight className="size-3.5 shrink-0 text-text-on-inverse-muted" />
					<span className="tr-text-ui text-text-on-inverse-muted">Projects</span>
				</div>
				<div className="flex min-h-0 flex-1">
					<PickerColumn className="w-[200px]" label="Locations">
						<PickerRow icon={House} name="Your computer" />
						<PickerRow icon={Folder} name="Desktop" />
						<PickerRow icon={Folder} name="My Documents" selected />
						<PickerRow icon={Folder} name="Downloads" />
					</PickerColumn>
					<PickerColumn className="w-[220px]">
						<PickerRow icon={Folder} name="Notes" />
						<PickerRow icon={Folder} name="Projects" selected chevron />
					</PickerColumn>
					<PickerColumn className="min-w-0 flex-1" last>
						<PickerRow icon={Folder} name="my-app" />
						<PickerRow icon={Folder} name="notes" />
						<PickerRow icon={Folder} name="to-do-app" target onSelect={onPickFolder} />
					</PickerColumn>
				</div>
			</div>
		</div>
	);
}

function PickerColumn({
	className,
	label,
	last,
	children,
}: {
	className?: string;
	label?: string;
	last?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex min-h-0 flex-col gap-0.5 overflow-auto p-xs",
				!last && "border-border-inverse border-r",
				className,
			)}
		>
			{label ? (
				<span className="px-sm pt-xs pb-1 tr-text-eyebrow text-text-on-inverse-muted">{label}</span>
			) : null}
			{children}
		</div>
	);
}

function PickerRow({
	icon: Icon,
	name,
	selected,
	chevron,
	target,
	onSelect,
}: {
	icon: LucideIcon;
	name: string;
	selected?: boolean;
	chevron?: boolean;
	target?: boolean;
	onSelect?: () => void;
}) {
	return (
		<button
			type="button"
			{...(target ? { "data-sim": "folder", "data-testid": "sim-folder" } : {})}
			{...(onSelect ? { onClick: onSelect } : {})}
			className={cn(
				"flex h-7 shrink-0 items-center gap-sm rounded-[var(--radius-sm)] px-sm text-left tr-text-ui transition-colors",
				selected
					? "bg-container-inverse-selected text-text-on-inverse"
					: "text-text-on-inverse hover:bg-container-inverse-selected",
			)}
		>
			<Icon className="size-4 shrink-0 text-text-on-inverse-muted" />
			<span className="min-w-0 flex-1 truncate">{name}</span>
			{chevron ? <ChevronRight className="size-3.5 shrink-0 text-text-on-inverse-muted" /> : null}
		</button>
	);
}

function Center({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-container-content-bg p-xl text-center">
			{children}
		</div>
	);
}

function CardSpotlight({
	cardRect,
	selector,
	side,
	title,
	body,
}: {
	cardRect: DOMRect | null;
	selector: string;
	side: "top" | "right";
	title: string;
	body: string;
}) {
	const rect = useTargetRect(selector);
	if (!rect || !cardRect) return null;
	const left = rect.left - cardRect.left;
	const top = rect.top - cardRect.top;
	const dim = "pointer-events-auto absolute bg-container-workspace-overlay";
	const clamp = (value: number) => Math.max(0, value);
	return (
		<div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
			<div className={dim} style={{ left: 0, top: 0, width: cardRect.width, height: clamp(top) }} />
			<div
				className={dim}
				style={{
					left: 0,
					top: top + rect.height,
					width: cardRect.width,
					height: clamp(cardRect.height - (top + rect.height)),
				}}
			/>
			<div className={dim} style={{ left: 0, top, width: clamp(left), height: rect.height }} />
			<div
				className={dim}
				style={{
					left: left + rect.width,
					top,
					width: clamp(cardRect.width - (left + rect.width)),
					height: rect.height,
				}}
			/>
			<div
				aria-hidden
				data-testid="onboarding-target-glow"
				className="pointer-events-none absolute rounded-[var(--radius-sm)] ring-2 ring-primary motion-safe:animate-pulse"
				style={{ left, top, width: rect.width, height: rect.height }}
			/>
			<Popover open>
				<PopoverAnchor asChild>
					<div
						aria-hidden
						className="pointer-events-none fixed"
						style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
					/>
				</PopoverAnchor>
				<PopoverContent
					data-testid="onboarding-coach"
					side={side}
					align="center"
					className="z-50 w-[260px] border-primary bg-primary p-md text-text-on-primary"
					onOpenAutoFocus={(event) => event.preventDefault()}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
					onInteractOutside={(event) => event.preventDefault()}
				>
					<p className="tr-title-card text-text-on-primary">{title}</p>
					<p className="mt-xs tr-text-metadata leading-snug text-text-on-primary">{body}</p>
					<PopoverArrow className="fill-primary" />
				</PopoverContent>
			</Popover>
		</div>
	);
}

function ViewportCoach({
	selector,
	side,
	title,
	body,
}: {
	selector: string;
	side: "top" | "right";
	title: string;
	body: string;
}) {
	const rect = useTargetRect(selector);
	if (!rect) return null;
	const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
	return (
		<>
			<div
				aria-hidden
				data-testid="onboarding-target-glow"
				className="pointer-events-none fixed z-[60] rounded-[var(--radius-sm)] ring-2 ring-primary motion-safe:animate-pulse"
				style={box}
			/>
			<Popover open>
				<PopoverAnchor asChild>
					<div aria-hidden className="pointer-events-none fixed" style={box} />
				</PopoverAnchor>
				<PopoverContent
					data-testid="onboarding-coach"
					side={side}
					align="center"
					className="z-[60] w-[260px] border-primary bg-primary p-md text-text-on-primary"
					onOpenAutoFocus={(event) => event.preventDefault()}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
					onInteractOutside={(event) => event.preventDefault()}
				>
					<p className="tr-title-card text-text-on-primary">{title}</p>
					<p className="mt-xs tr-text-metadata leading-snug text-text-on-primary">{body}</p>
					<PopoverArrow className="fill-primary" />
				</PopoverContent>
			</Popover>
		</>
	);
}

type Gap = "lg" | "xxl" | "xxxl" | "xxxxl";

const GAP_CLASS: Record<Gap, string> = {
	lg: "mt-lg",
	xxl: "mt-xxl",
	xxxl: "mt-xxxl",
	xxxxl: "mt-xxxxl",
};

type OnboardingSection = {
	key: string;
	gapBefore?: Gap;
	render: () => ReactNode;
};

function useSequentialReveal(count: number): number {
	const [phase, setPhase] = useState(0);
	useEffect(() => {
		const timers: ReturnType<typeof setTimeout>[] = [];
		for (let index = 1; index <= count; index++) {
			timers.push(setTimeout(() => setPhase(index), 200 + (index - 1) * 700));
		}
		return () => timers.forEach(clearTimeout);
	}, [count]);
	return phase;
}

function revealClass(shown: boolean): string {
	return cn(
		"transition-all duration-500 ease-out motion-reduce:transition-none",
		shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
	);
}

function OnboardingScreen({
	testId,
	sections,
	cta,
}: {
	testId: string;
	sections: OnboardingSection[];
	cta: {
		label: string;
		testId: string;
		onClick: () => void;
		gapBefore: Gap;
		disabled?: boolean;
		leading?: ReactNode;
	};
}) {
	const steps = sections.length + 1;
	const phase = useSequentialReveal(steps);
	const ctaRevealed = phase >= steps;
	return (
		<div
			data-testid={testId}
			className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-container-workspace-bg p-xl text-center"
		>
			<div className="flex w-full max-w-[720px] flex-col items-center">
				{sections.map((section, index) => {
					const revealed = phase >= index + 1;
					return (
						<div
							key={section.key}
							data-revealed={revealed ? "true" : "false"}
							className={cn(
								section.gapBefore && GAP_CLASS[section.gapBefore],
								revealClass(revealed),
							)}
						>
							{section.render()}
						</div>
					);
				})}
				<div className={cn(GAP_CLASS[cta.gapBefore], revealClass(ctaRevealed))}>
					<div className="flex flex-wrap items-center justify-center gap-sm">
						{cta.leading}
						<Button
							data-testid={cta.testId}
							data-revealed={ctaRevealed ? "true" : "false"}
							disabled={cta.disabled}
							onClick={cta.onClick}
						>
							{cta.label}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

function GitStatus({ ready }: { ready: boolean }) {
	return (
		<div
			data-testid="onboarding-git"
			data-ready={ready ? "true" : "false"}
			className="inline-flex h-8 items-center gap-sm rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-md tr-text-ui"
		>
			<span className="text-text-default">Git:</span>
			{ready ? (
				<span className="inline-flex items-center gap-xs text-feedback-success">
					<Check className="size-3.5" />
					is Ready
				</span>
			) : (
				<Loader2 className="size-3.5 shrink-0 text-text-muted motion-safe:animate-spin" />
			)}
		</div>
	);
}

function IntroScreen({ onStart }: { onStart: () => void }) {
	const [gitReady, setGitReady] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setGitReady(true), 3500);
		return () => clearTimeout(timer);
	}, []);
	const sections: OnboardingSection[] = [
		{
			key: "title",
			render: () => <h1 className="tr-brand-hero text-primary">Welcome to {PRODUCT_NAME}</h1>,
		},
		{
			key: "lede",
			gapBefore: "xxl",
			render: () => (
				<p className="max-w-[400px] tr-heading-md text-text-default">
					{PRODUCT_NAME} is a worktree IDE built for working with AI agents in parallel.
				</p>
			),
		},
		{
			key: "git-copy",
			gapBefore: "xxxl",
			render: () => (
				<p className="tr-text-ui text-text-muted">
					<span className="block">{PRODUCT_NAME} works with Git projects</span>
					<span className="block">Let's make sure your computer is ready.</span>
				</p>
			),
		},
	];
	return (
		<OnboardingScreen
			testId="onboarding-intro"
			sections={sections}
			cta={{
				label: "Start demo project",
				testId: "onboarding-start",
				onClick: onStart,
				gapBefore: "lg",
				disabled: !gitReady,
				leading: <GitStatus ready={gitReady} />,
			}}
		/>
	);
}

function FinalScreen({ onFinish }: { onFinish: () => void }) {
	const sections: OnboardingSection[] = [
		{
			key: "title",
			render: () => <p className="tr-brand-hero text-primary">That's the workflow.</p>,
		},
		{
			key: "lede",
			gapBefore: "xxl",
			render: () => (
				<p className="max-w-[560px] tr-heading-md text-text-default">
					Now try it with your own project.
				</p>
			),
		},
	];
	return (
		<OnboardingScreen
			testId="onboarding-final"
			sections={sections}
			cta={{
				label: "Start working on your own project",
				testId: "onboarding-finish",
				onClick: onFinish,
				gapBefore: "xxxxl",
			}}
		/>
	);
}
