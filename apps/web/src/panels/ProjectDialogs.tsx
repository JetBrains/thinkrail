import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "../store";
import {
	createMockProject,
	DEFAULT_PARENT,
	MOCK_PARENTS,
	PROJECT_ACTIONS,
	projectSlug,
} from "./projectActions";

// Shared field styling (reused from the create-worktree / onboarding fields — no new tokens).
const LABEL = "text-muted text-xs uppercase tracking-wider";
const INPUT =
	"rounded-[var(--radius-sm)] border border-border2 bg-[var(--input-bg)] px-sm py-xs text-sm text-text outline-none transition-colors placeholder:text-hint focus:border-primary";
const CHIP =
	"rounded-[var(--radius-sm)] border border-border2 bg-[var(--input-bg)] px-sm py-xs font-[var(--font-mono)] text-sm text-text";

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
const label = (id: string) => PROJECT_ACTIONS.find((a) => a.id === id)?.label ?? "";

/** Mounts the open project-entry dialog (create / open-local / clone), all mocked. Store-driven so the
 * projects rail and Welcome both open them; each flow has its own distinct dialog. */
export function ProjectDialogs() {
	const kind = useAppStore((s) => s.projectDialog);
	const close = useAppStore((s) => s.closeProjectDialog);
	if (kind === "create") return <CreateProjectDialog onClose={close} />;
	if (kind === "open") return <OpenLocalProjectDialog onClose={close} />;
	if (kind === "clone") return <CloneFromGitHubDialog onClose={close} />;
	return null;
}

/** A small mocked "Choose folder" control that cycles the predefined parent folders (no native picker). */
function ChooseFolderButton({ onClick }: { onClick: () => void }) {
	return (
		<Button type="button" variant="outline" size="sm" data-testid="choose-folder" onClick={onClick}>
			Choose folder
		</Button>
	);
}

// ── Create new project ────────────────────────────────────────────────────────────────────────────
function CreateProjectDialog({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [parentIdx, setParentIdx] = useState(0);
	const [creating, setCreating] = useState(false);
	const nameRef = useRef<HTMLInputElement>(null);
	useEffect(() => void nameRef.current?.focus(), []);

	const parent = MOCK_PARENTS[parentIdx] ?? DEFAULT_PARENT;
	const folder = name.trim() ? projectSlug(name) : "my-project";
	const path = `${parent}/${folder}`;

	const submit = () => {
		if (!name.trim() || creating) return;
		setCreating(true);
		// MOCK: brief loading, then append + select (no host git init).
		setTimeout(() => {
			createMockProject(name.trim(), path);
			onClose();
		}, 500);
	};

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				data-testid="create-project-dialog"
				className="max-w-[520px] gap-md p-md"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					nameRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>{label("create")}</DialogTitle>
					<DialogDescription>
						Create a new local folder and initialize a git repository.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-xs">
					<label htmlFor="create-project-name" className={LABEL}>
						Project name
					</label>
					<input
						ref={nameRef}
						id="create-project-name"
						data-testid="project-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="my-project"
						spellCheck={false}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								submit();
							}
						}}
						className={INPUT}
					/>
				</div>

				<div className="flex flex-col gap-xs">
					<span className={LABEL}>Parent folder</span>
					<div className="flex items-center gap-sm">
						<div data-testid="project-parent" className={`min-w-0 flex-1 truncate ${CHIP}`}>
							{parent}
						</div>
						<ChooseFolderButton
							onClick={() => setParentIdx((i) => (i + 1) % MOCK_PARENTS.length)}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-xs">
					<span className={LABEL}>Resulting project path</span>
					<div data-testid="project-path" className={`truncate ${CHIP}`}>
						{path}
					</div>
				</div>

				<div className="flex justify-end">
					<Button
						type="button"
						data-testid="create-project-confirm"
						disabled={!name.trim() || creating}
						onClick={submit}
					>
						{creating ? <Loader2 className="size-4 animate-spin" /> : null}
						Create project
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ── Open local project ────────────────────────────────────────────────────────────────────────────
// MOCK folders the picker cycles; one is a non-git folder to exercise the init prompt.
const FIRST_FOLDER = { path: "~/code/thinkrail", git: true } as const;
const MOCK_FOLDERS: readonly { path: string; git: boolean }[] = [
	FIRST_FOLDER,
	{ path: "~/code/scratch", git: false },
	{ path: "~/projects/website", git: true },
];

