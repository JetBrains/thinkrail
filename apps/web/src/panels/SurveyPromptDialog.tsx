import type { AppSurvey } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { SurveyAnalyticsNotice } from "./FeedbackSettings";
import { SurveyForm } from "./SurveyForm";

const SUGGESTION = "survey-suggestion";

export function SurveyPromptDialog() {
	const t = useT();
	const open = useAppStore((state) => state.interviewPromptOpen);
	const analyticsEnabled = useAppStore((state) => state.analyticsEnabled);
	const analyticsSuppressed = useAppStore((state) => state.surveyAnalyticsSuppressed);
	const [phase, setPhase] = useState<"toast" | "dialog">("toast");
	const [survey, setSurvey] = useState<AppSurvey | null>(null);
	const [thanks, setThanks] = useState<string | null>(null);
	const submissionId = useRef("");
	const completedRef = useRef(false);
	const formShownRef = useRef(false);
	const pendingRef = useRef(false);
	const handled = useRef(false);
	const suggestionId = useRef<string | null>(null);
	const suppressClose = useRef(false);

	const hidePrompt = () => {
		suppressClose.current = true;
		useAppStore.getState().hideInterviewPrompt();
	};

	const clearSuggestion = () => {
		const id = suggestionId.current;
		suggestionId.current = null;
		if (id) useAppStore.getState().dismissToast(id);
	};

	const respond = (action: "postpone" | "never") => {
		if (pendingRef.current) return Promise.resolve(false);
		pendingRef.current = true;
		return getTransport()
			.request("feedback.respond", { action })
			.then(() => true)
			.catch((error: unknown) => {
				toast.error(errorText(error), t("panels.survey.saveFailed"));
				return false;
			})
			.finally(() => {
				pendingRef.current = false;
			});
	};

	useEffect(() => {
		if (!open) {
			handled.current = true;
			clearSuggestion();
			setPhase("toast");
			setSurvey(null);
			setThanks(null);
			completedRef.current = false;
			formShownRef.current = false;
			return;
		}
		suppressClose.current = false;
	}, [open]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		void getTransport()
			.request("feedback.survey", {})
			.then((result) => {
				if (cancelled) return;
				useAppStore.getState().setSurveyAnalyticsSuppressed(result.analyticsSuppressed === true);
				if (!result.survey) {
					hidePrompt();
					return;
				}
				submissionId.current = crypto.randomUUID();
				setSurvey(result.survey);
			})
			.catch(() => {
				if (!cancelled) hidePrompt();
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	useEffect(() => {
		if (!open || phase !== "toast" || !survey) return;
		const existing = useAppStore.getState().toasts.find((item) => item.marker === SUGGESTION);
		if (existing) {
			suggestionId.current = existing.id;
			return;
		}
		handled.current = false;
		const accept = () => {
			handled.current = true;
			clearSuggestion();
			setPhase("dialog");
		};
		const hideForever = () => {
			void respond("never").then((ok) => {
				if (!ok) return;
				handled.current = true;
				const id = suggestionId.current;
				if (!id) return;
				useAppStore.getState().updateToast(id, {
					message: t("panels.survey.hidden"),
					actions: [
						{
							label: t("panels.survey.ok"),
							variant: "primary",
							onClick: () => hidePrompt(),
						},
					],
					onDismiss: () => hidePrompt(),
				});
			});
		};
		const id = useAppStore.getState().pushToast({
			variant: "info",
			marker: SUGGESTION,
			message: t("panels.survey.suggest"),
			durationMs: Number.POSITIVE_INFINITY,
			actions: [
				{ label: t("panels.survey.sure"), variant: "primary", onClick: accept },
				{ label: t("panels.survey.hideForever"), onClick: hideForever },
			],
			onDismiss: () => {
				if (handled.current || pendingRef.current) return;
				handled.current = true;
				void respond("postpone").finally(() => hidePrompt());
			},
		});
		suggestionId.current = id;
	}, [open, phase, survey, t]);

	const abandon = () => {
		if (suppressClose.current || pendingRef.current) return;
		if (completedRef.current || thanks !== null) {
			hidePrompt();
			return;
		}
		pendingRef.current = true;
		const dismissed = formShownRef.current
			? getTransport()
					.request("feedback.survey.submit", {
						submissionId: submissionId.current,
						event: "dismissed",
					})
					.catch(() => undefined)
			: Promise.resolve();
		void dismissed
			.then(() => getTransport().request("feedback.respond", { action: "postpone" }))
			.then(() => hidePrompt())
			.catch((error: unknown) => toast.error(errorText(error), t("panels.survey.saveFailed")))
			.finally(() => {
				pendingRef.current = false;
			});
	};

	const dialogOpen = open && phase === "dialog" && (survey !== null || thanks !== null);
	const formVisible =
		dialogOpen && analyticsEnabled && !analyticsSuppressed && survey !== null && thanks === null;
	if (formVisible) formShownRef.current = true;

	return (
		<Dialog
			open={dialogOpen}
			onOpenChange={(next) => {
				if (!next && !suppressClose.current) abandon();
			}}
		>
			<DialogContent data-testid="survey-prompt-dialog">
				<DialogHeader>
					<DialogTitle>{t("panels.survey.title")}</DialogTitle>
				</DialogHeader>
				{thanks !== null ? (
					<p data-testid="survey-thanks" className="text-text-default tr-text-ui">
						{thanks}
					</p>
				) : survey && (analyticsSuppressed || !analyticsEnabled) ? (
					<SurveyAnalyticsNotice
						analyticsEnabled={analyticsEnabled}
						analyticsSuppressed={analyticsSuppressed}
					/>
				) : survey ? (
					<SurveyForm
						key={`${survey.id}:${survey.iteration}:${submissionId.current}`}
						survey={survey}
						submissionId={submissionId.current}
						onShown={() => {
							formShownRef.current = true;
						}}
						onCompleted={(message) => {
							completedRef.current = true;
							useAppStore.getState().setInAppSurvey(null);
							if (message === null) hidePrompt();
							else setThanks(message);
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
