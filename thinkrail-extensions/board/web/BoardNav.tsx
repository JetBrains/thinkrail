import {
	RiCheckboxBlankCircleFill,
	RiFilter3Line,
	RiFlag2Line,
	RiFolder3Line,
	RiStackLine,
} from "@remixicon/react";
import type { PanelProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import {
	type BoardView,
	CARD_SIZES,
	CARD_TYPES,
	type InboxItem,
	loadBoard,
	overLimit,
	type ProjectSummary,
} from "./api";
import { useBoardProject } from "./boardProject";
import {
	type BoardSelection,
	QUEUES,
	queueCount,
	selectInitiative,
	selectProject,
	toggleMine,
	toggleQueue,
	toggleSize,
	toggleType,
	useBoardSelection,
} from "./boardState";
import { useInbox } from "./Inbox";
import { QUEUE_LABELS, TYPE_LABELS } from "./labels";
import { type Initiative, loadRoadmap, type RoadmapView } from "./roadmapApi";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

const DEPTH_PADDING = ["pl-8", "pl-16", "pl-24"] as const;

function NavSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section aria-label={title} className="flex flex-col gap-2 py-4">
			<h3 className="px-8 pb-2 tr-text-eyebrow text-text-subtle">{title}</h3>
			<ul className="flex flex-col">{children}</ul>
		</section>
	);
}

function NavRow({
	testId,
	pressed,
	icon,
	label,
	figure,
	attention = false,
	depth = 0,
	data,
	onClick,
}: {
	testId: string;
	pressed: boolean;
	icon?: ReactNode;
	label: string;
	figure?: ReactNode;
	attention?: boolean;
	depth?: number;
	data?: Readonly<Record<`data-${string}`, string>>;
	onClick: () => void;
}) {
	const t = useT();
	return (
		<li>
			<button
				type="button"
				data-testid={testId}
				aria-pressed={pressed}
				{...data}
				onClick={onClick}
				className={cn(
					"flex h-28 w-full min-w-0 items-center gap-8 rounded-xs pr-8 text-left tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default focus-visible:focus-ring aria-pressed:bg-control-bg-selected aria-pressed:text-text-default",
					DEPTH_PADDING[Math.min(depth, DEPTH_PADDING.length - 1)],
				)}
			>
				{icon}
				<span className="min-w-0 flex-1 truncate">{label}</span>
				{attention ? (
					<RiCheckboxBlankCircleFill
						aria-label={t("board.nav.attention")}
						data-testid="board-nav-attention"
						className="size-8 shrink-0 text-feedback-warning"
					/>
				) : null}
				{figure === undefined ? null : (
					<span className="shrink-0 tabular-nums tr-text-metadata text-text-subtle">{figure}</span>
				)}
			</button>
		</li>
	);
}

function Projects({
	projects,
	shown,
	inbox,
}: {
	projects: readonly ProjectSummary[];
	shown: string;
	inbox: readonly InboxItem[];
}) {
	const t = useT();
	return (
		<NavSection title={t("board.nav.projects")}>
			{projects.map((project) => (
				<NavRow
					key={project.projectId}
					testId="board-nav-project"
					data={{ "data-project-id": project.projectId }}
					pressed={project.projectId === shown}
					icon={<RiFolder3Line aria-hidden className="size-14 shrink-0" />}
					label={project.name}
					figure={project.cards}
					attention={inbox.some((item) => item.projectId === project.projectId)}
					onClick={() => selectProject(project.projectId)}
				/>
			))}
		</NavSection>
	);
}

function waitingOn(roadmap: RoadmapView, initiative: Initiative): boolean {
	const agents = roadmap.rollups.initiatives[initiative.id]?.agents;
	return !!agents && agents.waiting + agents.failed > 0;
}

