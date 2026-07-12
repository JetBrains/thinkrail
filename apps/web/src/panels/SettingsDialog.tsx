import { GitBranch, KeyRound, type LucideIcon, Palette, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib";
import { type SettingsSection, useAppStore } from "@/store";
import { GithubSettings } from "./GithubSettings";
import { ProvidersSettings } from "./ProvidersSettings";

/** The live settings sections, in nav order. */
const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
	{ id: "providers", label: "Providers", icon: KeyRound },
	{ id: "github", label: "GitHub", icon: GitBranch },
];
/** Placeholder sections — shown dimmed so the shell reads as built-to-grow (not yet wired). */
const SOON: { label: string; icon: LucideIcon }[] = [
	{ label: "General", icon: SlidersHorizontal },
	{ label: "Appearance", icon: Palette },
];

/**
 * App settings — a two-pane shell (left section rail + scrollable content pane) so it grows past today's two
 * sections. Store-driven: the top-bar gear and the Welcome provider-warning both open it via `openSettings`,
 * deep-linking to a section. On mobile the rail collapses to a horizontal segmented strip above the content.
 */
export function SettingsDialog() {
	const open = useAppStore((s) => s.settingsOpen);
	const section = useAppStore((s) => s.settingsSection);

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) useAppStore.getState().closeSettings();
			}}
		>
			<DialogContent
				data-testid="settings-dialog"
				className="flex h-[80vh] max-h-[85vh] w-full max-w-[52rem] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="border-border2 border-b px-lg py-md">
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col md:flex-row">
					<nav
						aria-label="Settings sections"
						className="flex shrink-0 gap-xs overflow-x-auto border-border2 border-b p-sm md:w-[192px] md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:bg-bg-dark md:p-md"
					>
						{SECTIONS.map(({ id, label, icon: Icon }) => {
							const active = section === id;
							return (
								<button
									key={id}
									type="button"
									data-testid={`settings-nav-${id}`}
									data-active={active}
									onClick={() => useAppStore.getState().setSettingsSection(id)}
									className={cn(
										"flex shrink-0 items-center gap-sm rounded-[var(--radius-md)] px-md py-sm text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
										active
											? "bg-[var(--primary-10)] font-medium text-primary"
											: "text-muted hover:bg-hover hover:text-text",
									)}
								>
									<Icon className="size-4 shrink-0" />
									{label}
								</button>
							);
						})}
						{SOON.map(({ label, icon: Icon }) => (
							<span
								key={label}
								className="flex shrink-0 cursor-default items-center gap-sm rounded-[var(--radius-md)] px-md py-sm text-hint text-sm opacity-60"
							>
								<Icon className="size-4 shrink-0" />
								{label}
								<span className="ml-auto rounded-full border border-border2 px-xs py-0.5 font-[var(--font-mono)] text-[10px] text-hint uppercase">
									Soon
								</span>
							</span>
						))}
					</nav>

					<div className="min-h-0 flex-1 overflow-y-auto p-lg">
						{section === "providers" ? <ProvidersSettings /> : <GithubSettings />}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
