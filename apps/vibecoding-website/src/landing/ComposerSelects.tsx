import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Model = { name: string; id: string; meta: string };

const MODEL_GROUPS: { provider: string; models: Model[] }[] = [
	{
		provider: "anthropic",
		models: [
			{ name: "Claude Opus 4.8", id: "claude-opus-4-8", meta: "1M context · reasoning" },
			{ name: "Claude Opus 5", id: "claude-opus-5", meta: "1M context · reasoning" },
			{ name: "Claude Sonnet 5", id: "claude-sonnet-5", meta: "1M context · reasoning" },
		],
	},
	{
		provider: "openai",
		models: [
			{ name: "GPT-5.5", id: "gpt-5.5", meta: "272K context · reasoning" },
			{ name: "GPT-5.6 Sol", id: "gpt-5.6-sol", meta: "272K context · reasoning" },
			{ name: "GPT-5.5 Pro", id: "gpt-5.5-pro", meta: "1.1M context · reasoning" },
		],
	},
	{
		provider: "openai-codex",
		models: [
			{ name: "GPT-5.6 Terra", id: "gpt-5.6-terra", meta: "272K context · reasoning" },
			{ name: "GPT-5.6 Luna", id: "gpt-5.6-luna", meta: "272K context · reasoning" },
		],
	},
];

const EFFORTS = ["High", "Medium", "Low"];

function useOutsideClose(open: boolean, onClose: () => void) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, onClose]);
	return ref;
}

const triggerCls =
	"inline-flex items-center gap-1.5 rounded-sm border border-border bg-container-card-bg px-2.5 py-1 text-xs whitespace-nowrap transition-colors hover:border-control-border-active";

export function ModelSelect() {
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("claude-opus-4-8");
	const ref = useOutsideClose(open, () => setOpen(false));
	const current = MODEL_GROUPS.flatMap((g) => g.models).find((m) => m.id === value);

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={`${triggerCls} text-text-muted`}
			>
				{current?.name} <ChevronDown className="size-3.5" />
			</button>
			{open && (
				<div
					role="listbox"
					aria-label="Choose a model"
					className="animate-in fade-in slide-in-from-bottom-1 absolute bottom-[calc(100%+6px)] left-0 z-30 max-h-64 w-72 overflow-y-auto rounded-sm border border-border bg-container-card-bg p-1 duration-150"
				>
					{MODEL_GROUPS.map((g) => (
						<fieldset key={g.provider}>
							<legend className="w-full px-2.5 py-1.5 text-xs text-text-subtle">
								{g.provider}
							</legend>
							{g.models.map((m) => (
								<button
									key={m.id}
									type="button"
									role="option"
									aria-selected={m.id === value}
									onClick={() => {
										setValue(m.id);
										setOpen(false);
									}}
									className="flex w-full items-start gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-control-bg"
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs text-text-default">{m.name}</span>
										<span className="block truncate text-xs text-text-subtle">{m.meta}</span>
									</span>
									{m.id === value && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
								</button>
							))}
						</fieldset>
					))}
				</div>
			)}
		</div>
	);
}

export function EffortSelect() {
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("Low");
	const ref = useOutsideClose(open, () => setOpen(false));

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={`${triggerCls} text-text-subtle`}
			>
				EFFORT <b className="font-semibold text-text-muted">{value}</b>
				<ChevronDown className="size-3.5" />
			</button>
			{open && (
				<div
					role="listbox"
					aria-label="Choose an effort level"
					className="animate-in fade-in slide-in-from-bottom-1 absolute bottom-[calc(100%+6px)] left-0 z-30 w-36 rounded-sm border border-border bg-container-card-bg p-1 duration-150"
				>
					{EFFORTS.map((e) => (
						<button
							key={e}
							type="button"
							role="option"
							aria-selected={e === value}
							onClick={() => {
								setValue(e);
								setOpen(false);
							}}
							className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-xs text-text-default transition-colors hover:bg-control-bg"
						>
							{e}
							{e === value && <Check className="size-3.5 text-primary" />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
