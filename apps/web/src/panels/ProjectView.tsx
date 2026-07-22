import { ChevronDown, Lock } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "../store";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { projectAvatarColor } from "./projectAvatar";

// Heavy editor loads only when the view is shown (matches FilePane).
const MonacoEditor = lazy(() => import("./MonacoEditor"));

/**
 * MOCK project files for the read-only view — a hardcoded stand-in for host-side repo reading (there is
 * no real fs/wire call here; see task-project-readonly-view). Replace with a real read when the
 * project-main-branch read lands host-side.
 */
function mockProjectFiles(projectName: string): { path: string; content: string }[] {
	return [
		{
			path: "README.md",
			content: `# ${projectName}\n\nMock read-only preview of the project's main branch.\n\nWork happens in isolated worktrees — use **Edit → Edit in new worktree** to make changes.\n`,
		},
		{
			path: "src/index.ts",
			content:
				"// Mock file (read-only preview)\nexport function main(): void {\n\tconsole.log('hello from the main branch');\n}\n",
		},
		{
			path: "package.json",
			content: `{\n  "name": "${projectName}",\n  "version": "0.0.0",\n  "private": true\n}\n`,
		},
	];
}

/**
 * The read-only **project view**: opens when a project is selected (its main branch), shown view-only so
 * work is guided into isolated worktrees. Header = avatar + name + a "Read-only · main" lock badge + an
 * **Edit** dropdown (new worktree / inline). Body = a mock file list + a read-only Monaco. Trying to type
 * while read-only surfaces a soft-edit hint instead of silently dropping the keystroke. The contextual
 * right rail (Specs/All files/Scripts/Hooks) is mounted beside it by the shell; terminals are worktree-
 * scoped, so none here. Frontend-only; file data is mocked.
 */
export function ProjectView({ projectId }: { projectId: string }) {
	const projectName = useAppStore(
		(s) => s.projects.find((p) => p.id === projectId)?.name ?? projectId,
	);
	const files = mockProjectFiles(projectName);
	const [activePath, setActivePath] = useState(files[0]?.path ?? "");
	const [readOnly, setReadOnly] = useState(true);
	const [hintOpen, setHintOpen] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const active = files.find((f) => f.path === activePath) ?? files[0];

	// A keystroke in the read-only editor: flash the soft-edit hint (auto-dismissing) rather than swallow it.
	const onReadOnlyEdit = () => {
		setHintOpen(true);
		if (hintTimer.current) clearTimeout(hintTimer.current);
		hintTimer.current = setTimeout(() => setHintOpen(false), 4000);
	};

	const enableInlineEdit = () => {
		setReadOnly(false);
		setHintOpen(false);
	};

	return (
		<div data-testid="project-view" className="flex h-full min-h-0 flex-col bg-surface-content">
			<header className="flex h-[48px] shrink-0 items-center justify-between gap-md border-border2 border-b px-lg">
				<div className="flex min-w-0 items-center gap-sm">
					<div
						aria-hidden
						className={`size-5 shrink-0 rounded-[var(--radius-sm)] ${projectAvatarColor(projectId)}`}
					/>
					<span className="truncate font-medium text-sm text-text">{projectName}</span>
					{readOnly ? (
						<span
							data-testid="readonly-badge"
							className="inline-flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] border border-border2 px-xs py-0.5 text-hint text-xs"
						>
							<Lock className="size-3" />
							Read-only · main
						</span>
					) : null}
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size="sm" data-testid="project-edit" aria-label="Edit">
							Edit
							<ChevronDown className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-[16rem]">
						<DropdownMenuItem data-testid="edit-new-worktree" onSelect={() => setDialogOpen(true)}>
							<span>Edit in new worktree</span>
							<span className="ml-auto text-hint text-xs">Recommended</span>
						</DropdownMenuItem>
						<DropdownMenuItem data-testid="edit-inline" onSelect={enableInlineEdit}>
							<span>Edit inline here</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</header>

			<div className="flex min-h-0 flex-1">
				<aside className="w-56 shrink-0 overflow-auto border-border2 border-r">
					<div className="px-sm py-xs text-hint text-xs uppercase tracking-wider">Files (mock)</div>
					<ul className="flex flex-col">
						{files.map((file) => (
							<li key={file.path}>
								<button
									type="button"
									data-testid="project-file"
									data-active={file.path === activePath}
									onClick={() => setActivePath(file.path)}
									className={`w-full truncate px-sm py-xs text-left text-sm ${file.path === activePath ? "bg-hover text-text" : "text-muted hover:bg-hover"}`}
								>
									{file.path}
								</button>
							</li>
						))}
					</ul>
				</aside>
				<div className="relative min-h-0 flex-1">
					<Suspense
						fallback={
							<div className="flex h-full items-center justify-center text-hint">
								Loading editor…
							</div>
						}
					>
						<MonacoEditor
							key={active?.path}
							path={active?.path ?? "untitled"}
							content={active?.content ?? ""}
							readOnly={readOnly}
							onReadOnlyEdit={onReadOnlyEdit}
						/>
					</Suspense>
					{hintOpen ? (
						<div
							data-testid="readonly-hint"
							className="-translate-x-1/2 absolute top-md left-1/2 z-10 flex items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-elevated px-md py-sm text-text text-xs shadow-[var(--shadow-md)]"
						>
							<span>Editing the main branch is off. Work in a workspace instead.</span>
							<button
								type="button"
								data-testid="hint-new-worktree"
								onClick={() => setDialogOpen(true)}
								className="shrink-0 rounded-[var(--radius-sm)] border border-border2 bg-hover px-sm py-0.5 text-text hover:bg-elevated"
							>
								New worktree
							</button>
						</div>
					) : null}
				</div>
			</div>

			{dialogOpen ? (
				<NewWorkspaceDialog
					open
					projectId={projectId}
					onOpenChange={setDialogOpen}
					onCreated={() => {
						/* the dialog activates the new workspace + closes itself; the shell then swaps to it */
					}}
				/>
			) : null}
		</div>
	);
}
