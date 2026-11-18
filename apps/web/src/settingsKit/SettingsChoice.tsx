import { RiCheckLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { isImeComposing, twinArrow } from "@thinkrail/ui/keyboard";
import { type LocalKeyEvent, useLocalKeys } from "@thinkrail/ui/local-keys";
import { cn } from "@thinkrail/ui/utils";
import { useId, useState } from "react";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";

export interface SettingsChoiceOption<T extends string> {
	id: T;
	label: string;
	hint?: string;
	description?: string;
	testId?: string;
	disabled?: boolean;
}

export type SettingsChoiceLayout = "segmented" | "list" | "cards";
export type SettingsChoiceCost = "cheap" | "expensive";

export interface SettingsChoiceProps<T extends string> {
	label: string;
	options: readonly SettingsChoiceOption<T>[];
	value: T | null;
	onSelect: (value: T) => void;
	onPendingChange?: ((pending: T | null) => void) | undefined;
	layout?: SettingsChoiceLayout;
	cost?: SettingsChoiceCost;
	disabled?: boolean;
	testId?: string;
}

const STEPS: Readonly<Record<SettingsChoiceLayout, Readonly<Record<string, 1 | -1>>>> = {
	segmented: { ArrowLeft: -1, ArrowRight: 1 },
	list: { ArrowUp: -1, ArrowDown: 1 },
	cards: { ArrowUp: -1, ArrowDown: 1 },
};

const OPTION = '[role="option"]';

const enabled = <T extends string>(option: SettingsChoiceOption<T>, disabled: boolean) =>
	!disabled && option.disabled !== true;

export function choiceStep<T extends string>(
	options: readonly SettingsChoiceOption<T>[],
	from: T | null,
	delta: 1 | -1,
	disabled = false,
): T | null {
	const start = options.findIndex((option) => option.id === from);
	const ahead =
		delta === 1 ? options.slice(start + 1) : options.slice(0, Math.max(start, 0)).reverse();
	return ahead.find((option) => enabled(option, disabled))?.id ?? null;
}

export function choiceFocus<T extends string>(
	options: readonly SettingsChoiceOption<T>[],
	value: T | null,
	pending: T | null,
): T | null {
	const reachable = options.filter((option) => option.disabled !== true);
	const preferred = pending ?? value;
	return (
		reachable.find((option) => option.id === preferred)?.id ??
		reachable[0]?.id ??
		options[0]?.id ??
		null
	);
}

const GROUP_CLASS: Record<SettingsChoiceLayout, string> = {
	segmented: "inline-flex h-32 max-w-full overflow-hidden rounded-sm bg-control-bg",
	list: "flex flex-col gap-2",
	cards: "flex flex-col gap-4",
};

function optionClass(layout: SettingsChoiceLayout, selected: boolean): string {
	if (layout === "segmented") {
		return cn(
			"flex h-32 items-center gap-4 px-12 tr-text-ui transition-colors focus-visible:focus-ring-inset disabled:text-control-disabled-text data-[pending=true]:bg-feedback-warning-subtle data-[pending=true]:text-text-default",
			selected
				? "rounded-sm bg-control-bg-selected text-text-default"
				: "text-text-muted hover:text-text-default",
		);
	}
	if (layout === "list") {
		return cn(
			"flex w-full items-center gap-8 rounded-sm px-8 py-6 text-left tr-text-ui transition-colors hover:bg-control-bg-hovered focus-visible:focus-ring-inset disabled:text-control-disabled-text data-[pending=true]:bg-feedback-warning-subtle",
			selected ? "bg-control-bg-selected text-text-default" : "text-text-muted",
		);
	}
	return cn(
		"flex w-full items-center gap-8 rounded-sm border px-12 py-8 text-left transition-colors focus-visible:focus-ring disabled:text-control-disabled-text data-[pending=true]:border-feedback-warning data-[pending=true]:bg-feedback-warning-subtle",
		selected
			? "border-primary-muted bg-clip-padding bg-primary-subtle"
			: "border-border-default hover:bg-control-bg-hovered",
	);
}

export interface ChoiceKeyEvent<E> {
	readonly defaultPrevented: boolean;
	readonly nativeEvent: LocalKeyEvent;
	readonly target: unknown;
	readonly currentTarget: { querySelectorAll(selector: string): Iterable<E> };
	preventDefault(): void;
}

export interface SettingsChoiceGroupProps<T extends string>
	extends Omit<SettingsChoiceProps<T>, "onSelect" | "onPendingChange"> {
	waiting: T | null;
	onApply: (value: T) => void;
	onKeyDown?: (event: ChoiceKeyEvent<HTMLElement>) => void;
	onLeave?: () => void;
}

export function SettingsChoiceGroup<T extends string>({
	label,
	options,
	value,
	layout = "segmented",
	cost = "cheap",
	disabled = false,
	testId,
	waiting,
	onApply,
	onKeyDown,
	onLeave,
}: SettingsChoiceGroupProps<T>) {
	const t = useT();
	const hintId = useId();
	const focusId = choiceFocus(options, value, waiting);
	return (
		<div className={cn("flex max-w-full flex-col gap-4", layout === "segmented" && "items-end")}>
			<div
				role="listbox"
				aria-label={label}
				aria-orientation={layout === "segmented" ? "horizontal" : "vertical"}
				data-testid={testId}
				data-layout={layout}
				data-cost={cost}
				className={GROUP_CLASS[layout]}
				onKeyDown={onKeyDown}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) onLeave?.();
				}}
			>
				{options.map((option) => {
					const selected = option.id === value;
					const isPending = option.id === waiting;
					const focus = option.id === focusId;
					return (
						<button
							key={option.id}
							type="button"
							role="option"
							aria-selected={selected}
							aria-describedby={isPending ? hintId : undefined}
							tabIndex={focus ? 0 : -1}
							disabled={disabled || option.disabled === true}
							data-setting-stop={focus ? "" : undefined}
							data-active={selected}
							data-pending={isPending || undefined}
							data-testid={option.testId}
							className={optionClass(layout, selected)}
							onClick={() => onApply(option.id)}
						>
							{layout === "segmented" ? (
								<>
									{option.label}
									{option.hint ? (
										<span className="text-text-subtle tr-text-metadata">{option.hint}</span>
									) : null}
								</>
							) : (
								<>
									<span className="flex min-w-0 flex-1 flex-col">
										<span
											className={cn(
												"flex flex-wrap items-center gap-4",
												layout === "cards" ? "tr-title-compact text-text-default" : "tr-text-ui",
											)}
										>
											{option.label}
											{option.hint ? (
												<span className="text-text-muted tr-text-metadata">{option.hint}</span>
											) : null}
										</span>
										{option.description ? (
											<span className="text-text-muted tr-text-metadata">{option.description}</span>
										) : null}
									</span>
									{selected ? (
										<RiCheckLine aria-hidden className="size-16 shrink-0 text-primary" />
									) : null}
								</>
							)}
						</button>
					);
				})}
			</div>
			{waiting !== null ? (
				<span id={hintId} className="text-feedback-warning tr-text-metadata">
					{t("settings.kit.choice.pending")}
				</span>
			) : null}
		</div>
	);
}

