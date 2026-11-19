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

export const PRESETS = ["agentic-kanban", "solo"] as const;
export type Preset = (typeof PRESETS)[number];

/** Which open issues the GitHub source lists: all of them, or those assigned to the gh user. */
export const GITHUB_FILTERS = ["open", "mine"] as const;
export type GithubFilter = (typeof GITHUB_FILTERS)[number];

export const TITLE_MAX = 300;
export const TEXT_MAX = 20_000;

export type Actor = "human" | "agent" | "git" | "automation";

/** Where a card comes from: the board itself, a workspace's task-spec or a GitHub issue. */
export type CardSource =
	| { kind: "native"; ref: string }
	| { kind: "task-spec"; ref: string; workspaceId: string; path: string }
	| { kind: "github"; ref: string; number: number; url: string };

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
}

export const DEFAULT_SETTINGS: BoardSettings = {
	preset: "agentic-kanban",
	wipLimits: { needsYou: 3, review: 5, agents: 3 },
	followSelection: false,
	github: { enabled: false, filter: "open" },
};

export function latestAttempt(card: Pick<Card, "attempts">): Attempt | undefined {
	return card.attempts.at(-1);
}