function Initiatives({
	roadmap,
	board,
	selection,
}: {
	roadmap: RoadmapView | null;
	board: BoardView | null;
	selection: BoardSelection;
}) {
	const t = useT();
	const initiatives = roadmap?.initiatives.filter((initiative) => !initiative.proposed) ?? [];
	return (
		<NavSection title={t("board.nav.initiatives")}>
			<NavRow
				testId="board-nav-all"
				pressed={selection.initiativeId === null}
				icon={<RiStackLine aria-hidden className="size-14 shrink-0" />}
				label={t("board.nav.allCards")}
				figure={board?.cards.length ?? ""}
				onClick={() => selectInitiative(null)}
			/>
			{roadmap
				? initiatives.map((initiative) => (
						<NavRow
							key={initiative.id}
							testId="board-nav-initiative"
							data={{ "data-initiative-id": initiative.id }}
							depth={initiative.depth + 1}
							pressed={selection.initiativeId === initiative.id}
							icon={<RiFlag2Line aria-hidden className="size-14 shrink-0" />}
							label={initiative.title}
							figure={initiative.memberCardIds.length}
							attention={waitingOn(roadmap, initiative)}
							onClick={() => selectInitiative(initiative.id)}
						/>
					))
				: null}
		</NavSection>
	);
}

function Queues({ board, selection }: { board: BoardView | null; selection: BoardSelection }) {
	const t = useT();
	return (
		<NavSection title={t("board.nav.queues")}>
			{QUEUES.map((queue) => {
				const wip = board ? queueCount(board, queue) : null;
				return (
					<NavRow
						key={queue}
						testId={`board-nav-queue-${queue}`}
						pressed={selection.queue === queue}
						label={t(QUEUE_LABELS[queue])}
						attention={queue === "needsYou" && (wip?.count ?? 0) > 0}
						figure={
							wip ? (
								<span
									data-over={overLimit(wip) || undefined}
									className="data-[over]:text-feedback-error"
								>
									{wip.limit > 0 ? `${wip.count}/${wip.limit}` : wip.count}
								</span>
							) : (
								""
							)
						}
						onClick={() => toggleQueue(queue)}
					/>
				);
			})}
		</NavSection>
	);
}

function Filters({ selection }: { selection: BoardSelection }) {
	const t = useT();
	const { filters } = selection;
	const filter = <RiFilter3Line aria-hidden className="size-14 shrink-0" />;
	return (
		<NavSection title={t("board.nav.filters")}>
			<NavRow
				testId="board-nav-filter-mine"
				pressed={filters.mine}
				icon={filter}
				label={t("board.nav.filter.mine")}
				onClick={toggleMine}
			/>
			{CARD_TYPES.map((type) => (
				<NavRow
					key={type}
					testId={`board-nav-filter-type-${type}`}
					pressed={filters.types.includes(type)}
					icon={filter}
					label={t(TYPE_LABELS[type])}
					onClick={() => toggleType(type)}
				/>
			))}
			{CARD_SIZES.map((size) => (
				<NavRow
					key={size}
					testId={`board-nav-filter-size-${size}`}
					pressed={filters.sizes.includes(size)}
					icon={filter}
					label={t("board.nav.filter.size", { size })}
					onClick={() => toggleSize(size)}
				/>
			))}
		</NavSection>
	);
}

/**
 * Board view's left side: the project shown (one at a time, among the open ones), its initiatives with
 * their counts and attention dots, the queues and the saved filters — each narrowing the center.
 */
export default function BoardNav({ host }: PanelProps) {
	const t = useT();
	const { projectId, projects } = useBoardProject(host);
	const selection = useBoardSelection();
	const inbox = useInbox(host);
	const board = useHostQuery(`nav-board:${projectId}`, (signal) =>
		loadBoard(host, projectId, signal),
	);
	useBoardChanged(host, projectId, board.reload);
	const roadmap = useHostQuery(`nav-roadmap:${projectId}`, (signal) =>
		loadRoadmap(host, projectId, signal),
	);
	useBoardChanged(host, projectId, roadmap.reload);
	return (
		<nav
			data-testid="board-nav"
			data-project-id={projectId}
			aria-label={t("board.nav.title")}
			className="flex h-full min-h-0 flex-col overflow-auto bg-container-sidebar-bg px-4 py-4"
		>
			{projects ? <Projects projects={projects} shown={projectId} inbox={inbox} /> : null}
			<Initiatives
				roadmap={roadmap.state.kind === "ready" ? roadmap.state.value : null}
				board={board.state.kind === "ready" ? board.state.value : null}
				selection={selection}
			/>
			<Queues
				board={board.state.kind === "ready" ? board.state.value : null}
				selection={selection}
			/>
			<Filters selection={selection} />
		</nav>
	);
}
