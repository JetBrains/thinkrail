import {
	RiCalendarScheduleLine,
	RiDeleteBinLine,
	RiEditLine,
	RiSendPlane2Line,
} from "@remixicon/react";
import type {
	ImageContent,
	PromptModelSelection,
	ScheduledPromptRecord,
	ThinkingLevel,
	WireModel,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { randomUuid } from "@/lib";
import { ModelEffortPicker, type ModelSelection } from "./ModelEffortPicker";
import { LEVEL_LABEL } from "./modelPicker";
import type { ModelPreferences } from "./useModelPreferences";

export interface ScheduledPromptDraftSnapshot {
	sessionId: string;
	text: string;
	imageIds: readonly string[];
}

export interface ScheduledPromptInput {
	id: string;
	dueAt: number;
	text: string;
	images: ImageContent[];
	modelSelection: PromptModelSelection;
}

function sameDraft(a: ScheduledPromptDraftSnapshot, b: ScheduledPromptDraftSnapshot): boolean {
	return (
		a.sessionId === b.sessionId &&
		a.text === b.text &&
		a.imageIds.length === b.imageIds.length &&
		a.imageIds.every((id, index) => id === b.imageIds[index])
	);
}

const minute = 60_000;
const remainingTime = (dueAt: number, now: number) => {
	const remaining = Math.max(0, dueAt - now);
	if (remaining < 60 * minute) {
		const seconds = Math.ceil(remaining / 1000);
		return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	}
	const minutes = Math.ceil(remaining / minute);
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const futureFourHours = () => Math.ceil((Date.now() + 4 * 60 * minute) / minute) * minute;
const parts = (at: number) => {
	const d = new Date(at);
	return {
		date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
		time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
	};
};
const makeTime = (date: string, time: string, now = Date.now()) =>
	scheduledLocalTime(date, time, now);

function scheduledLocalTime(date: string, time: string, now = Date.now()) {
	if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
	const [y, m, d] = date.split("-").map(Number),
		[h, n] = time.split(":").map(Number);
	if (y === undefined || m === undefined || d === undefined || h === undefined || n === undefined)
		return null;
	const wallTime = new Date(0);
	wallTime.setUTCFullYear(y, m - 1, d);
	wallTime.setUTCHours(h, n, 0, 0);
	if (
		wallTime.getUTCFullYear() !== y ||
		wallTime.getUTCMonth() !== m - 1 ||
		wallTime.getUTCDate() !== d ||
		wallTime.getUTCHours() !== h ||
		wallTime.getUTCMinutes() !== n
	)
		return null;
	const minuteOffsets = new Set(
		[-36, -24, -12, 0, 12, 24, 36].map((hours) =>
			new Date(wallTime.getTime() + hours * 60 * minute).getTimezoneOffset(),
		),
	);
	const matches = [...minuteOffsets]
		.map((offset) => wallTime.getTime() + offset * minute)
		.filter((at) => {
			const value = new Date(at);
			return (
				value.getFullYear() === y &&
				value.getMonth() === m - 1 &&
				value.getDate() === d &&
				value.getHours() === h &&
				value.getMinutes() === n
			);
		})
		.sort((a, b) => a - b);
	return matches.find((at) => at > now) ?? matches[0] ?? null;
}

export function ScheduledPrompts({
	items,
	sessionId,
	text,
	draftText,
	images,
	imageIds,
	canSchedule,
	onSchedule,
	onUpdate,
	onCancel,
	onSendNow,
	models,
	currentModel,
	thinkingLevel,
	modelPreferences,
	modelsRefreshing,
	onRefreshModels,
	onScheduled,
	listTarget,
}: {
	items: ScheduledPromptRecord[];
	sessionId: string;
	text: string;
	draftText: string;
	images: ImageContent[];
	imageIds: readonly string[];
	canSchedule: boolean;
	onSchedule: (scheduled: ScheduledPromptInput) => Promise<unknown>;
	onUpdate: (scheduled: ScheduledPromptInput) => Promise<unknown>;
	onCancel: (id: string) => Promise<unknown>;
	onSendNow: (id: string) => Promise<unknown>;
	models: WireModel[];
	currentModel: WireModel | null;
	thinkingLevel: ThinkingLevel;
	modelPreferences: ModelPreferences;
	modelsRefreshing: boolean;
	onRefreshModels: (force: boolean) => void;
	onScheduled: (snapshot: ScheduledPromptDraftSnapshot) => void;
	listTarget: HTMLDivElement | null;
}) {
	const t = useT();
	const lastUsed = useRef(0);
	const rememberedTime = useRef<number | null>(null);
	const [now, setNow] = useState(Date.now());
	const [open, setOpen] = useState(false);
	const [date, setDate] = useState("");
	const [time, setTime] = useState("");
	const [hours, setHours] = useState("4");
	const [minutes, setMinutes] = useState("0");
	const [editing, setEditing] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [modelSelection, setModelSelection] = useState<PromptModelSelection | undefined>();
	const [sendingId, setSendingId] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [prompt, setPrompt] = useState(text);
	const [scheduledImages, setScheduledImages] = useState<ImageContent[]>(images);
	const scheduleRequest = useRef<{ id: string; snapshot: ScheduledPromptDraftSnapshot } | null>(
		null,
	);
	const draftSnapshot = useRef<ScheduledPromptDraftSnapshot>({
		sessionId,
		text: draftText,
		imageIds,
	});
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	const setAbsolute = (at: number) => {
		const p = parts(at);
		setDate(p.date);
		setTime(p.time);
		const delay = at > now ? Math.max(1, Math.floor((at - now) / minute)) : 0;
		setHours(String(Math.floor(delay / 60)));
		setMinutes(String(delay % 60));
	};
	const setDelay = (h: string, m: string) => {
		setHours(h);
		setMinutes(m);
		if (/^\d+$/.test(h) && /^\d+$/.test(m) && Number(m) < 60) {
			const at = futureFourHours() - 4 * 60 * minute + (Number(h) * 60 + Number(m)) * minute;
			const p = parts(at);
			setDate(p.date);
			setTime(p.time);
		}
	};
	const dueAt = makeTime(date, time, now);
	const valid =
		!!prompt.trim() &&
		!!modelSelection &&
		dueAt !== null &&
		dueAt > now &&
		/^\d+$/.test(hours) &&
		/^\d+$/.test(minutes) &&
		Number(minutes) < 60 &&
		Number(hours) * 60 + Number(minutes) >= 1 &&
		!saving;
	const show = () => {
		setEditing(null);
		setModelSelection(
			currentModel
				? { model: { provider: currentModel.provider, id: currentModel.id }, thinkingLevel }
				: undefined,
		);
		setPrompt(text);
		setScheduledImages(images);
		const snapshot = { sessionId, text: draftText, imageIds: [...imageIds] };
		draftSnapshot.current = snapshot;
		if (!scheduleRequest.current || !sameDraft(scheduleRequest.current.snapshot, snapshot))
			scheduleRequest.current = { id: randomUuid(), snapshot };
		setError("");
		setAbsolute(
			rememberedTime.current !== null && Date.now() - lastUsed.current < 5 * minute
				? rememberedTime.current
				: futureFourHours(),
		);
		setOpen(true);
	};
	const save = async () => {
		if (!valid || dueAt === null || !modelSelection || (!editing && !canSchedule)) return;
		setSaving(true);
		setError("");
		const snapshot = draftSnapshot.current;
		if (!scheduleRequest.current || !sameDraft(scheduleRequest.current.snapshot, snapshot))
			scheduleRequest.current = { id: randomUuid(), snapshot };
		const scheduled = {
			id: editing ?? scheduleRequest.current.id,
			dueAt,
			text: prompt.trim(),
			images: scheduledImages,
			modelSelection,
		};
		const pending = editing ? onUpdate(scheduled) : onSchedule(scheduled);
		await pending
			.then(() => {
				if (!editing) {
					scheduleRequest.current = null;
					onScheduled(draftSnapshot.current);
				}
				setEditing(null);
				rememberedTime.current = dueAt;
				lastUsed.current = Date.now();
				setOpen(false);
			})
			.catch((e: unknown) => {
				setError(e instanceof Error ? e.message : t("chat.schedule.failed"));
			})
			.finally(() => setSaving(false));
	};
	const edit = (item: ScheduledPromptRecord) => {
		setEditing(item.id);
		setModelSelection(
			item.modelSelection ??
				(currentModel
					? { model: { provider: currentModel.provider, id: currentModel.id }, thinkingLevel }
					: undefined),
		);
		setPrompt(item.text);
		setScheduledImages(item.images ?? []);
		setError("");
		setAbsolute(item.dueAt);
		setOpen(true);
	};
	const sendNow = async (id: string) => {
		if (sendingId) return;
		setSendingId(id);
		await onSendNow(id)
			.catch((e: unknown) => setError(e instanceof Error ? e.message : t("chat.schedule.failed")))
			.finally(() => setSendingId(null));
	};
	const cancel = async (id: string) => {
		await onCancel(id).catch(() => {});
	};
	const asPair = (selection: ModelSelection, previous?: ThinkingLevel): PromptModelSelection => ({
		model: { provider: selection.model.provider, id: selection.model.id },
		thinkingLevel:
			selection.level ??
			(previous && selection.model.thinkingLevels.includes(previous)
				? previous
				: (selection.model.thinkingLevels[0] ?? "off")),
	});
	const pickRowModel = async (item: ScheduledPromptRecord, selection: PromptModelSelection) => {
		setError("");
		await onUpdate({
			id: item.id,
			dueAt: item.dueAt,
			text: item.text,
			images: item.images ?? [],
			modelSelection: selection,
		}).catch((e: unknown) => setError(e instanceof Error ? e.message : t("chat.schedule.failed")));
	};
	const pickerModel = (selection?: PromptModelSelection) =>
		models.find(
			(model) => model.provider === selection?.model.provider && model.id === selection.model.id,
		) ?? null;
	const close = () => {
		if (!editing) rememberedTime.current = dueAt;
		lastUsed.current = Date.now();
		setOpen(false);
		setEditing(null);
	};
	return (
		<div className="relative flex items-center" data-testid="scheduled-prompts">
			{items.length > 0 && listTarget
				? createPortal(
						<div className="mb-8 flex max-h-[180px] w-full flex-col gap-2 overflow-y-auto border-b border-control-border-default pb-8">
							{items
								.filter((item) => item.sessionId === sessionId)
								.map((item) => (
									<div
										key={item.id}
										className="flex min-w-0 items-center gap-8 rounded-sm bg-container-workspace-bg px-8 py-4"
									>
										<div
											className={
												item.status === "delivering" || sendingId === item.id
													? "pointer-events-none opacity-40"
													: ""
											}
										>
											<ModelEffortPicker
												iconOnly
												models={models}
												current={pickerModel(item.modelSelection)}
												level={item.modelSelection?.thinkingLevel ?? thinkingLevel}
												onSelect={(selection) =>
													void pickRowModel(
														item,
														asPair(selection, item.modelSelection?.thinkingLevel),
													)
												}
												onSelectLevel={(level) => {
													if (item.modelSelection)
														void pickRowModel(item, {
															...item.modelSelection,
															thinkingLevel: level,
														});
												}}
												refreshing={modelsRefreshing}
												onRefresh={onRefreshModels}
												preferences={modelPreferences}
												className="h-24 px-4"
											/>
										</div>
										<div className="min-w-0 flex-1">
											<div className="truncate tr-text-ui">{item.text}</div>
											<div className="tr-text-metadata text-text-muted">
												{parts(item.dueAt).date} {parts(item.dueAt).time} ·{" "}
												{item.status === "failed" ? item.error : remainingTime(item.dueAt, now)}
												{item.modelSelection ? (
													<span
														title={
															item.modelSelection.model.provider +
															"/" +
															item.modelSelection.model.id
														}
													>
														{" "}
														·{" "}
														{pickerModel(item.modelSelection)?.name ?? item.modelSelection.model.id}{" "}
														· {t(LEVEL_LABEL[item.modelSelection.thinkingLevel])}
													</span>
												) : null}
											</div>
										</div>
										{
											<>
												<button
													type="button"
													aria-label={t("chat.schedule.sendNow")}
													title={t("chat.schedule.sendNow")}
													disabled={sendingId !== null || item.status !== "scheduled"}
													onClick={() => void sendNow(item.id)}
													className="text-text-muted hover:text-text-default disabled:opacity-40"
												>
													<RiSendPlane2Line className="size-14" />
												</button>
												<button
													type="button"
													disabled={sendingId === item.id || item.status === "delivering"}
													className="text-text-muted hover:text-text-default disabled:opacity-40"
													aria-label={t("common.edit")}
													onClick={() => edit(item)}
												>
													<RiEditLine className="size-14" />
												</button>
												<button
													type="button"
													disabled={sendingId === item.id || item.status === "delivering"}
													className="text-text-muted hover:text-text-default disabled:opacity-40"
													aria-label={t("common.delete")}
													onClick={() => void cancel(item.id)}
												>
													<RiDeleteBinLine className="size-14" />
												</button>
											</>
										}
									</div>
								))}
							{error && !open ? (
								<div role="alert" className="text-feedback-error tr-text-metadata">
									{error}
								</div>
							) : null}
						</div>,
						listTarget,
					)
				: null}
			<Popover
				open={open}
				onOpenChange={(v) => {
					if (!v) close();
				}}
			>
				<PopoverTrigger asChild>
					<button
						type="button"
						onClick={show}
						data-testid="schedule-open"
						disabled={!canSchedule || saving}
						aria-label={t("chat.schedule.open")}
						className="relative -ml-12 flex h-28 w-40 items-center justify-end rounded-r-full pr-8 text-feedback-warning hover:opacity-80 disabled:pointer-events-none disabled:text-text-subtle"
					>
						<svg
							viewBox="0 0 40 28"
							className="absolute inset-0 size-full fill-current"
							aria-hidden="true"
						>
							<path d="M0 0H26A14 14 0 0 1 26 28H0A18 18 0 0 0 0 0Z" />
						</svg>
						<RiCalendarScheduleLine className="relative size-14 text-text-default" />
					</button>
				</PopoverTrigger>
				<PopoverContent side="top" align="end" className="w-[280px] p-12">
					<div className="flex flex-col gap-8">
						<div className="flex items-center gap-6 text-text-default tr-text-ui">
							<RiCalendarScheduleLine className="size-14" />
							{t("chat.schedule.title")}
						</div>
						{editing ? (
							<ModelEffortPicker
								models={models}
								current={pickerModel(modelSelection)}
								level={modelSelection?.thinkingLevel ?? thinkingLevel}
								onSelect={(selection) =>
									setModelSelection(asPair(selection, modelSelection?.thinkingLevel))
								}
								onSelectLevel={(level) =>
									setModelSelection((pair) => (pair ? { ...pair, thinkingLevel: level } : pair))
								}
								refreshing={modelsRefreshing}
								onRefresh={onRefreshModels}
								preferences={modelPreferences}
								className="h-28 max-w-full px-4"
							/>
						) : null}
						{editing ? (
							<textarea
								aria-label={t("chat.schedule.prompt")}
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								rows={2}
								className="w-full resize-y rounded-sm border border-control-border-default bg-control-bg px-6 py-4 tr-text-ui"
							/>
						) : null}
						<div className="flex items-center gap-8 rounded-md border border-control-border-default bg-control-bg px-8 py-6 focus-within:border-control-border-active">
							<div className="relative min-w-0 flex-1">
								<button
									type="button"
									className="w-full text-left text-text-default tr-text-ui"
									onClick={(e) => {
										const picker = e.currentTarget.nextElementSibling as HTMLInputElement | null;
										picker?.showPicker?.();
									}}
								>
									{date}
								</button>
								<input
									type="date"
									aria-label={t("chat.schedule.date")}
									value={date}
									onChange={(e) => {
										setDate(e.target.value);
										const at = makeTime(e.target.value, time, now);
										if (at !== null) setAbsolute(at);
									}}
									className="pointer-events-none absolute inset-0 size-full opacity-0"
									tabIndex={-1}
								/>
							</div>
							<input
								aria-label={t("chat.schedule.time")}
								value={time}
								inputMode="numeric"
								maxLength={5}
								onFocus={(e) => e.currentTarget.select()}
								onClick={(e) => e.currentTarget.select()}
								onChange={(e) => {
									const value = e.target.value;
									if (!/^[0-9:]{0,5}$/.test(value)) return;
									setTime(value);
									const at = makeTime(date, value, now);
									if (at !== null) setAbsolute(at);
								}}
								onBlur={() => {
									const match = /^(\d{1,2}):?(\d{2})$/.exec(time);
									if (!match?.[1] || !match[2]) return;
									const value = `${match[1].padStart(2, "0")}:${match[2]}`;
									const at = makeTime(date, value, now);
									if (at !== null) setAbsolute(at);
								}}
								className="w-64 border-l border-control-border-default bg-control-bg pl-8 text-center text-text-default outline-none tr-text-ui"
							/>
						</div>
						<div className="rounded-md border border-control-border-active bg-container-workspace-bg p-8">
							<div className="mb-4 tr-text-metadata text-text-default">
								{t("chat.schedule.delay")}
							</div>
							<div className="flex items-center gap-4">
								<input
									aria-label={t("chat.schedule.hours")}
									onFocus={(e) => e.currentTarget.select()}
									onClick={(e) => e.currentTarget.select()}
									type="number"
									min="0"
									step="1"
									value={hours}
									onChange={(e) => setDelay(e.target.value, minutes)}
									className="w-64 rounded-sm border border-control-border-default bg-control-bg px-6 py-4 tr-text-ui"
								/>
								h
								<input
									aria-label={t("chat.schedule.minutes")}
									onFocus={(e) => e.currentTarget.select()}
									onClick={(e) => e.currentTarget.select()}
									type="number"
									min="0"
									max="59"
									step="1"
									value={minutes}
									onChange={(e) => setDelay(hours, e.target.value)}
									className="w-56 rounded-sm border border-control-border-default bg-control-bg px-6 py-4 tr-text-ui"
								/>
								m
							</div>
						</div>
						<div className="flex gap-4">
							{[10, 60, 720, 1440].map((delay) => (
								<button
									key={delay}
									type="button"
									onClick={() => setDelay(String(Math.floor(delay / 60)), String(delay % 60))}
									className="flex-1 rounded-sm border border-control-border-default px-6 py-4 text-text-default hover:bg-control-bg-hovered tr-text-ui"
								>
									{delay < 60 ? `${delay}m` : `${delay / 60}h`}
								</button>
							))}
						</div>
						{error ? (
							<div role="alert" className="text-feedback-error tr-text-metadata">
								{error}
							</div>
						) : null}
						<div className="flex justify-end gap-6">
							<button
								type="button"
								onClick={close}
								className="rounded-sm px-8 py-4 hover:bg-control-bg-hovered tr-text-ui"
							>
								{t("common.cancel")}
							</button>
							<button
								type="button"
								data-testid="schedule-confirm"
								disabled={!valid}
								onClick={() => void save()}
								className="rounded-full bg-feedback-warning px-8 py-4 text-text-default disabled:opacity-40 tr-text-ui"
							>
								{editing ? t("common.save") : t("chat.schedule.submit")}
							</button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
