import {
	RiArrowDownSLine as ChevronDown,
	RiGitPullRequestLine as GitPullRequestArrow,
	RiLoader4Line as Loader2,
	RiSparkling2Line as Sparkles,
} from "@remixicon/react";
import type { PrBodySource } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";

export interface PrSourcing {
	source: PrBodySource;
	templates: string[];
	planAvailable: boolean;
}

export interface PrComposeState {
	draft: boolean;
	title: string;
	body: string;
	titleEdited?: boolean;
	sourcing?: PrSourcing;
}

export interface PrComposeSubmit {
	title: string;
	body: string;
	titleEdited: boolean;
	sourcing: PrSourcing | undefined;
}

export interface PrComposeSources {
	change: (source: PrBodySource, template: string | undefined) => Promise<string | null>;
	generate: (template: string | undefined) => Promise<string | null>;
}

const SOURCE_LABEL: Record<PrBodySource, string> = {
	plan: "Chat plan",
	commits: "Commits",
	template: "Template",
	empty: "Empty",
};

function SourceSwitch({
	value,
	options,
	disabled,
	onChange,
}: {
	value: PrBodySource;
	options: PrBodySource[];
	disabled: boolean;
	onChange: (source: PrBodySource) => void;
}) {
	return (
		<fieldset
			aria-label="Description from"
			data-testid="open-pr-compose-source"
			className="m-0 inline-flex min-w-0 rounded-sm border border-control-border-default bg-control-bg p-2"
		>
			{options.map((option) => (
				<button
					key={option}
					type="button"
					aria-pressed={value === option}
					data-source={option}
					disabled={disabled}
					onClick={() => onChange(option)}
					className={cn(
						"h-24 rounded-sm px-8 tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text",
						value === option
							? "bg-control-bg-selected text-text-default"
							: "text-text-muted hover:text-text-default",
					)}
				>
					{SOURCE_LABEL[option]}
				</button>
			))}
		</fieldset>
	);
}

function ComposeForm({
	state,
	busy,
	sources,
	onSubmit,
}: {
	state: PrComposeState;
	busy: boolean;
	sources: PrComposeSources;
	onSubmit: (submit: PrComposeSubmit) => void;
}) {
	const { sourcing } = state;
	const [title, setTitle] = useState(state.title);
	const [body, setBody] = useState(state.body);
	const [source, setSource] = useState(sourcing?.source);
	const [template, setTemplate] = useState(sourcing?.templates[0]);
	const [working, setWorking] = useState<"source" | "generate" | null>(null);
	const action = state.draft ? "Open draft PR" : "Open PR";
	const templates = sourcing?.templates ?? [];
	const options: PrBodySource[] = [
		...(sourcing?.planAvailable ? (["plan"] as const) : []),
		"commits",
		...(templates.length > 0 ? (["template"] as const) : []),
		"empty",
	];
	const run = (kind: "source" | "generate", load: () => Promise<string | null>) => {
		setWorking(kind);
		void load()
			.then((next) => {
				if (next !== null) setBody(next);
			})
			.finally(() => setWorking(null));
	};
	const switchSource = (next: PrBodySource, nextTemplate = template) => {
		setSource(next);
		setTemplate(nextTemplate);
		run("source", () => sources.change(next, next === "template" ? nextTemplate : undefined));
	};
	const locked = busy || working !== null;
	return (
		<>
			<DialogHeader>
				<DialogTitle>{action}</DialogTitle>
				<DialogDescription>
					{sourcing
						? "Review the title and description before the PR is created."
						: "Review the title and description before the PR is created — both came from this plan."}
				</DialogDescription>
			</DialogHeader>
			<label className="flex flex-col gap-4">
				<span className="tr-text-eyebrow text-text-subtle">Title</span>
				<input
					type="text"
					data-testid="open-pr-compose-title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					className="w-full rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active"
				/>
			</label>
			{source ? (
				<div className="flex flex-col gap-4">
					<span className="tr-text-eyebrow text-text-subtle">Description from</span>
					<div className="flex flex-wrap items-center gap-8">
						<SourceSwitch
							value={source}
							options={options}
							disabled={locked}
							onChange={(next) => switchSource(next)}
						/>
						{source === "template" && templates.length > 1 ? (
							<DropdownMenu>
								<DropdownMenuTrigger
									data-testid="open-pr-compose-template"
									disabled={locked}
									className="flex h-28 min-w-0 max-w-full items-center gap-4 rounded-sm border border-control-border-default bg-control-bg px-8 tr-code-text-small text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
								>
									<span className="truncate">{template}</span>
									<ChevronDown className="size-14 shrink-0 text-text-subtle" />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start">
									<DropdownMenuRadioGroup
										value={template ?? ""}
										onValueChange={(next) => switchSource("template", next)}
									>
										{templates.map((path) => (
											<DropdownMenuRadioItem key={path} value={path} className="tr-code-text-small">
												{path}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</div>
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col gap-4">
				<label htmlFor="open-pr-compose-body" className="tr-text-eyebrow text-text-subtle">
					Description
				</label>
				<Textarea
					id="open-pr-compose-body"
					data-testid="open-pr-compose-body"
					value={body}
					onChange={(e) => setBody(e.target.value)}
					disabled={working !== null}
					rows={14}
					className="min-h-160 flex-1 resize-y tr-code-text"
				/>
			</div>
			{source ? (
				<div className="flex flex-wrap items-center gap-8">
					<Button
						variant="soft"
						size="sm"
						data-testid="open-pr-compose-generate"
						disabled={locked}
						onClick={() =>
							run("generate", () => sources.generate(source === "template" ? template : undefined))
						}
					>
						{working === "generate" ? (
							<Loader2 className="size-14 animate-spin" />
						) : (
							<Sparkles className="size-14" />
						)}
						{source === "template" ? "Fill template with agent" : "Generate with agent"}
					</Button>
					<span className="tr-text-metadata text-text-subtle">
						{working === "generate"
							? "Writing from the diff, commits, and plan…"
							: "Replaces the description; nothing is sent until you open the PR."}
					</span>
				</div>
			) : null}
			<DialogFooter>
				<Button
					data-testid="open-pr-compose-submit"
					disabled={locked || title.trim().length === 0}
					onClick={() =>
						onSubmit({
							title,
							body,
							titleEdited: Boolean(state.titleEdited) || title.trim() !== state.title.trim(),
							sourcing: sourcing && source ? { ...sourcing, source } : undefined,
						})
					}
				>
					{busy ? (
						<Loader2 className="size-14 animate-spin" />
					) : (
						<GitPullRequestArrow className="size-14" />
					)}
					{action}
				</Button>
			</DialogFooter>
		</>
	);
}

export function PrComposeDialog({
	state,
	busy,
	sources,
	onClose,
	onSubmit,
}: {
	state: PrComposeState | null;
	busy: boolean;
	sources: PrComposeSources;
	onClose: () => void;
	onSubmit: (submit: PrComposeSubmit) => void;
}) {
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent
				data-testid="open-pr-compose-dialog"
				className="max-w-[40rem] max-h-[85vh] overflow-y-auto"
			>
				{state ? (
					<ComposeForm
						key={`${state.draft}-${state.title}`}
						state={state}
						busy={busy}
						sources={sources}
						onSubmit={onSubmit}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
