import { ArrowUp, Check, HelpCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EffortSelect, ModelSelect } from "./ComposerSelects";

type Choice = { label: string; desc: string; rec?: boolean };

type Block =
	| { type: "user"; text: string }
	| { type: "activity"; text: React.ReactNode }
	| { type: "says"; text: React.ReactNode }
	| { type: "widget"; chip: string; title: string; options: Choice[] }
	| { type: "done" };

const SCRIPT: Block[] = [
	{ type: "user", text: "What is ThinkRail? Keep it brief." },
	{ type: "activity", text: "read README · specs" },
	{
		type: "says",
		text: "ThinkRail is a worktree IDE for the pi coding agent. It lets you run isolated coding sessions across worktrees, with the editor, terminal, diffs, and specs in one interface.",
	},
	{ type: "user", text: "What is a worktree, and why does ThinkRail use them?" },
	{ type: "activity", text: "read architecture.md · workspace spec" },
	{
		type: "says",
		text: "A worktree is an isolated working directory connected to the same Git repository. ThinkRail uses worktrees so each task can have its own branch, files, terminal, and agent session without interfering with other work.",
	},
	{ type: "user", text: "How should I start a new feature in ThinkRail?" },
	{ type: "activity", text: "read specs/ · project graph" },
	{
		type: "says",
		text: "Start with the spec. Define the intended behavior first, then let the implementation follow it. I can help you set up the task.",
	},
	{
		type: "widget",
		chip: "Task",
		title: "What do you want to build?",
		options: [
			{ label: "Add a UI feature", desc: "new surface in the app" },
			{ label: "Fix a bug", desc: "something already broken" },
			{ label: "Refactor existing code", desc: "no behavior change" },
		],
	},
	{ type: "says", text: "Got it. How should I approach the implementation?" },
	{
		type: "widget",
		chip: "Approach",
		title: "How should I approach the implementation?",
		options: [
			{ label: "Plan first", desc: "scoped plan before any edits", rec: true },
			{ label: "Start implementing", desc: "go straight to code" },
			{ label: "Explore the codebase first", desc: "read before deciding" },
		],
	},
	{
		type: "says",
		text: "I'll inspect the relevant specs and code, propose a scoped plan, and wait for your approval before implementation.",
	},
	{ type: "done" },
];

const completedChoices = Object.fromEntries(
	SCRIPT.flatMap((block, index) =>
		block.type === "widget" && block.options[0] ? [[index, block.options[0].label]] : [],
	),
);

function Bubble({ children }: { children: React.ReactNode }) {
	return (
		<div className="animate-in fade-in slide-in-from-bottom-1 max-w-[85%] self-end rounded-sm border border-primary-muted bg-primary-subtle px-3.5 py-2.5 text-sm text-text-default duration-300">
			{children}
		</div>
	);
}

function Activity({ children }: { children: React.ReactNode }) {
	return (
		<div className="animate-in fade-in slide-in-from-bottom-1 flex w-full items-center gap-2 text-[15px] lg:w-4/5 lg:self-start text-text-subtle duration-300">
			<Check className="size-4 text-primary" aria-hidden="true" />
			<span>{children}</span>
		</div>
	);
}

function Says({ children }: { children: React.ReactNode }) {
	return (
		<div className="animate-in fade-in slide-in-from-bottom-1 w-full text-[17.4px] text-text-muted lg:w-4/5 lg:self-start duration-300">
			{children}
		</div>
	);
}

function QuestionCard({
	chip,
	title,
	options,
	value,
	onSelect,
}: {
	chip: string;
	title: string;
	options: Choice[];
	value: string | null;
	onSelect: (label: string) => void;
}) {
	return (
		<div className="animate-in fade-in slide-in-from-bottom-1 flex flex-col gap-3 rounded-sm border border-border bg-container-card-bg p-3.5 duration-300">
			<div className="flex items-center gap-2">
				<HelpCircle className="size-4 text-primary" aria-hidden="true" />
				<span className="rounded-sm border border-primary-muted bg-primary-subtle px-1.5 py-0.5 text-[12.6px] tracking-[0.05em] text-primary uppercase">
					{chip}
				</span>
			</div>
			<div className="text-sm font-medium text-text-default">{title}</div>
			<fieldset className="flex flex-col gap-[7px]">
				<legend className="sr-only">{chip}</legend>
				{options.map((option) => {
					const selected = value === option.label;
					return (
						<label
							key={option.label}
							className={`flex items-start gap-2.5 rounded-sm border px-2.5 py-2 text-left transition-colors focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ring ${
								selected
									? "border-primary-strong bg-primary-subtle"
									: "border-border bg-control-bg hover:border-control-border-active"
							}`}
						>
							<input
								type="radio"
								name={chip}
								value={option.label}
								checked={selected}
								disabled={value !== null}
								onChange={() => onSelect(option.label)}
								className="sr-only"
							/>
							<span
								className={`mt-0.5 size-3.5 shrink-0 rounded-full border-[1.5px] ${
									selected ? "border-primary bg-primary-strong" : "border-text-subtle"
								}`}
							/>
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="flex items-center gap-2 text-[16.2px] text-text-default">
									{option.label}
									{option.rec && (
										<span className="text-[12px] tracking-[0.04em] text-primary uppercase">
											recommended
										</span>
									)}
								</span>
								<span className="text-xs text-text-subtle">{option.desc}</span>
							</span>
						</label>
					);
				})}
			</fieldset>
		</div>
	);
}

