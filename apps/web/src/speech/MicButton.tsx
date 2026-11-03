import { RiLoader4Line, RiMicFill, RiMicLine, RiMicOffLine } from "@remixicon/react";
import type { SpeechModel } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton, withIconClass } from "@thinkrail/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import {
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useInsertionEffect,
	useRef,
	useState,
} from "react";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { micAvailability } from "./capture";
import { dictation, useDictationSnapshot } from "./dictation";
import { dictationShortcutLabel, noteFallbackFocus, registerChordTarget } from "./hotkey";
import { type MicState, micState } from "./micState";
import type { DictationError } from "./session";
import { dictationText } from "./text";

export interface MicButtonProps {
	fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
	/** Writes the field's text and caret on every partial and final; it must never move focus. */
	apply: (text: string, caret: number) => void;
	onListeningChange?: (listening: boolean) => void;
	fallback?: boolean;
	disabled?: boolean;
	size?: "s" | "m";
	className?: string;
}

const LEVEL_BARS = ["h-4", "h-6", "h-8", "h-12"] as const;

/** A spinner that stays clickable: `IconButton`'s `loading` disables the button, and a click cancels. */
const Busy = withIconClass(RiLoader4Line, "motion-safe:animate-spin");

const UNAVAILABLE_LABEL = {
	"insecure-origin": "speech.mic.unavailable.insecureOrigin",
	"unsupported-browser": "speech.mic.unavailable.unsupportedBrowser",
	"unsupported-platform": "speech.mic.unavailable.unsupportedPlatform",
} as const satisfies Record<string, MessageKey>;

const BLOCKED_LABEL = {
	denied: "speech.mic.blocked.denied",
	"no-device": "speech.mic.blocked.noDevice",
} as const satisfies Record<string, MessageKey>;

const ERROR_MESSAGE = {
	SPEECH_UNSUPPORTED_PLATFORM: "speech.mic.unavailable.unsupportedPlatform",
	SPEECH_NOT_INSTALLED: "speech.error.notInstalled",
	SPEECH_INSTALL_BUSY: "speech.error.installBusy",
	SPEECH_DOWNLOAD_FAILED: "speech.error.downloadFailed",
	SPEECH_CHECKSUM_MISMATCH: "speech.error.checksumMismatch",
	SPEECH_DISK_SPACE: "speech.error.diskSpace",
	SPEECH_ENGINE_FAILED: "speech.error.engineFailed",
	SPEECH_BUSY: "speech.error.busy",
	SPEECH_PROTOCOL: "speech.error.engineFailed",
	denied: "speech.mic.blocked.denied",
	"no-device": "speech.mic.blocked.noDevice",
	failed: "speech.error.microphoneFailed",
} as const satisfies Record<DictationError, MessageKey>;

export function speechErrorKey(code: DictationError): MessageKey {
	return ERROR_MESSAGE[code];
}

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

function setReadOnly(element: HTMLTextAreaElement | HTMLInputElement, readOnly: boolean): void {
	element.readOnly = readOnly;
}

function megabytes(bytes: number): string {
	return String(Math.max(1, Math.round(bytes / 1_000_000)));
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
					{t(ERROR_MESSAGE[state.failed])}
				</span>
			) : null}
			<div className="flex justify-end gap-8">
				<Button variant="ghost" size="m" data-testid="speech-offer-later" onClick={onLater}>
					{t("speech.offer.later")}
				</Button>
				<Button variant="primary" size="m" data-testid="speech-offer-download" onClick={onDownload}>
					{state.failed ? t("speech.offer.retry") : t("speech.offer.download")}
				</Button>
			</div>
		</div>
	);
}

function engineErrorToast(code: DictationError, message: string): void {
	if (code === "denied" || code === "no-device") toast.warning(message);
	else toast.error(message);
}

