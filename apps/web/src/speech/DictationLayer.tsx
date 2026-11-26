import { RiLoader4Line, RiMicFill, RiMicLine, RiMicOffLine } from "@remixicon/react";
import type { SpeechModel } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton, withIconClass } from "@thinkrail/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import {
	startTransition,
	useEffect,
	useInsertionEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { micAvailability } from "./capture";
import { dictatingElement, startDictation, stopDictation, useDictatingElement } from "./control";
import { dictation, useDictationSnapshot } from "./dictation";
import { dictationFieldOf } from "./field";
import { dictationShortcutLabel, installDictationChord, installDictationEscape } from "./hotkey";
import { BLOCKED_LABEL, speechErrorKey, UNAVAILABLE_LABEL } from "./labels";
import { type MicState, micState } from "./micState";
import type { DictationError, DictationPhase } from "./session";

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
 * Keeps the mic inside the field's right edge, against `container` when given, else the viewport, and
 * reports whether it fits: a field that left the page or is too narrow gets no mic.
 */
function followField(
	mic: HTMLElement,
	field: HTMLElement,
	container: HTMLElement | null,
	onFit: (fits: boolean) => void,
): () => void {
	let frame = 0;
	const place = () => {
		frame = 0;
		if (!field.isConnected) {
			onFit(false);
			return;
		}
		const rect = field.getBoundingClientRect();
		onFit(rect.width >= MIN_FIELD_WIDTH);
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
	for (let node: Element | null = field; node; node = node.parentElement) resized.observe(node);
	if (container) resized.observe(container);
	const removal = new MutationObserver(() => {
		if (!field.isConnected) schedule();
	});
	removal.observe(document.documentElement, { childList: true, subtree: true });
	window.addEventListener("resize", schedule);
	document.addEventListener("scroll", schedule, true);
	return () => {
		cancelAnimationFrame(frame);
		resized.disconnect();
		removal.disconnect();
		window.removeEventListener("resize", schedule);
		document.removeEventListener("scroll", schedule, true);
	};
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

const COMPOSER = "[data-dictation-fallback]";

/** A chat composer's resting mic, or the one that follows focus to any other field. */
type MicAnchor = "composer" | "field";
const fieldKeys = new WeakMap<HTMLElement, string>();
let nextFieldKey = 0;

function fieldKey(field: HTMLElement): string {
	let key = fieldKeys.get(field);
	if (!key) {
		nextFieldKey += 1;
		key = `mic-${nextFieldKey}`;
		fieldKeys.set(field, key);
	}
	return key;
}

function isComposer(field: HTMLElement): boolean {
	return field.matches(COMPOSER);
}

function sameFields(a: readonly HTMLElement[], b: readonly HTMLElement[]): boolean {
	return a.length === b.length && a.every((field, index) => field === b[index]);
}

/** The eligible chat composers on the page, which show their mic without focus. */
function useComposers(): HTMLElement[] {
	const [composers, setComposers] = useState<HTMLElement[]>([]);
	useEffect(() => {
		let frame = 0;
		const scan = () => {
			frame = 0;
			const dictating = dictatingElement();
			const next = Array.from(document.querySelectorAll<HTMLElement>(COMPOSER)).filter(
				(composer) => composer === dictating || dictationFieldOf(composer) === composer,
			);
			setComposers((prev) => (sameFields(prev, next) ? prev : next));
		};
		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(scan);
		};
		scan();
		const observer = new MutationObserver(schedule);
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["data-dictation-fallback", "readonly", "disabled", "contenteditable"],
		});
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, []);
	return composers;
}

/**
 * The page's one voice-input surface: it follows focus to whatever text field is active (the app's or
 * an extension's) and shows a mic in that field's corner, keeps a mic on every chat composer even
 * without focus, and owns the dictation chord. Turned off in Settings, it renders nothing and listens
 * to nothing.
 */
export function DictationLayer() {
	const enabled = useAppStore((s) => s.voiceInputEnabled);
	useEffect(() => {
		if (!enabled) stopDictation();
	}, [enabled]);
	return enabled ? <ActiveDictationLayer /> : null;
}

