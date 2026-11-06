import type { IssueConnection, IssueConnectionInput } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useState } from "react";
import { getTransport } from "../transport";
import { IssueAssociationForm } from "./IssueAssociationForm";
import {
	associationDismissal,
	type ConnectResult,
	ISSUE_ERROR_KEY,
	type IssuePanelError,
} from "./model";

export interface IssueAssociationDialogProps {
	projectId: string;
	initialRepositoryUrl?: string | null | undefined;
	onClose: () => void;
	onAssociated?: ((connection: IssueConnection) => void) | undefined;
}

export interface IssueAssociationBodyProps extends IssueAssociationDialogProps {
	pending: boolean;
	onPendingChange: (pending: boolean) => void;
}

export function IssueAssociationBody({
	projectId,
	initialRepositoryUrl,
	onClose,
	onAssociated,
	pending,
	onPendingChange,
}: IssueAssociationBodyProps) {
	const t = useT();
	const [error, setError] = useState<IssuePanelError | null>(null);

	const connect = (input: IssueConnectionInput): Promise<ConnectResult> => {
		onPendingChange(true);
		return getTransport()
			.request("issues.connect", { projectId, input })
			.then(
				(connection) => {
					onPendingChange(false);
					onAssociated?.(connection);
					onClose();
					return { ok: true };
				},
				() => {
					onPendingChange(false);
					return { ok: false, error: "connect" };
				},
			);
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>{t("issues.associateTitle")}</DialogTitle>
				<DialogDescription>{t("issues.associateDescription")}</DialogDescription>
			</DialogHeader>
			{error && (
				<p role="alert" data-testid="issues-error" className="break-words text-feedback-error">
					{t(ISSUE_ERROR_KEY[error])}
				</p>
			)}
			<IssueAssociationForm
				connection={null}
				initialRepositoryUrl={initialRepositoryUrl}
				pending={pending}
				authSupported
				onConnect={connect}
				onError={setError}
			/>
			<DialogFooter>
				<Button
					variant="outline"
					data-testid="issues-associate-skip"
					disabled={pending}
					onClick={onClose}
				>
					{t("issues.associateSkip")}
				</Button>
			</DialogFooter>
		</>
	);
}

export function IssueAssociationDialog(props: IssueAssociationDialogProps) {
	const [pending, setPending] = useState(false);
	const dismissal = associationDismissal(pending, props.onClose);
	return (
		<Dialog open onOpenChange={dismissal.onOpenChange}>
			<DialogContent
				data-testid="issues-associate-dialog"
				className="max-w-[30rem]"
				hideClose={dismissal.hideClose}
				onEscapeKeyDown={dismissal.onEscapeKeyDown}
				onInteractOutside={dismissal.onInteractOutside}
			>
				<IssueAssociationBody {...props} pending={pending} onPendingChange={setPending} />
			</DialogContent>
		</Dialog>
	);
}
