import { cn, isAbsolutePath, projectRelativePath } from "@/lib";

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function toolFileTarget(path: string, workspaceRoot?: string | undefined): string | null {
	const candidate = path.trim();
	if (!candidate) return null;
	if (!isAbsolutePath(candidate) && URI_SCHEME.test(candidate)) return null;
	const relative = projectRelativePath(candidate, workspaceRoot);
	if (!relative || isAbsolutePath(relative) || relative === ".." || relative.startsWith("../")) {
		return null;
	}
	return relative;
}

export function ToolFileLink({
	path,
	workspaceRoot,
	onOpenFile,
	disabled = false,
	className,
	label,
}: {
	path: string;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	disabled?: boolean;
	className?: string;
	label?: string;
}) {
	const candidate = path.trim();
	const displayPath =
		label ??
		(candidate && !isAbsolutePath(candidate) && URI_SCHEME.test(candidate)
			? candidate
			: projectRelativePath(candidate, workspaceRoot));
	const target = disabled ? null : toolFileTarget(candidate, workspaceRoot);
	if (!target || !onOpenFile) {
		return (
			<span
				data-testid="tool-file-reference"
				className={cn("min-w-0 truncate", className)}
				title={path}
			>
				{displayPath}
			</span>
		);
	}
	return (
		<button
			type="button"
			data-testid="tool-file-link"
			data-path={target}
			title={path}
			onClick={() => onOpenFile(target)}
			className={cn(
				"min-w-0 cursor-pointer truncate rounded-[var(--radius-xs)] text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary",
				className,
			)}
		>
			{displayPath}
		</button>
	);
}
