import { cn, isAbsolutePath, projectRelativePath } from "@/lib";
import { hasUriScheme, workspaceFileTarget } from "../fileTargets";

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
		(candidate && !isAbsolutePath(candidate) && hasUriScheme(candidate)
			? candidate
			: projectRelativePath(candidate, workspaceRoot));
	const target = disabled ? null : workspaceFileTarget(candidate, workspaceRoot);
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
