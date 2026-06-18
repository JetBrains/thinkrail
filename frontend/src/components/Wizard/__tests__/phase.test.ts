import { describe, it, expect } from "vitest";
import type { Session } from "@/types/session";
import { derivePhase } from "../phase";

const sessionWith = (status: Session["status"]): Session =>
  ({ status }) as unknown as Session;

describe("derivePhase", () => {
  it("returns pre-chat when there is no session", () => {
    expect(derivePhase({ session: null })).toBe("pre-chat");
    expect(derivePhase({ session: undefined })).toBe("pre-chat");
  });

  it("routes a completed (done) session to the done-screen", () => {
    expect(derivePhase({ session: sessionWith("done") })).toBe("done-screen");
  });

  it("routes an errored session to the done-screen", () => {
    expect(derivePhase({ session: sessionWith("error") })).toBe("done-screen");
  });

  it("keeps a session in any non-terminal state running", () => {
    expect(derivePhase({ session: sessionWith("running") })).toBe("running");
    expect(derivePhase({ session: sessionWith("idle") })).toBe("running");
    expect(derivePhase({ session: sessionWith("waiting") })).toBe("running");
  });
});
