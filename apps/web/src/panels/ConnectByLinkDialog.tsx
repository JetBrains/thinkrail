import { RiLinkM as Link } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRemoteConnectionController } from "../remote/remoteConnection";
import { mountRemoteSession } from "../transport";

export function ConnectByLinkDialog({ onClose }: { onClose: () => void }) {
	const t = useT();
	const controller = useMemo(() => createRemoteConnectionController(), []);
	const state = useSyncExternalStore(controller.subscribe, controller.getState);
	const [link, setLink] = useState("");

	useEffect(() => {
		if (state.status === "connected") {
			mountRemoteSession(state.connection.client);
			onClose();
		}
	}, [state, onClose]);

	const connecting = state.status === "connecting";
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent data-testid="connect-by-link-dialog" className="max-w-[32rem] gap-16">
				<DialogHeader>
					<DialogTitle>{t("panels.connectByLink.title")}</DialogTitle>
					<DialogDescription>{t("panels.connectByLink.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-8">
					<div className="relative">
						<Link className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted" />
						<input
							type="text"
							value={link}
							onChange={(e) => setLink(e.target.value)}
							placeholder={t("panels.connectByLink.placeholder")}
							aria-label={t("panels.connectByLink.title")}
							data-testid="connect-by-link-input"
							className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pl-24 pr-8 tr-text-ui text-text-default placeholder:text-text-muted outline-none transition-colors focus:border-control-border-active"
						/>
					</div>
					{state.status === "error" ? (
						<p
							role="alert"
							data-testid="connect-by-link-error"
							className="tr-text-metadata text-feedback-error"
						>
							{state.kind === "invalid-link"
								? t("panels.connectByLink.invalidLink")
								: state.message}
						</p>
					) : null}
					<Button
						data-testid="connect-by-link-submit"
						disabled={connecting || link.trim() === ""}
						onClick={() =>
							void controller.connect(link.trim(), t("panels.connectByLink.thisDevice"))
						}
					>
						{connecting ? t("panels.connectByLink.connecting") : t("panels.connectByLink.connect")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
