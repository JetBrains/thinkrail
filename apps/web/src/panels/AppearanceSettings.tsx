import type { ThemeId } from "@thinkrail/contracts";
import { Check } from "lucide-react";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getThemes, resolveTheme } from "@/themes";
import { getTransport } from "@/transport";

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
		<section data-testid="settings-appearance" className="flex flex-col gap-8">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Theme</h3>
				<p className="text-text-muted tr-text-metadata">
					Choose the app theme. Your choice is saved on the host and follows you across devices.
				</p>
			</div>
			<div className="flex flex-col gap-4">
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
								"flex items-center gap-8 rounded-[var(--radius-sm)] border px-12 py-8 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
								active
									? "border-primary-muted bg-clip-padding bg-primary-subtle text-text-default"
									: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
							)}
						>
							<span className="flex-1">{label}</span>
							{active ? <Check className="size-16 shrink-0 text-primary" /> : null}
						</button>
					);
				})}
			</div>
		</section>
	);
}
