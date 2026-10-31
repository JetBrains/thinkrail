import type { SurveyInvitationResponse } from "@thinkrail/contracts";
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
import { useRef } from "react";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

export function SurveyInvitationDialog() {
	const t = useT();
	const open = useAppStore((state) => state.surveyInvitationOpen);
	const postponeRef = useRef<HTMLButtonElement>(null);

	const respond = (action: SurveyInvitationResponse) => {
		void getTransport()
			.request("feedback.respond", { action })
			.catch((error: unknown) =>
				toast.error(errorText(error), t("panels.surveyInvitation.saveFailed")),
			);
	};

	const decline = (action: SurveyInvitationResponse) => {
		useAppStore.getState().hideSurveyInvitation();
		respond(action);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) decline("postpone");
			}}
		>
			<DialogContent
				data-testid="survey-invitation-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					postponeRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("panels.surveyInvitation.title")}</DialogTitle>
					<DialogDescription>{t("panels.surveyInvitation.body")}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-8 sm:flex-row sm:justify-between">
					<Button
						variant="ghost"
						data-testid="survey-invitation-never"
						onClick={() => decline("never")}
					>
						{t("panels.surveyInvitation.never")}
					</Button>
					<div className="flex flex-col gap-8 sm:flex-row">
						<Button
							ref={postponeRef}
							variant="outline"
							data-testid="survey-invitation-postpone"
							onClick={() => decline("postpone")}
						>
							{t("panels.surveyInvitation.postpone")}
						</Button>
						<Button
							variant="primary"
							data-testid="survey-invitation-take"
							onClick={() => {
								useAppStore.getState().openSurveyWindow();
								respond("postpone");
							}}
						>
							{t("panels.surveyInvitation.take")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
