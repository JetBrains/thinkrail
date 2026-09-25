import { RiErrorWarningLine } from "@remixicon/react";
import type { ExtensionInfo } from "@thinkrail/contracts";
import { useState } from "react";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

export const TrustExtensionsDialog = ({
	projectId,
	projectName,
	extensions,
	open,
	onOpenChange,
}: {
	projectId: string;
	projectName: string;
	extensions: readonly ExtensionInfo[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) => {
	const [busy, setBusy] = useState(false);
	const trust = async () => {
		setBusy(true);
		try {
			const project = await getTransport().request("project.setTrust", {
				id: projectId,
				trusted: true,
			});
			useAppStore.getState().applyProjectUpdated(project);
			onOpenChange(false);
		} catch (error) {
			toast.error(errorText(error), "Couldn't trust project");
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="ext-trust-dialog" className="max-w-[480px] gap-12 p-16">
				<DialogHeader>
					<DialogTitle>Trust {projectName}?</DialogTitle>
					<DialogDescription>
						{extensions.length === 1
							? "This project has 1 extension. It stays off until you trust the project."
							: `This project has ${extensions.length} extensions. They stay off until you trust the project.`}
					</DialogDescription>
				</DialogHeader>
				<div
					data-testid="ext-trust-warning"
					className="flex gap-8 rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 tr-text-ui text-text-default"
				>
					<RiErrorWarningLine className="mt-2 size-16 shrink-0 text-feedback-warning" />
					<span>
						Extensions run code on your computer with full access to your files, your network, and
						your sessions. Trust only repositories you trust.
					</span>
				</div>
				<ul data-testid="ext-trust-list" className="flex flex-col gap-4">
					{extensions.map((extension) => (
						<li
							key={extension.name}
							data-testid="ext-trust-item"
							className="flex items-baseline gap-8 tr-text-ui text-text-default"
						>
							<span className="truncate">{extension.title}</span>
							<span className="tr-code-text text-text-subtle">{extension.name}</span>
						</li>
					))}
				</ul>
				<DialogFooter>
					<Button
						variant="outline"
						data-testid="ext-trust-cancel"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button data-testid="ext-trust-confirm" disabled={busy} onClick={() => void trust()}>
						Trust project
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