export interface SettingsChoiceState<T extends string, E> {
	waiting: T | null;
	onApply: (value: T) => void;
	onKeyDown: (event: ChoiceKeyEvent<E>) => void;
	onLeave: () => void;
}

export function useSettingsChoice<T extends string, E extends { focus(): void }>({
	options,
	value,
	onSelect,
	onPendingChange,
	layout = "segmented",
	cost = "cheap",
	disabled = false,
}: SettingsChoiceProps<T>): SettingsChoiceState<T, E> {
	const keys = useLocalKeys("settings", LOCAL_KEY_DEFAULTS.settings);
	const [pending, setPending] = useState<T | null>(null);
	const waiting = cost === "expensive" && pending !== null && pending !== value ? pending : null;

	const pend = (next: T | null) => {
		setPending(next);
		if (next !== waiting) onPendingChange?.(next);
	};
	const apply = (id: T) => {
		pend(null);
		if (id !== value) onSelect(id);
	};

	const onKeyDown = (event: ChoiceKeyEvent<E>) => {
		const press = event.nativeEvent;
		if (event.defaultPrevented || isImeComposing(press)) return;
		const choices = Array.from(event.currentTarget.querySelectorAll(OPTION));
		const twin = twinArrow(keys.match(press));
		const plain = !(press.altKey || press.ctrlKey || press.metaKey || press.shiftKey);
		const key = twin ?? (plain ? press.key : null);
		if (key === "Escape" && waiting !== null) {
			event.preventDefault();
			pend(null);
			choices[options.findIndex((option) => option.id === value)]?.focus();
			return;
		}
		const delta = key === null ? undefined : STEPS[layout][key];
		if (delta === undefined) return;
		const focused = options.find((_, index) => choices[index] === event.target);
		const from = focused?.id ?? choiceFocus(options, value, waiting);
		const next = choiceStep(options, from, delta, disabled);
		if (next === null) return;
		event.preventDefault();
		if (cost === "cheap") apply(next);
		else pend(next === value ? null : next);
		choices[options.findIndex((option) => option.id === next)]?.focus();
	};

	return { waiting, onApply: apply, onKeyDown, onLeave: () => pend(null) };
}

export function SettingsChoice<T extends string>(props: SettingsChoiceProps<T>) {
	const state = useSettingsChoice<T, HTMLElement>(props);
	return <SettingsChoiceGroup {...props} {...state} />;
}
