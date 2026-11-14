import { expect, test } from "bun:test";
import { deviceMayRequest } from "./deviceAccess";

test("a read-only device may read chats but not prompt, change a model or reach an unknown method", () => {
	expect(deviceMayRequest("read", "session.getMessages")).toBe(true);
	expect(deviceMayRequest("read", "project.list")).toBe(true);
	expect(deviceMayRequest("read", "session.resources")).toBe(true);
	expect(deviceMayRequest("read", "skills.state")).toBe(true);
	expect(deviceMayRequest("read", "session.prompt")).toBe(false);
	expect(deviceMayRequest("read", "subagent.stop")).toBe(false);
	expect(deviceMayRequest("read", "session.setModel")).toBe(false);
	expect(deviceMayRequest("read", "workspace.markRead")).toBe(false);
	expect(deviceMayRequest("read", "fs.write")).toBe(false);
	expect(deviceMayRequest("write", "session.prompt")).toBe(true);
});
