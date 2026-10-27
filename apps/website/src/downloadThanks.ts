import type { WebsiteCtaLocation } from "@thinkrail/website-analytics";
import { captureAnalytics } from "./analytics";
import {
	contentKeyForPathname,
	ctaLocationForElement,
	desktopArtifactForUrl,
} from "./analyticsEvents";
import {
	downloadPostHogSurveyId,
	downloadSurveyFreeTextLimit,
	downloadSurveyStepCount,
	downloadSurveySteps,
	orderedChoices,
	type SurveyChoice,
	type SurveyStep,
	stepCanContinue,
	surveyAnswerValue,
	surveySentProperties,
} from "./downloadSurvey";

type Capture = typeof captureAnalytics;

const thankYou = "Thank you so much for taking time to answer these questions!";

export function initDownloadThanks(
	doc: Document = document,
	capture: Capture = captureAnalytics,
	random: () => number = Math.random,
	responseId: () => string = () => crypto.randomUUID(),
): void {
	const dialog = doc.querySelector<HTMLDialogElement>("[data-download-thanks]");
	const body = dialog?.querySelector<HTMLElement>("[data-survey-body]");
	const action = dialog?.querySelector<HTMLButtonElement>("[data-survey-action]");
	const progress = dialog?.querySelector<HTMLElement>("[data-survey-progress]");
	const thanks = dialog?.querySelector<HTMLElement>("[data-survey-thanks]");
	const welcome = dialog?.querySelector<HTMLElement>("[data-survey-welcome]");
	const emailHint = dialog?.querySelector<HTMLElement>("[data-survey-email-hint]");
	const actionRow = dialog?.querySelector<HTMLElement>("[data-survey-action-row]");
	if (!dialog || !body || !action || !progress || !thanks || !welcome || !emailHint || !actionRow)
		return;
	if (dialog.dataset.downloadThanksReady === "true") return;
	dialog.dataset.downloadThanksReady = "true";

	let stepIndex = 0;
	let started = false;
	let submitted = false;
	let shown = false;
	let dismissed = false;
	let advanceLocked = false;
	let currentResponseId = responseId();
	let answers: Record<string, string | string[]> = {};
	let ctaLocation: WebsiteCtaLocation | undefined;
	let order = downloadSurveySteps.map((step) => orderedChoices(step, random));

	const currentStep = (): SurveyStep | undefined => downloadSurveySteps[stepIndex];

	const readAnswer = (): { selected: string[]; freeText: string } => {
		const selected = [
			...body.querySelectorAll<HTMLInputElement>("input[type=radio], input[type=checkbox]"),
		]
			.filter((input) => input.checked)
			.map((input) => input.value);
		const freeText = body.querySelector<HTMLInputElement | HTMLTextAreaElement>(
			"[data-survey-free-text]",
		);
		return { selected, freeText: freeText?.value ?? "" };
	};

	const freeTextField = () =>
		body.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-survey-free-text]");

	const emailAccepted = () => {
		const field = freeTextField();
		return !(field instanceof HTMLInputElement && field.type === "email") || field.validity.valid;
	};

	const syncAction = () => {
		const step = currentStep();
		if (step === undefined) return;
		const answer = readAnswer();
		action.disabled = !stepCanContinue(step, answer.selected, answer.freeText) || !emailAccepted();
		action.textContent = step.action;
		progress.textContent = `${step.index} of ${downloadSurveyStepCount}`;
		emailHint.hidden = step.action !== "Finish" || !action.disabled;
	};

	const renderWelcome = () => {
		thanks.hidden = true;
		body.hidden = true;
		progress.hidden = true;
		welcome.hidden = false;
		actionRow.hidden = false;
		action.hidden = false;
		action.disabled = false;
		action.textContent = "Start";
		emailHint.hidden = true;
	};

	const renderStep = () => {
		const step = currentStep();
		const choices = order[stepIndex];
		if (step === undefined || choices === undefined) return;
		thanks.hidden = true;
		welcome.hidden = true;
		body.hidden = false;
		actionRow.hidden = false;
		action.hidden = false;
		progress.hidden = false;
		body.replaceChildren();
		const fieldset = doc.createElement("fieldset");
		fieldset.className = "download-survey-question";
		const legend = doc.createElement("legend");
		legend.textContent = step.prompt;
		fieldset.append(legend);
		if (step.kind === "text") {
			fieldset.append(freeTextControl(step));
		} else {
			fieldset.append(choiceList(step, choices));
		}
		body.append(fieldset);
		syncAction();
	};

	const freeTextControl = (step: SurveyStep): HTMLInputElement | HTMLTextAreaElement => {
		const field = step.index === 6 ? doc.createElement("input") : doc.createElement("textarea");
		field.className = "download-survey-text";
		field.dataset.surveyFreeText = "";
		field.maxLength = downloadSurveyFreeTextLimit;
		field.required = false;
		if (step.placeholder !== undefined) field.placeholder = step.placeholder;
		if (field instanceof HTMLInputElement) {
			field.type = "email";
			field.autocomplete = "email";
			field.inputMode = "email";
		} else {
			field.rows = 3;
		}
		field.addEventListener("input", syncAction);
		return field;
	};

	const choiceList = (step: SurveyStep, choices: readonly SurveyChoice[]): HTMLDivElement => {
		const wrap = doc.createElement("div");
		const needsAllHint =
			step.kind === "multi" &&
			step.max === undefined &&
			!/choose all that apply/i.test(step.prompt);
		if (needsAllHint) {
			const hint = doc.createElement("p");
			hint.className = "download-survey-hint";
			hint.textContent = "Choose all that apply";
			wrap.append(hint);
		}
		const list = doc.createElement("div");
		list.className = step.columns ? "download-survey-choices columns" : "download-survey-choices";
		for (const choice of choices) {
			const option = doc.createElement("div");
			option.className = "download-survey-option";
			const label = doc.createElement("label");
			label.className = "download-survey-choice";
			const input = doc.createElement("input");
			input.type = step.kind === "single" ? "radio" : "checkbox";
			input.name = `download-survey-${step.index}`;
			input.value = choice.id;
			const name = doc.createElement("span");
			name.textContent = choice.label;
			label.append(input, name);
			option.append(label);
			const custom = choice.custom === true ? doc.createElement("input") : undefined;
			if (custom) {
				custom.type = "text";
				custom.className = "download-survey-text";
				custom.dataset.surveyFreeText = "";
				custom.maxLength = downloadSurveyFreeTextLimit;
				custom.placeholder = "A few words";
				custom.hidden = true;
				custom.addEventListener("input", syncAction);
				option.append(custom);
			}
			input.addEventListener("change", () => {
				if (step.max !== undefined) {
					const boxes = [...list.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
					if (input.checked && boxes.filter((box) => box.checked).length > step.max) {
						input.checked = false;
					}
					const full = boxes.filter((box) => box.checked).length >= step.max;
					for (const box of boxes) box.disabled = full && !box.checked;
				}
				for (const field of list.querySelectorAll<HTMLInputElement>("[data-survey-free-text]")) {
					const choiceInput = field.parentElement?.querySelector(
						"input[type=radio], input[type=checkbox]",
					);
					field.hidden = !(choiceInput instanceof HTMLInputElement && choiceInput.checked);
				}
				if (custom && input.checked) custom.focus();
				syncAction();
			});
			list.append(option);
		}
		wrap.append(list);
		return wrap;
	};

	const showThanks = () => {
		welcome.hidden = true;
		body.hidden = true;
		actionRow.hidden = true;
		action.hidden = true;
		progress.hidden = true;
		emailHint.hidden = true;
		thanks.hidden = false;
		thanks.textContent = thankYou;
	};

	const surveyPlace = () => ({
		content_key: contentKeyForPathname(doc.location?.pathname ?? "/") ?? "unknown",
		...(ctaLocation === undefined ? {} : { cta_location: ctaLocation }),
	});

	const restart = () => {
		stepIndex = 0;
		started = false;
		submitted = false;
		shown = false;
		dismissed = false;
		advanceLocked = false;
		currentResponseId = responseId();
		answers = {};
		order = downloadSurveySteps.map((step) => orderedChoices(step, random));
		body.replaceChildren();
		renderWelcome();
	};

	action.addEventListener("click", () => {
		const step = currentStep();
		if (!started) {
			started = true;
			renderStep();
			return;
		}
		if (advanceLocked || step === undefined || action.disabled || !emailAccepted()) return;
		const answer = readAnswer();
		if (!stepCanContinue(step, answer.selected, answer.freeText)) return;
		advanceLocked = true;
		window.setTimeout(() => {
			advanceLocked = false;
		}, 400);
		const value = surveyAnswerValue(
			step,
			answer.selected,
			step.kind === "text" ||
				answer.selected.some(
					(id) => step.choices.find((choice) => choice.id === id)?.custom === true,
				)
				? answer.freeText
				: "",
		);
		if (value === undefined) delete answers[step.questionId];
		else answers[step.questionId] = value;
		const completed = step.index === downloadSurveyStepCount;
		capture(
			"survey sent",
			surveySentProperties({
				submissionId: currentResponseId,
				contentKey: surveyPlace().content_key,
				ctaLocation,
				answers,
				completed,
			}),
		);
		submitted = true;
		if (step.index === downloadSurveyStepCount) {
			showThanks();
			return;
		}
		stepIndex += 1;
		renderStep();
	});

	dialog.querySelector("[data-download-thanks-close]")?.addEventListener("click", () => {
		dialog.close();
	});
	dialog.addEventListener("close", () => {
		if (shown && !submitted && !dismissed) {
			dismissed = true;
			capture("survey dismissed", {
				$survey_id: downloadPostHogSurveyId,
				...surveyPlace(),
			});
		}
		restart();
	});

	const openFrom = (anchor: Element) => {
		if (dialog.open) return;
		ctaLocation = ctaLocationForElement(anchor);
		if (!shown) {
			shown = true;
			capture("survey shown", {
				$survey_id: downloadPostHogSurveyId,
				...surveyPlace(),
			});
		}
		dialog.showModal();
	};

	doc.addEventListener("click", (event) => {
		if (event.button !== 0) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		const anchor = target.closest("a[href]");
		if (anchor === null) return;
		const href = anchor.getAttribute("href");
		if (href === null || desktopArtifactForUrl(href) === undefined) return;
		openFrom(anchor);
	});

	renderWelcome();
}
