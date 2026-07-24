import { BASE_RULE_HINT, BOARD_COPY, DEMO_BASE, DEMO_FILES } from "./content";

interface FoldersBoardProps {
	phase: "predict" | "reveal";
	picks: string[];
	onToggle: (path: string) => void;
}

/**
 * Beat 1's board. Predict: neutral pills only (color must not leak the answer). Reveal: originals all
 * stay put (gold "stays here" on the left-behind; a pulse on each committed original) while copies fly
 * into the workspace — never a cross-out.
 */
export function FoldersBoard({ phase, picks, onToggle }: FoldersBoardProps) {
	const committed = DEMO_FILES.filter((f) => f.status === "committed" || f.status === "modified");
	const stays = DEMO_FILES.filter((f) => f.status === "untracked" || f.status === "ignored");
	const flyDelay = [
		"[animation-delay:150ms]",
		"[animation-delay:450ms]",
		"[animation-delay:750ms]",
	];

	return (
		<div className="flex flex-col gap-sm">
			<p className="text-hint text-xs">
				base{" "}
				<span className="rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs font-[var(--font-mono)] text-text">
					{DEMO_BASE} ▾
				</span>{" "}
				{BASE_RULE_HINT}
			</p>
			<div className="flex items-stretch gap-md">
				<div className="flex-1 rounded-[var(--radius-md)] border border-border2 bg-elevated p-md">
					<p className="mb-sm font-[var(--font-mono)] text-hint text-xs">
						{BOARD_COPY.projectHeader(phase)}
					</p>
					{DEMO_FILES.map((file) => {
						const picked = picks.includes(file.path);
						const pulses = phase === "reveal" && committed.includes(file);
						return (
							<button
								key={file.path}
								type="button"
								data-testid={`game-chip-${file.path}`}
								data-picked={picked}
								disabled={phase === "reveal"}
								onClick={() => onToggle(file.path)}
								className={`my-xs flex min-h-11 w-full items-center gap-sm rounded-[var(--radius-sm)] border px-sm py-sm text-left font-[var(--font-mono)] text-sm text-text transition-colors ${
									picked && phase === "predict"
										? "border-primary bg-primary/10"
										: "border-border2 bg-hover/40 hover:bg-hover"
								} ${pulses ? `animate-origin-pulse motion-reduce:animate-none ${flyDelay[committed.indexOf(file)] ?? ""}` : ""}`}
							>
								<span className="min-w-0 flex-1 truncate">{file.path}</span>
								{phase === "predict" && file.pill ? (
									<span className="rounded-full bg-hover px-sm text-hint text-xs">{file.pill}</span>
								) : null}
								{phase === "reveal" && stays.includes(file) ? (
									<span className="rounded-full bg-gold/15 px-sm text-gold text-xs">
										{BOARD_COPY.staysHereTag}
									</span>
								) : null}
							</button>
						);
					})}
				</div>
				<div
					className={`flex-1 rounded-[var(--radius-md)] border p-md ${phase === "predict" ? "border-dashed border-border2" : "border-border2 bg-elevated"}`}
				>
					<p className="mb-sm font-[var(--font-mono)] text-hint text-xs">
						{BOARD_COPY.workspaceHeader(phase)}
					</p>
					{phase === "predict" ? (
						<p className="mt-xl text-center text-hint text-lg">?</p>
					) : (
						committed.map((file, i) => (
							<div
								key={file.path}
								className={`my-xs flex items-center gap-sm rounded-[var(--radius-sm)] border border-border2 bg-hover/40 px-sm py-xs font-[var(--font-mono)] text-sm text-text animate-chip-fly motion-reduce:animate-none ${flyDelay[i] ?? ""}`}
							>
								<span className="min-w-0 flex-1 truncate">{file.path}</span>
								{file.status === "modified" ? (
									<span className="rounded-full bg-gold/15 px-sm text-gold text-xs">
										{BOARD_COPY.staleCommitTag}
									</span>
								) : (
									<span className="font-semibold text-green">✓</span>
								)}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
