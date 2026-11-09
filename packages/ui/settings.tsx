import { RiCheckLine as Check } from "@remixicon/react";
import { Children, isValidElement, type ReactNode } from "react";
import { cn } from "./utils";

export const SETTINGS_ROWS_CONTAINER = "flex flex-col [&>*:last-child]:border-b-0";

export interface SettingsRowProps {
	label: string;
	description?: ReactNode;
	control: ReactNode;
	testId?: string;
	noBorder?: boolean;
	className?: string;
}

export function SettingsRow({
	label,
	description,
	control,
	testId,
	noBorder = false,
	className,
}: SettingsRowProps) {
	return (
		<div
			data-testid={testId}
			className={cn(
				"flex flex-wrap items-center justify-between gap-12 py-12",
				!noBorder && "border-border-muted border-b",
				className,
			)}
		>
			<div className="flex min-w-160 flex-1 flex-col gap-2">
				<span className="tr-text-ui text-text-default">{label}</span>
				{description ? (
					<span className="tr-text-metadata text-text-muted">{description}</span>
				) : null}
			</div>
			<div className="max-w-full shrink-0">{control}</div>
		</div>
	);
}

export interface SettingsGroupProps {
	title: string;
	description?: string | undefined;
	children: ReactNode;
	testId?: string;
}

export function SettingsGroup({ title, description, children, testId }: SettingsGroupProps) {
	return (
		<section data-testid={testId} className="flex flex-col">
			<div className="flex flex-col gap-2 pb-12">
				<h3 className="tr-text-label-pill text-text-subtle">{title}</h3>
				{description ? <p className="tr-text-metadata text-text-muted">{description}</p> : null}
			</div>
			<div className={SETTINGS_ROWS_CONTAINER}>{children}</div>
		</section>
	);
}

export interface SettingsPageContainerProps {
	children: ReactNode;
	testId?: string;
}

export function SettingsPageContainer({ children, testId }: SettingsPageContainerProps) {
	return (
		<div data-testid={testId} className="flex flex-col">
			{Children.toArray(children).map((child, index) => (
				<div
					key={isValidElement(child) && child.key !== null ? child.key : index}
					className="flex flex-col empty:hidden [:not(:empty)~&]:mt-24 [:not(:empty)~&]:border-border-muted [:not(:empty)~&]:border-t [:not(:empty)~&]:pt-24"
				>
					{child}
				</div>
			))}
		</div>
	);
}

export interface SegmentedControlOption<T extends string> {
	id: T;
	label: string;
	testId?: string;
	disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
	name: string;
	label: string;
	options: readonly SegmentedControlOption<T>[];
	value: T | null;
	onSelect: (value: T) => void;
	disabled?: boolean;
	testId?: string;
}

export function SegmentedControl<T extends string>({
	name,
	label,
	options,
	value,
	onSelect,
	disabled = false,
	testId,
}: SegmentedControlProps<T>) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			data-testid={testId}
			className="inline-flex h-32 overflow-hidden rounded-sm bg-control-bg"
		>
			{options.map((option) => {
				const selected = value !== null && option.id === value;
				const optionDisabled = disabled || option.disabled === true;
				return (
					<label
						key={option.id}
						data-testid={option.testId}
						data-active={selected}
						className={cn(
							"relative cursor-pointer transition-colors",
							optionDisabled && "cursor-default",
						)}
					>
						<input
							type="radio"
							name={name}
							value={option.id}
							checked={selected}
							disabled={optionDisabled}
							onChange={() => onSelect(option.id)}
							className="peer sr-only inset-0"
						/>
						<span
							className={cn(
								"flex h-32 items-center px-12 tr-text-ui transition-colors",
								selected
									? "rounded-sm bg-control-bg-selected text-text-default"
									: "text-text-muted hover:text-text-default",
								"peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-primary",
								"peer-disabled:text-control-disabled-text peer-disabled:hover:text-control-disabled-text",
							)}
						>
							{option.label}
						</span>
					</label>
				);
			})}
		</div>
	);
}

export interface SettingsRadioChoice<T extends string> {
	id: T;
	label: string;
	hint?: string;
	description: string;
	testId: string;
	disabled?: boolean;
}

export function SettingsRadioCards<T extends string>({
	name,
	label,
	choices,
	value,
	disabled = false,
	onSelect,
}: {
	name: string;
	label: string;
	choices: readonly SettingsRadioChoice<T>[];
	value: T;
	disabled?: boolean;
	onSelect: (value: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="flex flex-col gap-4">
			{choices.map((choice) => {
				const active = choice.id === value;
				const choiceDisabled = disabled || choice.disabled === true;
				return (
					<label
						key={choice.id}
						data-testid={choice.testId}
						data-active={active}
						className={cn(
							"flex items-center gap-8 rounded-sm border px-12 py-8 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
							choiceDisabled ? "cursor-default" : "cursor-pointer",
							active
								? "border-primary-muted bg-clip-padding bg-primary-subtle"
								: "border-border-default hover:bg-control-bg-hovered",
						)}
					>
						<input
							type="radio"
							name={name}
							value={choice.id}
							checked={active}
							disabled={choiceDisabled}
							onChange={() => onSelect(choice.id)}
							className="sr-only"
						/>
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-4 tr-title-compact text-text-default">
								{choice.label}
								{choice.hint ? (
									<span className="text-text-muted tr-text-metadata">{choice.hint}</span>
								) : null}
							</span>
							<span className="block text-text-muted tr-text-metadata">{choice.description}</span>
						</span>
						{active ? <Check className="size-16 shrink-0 text-primary" /> : null}
					</label>
				);
			})}
		</div>
	);
}

export const SETTINGS_TAG =
	"shrink-0 rounded-xs border border-border-default px-4 tr-text-label-pill";

export function SettingsSubheading({
	title,
	description,
	testId,
	titleAttribute,
}: {
	title: string;
	description?: string;
	testId?: string;
	titleAttribute?: string;
}) {
	return (
		<div
			data-testid={testId}
			title={titleAttribute}
			className="flex min-w-0 flex-col gap-2 pt-16 pb-4"
		>
			<h4 className="tr-text-ui text-text-default">{title}</h4>
			{description ? (
				<p className="break-words text-text-muted tr-text-metadata">{description}</p>
			) : null}
		</div>
	);
}
