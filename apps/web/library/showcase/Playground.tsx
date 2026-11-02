import { Switch } from "@thinkrail/ui/switch";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";
import { CodeBlock } from "../parts/CodeBlock";
import type { PlaygroundConfig, PlaygroundValues } from "./types";

function Choice({
	name,
	options,
	value,
	onChange,
}: {
	name: string;
	options: readonly string[];
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
			<legend className="mb-4 tr-text-eyebrow text-text-muted">{name}</legend>
			<div className="flex flex-wrap gap-2">
				{options.map((option) => (
					<ToggleSegment
						key={option}
						testid={`playground-${name}-${option}`}
						label={option}
						active={value === option}
						onClick={() => onChange(option)}
					/>
				))}
			</div>
		</fieldset>
	);
}

export function Playground({ config }: { config: PlaygroundConfig }) {
	const [values, setValues] = useState<PlaygroundValues>(config.initial);
	const set = (name: string, value: string | boolean) =>
		setValues((current) => ({ ...current, [name]: value }));
	const { Preview } = config;
	const flags = config.controls.filter((control) => control.kind === "flag");
	return (
		<div className="grid grid-cols-[minmax(0,1fr)] gap-16 rounded-sm border border-border-default p-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<div className="flex flex-col gap-12">
				{config.controls.map((control) =>
					control.kind === "choice" ? (
						<Choice
							key={control.name}
							name={control.name}
							options={control.options}
							value={String(values[control.name] ?? control.options[0] ?? "")}
							onChange={(value) => set(control.name, value)}
						/>
					) : null,
				)}
				{flags.length > 0 ? (
					<div className="flex flex-wrap gap-16">
						{flags.map((flag) => (
							<span key={flag.name} className="flex items-center gap-8 tr-text-ui">
								<Switch
									checked={values[flag.name] === true}
									label={flag.name}
									testId={`playground-${flag.name}`}
									onCheckedChange={(checked) => set(flag.name, checked)}
								/>
								{flag.name}
							</span>
						))}
					</div>
				) : null}
			</div>
			<div className="flex min-w-0 flex-col gap-12">
				<div className="flex min-h-[6rem] items-center justify-center overflow-x-auto rounded-sm border border-border-default bg-container-elevated-bg p-16">
					<Preview values={values} />
				</div>
				<CodeBlock code={config.code(values)} title="playground.tsx" />
			</div>
		</div>
	);
}
