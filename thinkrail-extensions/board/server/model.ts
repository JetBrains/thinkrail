export const CATEGORIES = [
	"triage",
	"backlog",
	"unstarted",
	"started",
	"review",
	"completed",
	"canceled",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CARD_TYPES = ["feature", "bug", "chore"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_SIZES = ["S", "M", "L"] as const;
export type CardSize = (typeof CARD_SIZES)[number];

export const WORKFLOWS = ["brainstorm", "implement"] as const;
export type Workflow = (typeof WORKFLOWS)[number];

export const PRESETS = ["agentic-kanban", "solo", "spec-driven"] as const;
export type Preset = (typeof PRESETS)[number];

/** Which open issues the GitHub source lists: all of them, or those assigned to the gh user. */
export const GITHUB_FILTERS = ["open", "mine"] as const;
export type GithubFilter = (typeof GITHUB_FILTERS)[number];

export const TITLE_MAX = 300;
export const TEXT_MAX = 20_000;

export type Actor = "human" | "agent" | "git" | "automation";

/** Where a card comes from: the board itself, a workspace's task-spec, a GitHub issue or an OpenSpec change. */
export type CardSource =
	| { kind: "native"; ref: string }
	| { kind: "task-spec"; ref: string; workspaceId: string; path: string }
	| { kind: "github"; ref: string; number: number; url: string }
	| { kind: "openspec"; ref: string; change: string };

export interface AttemptNote {
	text: string;
	at: number;
}

export interface Attempt {
	workspaceId: string;
	sessionId: string;
	workflow: Workflow;
	startedAt: number;
	notes: AttemptNote[];
	/** The workspace's PR was seen merged. */
	merged?: true;
	/** The workspace was removed (archived or deleted). */
	removedAt?: number;
	/** The PR whose description was seen to carry the card's issue's `Closes #N`. */
	closesLinked?: number;
}

export interface Card {
	id: string;
	source: CardSource;
	title: string;
	description: string;
	acceptance: string[];
	type: CardType;
	size?: CardSize;
	/** The size is an agent's suggestion the human has not edited. */
	sizeSuggested?: boolean;
	labels: string[];
	/** Ids of the cards this card blocks. */
	blocks: string[];
	specRefs: string[];
	rank: number;
	category: Category;
	column: string;
	ownerHuman: string;
	attempts: Attempt[];
	createdBy: "human" | "agent";
	/** The chat that filed an agent's card, and the card that chat works on: Triage groups by it. */
	origin?: CardOrigin;
	createdAt: number;
	updatedAt: number;
	/** An attempt's workspace went away unmerged: the board asks whether to cancel; nothing is canceled. */
	cancelPending?: { workspaceId: string; at: number };
	/** The roadmap project (`P-n`) of this board the card belongs to; `projectId` is always a ThinkRail project. */
	roadmapProjectId?: string;
	/** A milestone (`M-n`) of the card's roadmap project. */
	milestoneId?: string;
	/** The planned start pinned on the step graph, an ISO date (`YYYY-MM-DD`). */
	pinnedStart?: string;
	/** Days of work the card stands for on the step graph; absent, its size's (`estimateOf`). */
	estimateDays?: number;
}

/** The chat that filed a card and the card it works on; a human's deferrals carry the card alone. */
export interface CardOrigin {
	sessionId?: string;
	cardId?: string;
}

export interface Placement {
	category: Category;
	column: string;
}

export interface Transition {
	cardId: string;
	/** `null` when the card was created. */
	from: Placement | null;
	/** `null` when the card was deleted. */
	to: Placement | null;
	at: number;
	actor: Actor;
	reason: string;
}

export interface WipLimits {
	needsYou: number;
	review: number;
	agents: number;
}

export interface GithubSettings {
	enabled: boolean;
	filter: GithubFilter;
}

export interface BoardSettings {
	preset: Preset;
	wipLimits: WipLimits;
	followSelection: boolean;
	github: GithubSettings;
	/** Where Publish writes the roadmap snapshot in the Default workspace, worktree-relative. */
	snapshotPath: string;
}

export const DEFAULT_SNAPSHOT_PATH = "ROADMAP.md";

export const DEFAULT_SETTINGS: BoardSettings = {
	preset: "agentic-kanban",
	wipLimits: { needsYou: 3, review: 5, agents: 3 },
	followSelection: false,
	github: { enabled: false, filter: "open" },
	snapshotPath: DEFAULT_SNAPSHOT_PATH,
};

export const HORIZONS = ["now", "next", "later"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const HEALTHS = ["on_track", "at_risk", "off_track"] as const;
export type Health = (typeof HEALTHS)[number];

/** A card on another project's board, which an initiative includes. */
export interface CardRef {
	projectId: string;
	cardId: string;
}

/** A status update of an initiative: a draft until a human publishes it. */
export interface InitiativeUpdate {
	id: string;
	at: number;
	text: string;
	health: Health;
	publishedAt?: number;
}

export interface Initiative {
	id: string;
	/** The initiative it nests under; a top-level one is a goal. */
	parentId?: string;
	title: string;
	outcome: string;
	criteria: string[];
	horizon: Horizon;
	rank: number;
	/** An ISO date (`YYYY-MM-DD`). */
	target?: string;
	/** Time only: a warning past 80 % of it, never a stop. */
	appetiteDays?: number;
	specRefs: string[];
	health?: { override?: Health; note?: string };
	updates: InitiativeUpdate[];
	/** This board's cards it includes directly, besides its projects' cards. */
	cardIds: string[];
	externalCards: CardRef[];
	/** An agent's proposal, shown for acceptance; accepting clears it. */
	proposed?: true;
	proposedBy?: "agent";
	/** When the human confirmed it done in an initiative-close chat. */
	closedAt?: number;
	createdAt: number;
	updatedAt: number;
}

export interface Milestone {
	id: string;
	title: string;
	/** An ISO date (`YYYY-MM-DD`). */
	target?: string;
}

/** A roadmap project (Linear's project, once called an epic): its cards carry its id. */
export interface RoadmapProject {
	id: string;
	initiativeId?: string;
	title: string;
	milestones: Milestone[];
	proposed?: true;
	proposedBy?: "agent";
	createdAt: number;
	updatedAt: number;
}

/** Days of work a size stands for on the step graph; an unsized card counts as M. */
export const SIZE_DAYS: Record<CardSize, number> = { S: 1, M: 3, L: 6 };
/** Points a size weighs in throughput and the forecast; an unsized card counts as M. */
export const SIZE_POINTS: Record<CardSize, number> = { S: 1, M: 2, L: 4 };

export function estimateOf(card: Pick<Card, "size" | "estimateDays">): number {
	return card.estimateDays ?? SIZE_DAYS[card.size ?? "M"];
}

export function pointsOf(card: Pick<Card, "size">): number {
	return SIZE_POINTS[card.size ?? "M"];
}

export function latestAttempt(card: Pick<Card, "attempts">): Attempt | undefined {
	return card.attempts.at(-1);
}
