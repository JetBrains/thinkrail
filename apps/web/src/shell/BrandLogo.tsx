import { BRAND_MARK_PATH, PRODUCT_NAME } from "../constants/branding";

export function BrandLogo() {
	return (
		<svg
			data-testid="brand-logo"
			role="img"
			aria-label={PRODUCT_NAME}
			width="32"
			height="32"
			viewBox="0 -53.5 557 557"
			className="size-[32px] shrink-0 text-primary"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path fill="currentColor" d={BRAND_MARK_PATH} />
		</svg>
	);
}
