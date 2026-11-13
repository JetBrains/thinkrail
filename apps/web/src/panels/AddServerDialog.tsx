import { RiLinkM as Link } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { failureOf, type HostFailure } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { appServers, serverFailureText } from "../remote";

type AddState = { kind: "idle" } | { kind: "adding" } | { kind: "failed"; failure: HostFailure };

/** Pairs a server by the link it printed and saves it; the dialog closes once the server is in the tree. */
export function AddServerDialog({ onClose }: { onClose: () => void }) {
	const t = useT();
	const [link, setLink] = useState("");
	const [state, setState] = useState<AddState>({ kind: "idle" });
	const mounted = useRef(true);
	useEffect(
		() => () => {
			mounted.current = false;
		},
		[],
	);

	const adding = state.kind === "adding";
	const submit = (): void => {
		if (adding || link.trim() === "") return;
		setState({ kind: "adding" });
		appServers()
			.add(link)
			.then(
				() => {
					if (mounted.current) onClose();
				},
				(error: unknown) => {
					if (mounted.current) setState({ kind: "failed", failure: failureOf(error) });
				},
			);
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent data-testid="add-server-dialog" className="max-w-[32rem] gap-16">
				<DialogHeader>
					<DialogTitle>{t("panels.servers.add.title")}</DialogTitle>
					<DialogDescription>{t("panels.servers.add.description")}</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-8"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<div className="relative">
						<Link className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted" />
						<input
							type="text"
							value={link}
							onChange={(event) => setLink(event.target.value)}
							placeholder={t("panels.servers.add.placeholder")}
							aria-label={t("panels.servers.add.title")}
							data-testid="add-server-link"
							disabled={adding}
							className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pl-24 pr-8 tr-text-ui text-text-default placeholder:text-text-muted transition-colors focus:border-control-border-active focus-visible:focus-ring"
						/>
					</div>
					{state.kind === "failed" ? (
						<p
							role="alert"
							data-testid="add-server-error"
							className="tr-text-metadata text-feedback-error"
						>
							{serverFailureText(t, state.failure)}
						</p>
					) : null}
					<Button
						type="submit"
						data-testid="add-server-submit"
						loading={adding}
						disabled={link.trim() === ""}
					>
						{adding ? t("panels.servers.add.connecting") : t("panels.servers.add.submit")}
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
