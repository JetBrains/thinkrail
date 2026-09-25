import { cn, remixicon, ui, useAction } from "@thinkrail/ext/view";
import { type FormEvent, useState } from "react";
import { useRules } from "./hooks";
import {
	type CheckResult,
	type GuardTool,
	isAddResult,
	isCheckResult,
	type RuleAction,
	type RuleTarget,
} from "./model";
import { Empty, RuleRow, Segmented } from "./parts";

const { RiAddLine, RiPlayLine } = remixicon;

const TARGET_OPTIONS = [
	{ value: "bash", label: "bash" },
	{ value: "path", label: "path" },
] as const satisfies readonly { value: RuleTarget; label: string }[];

const ACTION_OPTIONS = [
	{ value: "block", label: "block" },
	{ value: "allow", label: "allow" },
] as const satisfies readonly { value: RuleAction; label: string }[];

const TRY_OPTIONS = [
	{ value: "bash", label: "bash" },
	{ value: "write", label: "write" },
] as const satisfies readonly { value: GuardTool; label: string }[];

const PLACEHOLDER: Record<RuleTarget, string> = {
	bash: "regex, e.g. ^npm publish",
	path: "glob, e.g. **/secrets/** or *.pem",
};

const Label = ({ children }: { children: string }) => (
	<span className="tr-text-metadata text-text-subtle">{children}</span>
);

const AddRule = () => {
	const add = useAction("addRule");
	const [target, setTarget] = useState<RuleTarget>("bash");
	const [action, setAction] = useState<RuleAction>("block");
	const [pattern, setPattern] = useState("");
	const [note, setNote] = useState("");
	const [error, setError] = useState<string>();
	const submit = (event: FormEvent) => {
		event.preventDefault();
		void add({ target, action, pattern, note })
			.then((result) => {
				if (!isAddResult(result)) return setError("Unexpected reply.");
				if (!result.ok) return setError(result.error);
				setError(undefined);
				setPattern("");
				setNote("");
			})
			.catch((reason: unknown) => setError(String(reason)));
	};
	return (
		<form
			data-testid="tool-guard-add"
			onSubmit={submit}
			className="flex flex-col gap-8 border-b border-border-muted px-12 py-12"
		>
			<div className="flex flex-wrap items-center gap-8">
				<Label>New rule</Label>
				<span className="ml-auto" />
				<Segmented
					options={TARGET_OPTIONS}
					value={target}
					onChange={setTarget}
					testId="tool-guard-add-target"
				/>
				<Segmented
					options={ACTION_OPTIONS}
					value={action}
					onChange={setAction}
					testId="tool-guard-add-action"
				/>
			</div>
			<ui.Input
				data-testid="tool-guard-add-pattern"
				aria-label="Pattern"
				className="tr-code-text"
				placeholder={PLACEHOLDER[target]}
				value={pattern}
				onChange={(event) => setPattern(event.target.value)}
			/>
			<div className="flex items-center gap-8">
				<ui.Input
					data-testid="tool-guard-add-note"
					aria-label="Why"
					placeholder="Why (shown to the agent)"
					value={note}
					onChange={(event) => setNote(event.target.value)}
				/>
				<ui.Button
					type="submit"
					size="sm"
					data-testid="tool-guard-add-submit"
					disabled={!pattern.trim()}
				>
					<RiAddLine className="size-14" /> Add
				</ui.Button>
			</div>
			{error && (
				<p data-testid="tool-guard-add-error" className="tr-text-metadata text-feedback-error">
					{error}
				</p>
			)}
		</form>
	);
};

const TryResult = ({ result }: { result: CheckResult }) => {
	if (result.verdict === "error")
		return <p className="tr-text-metadata text-feedback-error">{result.error}</p>;
	const blocked = result.verdict === "block";
	return (
		<p
			data-testid="tool-guard-try-result"
			data-verdict={result.verdict}
			className={cn("tr-text-metadata", blocked ? "text-feedback-error" : "text-feedback-success")}
		>
			{blocked ? "Blocked" : "Allowed"}
			<span className="text-text-muted">
				{result.rule ? ` by "${result.rule.label}"` : " (no rule matched)"}
			</span>
		</p>
	);
};

const TryBox = () => {
	const check = useAction("check");
	const [tool, setTool] = useState<GuardTool>("bash");
	const [input, setInput] = useState("");
	const [result, setResult] = useState<CheckResult>();
	const submit = (event: FormEvent) => {
		event.preventDefault();
		void check({ tool, input })
			.then((value) =>
				setResult(isCheckResult(value) ? value : { verdict: "error", error: "Unexpected reply." }),
			)
			.catch((reason: unknown) => setResult({ verdict: "error", error: String(reason) }));
	};
	return (
		<form
			data-testid="tool-guard-try"
			onSubmit={submit}
			className="flex flex-col gap-8 border-b border-border-muted px-12 py-12"
		>
			<div className="flex items-center gap-8">
				<Label>Try a call</Label>
				<span className="ml-auto" />
				<Segmented
					options={TRY_OPTIONS}
					value={tool}
					onChange={(value) => {
						setTool(value);
						setResult(undefined);
					}}
					testId="tool-guard-try-tool"
				/>
			</div>
			<div className="flex items-center gap-8">
				<ui.Input
					data-testid="tool-guard-try-input"
					aria-label="Command or path"
					className="tr-code-text"
					placeholder={tool === "bash" ? "git push --force origin main" : ".env.local"}
					value={input}
					onChange={(event) => {
						setInput(event.target.value);
						setResult(undefined);
					}}
				/>
				<ui.Button
					type="submit"
					variant="outline"
					size="sm"
					data-testid="tool-guard-try-submit"
					disabled={!input.trim()}
				>
					<RiPlayLine className="size-14" /> Try
				</ui.Button>
			</div>
			{result && <TryResult result={result} />}
		</form>
	);
};

export const RulesEditor = () => {
	const rules = useRules();
	const toggle = useAction("toggleRule");
	const remove = useAction("removeRule");
	return (
		<div data-testid="tool-guard-rules" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<AddRule />
			<TryBox />
			<div className="flex items-center gap-8 px-12 pt-12 pb-4">
				<Label>First match wins, top to bottom</Label>
			</div>
			{rules.length === 0 ? (
				<Empty title="No rules" detail="Rules load with the extension." />
			) : (
				<ul>
					{rules.map((rule) => (
						<RuleRow
							key={rule.id}
							rule={rule}
							onToggle={() => void toggle({ id: rule.id }).catch(() => {})}
							onRemove={() => void remove({ id: rule.id }).catch(() => {})}
						/>
					))}
				</ul>
			)}
		</div>
	);
};
