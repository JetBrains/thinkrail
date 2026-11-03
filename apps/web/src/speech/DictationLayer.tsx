import { RiLoader4Line, RiMicFill, RiMicLine, RiMicOffLine } from "@remixicon/react";
import type { SpeechModel } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton, withIconClass } from "@thinkrail/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { micAvailability } from "./capture";
import { dictatingElement, startDictation, stopDictation, useDictatingElement } from "./control";
import { useDictationSnapshot } from "./dictation";
import { dictationFieldOf } from "./field";
import { dictationShortcutLabel, installDictationChord } from "./hotkey";
import { BLOCKED_LABEL, speechErrorKey, UNAVAILABLE_LABEL } from "./labels";
import { type MicState, micState } from "./micState";
import type { DictationError } from "./session";

const LEVEL_BARS = ["h-4", "h-6", "h-8", "h-12"] as const;
const Busy = withIconClass(RiLoader4Line, "motion-safe:animate-spin");
const MIN_FIELD_WIDTH = 96;
const TALL_FIELD_HEIGHT = 40;

function blockedMicrophone(code: DictationError | undefined): "denied" | "no-device" | null {
	return code === "denied" || code === "no-device" ? code : null;
}

function installSpeech(model: SpeechModel): void {
	void getTransport()
		.request("speech.install", { model })
		.catch(() => {});
}

function cancelInstall(): void {
	void getTransport()
		.request("speech.cancelInstall", {})
		.catch(() => {});
}

function megabytes(bytes: number): string {
	return String(Math.max(1, Math.round(bytes / 1_000_000)));
}

function insideLayer(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[data-dictation-layer]") !== null;
}

/** Portal into the field's dialog or popover, so the mic is inside its focus trap and outside-click guard. */
function layerContainer(field: HTMLElement): HTMLElement | null {
	return field.closest<HTMLElement>('[role="dialog"], [data-radix-popper-content-wrapper]');
}

/**
 * Keeps the mic inside the field's right edge: at the bottom corner of a tall field, centred on a
 * single line. Inside a dialog or popover it is positioned against that container, including its
 * scroll offset (they are positioned and often transformed, which would skew a fixed element);
 * elsewhere against the viewport. It re-places on resize and scroll, never on an idle frame loop.
 */
function followField(
	mic: HTMLElement,
	field: HTMLElement,
	container: HTMLElement | null,
): () => void {
	let frame = 0;
	const place = () => {
		frame = 0;
		const rect = field.getBoundingClientRect();
		const origin = container?.getBoundingClientRect();
		const left =
			container && origin ? origin.left + container.clientLeft - container.scrollLeft : 0;
		const top = container && origin ? origin.top + container.clientTop - container.scrollTop : 0;
		const tall = rect.height >= TALL_FIELD_HEIGHT;
		mic.style.left = `${rect.right - 2 - left}px`;
		mic.style.top = `${(tall ? rect.bottom - 2 : rect.top + rect.height / 2) - top}px`;
		mic.dataset.placement = tall ? "corner" : "middle";
	};
	const schedule = () => {
		if (frame === 0) frame = requestAnimationFrame(place);
	};
	place();
	const resized = new ResizeObserver(schedule);
	resized.observe(field);
	resized.observe(document.documentElement);
	if (container) resized.observe(container);
	window.addEventListener("resize", schedule);
	document.addEventListener("scroll", schedule, true);
	return () => {
		cancelAnimationFrame(frame);
		resized.disconnect();
		window.removeEventListener("resize", schedule);
		document.removeEventListener("scroll", schedule, true);
	};
}

function fitsMic(field: HTMLElement): boolean {
	return field.getBoundingClientRect().width >= MIN_FIELD_WIDTH;
}

function LevelMeter({ level }: { level: number }) {
	const lit = Math.round(level * LEVEL_BARS.length);
	return (
		<span aria-hidden className="inline-flex h-12 shrink-0 items-end gap-2 text-feedback-error">
			{LEVEL_BARS.map((height, index) => (
				<span
					key={height}
					className={cn("w-2 rounded-xs bg-current", height, index >= lit && "opacity-30")}
				/>
			))}
		</span>
	);
}

function OfferCard({
	state,
	onDownload,
	onLater,
}: {
	state: Extract<MicState, { kind: "offer" }>;
	onDownload: () => void;
	onLater: () => void;
}) {
	const t = useT();
	return (
		<div data-testid="speech-offer" className="flex flex-col gap-8">
			<span className="text-text-default tr-text-emphasis">{t("speech.offer.title")}</span>
			<span className="text-text-muted tr-text-metadata">
				{t("speech.offer.body", { size: megabytes(state.downloadBytes) })}
			</span>
			{state.failed ? (
				<span data-testid="speech-offer-error" className="text-feedback-error tr-text-metadata">
					{t(speechErrorKey(state.failed))}
				</span>
			) : null}
			<div className="flex justify-end gap-8">
				<Button
					variant="ghost"
					size="m"
					data-testid="speech-offer-later"
					onMouseDown={(event) => event.preventDefault()}
					onClick={onLater}
				>
					{t("speech.offer.later")}
				</Button>
				<Button
					variant="primary"
					size="m"
					data-testid="speech-offer-download"
					onMouseDown={(event) => event.preventDefault()}
					onClick={onDownload}
				>
					{state.failed ? t("speech.offer.retry") : t("speech.offer.download")}
				</Button>
			</div>
		</div>
	);
}

/**
 * The page's one voice-input surface: it follows focus to whatever text field is active (the app's or
 * an extension's), shows a mic in that field's corner, and owns the dictation chord.
 */
