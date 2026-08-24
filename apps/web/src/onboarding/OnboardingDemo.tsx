import { Folder, FolderOpen, X } from "lucide-react";
import { PRODUCT_NAME } from "../constants/branding";
import { useAppStore } from "../store";
import { startDemo } from "./demo";
import { OnboardingCoach } from "./OnboardingCoach";
import { CoachBody, Spotlight } from "./Spotlight";

export function OnboardingDemo() {
	const stage = useAppStore((s) => s.onboarding.stage);
	const resetOnboarding = useAppStore((s) => s.resetOnboarding);
	if (!stage) return null;
	return (
		<>
			{stage === "welcome" ? <DemoEmptyWelcome /> : null}
			{stage === "picker" ? <DemoFolderPicker /> : null}
			{stage === "live" ? <OnboardingCoach /> : null}
			<button
				type="button"
				data-testid="onboarding-exit"
				onClick={() => resetOnboarding()}
				className="fixed top-md right-md z-50 inline-flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs text-text-muted tr-text-metadata shadow-[var(--shadow-sm)] outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				<X className="size-3.5" />
				Exit demo
			</button>
		</>
	);
}

function DemoScaffold({ children }: { children: React.ReactNode }) {
	return (
		<div className="fixed inset-0 z-30 flex flex-col bg-container-workspace-bg">
			<div className="flex h-12 shrink-0 items-center border-border-default border-b bg-container-header-bg px-lg">
				<span className="tr-title-card text-primary">{PRODUCT_NAME}</span>
			</div>
			<div className="flex min-h-0 flex-1">
				<aside className="w-[18%] min-w-[160px] border-border-default border-r bg-container-sidebar-bg p-md">
					<span className="tr-text-eyebrow text-text-muted">Projects</span>
				</aside>
				<div className="flex min-h-0 flex-1 items-center justify-center bg-container-content-bg p-xl">
					{children}
				</div>
			</div>
		</div>
	);
}

function DemoEmptyWelcome() {
	const setDemoStage = useAppStore((s) => s.setDemoStage);
	return (
		<>
			<DemoScaffold>
				<div className="flex flex-col items-center text-center">
					<h1 className="tr-brand-hero text-primary">{PRODUCT_NAME}</h1>
					<div className="mt-xl">
						<button
							type="button"
							data-onboarding="demo-open"
							data-testid="demo-open-project"
							onClick={() => setDemoStage("picker")}
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
				</div>
			</DemoScaffold>
			<Spotlight selector='[data-onboarding="demo-open"]' side="right" align="center">
				<CoachBody
					step={1}
					title="Open a project"
					body="Choose a project folder from your computer."
				/>
			</Spotlight>
		</>
	);
}

function DemoFolderPicker() {
	return (
		<>
			<DemoScaffold>
				<div className="w-[520px] overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg shadow-[var(--shadow-lg)]">
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
								data-onboarding="demo-folder"
								data-testid="demo-folder-todo"
								onClick={() => void startDemo()}
								className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-md py-sm text-left tr-text-ui text-text-default transition-colors hover:bg-control-bg-hovered"
							>
								<Folder className="size-4 text-primary" />
								<span>to-do-app</span>
							</button>
						</li>
					</ul>
				</div>
			</DemoScaffold>
			<Spotlight selector='[data-onboarding="demo-folder"]' side="right" align="center">
				<CoachBody
					step={1}
					title="Choose your project folder"
					body="Select the To Do App folder to open it in ThinkRail."
				/>
			</Spotlight>
		</>
	);
}
