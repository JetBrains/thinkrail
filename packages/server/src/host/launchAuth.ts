import { randomBytes, timingSafeEqual } from "node:crypto";
import { LAUNCH_AUTH_PATH, LAUNCH_TOKEN_PARAM } from "@thinkrail/contracts";

export interface LaunchAuthPolicy {
	token: string;
	host: string;
	port: number;
	extraOrigins: readonly string[];
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

export const createLaunchToken = () => randomBytes(32).toString("base64url");

export const launchPathFor = (token: string) =>
	`/?${LAUNCH_TOKEN_PARAM}=${encodeURIComponent(token)}`;

export const parseAllowedOrigins = (raw: string | undefined) =>
	(raw ?? "").split(",").flatMap((entry) => {
		const value = entry.trim();
		if (value === "") return [];
		try {
			const origin = new URL(value).origin;
			return origin === "null" ? [] : [origin];
		} catch {
			return [];
		}
	});

export const isLaunchProtectedPath = (pathname: string) =>
	pathname === "/ws" ||
	pathname === LAUNCH_AUTH_PATH ||
	pathname.startsWith("/files/") ||
	pathname.startsWith("/ext/");

const hostLiteral = (host: string) =>
	host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

const allowedOrigins = ({ host, port, extraOrigins }: LaunchAuthPolicy) => {
	const hosts = WILDCARD_HOSTS.has(host) ? LOOPBACK_HOSTS : [...LOOPBACK_HOSTS, hostLiteral(host)];
	return new Set([...hosts.map((name) => `http://${name}:${port}`), ...extraOrigins]);
};

export const isOriginAllowed = ({
	origin,
	requestHost,
	policy,
}: {
	origin: string | null;
	requestHost: string | null;
	policy: LaunchAuthPolicy;
}) => {
	if (origin === null) return true;
	if (allowedOrigins(policy).has(origin)) return true;
	return (
		WILDCARD_HOSTS.has(policy.host) &&
		requestHost !== null &&
		(origin === `http://${requestHost}` || origin === `https://${requestHost}`)
	);
};

export const isLaunchTokenValid = (expected: string, given: string | null) => {
	if (given === null) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(given);
	return a.length === b.length && timingSafeEqual(a, b);
};

export const checkLaunchAuth = (req: Request, url: URL, policy: LaunchAuthPolicy) => {
	const originOk = isOriginAllowed({
		origin: req.headers.get("origin"),
		requestHost: req.headers.get("host"),
		policy,
	});
	if (!originOk) return "foreign-origin" as const;
	return isLaunchTokenValid(policy.token, url.searchParams.get(LAUNCH_TOKEN_PARAM))
		? ("allowed" as const)
		: ("bad-token" as const);
};