function OpenLocalProjectDialog({ onClose }: { onClose: () => void }) {
	const [idx, setIdx] = useState(0);
	const [showInit, setShowInit] = useState(false);
	const [opening, setOpening] = useState(false);
	const selected = MOCK_FOLDERS[idx] ?? FIRST_FOLDER;

	const doOpen = () => {
		setOpening(true);
		setTimeout(() => {
			createMockProject(basename(selected.path), selected.path);
			onClose();
		}, 500);
	};
	// Git folders open straight away; a non-git folder shows the init prompt first.
	const submit = () => (selected.git ? doOpen() : setShowInit(true));

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent data-testid="open-project-dialog" className="max-w-[520px] gap-md p-md">
				<DialogHeader>
					<DialogTitle>{label("open")}</DialogTitle>
					<DialogDescription>Open an existing project folder from this computer.</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-xs">
					<span className={LABEL}>Selected folder</span>
					<div className="flex items-center gap-sm">
						<div data-testid="open-folder-path" className={`min-w-0 flex-1 truncate ${CHIP}`}>
							{selected.path}
						</div>
						<ChooseFolderButton
							onClick={() => {
								setIdx((i) => (i + 1) % MOCK_FOLDERS.length);
								setShowInit(false);
							}}
						/>
					</div>
				</div>

				{showInit ? (
					// MOCK non-git state (no project.inspect/init call).
					<div
						data-testid="open-init-prompt"
						className="flex flex-col gap-sm rounded-[var(--radius-md)] border border-border2 bg-elevated px-md py-sm"
					>
						<span className="text-sm text-text">This folder is not a git repository.</span>
						<span className="text-hint text-xs">
							ThinkRail can initialize a git repository in this folder.
						</span>
						<div className="flex justify-end gap-sm">
							<Button type="button" variant="outline" size="sm" onClick={() => setShowInit(false)}>
								Cancel
							</Button>
							<Button
								type="button"
								size="sm"
								data-testid="open-init-confirm"
								disabled={opening}
								onClick={doOpen}
							>
								{opening ? <Loader2 className="size-4 animate-spin" /> : null}
								Initialize and open
							</Button>
						</div>
					</div>
				) : (
					<div className="flex justify-end">
						<Button
							type="button"
							data-testid="open-project-confirm"
							disabled={opening}
							onClick={submit}
						>
							{opening ? <Loader2 className="size-4 animate-spin" /> : null}
							Open project
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ── Clone from GitHub ─────────────────────────────────────────────────────────────────────────────
/** Parse the repo name from a GitHub URL, or null if it doesn't look like one. */
function repoFromUrl(url: string): string | null {
	const m = url.trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
	return m?.[2] ?? null;
}

function CloneFromGitHubDialog({ onClose }: { onClose: () => void }) {
	const projects = useAppStore((s) => s.projects);
	const [url, setUrl] = useState("");
	const [parentIdx, setParentIdx] = useState(0);
	const [cloning, setCloning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const urlRef = useRef<HTMLInputElement>(null);
	useEffect(() => void urlRef.current?.focus(), []);

	const parent = MOCK_PARENTS[parentIdx] ?? DEFAULT_PARENT;
	const repo = repoFromUrl(url);
	const dest = repo ?? "repository";
	const path = `${parent}/${dest}`;
	const trimmed = url.trim();
	const invalid = trimmed.length > 0 && repo === null;
	const canClone = repo !== null && !cloning;

	const submit = () => {
		if (!canClone) return;
		setCloning(true);
		setError(null);
		// MOCK outcomes keyed off the (repo) name so every state is reviewable — no real clone.
		setTimeout(() => {
			if (repo === "existing" || projects.some((p) => p.name === repo)) {
				setError("A folder with this name already exists in the selected location.");
				setCloning(false);
			} else if (/fail/i.test(trimmed)) {
				setError("Couldn't clone this repository. Check the URL and try again.");
				setCloning(false);
			} else {
				createMockProject(repo, path);
				onClose();
			}
		}, 800);
	};

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent data-testid="clone-project-dialog" className="max-w-[520px] gap-md p-md">
				<DialogHeader>
					<DialogTitle>{label("clone")}</DialogTitle>
					<DialogDescription>Clone a GitHub repository into a local folder.</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-xs">
					<label htmlFor="clone-url" className={LABEL}>
						Repository URL
					</label>
					<input
						ref={urlRef}
						id="clone-url"
						data-testid="clone-url"
						value={url}
						onChange={(e) => {
							setUrl(e.target.value);
							setError(null);
						}}
						placeholder="https://github.com/owner/repository.git"
						spellCheck={false}
						className={`${INPUT} font-[var(--font-mono)]`}
					/>
					{invalid ? (
						<span data-testid="clone-invalid" className="text-red text-xs">
							Enter a valid GitHub repository URL.
						</span>
					) : null}
				</div>

				<div className="flex flex-col gap-xs">
					<span className={LABEL}>Clone to</span>
					<div className="flex items-center gap-sm">
						<div className={`min-w-0 flex-1 truncate ${CHIP}`}>{parent}</div>
						<ChooseFolderButton
							onClick={() => setParentIdx((i) => (i + 1) % MOCK_PARENTS.length)}
						/>
					</div>
					<span className="text-hint text-xs">
						Destination:{" "}
						<span data-testid="clone-path" className="font-[var(--font-mono)] text-muted">
							{path}
						</span>
					</span>
				</div>

				{error ? (
					<span data-testid="clone-error" className="text-red text-xs">
						{error}
					</span>
				) : null}

				<div className="flex justify-end gap-sm">
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" data-testid="clone-confirm" disabled={!canClone} onClick={submit}>
						{cloning ? <Loader2 className="size-4 animate-spin" /> : null}
						Clone repository
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
