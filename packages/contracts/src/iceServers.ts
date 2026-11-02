/**
 * Public STUN servers both peers use to learn their public address, so a phone off the host's network (mobile
 * data, another Wi‑Fi) can still reach it peer-to-peer without any ThinkRail server. No TURN yet: a symmetric
 * NAT or carrier-grade NAT still fails until a relay with TURN is deployed.
 */
export const PUBLIC_STUN_URLS: readonly string[] = [
	"stun:stun.l.google.com:19302",
	"stun:stun.cloudflare.com:3478",
];
