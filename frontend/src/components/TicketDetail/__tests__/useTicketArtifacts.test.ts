import { describe, it, expect } from "vitest";
import { deriveTicketArtifacts } from "@/components/TicketDetail/useTicketArtifacts.ts";
import type { Ticket } from "@/types/board.ts";

function makeTicket(o: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    title: "x",
    status: "implementing",
    productDesignPath: null,
    technicalDesignPath: null,
    historyPath: null,
    implementationPlanPath: null,
    skippedPhases: [],
    ...o,
  } as unknown as Ticket;
}

describe("deriveTicketArtifacts", () => {
  it("returns empty when no artifacts present", () => {
    const r = deriveTicketArtifacts(makeTicket(), null, 0, []);
    expect(r).toEqual([]);
  });

  it("includes canonical artifacts in phase order", () => {
    const t = makeTicket({
      productDesignPath: "pd.md",
      technicalDesignPath: "td.md",
      implementationPlanPath: "impl.md",
    });
    const r = deriveTicketArtifacts(t, null, 0, []);
    const kinds = r.map((a) => (a.kind === "canonical" ? a.artifact : a.kind));
    expect(kinds).toEqual(["product_design", "technical_design", "plan"]);
  });

  it("includes history when entries > 0", () => {
    const r = deriveTicketArtifacts(makeTicket(), null, 3, []);
    expect(r.find((a) => a.kind === "history")).toBeDefined();
  });

  it("dedupes session-touched files against canonical paths", () => {
    const t = makeTicket({ productDesignPath: "pd.md" });
    const sessionFiles = [{ path: "pd.md" }, { path: "notes.md" }];
    const r = deriveTicketArtifacts(t, null, 0, sessionFiles);
    const files = r.filter((a) => a.kind === "file");
    expect(files.length).toBe(1);
    expect(files[0]).toMatchObject({ kind: "file", filePath: "notes.md" });
  });

  it("uses plan kind for implementation_plan path (no canonical duplicate)", () => {
    const t = makeTicket({ implementationPlanPath: "impl.md" });
    const r = deriveTicketArtifacts(t, null, 0, []);
    expect(r.find((a) => a.kind === "plan")).toBeDefined();
    const canonicals = r.filter((a) => a.kind === "canonical");
    expect(
      canonicals.find((a: any) => a.artifact === "implementation_plan"),
    ).toBeUndefined();
  });

  it("dedupes session-touched files by suffix match", () => {
    const t = makeTicket({ productDesignPath: "/abs/path/pd.md" });
    const sessionFiles = [{ path: "pd.md" }];
    const r = deriveTicketArtifacts(t, null, 0, sessionFiles);
    expect(r.filter((a) => a.kind === "file")).toEqual([]);
  });
});
