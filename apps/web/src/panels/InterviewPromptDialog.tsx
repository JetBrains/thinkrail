import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import type { InterviewResponse } from "@thinkrail/contracts";
import { type MouseEvent, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { INTERVIEW_BOOKING_URL, INTERVIEW_INVITATION_COPY } from "./interview";

export function InterviewPromptDialog() {
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
			.catch((error) => toast.error(errorText(error), "Couldn't save your response"))
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
					<DialogTitle>Help shape ThinkRail</DialogTitle>
					<DialogDescription>{INTERVIEW_INVITATION_COPY}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-8 sm:flex-row sm:justify-between">
					<Button
						variant="ghost"
						disabled={pendingAction !== null}
						data-testid="interview-never"
						onClick={() => respond("never")}
					>
						Never show again
					</Button>
					<div className="flex flex-col gap-8 sm:flex-row">
						<Button
							ref={postponeRef}
							variant="outline"
							disabled={pendingAction !== null}
							data-testid="interview-postpone"
							onClick={() => respond("postpone")}
						>
							Not now
						</Button>
						<a
							href={INTERVIEW_BOOKING_URL}
							target="_blank"
							rel="noopener noreferrer"
							aria-disabled={pendingAction !== null}
							data-testid="interview-book"
							className={cn(
								buttonVariants(),
								pendingAction !== null && "pointer-events-none opacity-50",
							)}
							onClick={book}
							onAuxClick={book}
						>
							<ExternalLink className="size-14" />
							Schedule an interview
						</a>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