export function ChatDemo() {
	const ref = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [started, setStarted] = useState(false);
	const [revealed, setRevealed] = useState(0);
	const [choices, setChoices] = useState<Record<number, string>>({});
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setReduced(true);
			setStarted(true);
			setChoices(completedChoices);
			setRevealed(SCRIPT.length);
			return;
		}
		let timer: ReturnType<typeof setTimeout>;
		const obs = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					obs.disconnect();
					timer = setTimeout(() => {
						setStarted(true);
						setRevealed(1);
					}, 2000);
				}
			},
			{ threshold: 0.3 },
		);
		obs.observe(el);
		return () => {
			obs.disconnect();
			clearTimeout(timer);
		};
	}, []);

	useEffect(() => {
		if (!started) return;
		const next = SCRIPT[revealed];
		if (!next) return;
		if (next.type === "user") return;
		const prev = SCRIPT[revealed - 1];
		if (prev?.type === "widget" && !choices[revealed - 1]) return;
		const t = setTimeout(() => setRevealed((r) => r + 1), next.type === "says" ? 1000 : 650);
		return () => clearTimeout(t);
	}, [started, revealed, choices]);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
	}, [revealed, choices, reduced]);

	const nextBlock = SCRIPT[revealed];
	const pendingUser = started && nextBlock?.type === "user" ? nextBlock.text : null;
	const finished = started && revealed >= SCRIPT.length;

	const send = () => {
		if (!pendingUser) return;
		setRevealed((r) => r + 1);
	};

	const replay = () => {
		if (reduced) {
			setChoices(completedChoices);
			setRevealed(SCRIPT.length);
			return;
		}
		setChoices({});
		setRevealed(1);
	};

	return (
		<section id="demo" className="scroll-mt-16 border-b border-border-muted">
			<div className="mx-auto max-w-[1200px] px-6 py-8 sm:py-24">
				<div className="mx-auto flex w-full max-w-[900px] flex-wrap items-center justify-between gap-x-4 gap-y-1">
					<p className="label-mono">Agent session</p>
					<p className="label-mono text-primary">this demo is interactive</p>
				</div>

				<div
					ref={ref}
					className="mx-auto mt-8 flex h-[520px] w-full max-w-[900px] flex-col overflow-hidden rounded-sm border border-border bg-container-terminal-bg sm:mt-10 sm:aspect-video sm:h-auto"
				>
					<div
						ref={scrollRef}
						className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5"
					>
						{SCRIPT.slice(0, revealed).map((b, i) => {
							if (b.type === "user") return <Bubble key={i}>{b.text}</Bubble>;
							if (b.type === "activity") return <Activity key={i}>{b.text}</Activity>;
							if (b.type === "says") return <Says key={i}>{b.text}</Says>;
							if (b.type === "widget")
								return (
									<div key={i} className="flex w-full flex-col gap-3 lg:w-4/5 lg:self-start">
										<QuestionCard
											chip={b.chip}
											title={b.title}
											options={b.options}
											value={choices[i] ?? null}
											onSelect={(label) => setChoices((c) => ({ ...c, [i]: label }))}
										/>
										{choices[i] && (
											<div className="animate-in fade-in slide-in-from-bottom-1 inline-flex items-center gap-2 self-end rounded-full border border-primary-muted bg-primary-subtle px-3 py-1.5 text-[15px] text-text-muted duration-300">
												<Check className="size-4 text-primary" aria-hidden="true" />
												<span>{choices[i]}</span>
											</div>
										)}
									</div>
								);
							return (
								<div
									key={i}
									className="animate-in fade-in flex w-full items-center justify-between gap-2.5 border-t lg:w-4/5 lg:self-start border-border-muted pt-3 text-xs text-text-subtle duration-300"
								>
									<span className="flex items-center gap-2">
										<Check className="size-4 text-primary" aria-hidden="true" /> Done
									</span>
									<span>6s · 18.4k tok · $0.12</span>
								</div>
							);
						})}
					</div>

					<div className="m-3 mt-0 flex flex-col gap-[15px] rounded-sm border border-control-border-active bg-control-bg px-3 py-4 sm:m-4 sm:px-3.5 sm:py-[21px]">
						<div
							className={`text-[16.2px] ${pendingUser ? "text-text-default" : "text-text-subtle"}`}
						>
							{pendingUser ??
								(finished
									? "Session complete — replay the demo to watch it again."
									: "Message the agent… (@ files · / commands · Enter to send)")}
						</div>
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<ModelSelect />
							<EffortSelect />
							{finished ? (
								<button
									type="button"
									onClick={replay}
									className="ml-auto inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
								>
									<RotateCcw className="size-4" />
									Replay demo
								</button>
							) : (
								<button
									type="button"
									onClick={send}
									disabled={!pendingUser}
									aria-label="Send message"
									className={`ml-auto inline-flex size-[30px] items-center justify-center rounded-sm bg-primary text-primary-foreground transition-opacity ${
										pendingUser ? "send-glow hover:opacity-90" : "opacity-40"
									}`}
								>
									<ArrowUp className="size-4" />
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
