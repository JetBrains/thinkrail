export function SiteFooter() {
	return (
		<footer className="bg-background">
			<div className="mx-auto max-w-[1200px] px-6">
				<div className="border-t border-border-muted py-6 text-[13.2px] text-text-muted">
					<span>
						Copyright © 2026{" "}
						<a
							href="https://www.jetbrains.com"
							target="_blank"
							rel="noreferrer"
							className="text-text-default underline underline-offset-2 transition-colors hover:text-primary"
						>
							JetBrains
						</a>{" "}
						InnovationHub
						<span className="hidden sm:inline"> · Apache License 2.0</span>
					</span>
					<span className="block sm:hidden">Apache License 2.0</span>
				</div>
			</div>
		</footer>
	);
}
