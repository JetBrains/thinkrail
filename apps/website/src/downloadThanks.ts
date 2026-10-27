import type { WebsiteCtaLocation } from "@thinkrail/website-analytics";
import { captureAnalytics } from "./analytics";
import {
	contentKeyForPathname,
	ctaLocationForElement,
	desktopArtifactForUrl,
} from "./analyticsEvents";
import {
	answerSurveyStep,
	downloadSurveyFreeTextLimit,
	downloadSurveySteps,
	type SurveyChoice,
	type SurveyPlace,
	type SurveyStep,
	startSurveyResponse,
	stepCanContinue,
	surveyDismissedProperties,
	surveyShownProperties,
} from "./downloadSurvey";

type Capture = typeof captureAnalytics;

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
	const contentKey = contentKeyForPathname(doc.location?.pathname ?? "/");
	if (contentKey === undefined) return;
	if (dialog.dataset.downloadThanksReady === "true") return;
	dialog.dataset.downloadThanksReady = "true";

	let stepIndex = 0;
	let started = false;
	let shown = false;
	let advanceLocked = false;
	let response = startSurveyResponse(responseId(), random);
	let ctaLocation: WebsiteCtaLocation | undefined;

	const currentStep = (): SurveyStep | undefined => downloadSurveySteps[stepIndex];

	const freeTextField = () =>
		body.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-survey-free-text]");

	const readAnswer = (): { selected: string[]; freeText: string } => {
		const selected = [...body.querySelectorAll<HTMLInputElement>("input[type=checkbox]")]
			.filter((input) => input.checked)
			.map((input) => input.value);
		return { selected, freeText: freeTextField()?.value ?? "" };
	};

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
		progress.textContent = `${step.index} of ${downloadSurveySteps.length}`;
		emailHint.hidden = step.action !== "Finish" || !action.disabled;
	};

	const renderWelcome = () => {
		thanks.hidden = true;
		body.hidden = true;
		progress.hidden = true;
		welcome.hidden = false;
		actionRow.hidden = false;
		action.disabled = false;
		action.textContent = "Start";
		emailHint.hidden = true;
	};

	const legendId = (step: SurveyStep) => `download-survey-question-${step.index}`;
	const hintId = (step: SurveyStep) => `download-survey-hint-${step.index}`;

	const renderStep = () => {
		const step = currentStep();
		const choices = response.order[stepIndex];
		if (step === undefined || choices === undefined) return;
		thanks.hidden = true;
		welcome.hidden = true;
		body.hidden = false;
		actionRow.hidden = false;
		progress.hidden = false;
		body.replaceChildren();
		const fieldset = doc.createElement("fieldset");
		fieldset.className = "download-survey-question";
		fieldset.tabIndex = -1;
		if (step.hint !== undefined) fieldset.setAttribute("aria-describedby", hintId(step));
		const legend = doc.createElement("legend");
		legend.id = legendId(step);
		legend.textContent = step.prompt;
		fieldset.append(legend);
		if (step.kind === "text") {
			fieldset.append(freeTextControl(step));
		} else {
			fieldset.append(choiceList(step, choices));
		}
		body.append(fieldset);
		syncAction();
		fieldset.focus();
	};

	const freeTextControl = (step: SurveyStep): HTMLInputElement | HTMLTextAreaElement => {
		const field = step.email ? doc.createElement("input") : doc.createElement("textarea");
		field.className = "download-survey-text";
		field.setAttribute("aria-labelledby", legendId(step));
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
		if (step.hint !== undefined) {
			const hint = doc.createElement("p");
			hint.className = "download-survey-hint";
			hint.id = hintId(step);
			hint.textContent = step.hint;
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
			input.type = "checkbox";
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
				custom.setAttribute("aria-label", choice.label);
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
					const choiceInput = field.parentElement?.querySelector("input[type=checkbox]");
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
		progress.hidden = true;
		emailHint.hidden = true;
		thanks.hidden = false;
		thanks.focus();
	};

	const surveyPlace = (): SurveyPlace => ({
		content_key: contentKey,
		...(ctaLocation === undefined ? {} : { cta_location: ctaLocation }),
	});

	const restart = () => {
		stepIndex = 0;
		started = false;
		shown = false;
		advanceLocked = false;
		response = startSurveyResponse(responseId(), random);
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
		const answered = answerSurveyStep(
			response,
			step,
			answer.selected,
			answer.freeText,
			surveyPlace(),
		);
		if (answered === undefined) return;
		advanceLocked = true;
		window.setTimeout(() => {
			advanceLocked = false;
		}, 400);
		response = answered.response;
		capture("survey sent", answered.properties);
		if (step.index === downloadSurveySteps.length) {
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
		const dismissal = surveyDismissedProperties(response, surveyPlace());
		if (shown && dismissal !== undefined) capture("survey dismissed", dismissal);
		restart();
	});

	const openFrom = (anchor: Element) => {
		if (dialog.open) return;
		ctaLocation = ctaLocationForElement(anchor);
		if (!shown) {
			shown = true;
			capture("survey shown", surveyShownProperties(surveyPlace()));
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
