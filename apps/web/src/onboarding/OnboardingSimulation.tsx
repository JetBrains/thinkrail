import {
	Check,
	ChevronRight,
	Folder,
	FolderOpen,
	GitBranch,
	House,
	Loader2,
	type LucideIcon,
	Plus,
	Send,
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

type CoachInfo = {
	selector: string;
	side: "top" | "right";
	scope: "card" | "viewport";
	title: string;
	body: string;
};

function activeCoach(step: Step, dialogOpen: boolean): CoachInfo | null {
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
			return dialogOpen
				? {
						selector: '[data-testid="create-workspace"]',
						side: "right",
						scope: "viewport",
						title: "Create the workspace",
						body: "A workspace isolates this task on its own branch. The prepared task will start here — click Create.",
					}
				: {
						selector: '[data-sim="rail-add"]',
						side: "right",
						scope: "card",
						title: "Create a workspace",
						body: "ThinkRail runs each task in its own isolated worktree and branch. Open the New workspace dialog.",
					};
		case "ws2-create":
			return dialogOpen
				? {
						selector: '[data-testid="create-workspace"]',
						side: "right",
						scope: "viewport",
						title: "Create the second workspace",
						body: "A second isolated workspace so the tasks run in parallel. Its prepared task starts here — click Create.",
					}
				: {
						selector: '[data-sim="rail-add"]',
						side: "right",
						scope: "card",
						title: "Create a second workspace",
						body: "Add a second workspace so two tasks run side by side, each on its own branch.",
					};
		case "agent1":
			return {
				selector: '[data-sim="send"]',
				side: "top",
				scope: "card",
				title: "Start the first agent",
				body: "The prompt is ready — send it to the agent.",
			};
		case "agent2-switch":
			return {
				selector: '[data-sim="ws-1"]',
				side: "right",
				scope: "card",
				title: "Switch to your second workspace",
				body: "Your first agent keeps working — switch over to start the next one.",
			};
		case "agent2":
			return {
				selector: '[data-sim="send"]',
				side: "top",
				scope: "card",
				title: "Run a second agent in parallel",
				body: "Both agents run at the same time, each in its own workspace. Send to start.",
			};
		default:
			return null;
	}
}

const WS_NAMES = ["Add search", "Completed filter"];

export type CreateDialogArgs = { onCreate: () => void; onClose: () => void; prompt: string };

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
	const [drafts, setDrafts] = useState<Record<number, string>>({});
	const [messages, setMessages] = useState<Record<number, Msg[]>>({});
	const [status, setStatus] = useState<Record<number, WsStatus>>({});
	const [dialogOpen, setDialogOpen] = useState(false);
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(() => () => timers.current.forEach(clearTimeout), []);

	const projectOpen = step !== "intro" && step !== "open" && step !== "picker";
	const coach = activeCoach(step, dialogOpen);
	const progress = STEP_ORDER.indexOf(step) / (STEP_ORDER.length - 1);

	const onRailAdd = () => {
		if (step === "ws1-create" || step === "ws2-create") setDialogOpen(true);
	};

	const onPreviewCreate = () => {
		if (step === "ws1-create") {
			setWorkspaces([WS_NAMES[0] as string]);
			setDialogOpen(false);
			setStep("ws2-create");
		} else if (step === "ws2-create") {
			setWorkspaces([WS_NAMES[0] as string, WS_NAMES[1] as string]);
			setActiveWs(0);
			setDrafts((d) => ({ ...d, 0: TASK_1 }));
			setDialogOpen(false);
			setStep("agent1");
		}
	};

	const onWsClick = (index: number) => {
		if (step === "agent2-switch" && index === 1) {
			setActiveWs(1);
			setDrafts((d) => ({ ...d, 1: TASK_2 }));
			setStep("agent2");
		}
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
							prompt: step === "ws1-create" ? TASK_1 : TASK_2,
						})
					: null}
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
						data-sim="send"
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

function Intro({ onDone }: { onDone: () => void }) {
	const [phase, setPhase] = useState(0);
	const [gitReady, setGitReady] = useState(false);
	useEffect(() => {
		const timers = [
			setTimeout(() => setPhase(1), 200),
			setTimeout(() => setPhase(2), 1000),
			setTimeout(() => setPhase(3), 1900),
			setTimeout(() => setGitReady(true), 3200),
			setTimeout(() => setPhase(4), 3900),
			setTimeout(onDone, 5200),
		];
		return () => timers.forEach(clearTimeout);
	}, [onDone]);
	const reveal = (index: number) =>
		`transition-all duration-500 ease-out motion-reduce:transition-none ${
			phase >= index ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
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
			<div className={`flex flex-col items-center gap-sm ${reveal(3)}`}>
				<p className="tr-title-card text-text-default">Before we start</p>
				<p className="max-w-[460px] text-text-muted tr-text-metadata">
					ThinkRail works with Git projects. Let's make sure your computer is ready.
				</p>
				<div
					data-testid="onboarding-git"
					className="mt-xs inline-flex items-center gap-sm rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-md py-sm"
				>
					<GitBranch className="size-4 shrink-0 text-text-muted" />
					<span className="tr-text-ui text-text-default">Git</span>
					{gitReady ? (
						<span className="inline-flex items-center gap-xs tr-text-metadata text-feedback-success">
							<Check className="size-3.5" />
							Git is ready
						</span>
					) : (
						<span className="inline-flex items-center gap-xs text-text-muted tr-text-metadata">
							<Loader2 className="size-3.5 motion-safe:animate-spin" />
							Checking Git…
						</span>
					)}
				</div>
			</div>
			<p
				className={`max-w-[520px] whitespace-pre-line text-text-muted tr-text-metadata ${reveal(4)}`}
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
