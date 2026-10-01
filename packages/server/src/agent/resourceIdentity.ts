const PI_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const HOST_RESOURCE_ID = /^[A-Za-z0-9_-]{1,200}$/;

export function isPiSessionId(value: unknown): value is string {
	return typeof value === "string" && PI_SESSION_ID.test(value);
}

export function isHostResourceId(value: unknown): value is string {
	return typeof value === "string" && HOST_RESOURCE_ID.test(value);
}
