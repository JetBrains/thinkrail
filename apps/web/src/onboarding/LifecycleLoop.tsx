import type { ReactNode } from "react";
import { DEMO_PROJECT, DEMO_WORKSPACE } from "./content";

const SCENE_DELAYS = [
	"[animation-delay:-12.5s]",
	"[animation-delay:-10s]",
	"[animation-delay:-7.5s]",
	"[animation-delay:-5s]",
	"[animation-delay:-2.5s]",
] as const;

const STAGE_LABELS = ["create", "fresh folder", "onCreate hooks", "you work", "onDelete cleanup"];

/** The ~12.5s CSS-only lifecycle loop; reduced motion renders all five scenes stacked statically. */
export function LifecycleLoop() {
	const scenes: ReactNode[] = [
		<div
			key="create"
			className="rounded-[var(--radius-md)] border border-border2 bg-bg-dark p-md text-sm"
		>
			<p className="font-semibold text-text">Create workspace</p>
			<p className="mt-xs text-hint text-xs">
				base <span className="font-[var(--font-mono)] text-text">origin/main ▾</span>
			</p>
		</div>,
		<p key="folder" className="font-[var(--font-mono)] text-muted text-sm leading-6">
			~/projects/{DEMO_PROJECT}/ <span className="text-green">untouched</span>
			<br />
			~/.thinkrail/worktrees/{DEMO_PROJECT}/
			<span className="rounded-[var(--radius-sm)] bg-primary/20 px-xs text-text">
				{DEMO_WORKSPACE}/
			</span>{" "}
			<span className="text-primary">fresh folder, fresh branch</span>
		</p>,
		<div key="hooks" className="font-[var(--font-mono)] text-green text-sm leading-6">
			<p>▸ npm install ✓</p>
			<p>▸ cp ~/projects/{DEMO_PROJECT}/.env . ✓</p>
			<p>▸ ./scripts/dev-certs.sh ✓</p>
		</div>,
		<p key="work" className="text-muted text-sm">
			"fix the pitch tracking" · <span className="text-green">+42 −7</span> · your project folder:
			untouched
		</p>,
		<div key="cleanup" className="text-sm">
			<p className="font-[var(--font-mono)] text-green">▸ docker compose down ✓</p>
			<p className="mt-xs text-muted">{DEMO_PROJECT}/ — untouched the whole time</p>
		</div>,
	];
	return (
		<div data-testid="lifecycle-loop" className="w-full">
			<div className="relative h-40 motion-reduce:static motion-reduce:flex motion-reduce:h-auto motion-reduce:flex-col motion-reduce:gap-md">
				{scenes.map((scene, i) => (
					<div
						key={STAGE_LABELS[i]}
						className={`absolute inset-0 flex items-center justify-center opacity-0 animate-lifecycle-scene ${SCENE_DELAYS[i]} motion-reduce:static motion-reduce:animate-none motion-reduce:opacity-100`}
					>
						{scene}
					</div>
				))}
			</div>
			<p className="mt-sm text-center text-hint text-xs">{STAGE_LABELS.join(" · ")}</p>
		</div>
	);
}
