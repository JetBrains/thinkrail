import type { DetectedAccount, ProviderStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { announceProviderConnected, ConnectProviderOptions } from "./ConnectProviderOptions";
import { detectAccounts } from "./detectAccounts";
import { cancelUnownedLogin, useProviderAuth } from "./useProviderAuth";

export function ConnectProviderDialog({
	onClose,
	onConnected,
}: {
	onClose: () => void;
	onConnected?: (provider: ProviderStatus) => void;
}) {
	const t = useT();
	const settingsOpen = useAppStore((s) => s.settingsOpen);
	const auth = useProviderAuth({ ownsLoginDialog: !settingsOpen });
	const [detected, setDetected] = useState<DetectedAccount[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		void detectAccounts().then((accounts) => {
			if (!cancelled) setDetected(accounts);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<>
			<Dialog
				open
				onOpenChange={(open) => {
					if (open) return;
					cancelUnownedLogin();
					onClose();
				}}
			>
				<DialogContent
					data-testid="connect-provider-dialog"
					className="max-h-[85vh] max-w-[36rem] gap-16 overflow-y-auto"
				>
					<DialogHeader>
						<DialogTitle>{t("panels.connectProvider.title")}</DialogTitle>
						<DialogDescription>{t("panels.connectProvider.description")}</DialogDescription>
					</DialogHeader>
					<ConnectProviderOptions
						auth={auth}
						detected={detected}
						onConnected={(provider) => {
							useAppStore.getState().clearLogin();
							void announceProviderConnected(provider);
							onClose();
							onConnected?.(provider);
						}}
					/>
				</DialogContent>
			</Dialog>
			{auth.loginDialog}
		</>
	);
}