export function DictationLayer() {
	const t = useT();
	const status = useAppStore((s) => s.speech);
	const snapshot = useDictationSnapshot();
	const [availability] = useState(micAvailability);
	const [focused, setFocused] = useState<HTMLElement | null>(null);
	const [offerOpen, setOfferOpen] = useState(false);
	const lastFallback = useRef<HTMLElement | null>(null);
	const dictating = useDictatingElement();
	const state = micState(status, availability, blockedMicrophone(snapshot.error?.code));
	const latest = useRef({ state });
	useInsertionEffect(() => {
		latest.current = { state };
	});

	useEffect(() => {
		const onFocusIn = (event: FocusEvent) => {
			if (insideLayer(event.target)) return;
			const field = dictationFieldOf(event.target);
			if (field?.hasAttribute("data-dictation-fallback")) lastFallback.current = field;
			setFocused(field);
		};
		const onFocusOut = (event: FocusEvent) => {
			if (insideLayer(event.relatedTarget)) return;
			if (!dictationFieldOf(event.relatedTarget)) setFocused(null);
		};
		document.addEventListener("focusin", onFocusIn);
		document.addEventListener("focusout", onFocusOut);
		setFocused(dictationFieldOf(document.activeElement));
		return () => {
			document.removeEventListener("focusin", onFocusIn);
			document.removeEventListener("focusout", onFocusOut);
		};
	}, []);

	useEffect(
		() =>
			installDictationChord({
				press: (target) => {
					const current = latest.current.state;
					if (dictatingElement() === target) {
						stopDictation();
						return false;
					}
					if (current.kind === "ready" || current.kind === "blocked") {
						startDictation(target);
						return true;
					}
					setFocused(target);
					if (current.kind === "offer") setOfferOpen(true);
					if (current.kind === "installing") cancelInstall();
					return false;
				},
				release: stopDictation,
				lastFallback: () => lastFallback.current,
				dictating: dictatingElement,
			}),
		[],
	);

	const error = snapshot.error;
	useEffect(() => {
		if (!error) return;
		const message = t(speechErrorKey(error.code));
		if (error.code === "denied" || error.code === "no-device") toast.warning(message);
		else toast.error(message);
	}, [error, t]);

	useEffect(() => {
		if (state.kind === "ready" && offerOpen) setOfferOpen(false);
	}, [state.kind, offerOpen]);

	const listening = snapshot.phase !== "idle" ? dictating : null;
	const field = listening ?? focused;
	const container = field ? layerContainer(field) : null;
	const micRef = useRef<HTMLDivElement>(null);
	const shown = state.kind !== "hidden" && field !== null && field.isConnected && fitsMic(field);
	useLayoutEffect(() => {
		const mic = micRef.current;
		if (!mic || !field || !shown) return;
		return followField(mic, field, container);
	}, [field, container, shown]);

	if (!shown || !field) return null;

	const active = listening === field;
	const starting = active && snapshot.phase === "connecting";
	const busy = state.kind === "installing" || starting;
	const shortcut = dictationShortcutLabel();
	const label =
		state.kind === "unavailable"
			? t(UNAVAILABLE_LABEL[state.reason])
			: state.kind === "blocked"
				? t(BLOCKED_LABEL[state.reason])
				: state.kind === "installing"
					? t("speech.mic.installing", {
							percent: String(
								state.totalBytes > 0
									? Math.floor((state.receivedBytes / state.totalBytes) * 100)
									: 0,
							),
						})
					: state.kind === "offer"
						? t("speech.mic.setup")
						: starting
							? t("speech.mic.starting")
							: active
								? t("speech.mic.stop", { shortcut })
								: t("speech.mic.start", { shortcut });
	const press = () => {
		if (active) stopDictation();
		else if (state.kind === "ready" || state.kind === "blocked") startDictation(field);
		else if (state.kind === "offer") setOfferOpen(true);
		else if (state.kind === "installing") cancelInstall();
	};

	return createPortal(
		<div
			ref={micRef}
			data-dictation-layer=""
			className={cn(
				"z-50 flex -translate-x-full items-center gap-4 data-[placement=corner]:-translate-y-full data-[placement=middle]:-translate-y-1/2",
				container ? "absolute" : "fixed",
			)}
		>
			{active && !starting ? <LevelMeter level={snapshot.level} /> : null}
			<Popover open={offerOpen} onOpenChange={setOfferOpen}>
				<PopoverAnchor asChild>
					<IconButton
						icon={
							busy
								? Busy
								: state.kind === "unavailable" || state.kind === "blocked"
									? RiMicOffLine
									: active
										? RiMicFill
										: RiMicLine
						}
						data-testid="speech-mic"
						data-mic-state={active ? "listening" : state.kind}
						label={label}
						tone={active ? "danger" : undefined}
						selected={active}
						size="s"
						disabled={state.kind === "unavailable"}
						aria-busy={busy}
						aria-pressed={active}
						{...(state.kind === "offer"
							? { "aria-haspopup": "dialog" as const, "aria-expanded": offerOpen }
							: {})}
						onMouseDown={(event) => event.preventDefault()}
						onClick={press}
					/>
				</PopoverAnchor>
				{state.kind === "offer" ? (
					<PopoverContent
						data-dictation-layer=""
						container={container}
						side="top"
						align="end"
						className="w-[320px] p-12"
						onOpenAutoFocus={(event) => event.preventDefault()}
						onCloseAutoFocus={(event) => event.preventDefault()}
					>
						<OfferCard
							state={state}
							onDownload={() => {
								setOfferOpen(false);
								installSpeech(state.model);
							}}
							onLater={() => setOfferOpen(false)}
						/>
					</PopoverContent>
				) : null}
			</Popover>
		</div>,
		container ?? document.body,
	);
}
