import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { loadInAppSurvey } from "@/transport";
import { SurveyForm } from "./SurveyForm";
import { thankYouText } from "./surveyDraft";

export function SurveyWindow() {
	const t = useT();
	const open = useAppStore((state) => state.surveyWindowOpen);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) useAppStore.getState().closeSurveyWindow();
			}}
		>
			<DialogContent data-testid="survey-window">
				<DialogHeader>
					<DialogTitle>{t("panels.survey.title")}</DialogTitle>
				</DialogHeader>
				<SurveyWindowBody />
			</DialogContent>
		</Dialog>
	);
}

function SurveyWindowBody() {
	const t = useT();
	const survey = useAppStore((state) => state.inAppSurvey);
	const [thanks, setThanks] = useState<string | null>(null);
	const [changed, setChanged] = useState(false);

	useEffect(() => {
		void loadInAppSurvey();
	}, []);

	if (thanks !== null) {
		return (
			<div className="flex flex-col items-start gap-12">
				<p data-testid="survey-thanks" className="text-text-default tr-text-ui">
					{thanks}
				</p>
				<Button variant="outline" onClick={() => useAppStore.getState().closeSurveyWindow()}>
					{t("panels.survey.close")}
				</Button>
			</div>
		);
	}
	if (!survey) {
		return (
			<p data-testid="survey-unavailable" className="text-text-muted tr-text-ui">
				{t("panels.survey.unavailable")}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-12">
			{changed ? (
				<p role="status" data-testid="survey-changed" className="text-text-default tr-text-ui">
					{t("panels.survey.changed")}
				</p>
			) : null}
			<SurveyForm
				key={`${survey.id}:${survey.iteration}`}
				survey={survey}
				onSent={() => {
					setThanks(thankYouText(survey, t("panels.survey.thankYou")));
					useAppStore.getState().setInAppSurvey(null);
				}}
				onChanged={() => {
					setChanged(true);
					void loadInAppSurvey();
				}}
			/>
		</div>
	);
}
