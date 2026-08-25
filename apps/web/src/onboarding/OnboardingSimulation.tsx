import { Check, Folder, FolderOpen, GitBranch, House, Plus, Send, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from "../components/ui/popover";
import { PRODUCT_NAME } from "../constants/branding";
import { useAppStore } from "../store";
import { useTargetRect } from "./anchor";

const TASK_1 = "Add search functionality to the To Do app.";
const TASK_2 = "Add a filter for completed tasks.";
const RESULT_1 =
	"Added a live search box that filters tasks as you type — a new searchTasks() in src/app.js wired to an input in index.html.";
const RESULT_2 =
	"Added an All / Active / Completed filter above the list, with the chosen filter remembered across reloads.";

type Step =
	| "intro"
	| "open"
	| "picker"
	| "ws1-create"
	| "ws2-create"
	| "agent1"
	| "agent2-switch"
	| "agent2"
	| "done";

const STEP_ORDER: Step[] = [
	"intro",
	"open",
	"picker",
	"ws1-create",
	"ws2-create",
	"agent1",
	"agent2-switch",
	"agent2",
	"done",
];

type WsStatus = "idle" | "working" | "done";
type Msg = { id: string; role: "user" | "assistant" | "working"; text?: string };

const COACH: Record<
	Exclude<Step, "intro" | "done">,
	{ title: string; body: string; selector: string; side: "top" | "right"; task?: string }
> = {
	open: {
		title: "Open a project",
		body: "Choose a project folder from your computer.",
		selector: '[data-sim="open-project"]',
		side: "top",
	},
	picker: {
		title: "Choose your project folder",
		body: "Select the To Do App folder to open it in ThinkRail.",
		selector: '[data-sim="folder"]',
		side: "right",
	},
	"ws1-create": {
		title: "Create a workspace",
		body: "ThinkRail runs each task in its own isolated worktree and branch. Create one for the first task.",
		selector: '[data-sim="rail-add"]',
		side: "right",
	},
	"ws2-create": {
		title: "Create a second workspace",
		body: "Now create a second workspace so two tasks can run side by side, each on its own branch.",
		selector: '[data-sim="rail-add"]',
		side: "right",
	},
	agent1: {
		title: "Start the first agent",
		body: "Ask the agent to build the first feature, then send it.",
		selector: '[data-sim="composer"]',
		side: "top",
		task: TASK_1,
	},
	"agent2-switch": {
		title: "Switch to your second workspace",
		body: "Your first agent keeps working independently — switch over to start the next one.",
		selector: '[data-sim="ws-1"]',
		side: "right",
	},
	agent2: {
		title: "Run a second agent in parallel",
		body: "Start the second task here. Both agents now run at the same time, each in its own workspace.",
		selector: '[data-sim="composer"]',
		side: "top",
		task: TASK_2,
	},
};

const WS_NAMES = ["Add search", "Completed filter"];

export function OnboardingSimulation() {
	const open = useAppStore((s) => s.demoOpen);
	if (!open) return null;
	return <Simulation />;
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

function Simulation() {
	const closeDemo = useAppStore((s) => s.closeDemo);
	const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
	const cardRect = useElementRect(cardEl);
	const [step, setStep] = useState<Step>("intro");
	const startTour = useCallback(() => setStep("open"), []);
	const [workspaces, setWorkspaces] = useState<string[]>([]);
	const [activeWs, setActiveWs] = useState(0);
	const [drafts, setDrafts] = useState<Record<number, string>>({});
	const [messages, setMessages] = useState<Record<number, Msg[]>>({});
	const [status, setStatus] = useState<Record<number, WsStatus>>({});
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(() => () => timers.current.forEach(clearTimeout), []);

	const projectOpen = step !== "intro" && step !== "open" && step !== "picker";
	const coach = step === "intro" || step === "done" ? null : COACH[step];
	const progress = STEP_ORDER.indexOf(step) / (STEP_ORDER.length - 1);

	const onRailAdd = () => {
		if (step === "ws1-create") {
			setWorkspaces([WS_NAMES[0] as string]);
			setStep("ws2-create");
		} else if (step === "ws2-create") {
			setWorkspaces([WS_NAMES[0] as string, WS_NAMES[1] as string]);
			setActiveWs(0);
			setStep("agent1");
		}
	};

	const onWsClick = (index: number) => {
		if (step === "agent2-switch" && index === 1) {
			setActiveWs(1);
			setStep("agent2");
		}
	};

	const insertTask = () => {
		if (coach?.task) setDrafts((d) => ({ ...d, [activeWs]: coach.task as string }));
	};

	const send = () => {
		const ws = activeWs;
		const text = (drafts[ws] ?? "").trim();
		if (!text || status[ws] === "working") return;
		const result = ws === 0 ? RESULT_1 : RESULT_2;
		setDrafts((d) => ({ ...d, [ws]: "" }));
		setStatus((s) => ({ ...s, [ws]: "working" }));
		setMessages((m) => ({
			...m,
			[ws]: [
				...(m[ws] ?? []),
				{ id: crypto.randomUUID(), role: "user", text },
				{ id: crypto.randomUUID(), role: "working" },
			],
		}));
		const timer = setTimeout(() => {
			setMessages((m) => ({
				...m,
				[ws]: [
					...(m[ws] ?? []).filter((msg) => msg.role !== "working"),
					{ id: crypto.randomUUID(), role: "assistant", text: result },
				],
			}));
			setStatus((s) => ({ ...s, [ws]: "done" }));
			setStep(ws === 0 ? "agent2-switch" : "done");
		}, 1400);
		timers.current.push(timer);
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
					<SimCenter
						step={step}
						activeWs={activeWs}
						messages={messages}
						status={status}
						draft={drafts[activeWs] ?? ""}
						onDraft={(v) => setDrafts((d) => ({ ...d, [activeWs]: v }))}
						onOpenProject={() => setStep("picker")}
						onPickFolder={() => setStep("ws1-create")}
						onSend={send}
					/>
				</div>

				{step === "intro" ? <Intro onDone={startTour} /> : null}
				{coach ? (
					<CardSpotlight
						cardRect={cardRect}
						selector={coach.selector}
						side={coach.side}
						title={coach.title}
						body={coach.body}
						{...(coach.task ? { onInsert: insertTask } : {})}
					/>
				) : null}
				{step === "done" ? <Completion onFinish={() => closeDemo()} /> : null}

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
									className={`flex h-7 w-full items-center gap-sm rounded-[var(--radius-sm)] pr-xs pl-xl text-left tr-text-ui transition-colors ${
										index === activeWs
											? "bg-control-bg-selected text-primary"
											: "text-text-muted hover:bg-control-bg-hovered"
									}`}
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
					{step === "agent2" || step === "agent2-switch" ? (
						<span className="mt-sm pl-sm text-text-subtle tr-text-metadata leading-snug">
							Both workspaces keep their own agent session — switching tabs never stops them.
						</span>
					) : null}
				</>
			) : (
				<span className="pl-sm text-text-subtle tr-text-metadata">No project open</span>
			)}
		</aside>
	);
}