export function MicButton({
	fieldRef,
	apply,
	onListeningChange,
	fallback = false,
	disabled = false,
	size = "m",
	className,
}: MicButtonProps) {
	const t = useT();
	const id = useId();
	const status = useAppStore((s) => s.speech);
	const snapshot = useDictationSnapshot();
	const [availability] = useState(micAvailability);
	const [offerOpen, setOfferOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const state = micState(status, availability, blockedMicrophone(snapshot.error?.code));
	const mine = snapshot.ownerId === id;
	const active = mine && snapshot.phase !== "idle";
	const latest = useRef({ apply, onListeningChange, state, disabled });
	useInsertionEffect(() => {
		latest.current = { apply, onListeningChange, state, disabled };
	});

	const begin = useCallback(() => {
		const element = fieldRef.current;
		if (!element) return;
		element.focus();
		const anchor = {
			base: element.value,
			start: element.selectionStart ?? element.value.length,
			end: element.selectionEnd ?? element.value.length,
		};
		dictation.start({
			ownerId: id,
			replace: (spoken) => {
				const { text, caret } = dictationText(anchor, spoken);
				latest.current.apply(text, caret);
			},
		});
	}, [id, fieldRef]);

	const press = useCallback((): boolean => {
		const now = dictation.snapshot();
		if (now.ownerId === id && now.phase !== "idle") {
			dictation.stop(id);
			return false;
		}
		const current = latest.current.state;
		if (latest.current.disabled) return false;
		if (current.kind === "ready" || current.kind === "blocked") {
			begin();
			return true;
		}
		if (current.kind === "offer") setOfferOpen(true);
		if (current.kind === "installing") cancelInstall();
		return false;
	}, [id, begin]);

	useEffect(
		() =>
			registerChordTarget(id, {
				element: () => fieldRef.current,
				press,
				release: () => dictation.stop(id),
				fallback,
			}),
		[id, press, fallback, fieldRef],
	);

	useEffect(() => () => dictation.stop(id), [id]);

	useEffect(() => {
		if (disabled) dictation.stop(id);
	}, [disabled, id]);

	useEffect(() => {
		const element = fieldRef.current;
		if (!element || !fallback) return;
		const onFocus = () => noteFallbackFocus(id);
		element.addEventListener("focus", onFocus);
		return () => element.removeEventListener("focus", onFocus);
	}, [fieldRef, fallback, id]);

	useEffect(() => {
		const element = fieldRef.current;
		latest.current.onListeningChange?.(active);
		if (!element || !active) return;
		setReadOnly(element, true);
		const onKeyDown = (event: Event) => {
			if (event instanceof KeyboardEvent && event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				dictation.stop(id);
			}
		};
		const onBlur = () => dictation.stop(id);
		element.addEventListener("keydown", onKeyDown);
		element.addEventListener("blur", onBlur);
		return () => {
			setReadOnly(element, false);
			element.removeEventListener("keydown", onKeyDown);
			element.removeEventListener("blur", onBlur);
			latest.current.onListeningChange?.(false);
		};
	}, [active, fieldRef, id]);

	const error = snapshot.error?.ownerId === id ? snapshot.error : null;
	useEffect(() => {
		if (error) engineErrorToast(error.code, t(ERROR_MESSAGE[error.code]));
	}, [error, t]);

	useEffect(() => {
		if (state.kind === "ready" && offerOpen) setOfferOpen(false);
	}, [state.kind, offerOpen]);

	if (state.kind === "hidden") return null;

	const shortcut = dictationShortcutLabel();
	const starting = active && snapshot.phase === "connecting";
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

	const busy = state.kind === "installing" || starting;
	return (
		<Popover open={offerOpen} onOpenChange={setOfferOpen}>
			<PopoverAnchor asChild>
				<span className={cn("inline-flex shrink-0 items-center gap-4", className)}>
					{active && !starting ? <LevelMeter level={snapshot.level} /> : null}
					<IconButton
						ref={buttonRef}
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
						size={size}
						disabled={state.kind === "unavailable" || disabled}
						aria-busy={busy}
						aria-pressed={active}
						{...(state.kind === "offer"
							? { "aria-haspopup": "dialog" as const, "aria-expanded": offerOpen }
							: {})}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							press();
						}}
					/>
				</span>
			</PopoverAnchor>
			{state.kind === "offer" ? (
				<PopoverContent
					side="top"
					align="end"
					className="w-[320px] p-12"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						buttonRef.current?.focus();
					}}
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
	);
}
