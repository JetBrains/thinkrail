import type { ThemeId } from "@thinkrail/contracts";
import { Check } from "lucide-react";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getThemes, resolveTheme } from "@/themes";
import { getTransport } from "@/transport";

/**
 * The "Appearance" settings section: the theme picker. Server-synced — clicking a theme fires
 * `settings.update` and the UI converges when the host's `settings.changed` broadcast folds into the store
 * (no optimistic apply), the same pattern as the workspace lifecycle. The active theme is read from the
 * store (fed by `server.welcome` / `settings.changed`); a rejected update surfaces a toast.
 */
export function AppearanceSettings() {
	const theme = useAppStore((s) => s.theme);
	const themes = getThemes();
	const activeThemeId = resolveTheme(theme).id;

	const select = (id: ThemeId) => {
		if (id === theme) return;
		getTransport()
			.request("settings.update", { config: { theme: id } })
			.catch(() => toast.error("Couldn't change theme"));
	};

	return (
		<section data-testid="settings-appearance" className="flex flex-col gap-sm">
			<div className="flex flex-col gap-xs">
				<h3 className="tr-title-section text-text-default">Theme</h3>
				<p className="text-text-subtle tr-text-metadata">
					Choose the app theme. Your choice is saved on the host and follows you across devices.
				</p>
			</div>
			<div className="flex flex-col gap-xs">
				{themes.map(({ id, label, appearance, contrast }) => {
					const active = id === activeThemeId;
					return (
						<button
							key={id}
							type="button"
							aria-pressed={active}
							data-testid={`theme-option-${id}`}
							data-theme-id={id}
							data-appearance={appearance}
							data-contrast={contrast}
							data-active={active}
							onClick={() => select(id)}
							className={cn(
								"flex items-center gap-sm rounded-[var(--radius-md)] border px-md py-sm text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
								active
									? "border-primary-muted bg-primary-subtle text-text-default"
									: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
							)}
						>
							<span className="flex-1">{label}</span>
							{active ? <Check className="size-4 shrink-0 text-primary" /> : null}
						</button>
					);
				})}
			</div>
		</section>
	);
}
