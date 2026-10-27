import { RiKeyLine as KeyRound, RiLoginBoxLine as LogIn } from "@remixicon/react";
import type { ProviderStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export function ProviderRow({
	provider,
	busy,
	onSignIn,
	onApiKey,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignIn: () => void;
	onApiKey: () => void;
}) {
	const t = useT();
	return (
		<div
			data-testid="provider-signin-row"
			data-provider={provider.id}
			data-configured="false"
			className="flex items-center gap-8 border-border-muted border-b py-12"
		>
			<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">{provider.name}</span>
			<div className="flex shrink-0 items-center gap-4">
				{provider.canOAuth && (
					<Button
						variant="soft-primary"
						size="m"
						iconLeft={LogIn}
						data-testid="provider-signin"
						data-provider={provider.id}
						disabled={busy}
						onClick={onSignIn}
					>
						{t("settings.providers.signIn")}
					</Button>
				)}
				{provider.canApiKey && (
					<Button
						variant="outline"
						size="m"
						iconLeft={KeyRound}
						data-testid="provider-apikey"
						data-provider={provider.id}
						disabled={busy}
						onClick={onApiKey}
					>
						{t("settings.providers.apiKey")}
					</Button>
				)}
			</div>
		</div>
	);
}