function ActiveDictationLayer() {
	const t = useT();
	const status = useAppStore((s) => s.speech);
	const snapshot = useDictationSnapshot();
	const [availability] = useState(micAvailability);
	const [focused, setFocused] = useState<HTMLElement | null>(null);
	const [offerFor, setOfferFor] = useState<HTMLElement | null>(null);
	const [kept, setKept] = useState<HTMLElement | null>(null);
	const lastFallback = useRef<HTMLElement | null>(null);
	const composers = useComposers();
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
			startTransition(() => setFocused(field));
		};
		const onFocusOut = (event: FocusEvent) => {
			if (insideLayer(event.relatedTarget)) return;
			if (!dictationFieldOf(event.relatedTarget)) startTransition(() => setFocused(null));
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
					if (current.kind === "offer") setOfferFor(target);
					if (current.kind === "installing") cancelInstall();
					return false;
				},
				release: stopDictation,
				lastFallback: () => lastFallback.current,
				dictating: dictatingElement,
			}),
		[],
	);

	useEffect(
		() => installDictationEscape(dictatingElement, () => dictation.snapshot().phase, stopDictation),
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
		if (state.kind === "ready" && offerFor) setOfferFor(null);
	}, [state.kind, offerFor]);

	const listening = snapshot.phase !== "idle" ? dictating : null;
	const field = listening ?? focused;
	const loose = field && !isComposer(field) ? field : null;
	if (loose && loose !== kept) setKept(loose);
	const anchor = loose ?? (kept?.isConnected ? kept : null);
	const resting =
		listening && isComposer(listening) && !composers.includes(listening)
			? [...composers, listening]
			: composers;

	if (state.kind === "hidden") return null;

	const mic = (target: HTMLElement, kind: MicAnchor, following: boolean) => (
		<FieldMic
			key={kind === "field" ? kind : fieldKey(target)}
			field={target}
			kind={kind}
			following={following}
			state={state}
			active={listening === target}
			phase={snapshot.phase}
			level={snapshot.level}
			offerOpen={offerFor === target}
			onOfferOpenChange={(open) => setOfferFor(open ? target : null)}
		/>
	);

	return (
		<>
			{anchor ? mic(anchor, "field", loose !== null) : null}
			{resting.map((composer) => mic(composer, "composer", true))}
		</>
	);
}

function FieldMic({
	field,
	kind,
	following,
	state,
	active,
	phase,
	level,
	offerOpen,
	onOfferOpenChange,
}: {
	field: HTMLElement;
	kind: MicAnchor;
	following: boolean;
	state: Exclude<MicState, { kind: "hidden" }>;
	active: boolean;
	phase: DictationPhase;
	level: number;
	offerOpen: boolean;
	onOfferOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const [fits, setFits] = useState(true);
	const container = layerContainer(field);
	const micRef = useRef<HTMLDivElement>(null);
	const shown = following && fits;
	useEffect(() => {
		if (!shown && offerOpen) onOfferOpenChange(false);
	}, [shown, offerOpen, onOfferOpenChange]);
	useLayoutEffect(() => {
		const mic = micRef.current;
		if (!mic || !following) return;
		return followField(mic, field, container, setFits);
	}, [field, container, following]);

	const starting = active && phase === "connecting";
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
		else if (state.kind === "offer") {
			field.focus();
			onOfferOpenChange(true);
		} else if (state.kind === "installing") cancelInstall();
	};

	return createPortal(
		<div
			ref={micRef}
			data-dictation-layer=""
			hidden={!shown}
			className={cn(
				"z-50 flex -translate-x-full items-center gap-4 data-[placement=corner]:-translate-y-full data-[placement=middle]:-translate-y-1/2",
				container ? "absolute" : "fixed",
			)}
		>
			{active && !starting ? <LevelMeter level={level} /> : null}
			<Popover open={offerOpen} onOpenChange={onOfferOpenChange}>
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
						data-mic-anchor={kind}
						tabIndex={-1}
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
								onOfferOpenChange(false);
								installSpeech(state.model);
							}}
							onLater={() => onOfferOpenChange(false)}
						/>
					</PopoverContent>
				) : null}
			</Popover>
		</div>,
		container ?? document.body,
	);
}
