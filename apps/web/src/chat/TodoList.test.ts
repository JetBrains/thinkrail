import { expect, test } from "bun:test";
import { glanceIcon } from "./TodoList";

test("only an actual pending question tells the user that an answer is required", () => {
	expect(glanceIcon("waiting_question").label).toBe("Waiting for your answer");
	expect(glanceIcon("waiting").label).toBe("Paused");
});
