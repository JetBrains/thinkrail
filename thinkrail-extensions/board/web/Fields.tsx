import { RiAddLine, RiCloseLine, RiDeleteBinLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState } from "react";
import { FIELD } from "./CardParts";

export function Section({
	title,
	testId,
	children,
}: {
	title: string;
	testId?: string;
	children: ReactNode;
}) {
	return (
		<section data-testid={testId} className="flex flex-col gap-4">
			<h3 className="tr-text-eyebrow text-text-muted">{title}</h3>
			{children}
		</section>
	);
}

/** A text field that writes on blur or Enter, when its value changed; keyed by the saved value. */
export function SavedInput({
	value,
	label,
	testId,
	onSave,
	compact = false,
}: {
	value: string;
	label: string;
	testId: string;
	onSave: (value: string) => void;
	/** A row's field rather than a panel's heading. */
	compact?: boolean;
}) {
	const [draft, setDraft] = useState(value);
	const save = () => {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== value) onSave(trimmed);
		else setDraft(value);
	};
	return (
		<input
			data-testid={testId}
			aria-label={label}
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={save}
			onKeyDown={(event) => {
				if (event.key !== "Enter" || isImeComposing(event.nativeEvent)) return;
				event.preventDefault();
				save();
			}}
			className={cn(FIELD, !compact && "tr-title-compact")}
		/>
	);
}

/** A field that an empty value clears (`null`): a date, a number of days; saved on blur, Enter or a pick. */
export function ClearableInput({
	id,
	value,
	type,
	label,
	testId,
	min,
	onSave,
}: {
	id?: string;
	value: string;
	type: "date" | "number";
	label: string;
	testId: string;
	min?: number;
	onSave: (value: string | null) => void;
}) {
	const [draft, setDraft] = useState(value);
	const save = (next: string) => {
		const trimmed = next.trim();
		if (trimmed !== value) onSave(trimmed || null);
	};
	return (
		<input
			id={id}
			type={type}
			data-testid={testId}
			aria-label={label}
			min={min}
			value={draft}
			onChange={(event) => {
				setDraft(event.currentTarget.value);
				if (type === "date") save(event.currentTarget.value);
			}}
			onBlur={() => save(draft)}
			onKeyDown={(event) => {
				if (event.key !== "Enter" || isImeComposing(event.nativeEvent)) return;
				event.preventDefault();
				save(draft);
			}}
			className={cn(FIELD, "w-auto shrink-0 tabular-nums")}
		/>
	);
}

export function SavedTextarea({
	value,
	label,
	testId,
	placeholder,
	onSave,
}: {
	value: string;
	label: string;
	testId: string;
	placeholder?: string;
	onSave: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	return (
		<Textarea
			data-testid={testId}
			aria-label={label}
			placeholder={placeholder}
			rows={4}
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={() => {
				if (draft !== value) onSave(draft);
			}}
		/>
	);
}

/** An editable list of short strings: acceptance or success criteria, spec refs. */
export function ItemList({
	items,
	label,
	addLabel,
	testId,
	onChange,
	renderItem,
}: {
	items: readonly string[];
	label: string;
	addLabel: string;
	testId: string;
	onChange: (items: string[]) => void;
	/** How an item shows (a link, say); its text by default. */
	renderItem?: (item: string) => ReactNode;
}) {
	const t = useT();
	const [draft, setDraft] = useState("");
	const add = () => {
		const trimmed = draft.trim();
		if (!trimmed) return;
		onChange([...items, trimmed]);
		setDraft("");
	};
	return (
		<div data-testid={testId} className="flex flex-col gap-4">
			<ul className="flex flex-col gap-2">
				{items.map((item, index) => (
					<li
						key={`${index}:${item}`}
						data-testid={`${testId}-item`}
						className="flex items-start gap-4 tr-text-ui text-text-default"
					>
						<span className="min-w-0 flex-1 wrap-anywhere">
							{renderItem ? renderItem(item) : item}
						</span>
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("board.card.removeItem", { item })}
							onClick={() => onChange(items.filter((_, position) => position !== index))}
						/>
					</li>
				))}
			</ul>
			<form
				className="flex items-center gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					add();
				}}
			>
				<input
					data-testid={`${testId}-add`}
					aria-label={label}
					placeholder={addLabel}
					value={draft}
					onChange={(event) => setDraft(event.currentTarget.value)}
					className={FIELD}
				/>
				<IconButton
					icon={RiAddLine}
					size="s"
					type="submit"
					label={addLabel}
					disabled={!draft.trim()}
				/>
			</form>
		</div>
	);
}

/** A delete behind an inline confirm; `wide` shows its label beside the icon. */
export function ConfirmDelete({
	label,
	question,
	testId,
	wide = false,
	onDelete,
}: {
	label: string;
	question: string;
	testId: string;
	wide?: boolean;
	onDelete: () => void;
}) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	return confirming ? (
		<span className="flex flex-wrap items-center gap-4">
			<span className="tr-text-metadata text-text-muted">{question}</span>
			<Button
				variant="destructive"
				size="s"
				data-testid={`${testId}-confirm`}
				onClick={() => {
					setConfirming(false);
					onDelete();
				}}
			>
				{label}
			</Button>
			<Button variant="ghost" size="s" onClick={() => setConfirming(false)}>
				{t("board.card.keep")}
			</Button>
		</span>
	) : wide ? (
		<Button
			variant="ghost"
			size="s"
			tone="danger"
			iconLeft={RiDeleteBinLine}
			data-testid={testId}
			className="self-start"
			onClick={() => setConfirming(true)}
		>
			{label}
		</Button>
	) : (
		<IconButton
			icon={RiDeleteBinLine}
			size="s"
			label={label}
			data-testid={testId}
			onClick={() => setConfirming(true)}
		/>
	);
}
