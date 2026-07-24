import { useState } from "react";
import { Button } from "../components/ui/button";
import { DEMO_BASE, DEMO_WORKSPACE, GAME_BEATS, RECAP, scoreLine } from "./content";
import { FoldersBoard } from "./FoldersBoard";
import { BeatReveal } from "./reveals";

interface WorktreeGameProps {
	/** Back to the features carousel — never dismisses the overlay itself. */
	onExit: () => void;
	/** End-screen CTA — the overlay decides what finishing means per mode. */
	onFinish: () => void;
}

/** The five-beat predict→reveal→why game. Local state only; all copy from content.ts. */
export function WorktreeGame({ onExit, onFinish }: WorktreeGameProps) {
	const [index, setIndex] = useState(0);
	const [phase, setPhase] = useState<"predict" | "reveal">("predict");
	const [picks, setPicks] = useState<string[]>([]);
	const [choice, setChoice] = useState<string | null>(null);
	const [score, setScore] = useState(0);
	const [done, setDone] = useState(false);

	const beat = GAME_BEATS[index];
	if (done || !beat) {
		return (
			<div
				className="flex flex-col items-center gap-md p-lg text-center"
				data-testid="onboarding-game"
			>
				<p className="font-semibold text-lg text-primary" data-testid="game-score">
					{scoreLine(score)}
				</p>
				<ul className="max-w-[56ch] text-left">
					{RECAP.map((line) => (
						<li key={line} className="my-sm flex gap-sm text-muted text-sm">
							<span className="font-semibold text-green">✓</span>
							<span>{line}</span>
						</li>
					))}
				</ul>
				<Button className="text-bg" data-testid="game-finish" onClick={onFinish}>
					Get started
				</Button>
			</div>
		);
	}

	const isCorrect =
		beat.kind === "tap"
			? picks.length === beat.answers.length && beat.answers.every((a) => picks.includes(a))
			: choice === beat.correctId;

	const reveal = () => {
		if (isCorrect) setScore((s) => s + 1);
		setPhase("reveal");
	};
	const next = () => {
		if (index + 1 >= GAME_BEATS.length) {
			setDone(true);
			return;
		}
		setIndex(index + 1);
		setPhase("predict");
		setPicks([]);
		setChoice(null);
	};

	return (
		<div className="flex flex-col gap-md p-lg" data-testid="onboarding-game">
			<div className="flex items-center gap-sm">
				<div className="flex flex-1 items-center gap-xs">
					{GAME_BEATS.map((b, i) => (
						<span
							key={b.id}
							data-testid={`game-dot-${i}`}
							className={`size-2 rounded-full ${i === index ? "bg-primary" : i < index ? "bg-primary/40" : "bg-hover"}`}
						/>
					))}
				</div>
				<button
					type="button"
					data-testid="game-skip"
					onClick={onExit}
					className="text-hint text-xs hover:text-muted"
				>
					Skip ✕
				</button>
			</div>

			<p className="font-semibold text-md text-text">
				You create workspace{" "}
				<span className="font-[var(--font-mono)] text-primary">{DEMO_WORKSPACE}</span>
				{beat.kind === "tap" ? (
					<>
						{" "}
						from <span className="font-[var(--font-mono)]">{DEMO_BASE}</span>. {beat.prompt}
					</>
				) : (
					<>. {beat.prompt}</>
				)}
			</p>

			{beat.kind === "tap" ? (
				<FoldersBoard
					phase={phase}
					picks={picks}
					onToggle={(path) =>
						setPicks((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]))
					}
				/>
			) : phase === "predict" ? (
				<div className="flex flex-col gap-sm">
					{beat.choices.map((c) => (
						<button
							key={c.id}
							type="button"
							data-testid={`game-choice-${c.id}`}
							data-selected={choice === c.id}
							onClick={() => setChoice(c.id)}
							className={`rounded-[var(--radius-md)] border p-md text-left text-sm text-text transition-colors ${choice === c.id ? "border-primary bg-primary/10" : "border-border2 bg-elevated hover:bg-hover"}`}
						>
							{c.label}
						</button>
					))}
				</div>
			) : (
				<BeatReveal beat={beat} />
			)}

			{phase === "reveal" ? (
				<p
					className="rounded-[var(--radius-md)] border border-primary/40 bg-primary/10 p-md text-sm text-text"
					data-testid="game-whyline"
				>
					{beat.whyline} {isCorrect ? <span className="font-semibold text-green">+1</span> : null}
				</p>
			) : null}

			<div className="flex justify-end">
				{phase === "predict" ? (
					<Button
						className="text-bg"
						data-testid="game-reveal"
						disabled={beat.kind === "choice" && choice === null}
						onClick={reveal}
					>
						Reveal
					</Button>
				) : (
					<Button className="text-bg" data-testid="game-next" onClick={next}>
						Next
					</Button>
				)}
			</div>
		</div>
	);
}
