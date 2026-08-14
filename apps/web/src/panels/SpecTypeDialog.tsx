import type { SpecTypeInfo } from "@thinkrail/contracts";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/store";
import { errorText, getTransport } from "@/transport";

const INPUT_CLASS =
	"w-full rounded-[var(--radius-md)] border border-control-border-default bg-control-bg px-md py-sm tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary-soft disabled:bg-control-disabled-bg disabled:text-control-disabled-text";

/** Mirrors the server's card-name rule (`saveTypeCard`): the slug doubles as filename and `type` value. */
const CARD_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Quote a YAML scalar when it would otherwise mis-parse (colons, leading specials, quotes). */
function yamlScalar(value: string): string {
	if (/^[A-Za-z0-9][^:#]*$/.test(value) && !value.endsWith(" ")) return value;
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Build the type-card markdown from the form's fields — the same text the preview shows and Save writes. */
export function buildTypeCardMarkdown(fields: {
	name: string;
	title: string;
	description: string;
	lifecycle: "durable" | "ephemeral";
	home: string;
	sections: string[];
	statuses: string[];
	body: string;
}): string {
	const lines = ["---", `name: ${fields.name}`];
	if (fields.title !== "") lines.push(`title: ${yamlScalar(fields.title)}`);
	lines.push(`description: ${yamlScalar(fields.description)}`);
	lines.push(`lifecycle: ${fields.lifecycle}`);
	if (fields.home !== "") lines.push(`home: ${yamlScalar(fields.home)}`);
	if (fields.sections.length > 0)
		lines.push(`sections: [${fields.sections.map(yamlScalar).join(", ")}]`);
	if (fields.statuses.length > 0)
		lines.push(`statuses: [${fields.statuses.map(yamlScalar).join(", ")}]`);
	lines.push("---", "");
	const body = fields.body.trim();
	if (body !== "") lines.push(body, "");
	return lines.join("\n");
}

function Field({
	id,
	label,
	hint,
	children,
}: {
	id: string;
	label: string;
	/** The inline explanation — the form is the guidance for what each card field means. */
	hint: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-xs tr-text-ui">
			<label htmlFor={id} className="tr-text-emphasis text-text-default">
				{label}
			</label>
			<p className="tr-text-metadata text-text-muted">{hint}</p>
			{children}
		</div>
	);
}

/**
 * The **type constructor**: a guided form that authors a project spec-type card and saves it as
 * `.pi/spec-types/<name>.md` via the scoped `spec.saveTypeCard` command. Prototype-grade by design —
 * the field hints carry the card schema's meaning (the form is the guidance), and a live preview shows
 * the exact markdown that will be written. Creation-only in P1: an existing project card is edited as a
 * file (or superseded by saving the same name again — the server overwrites).
 */
export function SpecTypeDialog({
	open,
	workspaceId,
	existing,
	onOpenChange,
}: {
	open: boolean;
	workspaceId: string;
	/** Already-registered types, to warn before overriding a name. */
	existing: SpecTypeInfo[];
	onOpenChange: (open: boolean) => void;
}) {
	const [name, setName] = useState("");
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [lifecycle, setLifecycle] = useState<"durable" | "ephemeral">("durable");
	const [home, setHome] = useState("");
	const [sectionsText, setSectionsText] = useState("");
	const [statusesText, setStatusesText] = useState("");
	const [body, setBody] = useState("");
	const [saving, setSaving] = useState(false);

	const sections = sectionsText
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	const statuses = statusesText
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	// Computed per render (cheap string build; the input arrays are fresh each render anyway).
	const preview = buildTypeCardMarkdown({
		name,
		title,
		description,
		lifecycle,
		home,
		sections,
		statuses,
		body,
	});
	const nameTaken = existing.find((t) => t.name === name);
	const valid = CARD_NAME.test(name) && description.trim() !== "";

	const save = async () => {
		setSaving(true);
		try {
			await getTransport().request("spec.saveTypeCard", { workspaceId, name, content: preview });
			toast.success(`Spec type "${name}" saved to .pi/spec-types/`);
			onOpenChange(false);
		} catch (err) {
			toast.error(errorText(err, "Couldn't save the type card."));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="spec-type-dialog" className="max-w-[44rem] gap-md">
				<DialogHeader>
					<DialogTitle>New spec type</DialogTitle>
					<DialogDescription>
						A type card teaches agents (and people) what this kind of spec is for and what it should
						contain. Saved to this project's <code className="tr-code-text">.pi/spec-types/</code> —
						committed, shared with the team, and it wins over a built-in of the same name.
					</DialogDescription>
				</DialogHeader>

				<div className="flex max-h-[60vh] flex-col gap-md overflow-y-auto pr-xs">
					<Field
						id="spec-type-name"
						label="Name"
						hint="The slug specs carry in their `type` frontmatter — lowercase, hyphens (e.g. runbook, decision)."
					>
						<input
							id="spec-type-name"
							data-testid="spec-type-name-input"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="runbook"
							spellCheck={false}
							className={INPUT_CLASS}
						/>
						{nameTaken ? (
							<p className="tr-text-metadata text-feedback-warning">
								“{name}” is already registered ({nameTaken.origin}) — saving overrides it for this
								project.
							</p>
						) : null}
					</Field>

					<Field
						id="spec-type-description"
						label="Description"
						hint="1–2 sentences: what the type is for and when to choose it. This is what agents read when picking a type."
					>
						<input
							id="spec-type-description"
							data-testid="spec-type-description-input"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Operational steps for one recurring situation."
							className={INPUT_CLASS}
						/>
					</Field>

					<div className="flex flex-col gap-xs">
						<span className="tr-text-emphasis text-text-default">Lifecycle</span>
						<p className="tr-text-metadata text-text-muted">
							Durable specs are ground truth, kept honest as code changes. Ephemeral specs serve one
							piece of work and retire when it lands (their decisions get promoted into durable
							specs).
						</p>
						<div className="flex gap-sm">
							{(["durable", "ephemeral"] as const).map((value) => (
								<Button
									key={value}
									type="button"
									variant={lifecycle === value ? "outline" : "ghost"}
									size="sm"
									aria-pressed={lifecycle === value}
									data-testid={`spec-type-lifecycle-${value}`}
									onClick={() => setLifecycle(value)}
								>
									{value}
								</Button>
							))}
						</div>
					</div>

					<Field
						id="spec-type-title"
						label="Title (optional)"
						hint="Display name; falls back to the slug."
					>
						<input
							id="spec-type-title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Runbook"
							className={INPUT_CLASS}
						/>
					</Field>

					<Field
						id="spec-type-home"
						label="Home (optional)"
						hint="Default location hint for specs of this type — a default, never enforced (e.g. docs/runbooks/)."
					>
						<input
							id="spec-type-home"
							value={home}
							onChange={(e) => setHome(e.target.value)}
							placeholder="docs/runbooks/"
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<Field
						id="spec-type-sections"
						label="Expected sections (optional)"
						hint="One heading per line. New specs of this type scaffold these headings; checks stay advisory."
					>
						<Textarea
							id="spec-type-sections"
							data-testid="spec-type-sections-input"
							value={sectionsText}
							onChange={(e) => setSectionsText(e.target.value)}
							placeholder={"Situation\nSteps"}
							rows={3}
							spellCheck={false}
						/>
					</Field>

					<Field
						id="spec-type-statuses"
						label="Statuses (optional)"
						hint="Comma-separated status vocabulary for this type; empty keeps the global draft/active/stale/done/deprecated."
					>
						<input
							id="spec-type-statuses"
							value={statusesText}
							onChange={(e) => setStatusesText(e.target.value)}
							placeholder="proposed, accepted, superseded"
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<Field
						id="spec-type-body"
						label="Guidance (the card's body)"
						hint="Free prose agents read before authoring: when to use it (and when not), the quality bar, and optionally a `## Template` block that scaffolding prefers over the sections."
					>
						<Textarea
							id="spec-type-body"
							data-testid="spec-type-body-input"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder={
								"Use when …\n\n## Quality bar\n- …\n\n## Template\n\n```markdown\n## Situation\n\n## Steps\n```"
							}
							rows={6}
							spellCheck={false}
						/>
					</Field>

					<div className="flex flex-col gap-xs">
						<span className="tr-text-emphasis text-text-default">Preview</span>
						<pre
							data-testid="spec-type-preview"
							className="max-h-48 overflow-auto rounded-[var(--radius-md)] border border-control-border-default bg-container-elevated-bg p-md tr-code-text-small text-text-muted"
						>
							{preview}
						</pre>
					</div>
				</div>

				<div className="flex justify-end gap-sm">
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="button"
						data-testid="spec-type-save"
						disabled={!valid || saving}
						onClick={() => void save()}
					>
						{saving ? "Saving…" : "Save type card"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
