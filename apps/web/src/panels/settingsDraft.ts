import {
	type ChangeEvent,
	type KeyboardEvent,
	useEffect,
	useInsertionEffect,
	useRef,
	useState,
} from "react";

export const SETTINGS_INPUT =
	"h-32 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none placeholder:text-text-subtle focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text aria-invalid:border-feedback-error";

export interface SettingsDraftOptions {
	saved: string;
	isValid: (draft: string) => boolean;
	commit: (draft: string) => undefined | Promise<boolean>;
	enterBlurs?: boolean;
	onEdit?: () => void;
}

export interface SettingsDraft {
	draft: string;
	invalid: boolean;
	setDraft: (next: string) => void;
	submit: (next: string) => void;
	commitDraft: () => void;
	inputProps: {
		value: string;
		"aria-invalid": boolean;
		"data-settings-draft-input": true;
		onChange: (event: ChangeEvent<HTMLInputElement>) => void;
		onBlur: () => void;
		onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	};
}

export function useSettingsDraft({
	saved,
	isValid,
	commit,
	enterBlurs = false,
	onEdit,
}: SettingsDraftOptions): SettingsDraft {
	const [draft, setDraftState] = useState(saved);
	const savedRef = useRef(saved);
	const editingRef = useRef(false);
	const submittedRef = useRef<string | null>(null);
	const pendingRef = useRef<{ value: string }[]>([]);
	useInsertionEffect(() => {
		savedRef.current = saved;
	});
	useEffect(() => {
		const pending = pendingRef.current;
		pending.splice(0, pending.findIndex((entry) => entry.value === saved) + 1);
		if (pending.length > 0 || editingRef.current) return;
		submittedRef.current = null;
		setDraftState(saved);
	}, [saved]);
	const invalid = !isValid(draft);

	const setDraft = (next: string) => {
		editingRef.current = true;
		submittedRef.current = null;
		setDraftState(next);
		onEdit?.();
	};
	const submit = (next: string) => {
		editingRef.current = false;
		submittedRef.current = next;
		setDraftState(next);
		const stored = commit(next);
		if (!stored) return;
		const entry = { value: next };
		pendingRef.current.push(entry);
		void stored.then((ok) => {
			const pending = pendingRef.current;
			const index = pending.indexOf(entry);
			if (index >= 0) pending.splice(index, 1);
			if (ok || submittedRef.current !== next) return;
			submittedRef.current = null;
			if (!editingRef.current) setDraftState(pending.at(-1)?.value ?? savedRef.current);
		});
	};
	const commitDraft = () => {
		editingRef.current = false;
		if (invalid || draft === submittedRef.current) return;
		if (draft === (pendingRef.current.at(-1)?.value ?? saved)) return;
		submit(draft);
	};

	return {
		draft,
		invalid,
		setDraft,
		submit,
		commitDraft,
		inputProps: {
			value: draft,
			"aria-invalid": invalid,
			"data-settings-draft-input": true,
			onChange: (event) => setDraft(event.currentTarget.value),
			onBlur: commitDraft,
			onKeyDown: (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					if (enterBlurs) event.currentTarget.blur();
					else commitDraft();
				} else if (event.key === "Escape") {
					editingRef.current = false;
					setDraftState(pendingRef.current.at(-1)?.value ?? saved);
					onEdit?.();
				}
			},
		},
	};
}
