import { RiCheckLine as Check } from "@remixicon/react";
import { T, useT } from "@thinkrail/locales/react";

export interface ConnectedSummary {
	provider: string;
	models: number | null;
	defaultModel: string | null;
}

export function ConnectedLine({ summary }: { summary: ConnectedSummary }) {
	const t = useT();
	const { provider, models, defaultModel } = summary;
	return (
		<p
			data-testid="welcome-connected"
			className="flex items-center gap-8 rounded-full border border-border-default bg-clip-padding bg-container-workspace-bg px-16 py-8 text-text-default tr-text-ui motion-safe:animate-reveal"
		>
			<Check className="size-16 shrink-0 text-feedback-success" />
			<span>
				{defaultModel ? (
					<T
						i18nKey="panels.welcome.connectedDefault"
						values={{ provider, model: defaultModel }}
						components={[<span key="model" className="text-primary" />]}
					/>
				) : models === null ? (
					t("panels.welcome.connectedReady", { provider })
				) : (
					t("panels.welcome.connectedModels", { provider, count: models })
				)}
			</span>
		</p>
	);
}