function SimCenter({
	step,
	activeWs,
	messages,
	status,
	draft,
	onDraft,
	onOpenProject,
	onPickFolder,
	onSend,
}: {
	step: Step;
	activeWs: number;
	messages: Record<number, Msg[]>;
	status: Record<number, WsStatus>;
	draft: string;
	onDraft: (value: string) => void;
	onOpenProject: () => void;
	onPickFolder: () => void;
	onSend: () => void;
}) {
	if (step === "open") {
		return (
			<Center>
				<h1 className="tr-brand-hero text-primary">{PRODUCT_NAME}</h1>
				<div className="mt-xl">
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
		return (
			<Center>
				<div className="w-[440px] overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg shadow-[var(--shadow-md)]">
					<div className="flex items-center gap-xs border-border-default border-b px-lg py-md tr-text-metadata text-text-muted">
						<Folder className="size-3.5" />
						<span>Home</span>
						<span>/</span>
						<span>Projects</span>
					</div>
					<ul className="p-sm">
						<li>
							<button
								type="button"
								data-sim="folder"
								data-testid="sim-folder"
								onClick={onPickFolder}
								className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-md py-sm text-left tr-text-ui text-text-default transition-colors hover:bg-control-bg-hovered"
							>
								<Folder className="size-4 text-primary" />
								<span>to-do-app</span>
							</button>
						</li>
					</ul>
				</div>
			</Center>
		);
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
	const rows = messages[activeWs] ?? [];
	return (
		<div className="flex min-h-0 flex-1 flex-col bg-container-content-bg">
			<div className="flex min-h-0 flex-1 flex-col gap-sm overflow-auto p-lg">
				{rows.length === 0 ? (
					<p className="m-auto text-text-subtle tr-text-metadata">
						Start the agent below to build this task.
					</p>
				) : (
					rows.map((msg) =>
						msg.role === "user" ? (
							<div
								key={msg.id}
								className="max-w-[80%] self-end rounded-[var(--radius-md)] border border-bubble-user-border bg-bubble-user-bg px-md py-sm tr-text-ui text-text-default"
							>
								{msg.text}
							</div>
						) : msg.role === "working" ? (
							<div
								key={msg.id}
								className="inline-flex items-center gap-sm self-start text-text-muted tr-text-metadata"
							>
								<span className="size-2 animate-pulse rounded-full bg-primary" />
								Working…
							</div>
						) : (
							<div key={msg.id} className="max-w-[80%] self-start tr-text-ui text-text-default">
								{msg.text}
							</div>
						),
					)
				)}
			</div>
			<div data-sim="composer" className="border-border-default border-t p-md">
				<div className="flex items-end gap-sm rounded-[var(--radius-md)] border border-control-border-default bg-container-workspace-bg p-sm">
					<textarea
						data-testid="sim-composer"
						value={draft}
						onChange={(event) => onDraft(event.target.value)}
						placeholder="Ask the agent…"
						rows={2}
						className="min-h-[40px] flex-1 resize-none bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-subtle"
					/>
					<Button
						size="sm"
						data-testid="sim-send"
						disabled={!draft.trim() || status[activeWs] === "working"}
						onClick={onSend}
					>
						<Send className="size-4" />
						Send
					</Button>
				</div>
			</div>
		</div>
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
	onInsert,
}: {
	cardRect: DOMRect | null;
	selector: string;
	side: "top" | "right";
	title: string;
	body: string;
	onInsert?: () => void;
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
					className="z-50 w-[260px] p-md"
					onOpenAutoFocus={(event) => event.preventDefault()}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
					onInteractOutside={(event) => event.preventDefault()}
				>
					<p className="tr-title-card text-text-default">{title}</p>
					<p className="mt-xs text-text-muted tr-text-metadata leading-snug">{body}</p>
					{onInsert ? (
						<div className="mt-md flex justify-end">
							<Button
								variant="outline"
								size="sm"
								data-testid="onboarding-insert-prompt"
								onClick={onInsert}
							>
								Insert prompt
							</Button>
						</div>
					) : null}
					<PopoverArrow />
				</PopoverContent>
			</Popover>
		</div>
	);
}

function Intro({ onDone }: { onDone: () => void }) {
	const [shown, setShown] = useState(0);
	useEffect(() => {
		const timers = [
			setTimeout(() => setShown(1), 200),
			setTimeout(() => setShown(2), 1100),
			setTimeout(() => setShown(3), 2100),
			setTimeout(onDone, 3400),
		];
		return () => timers.forEach(clearTimeout);
	}, [onDone]);
	const reveal = (index: number) =>
		`transition-all duration-500 ease-out motion-reduce:transition-none ${
			shown >= index ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
		}`;
	return (
		<div
			data-testid="onboarding-intro"
			className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-md bg-container-workspace-bg p-xl text-center"
		>
			<h1 className={`tr-brand-hero text-primary ${reveal(1)}`}>Welcome to ThinkRail</h1>
			<p className={`max-w-[520px] tr-text-ui text-text-default ${reveal(2)}`}>
				ThinkRail is a worktree IDE built for working with AI agents in parallel.
			</p>
			<p
				className={`max-w-[520px] whitespace-pre-line text-text-muted tr-text-metadata ${reveal(3)}`}
			>
				{"Let's set up a demo project first.\nIt takes about 2 minutes."}
			</p>
		</div>
	);
}

function Completion({ onFinish }: { onFinish: () => void }) {
	return (
		<div className="absolute inset-0 z-40 flex items-center justify-center bg-container-workspace-overlay">
			<div className="w-[360px] rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-lg text-center shadow-[var(--shadow-md)]">
				<p className="tr-title-card text-text-default">You're ready to build</p>
				<p className="mt-xs text-text-muted tr-text-metadata leading-snug">
					You opened a project, created two isolated workspaces, and ran two agents in parallel —
					that's the ThinkRail loop.
				</p>
				<div className="mt-md flex justify-center">
					<Button size="sm" data-testid="onboarding-finish" onClick={onFinish}>
						Finish
					</Button>
				</div>
			</div>
		</div>
	);
}
