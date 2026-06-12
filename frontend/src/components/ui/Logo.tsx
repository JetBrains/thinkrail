import logoSvg from "@/assets/logo-thinkrail.svg";
import { PRODUCT_NAME } from "@/constants/branding";

interface LogoProps {
  /** Class applied to the <img>. Defaults to the header sizing class. */
  className?: string;
}

/** The product wordmark logo (SVG). Sizing comes from the applied class. */
export function Logo({ className = "header-logo" }: LogoProps) {
  return <img src={logoSvg} alt={PRODUCT_NAME} className={className} />;
}
