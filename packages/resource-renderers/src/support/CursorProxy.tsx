import { useT } from "@thinkrail/locales/react";
import { type FocusEventHandler, type KeyboardEventHandler, type Ref, useId } from "react";

export interface CursorOption {
	key: string;
	place: string;
	text: string;
	extent: string | null;
	position: number;
	size: number;
}

export interface CursorProxyProps {
	ref: Ref<HTMLDivElement>;
	focusDefault?: boolean;
	label: string;
	option: CursorOption;
	onKeyDown: KeyboardEventHandler<HTMLDivElement>;
	onFocus: FocusEventHandler<HTMLDivElement>;
	onBlur: FocusEventHandler<HTMLDivElement>;
}

export const CURSOR_PROXY_HOST = "has-[>[data-review-surface]:focus-visible]:focus-ring-inset";

export function CursorProxy({
	ref,
	focusDefault = false,
	label,
	option,
	onKeyDown,
	onFocus,
	onBlur,
}: CursorProxyProps) {
	const t = useT();
	const id = `${useId()}${option.key}`;
	const at = t("viewer.cursor.at", {
		place: option.place,
		text: option.text || t("viewer.cursor.blank"),
	});
	return (
		<div
			ref={ref}
			data-testid="review-cursor"
			data-review-surface
			data-focus-default={focusDefault || undefined}
			role="listbox"
			aria-label={label}
			aria-activedescendant={id}
			tabIndex={0}
			onKeyDown={onKeyDown}
			onFocus={onFocus}
			onBlur={onBlur}
			className="sticky top-0 h-0 [clip-path:inset(50%)]"
		>
			<div
				key={id}
				id={id}
				role="option"
				tabIndex={-1}
				aria-selected
				aria-posinset={option.position}
				aria-setsize={option.size}
				aria-label={option.extent ? t("viewer.cursor.range", { at, extent: option.extent }) : at}
			/>
		</div>
	);
}
