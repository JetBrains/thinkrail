import { RiAddLine, RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
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
}: {
	items: readonly string[];
	label: string;
	addLabel: string;
	testId: string;
	onChange: (items: string[]) => void;
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
						<span className="min-w-0 flex-1 wrap-anywhere">{item}</span>
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
