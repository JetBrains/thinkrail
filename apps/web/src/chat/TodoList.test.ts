import { expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import { glanceIcon } from "./TodoList";

test("only an actual pending question tells the user that an answer is required", () => {
	const t = currentTranslator();
	expect(glanceIcon(t, "waiting_question").label).toBe("Needs your answer");
	expect(glanceIcon(t, "waiting").label).toBe("Paused");
});
