import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import type { InterviewResponse } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, buttonVariants } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { type MouseEvent, useRef, useState } from "react";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { INTERVIEW_BOOKING_URL, INTERVIEW_INVITATION_KEY } from "./interview";

export function InterviewPromptDialog() {
	const t = useT();
	const open = useAppStore((state) => state.interviewPromptOpen);
	const [pendingAction, setPendingAction] = useState<InterviewResponse | null>(null);
	const pendingRef = useRef(false);
	const postponeRef = useRef<HTMLButtonElement>(null);

	const respond = (action: InterviewResponse) => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPendingAction(action);
		void getTransport()
			.request("feedback.respond", { action })
			.then(() => useAppStore.getState().hideInterviewPrompt())
			.catch((error) => toast.error(errorText(error), t("panels.interview.saveFailed")))
			.finally(() => {
				pendingRef.current = false;
				setPendingAction(null);
			});
	};

	const book = (event: MouseEvent<HTMLAnchorElement>): void => {
		if (event.type === "auxclick" && event.button !== 1) return;
		if (pendingRef.current) {
			event.preventDefault();
			return;
		}
		respond("book");
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) respond("postpone");
			}}
		>
			<DialogContent
				data-testid="interview-prompt-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					postponeRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("panels.interview.title")}</DialogTitle>
					<DialogDescription>{t(INTERVIEW_INVITATION_KEY)}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-8 sm:flex-row sm:justify-between">
					<Button
						variant="ghost"
						disabled={pendingAction !== null}
						data-testid="interview-never"
						onClick={() => respond("never")}
					>
						{t("panels.interview.never")}
					</Button>
					<div className="flex flex-col gap-8 sm:flex-row">
						<Button
							ref={postponeRef}
							variant="outline"
							disabled={pendingAction !== null}
							data-testid="interview-postpone"
							onClick={() => respond("postpone")}
						>
							{t("panels.interview.postpone")}
						</Button>
						<a
							href={INTERVIEW_BOOKING_URL}
							target="_blank"
							rel="noopener noreferrer"
							aria-disabled={pendingAction !== null}
							data-disabled={pendingAction !== null ? true : undefined}
							data-testid="interview-book"
							className={buttonVariants({ variant: "primary", size: "l" })}
							onClick={book}
							onAuxClick={book}
						>
							<ExternalLink aria-hidden />
							{t("panels.interview.book")}
						</a>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
