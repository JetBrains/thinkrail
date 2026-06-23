/** Map session status to a display label and CSS class */
export function getStatusStyle(status: string): { label: string; cls: string } {
  switch (status) {
    case "draft":
      return { label: "Draft", cls: "badge-draft" };
    case "idle":
      return { label: "Idle", cls: "badge-idle" };
    case "running":
      return { label: "Running", cls: "badge-running" };
    case "waiting":
      return { label: "Waiting", cls: "badge-waiting" };
    case "initializing":
      return { label: "Initializing", cls: "badge-draft" };
    case "done":
      return { label: "Done", cls: "badge-done" };
    case "error":
      return { label: "Error", cls: "badge-error" };
    case "interrupted":
      return { label: "Interrupted", cls: "badge-idle" };
    default:
      return { label: status, cls: "" };
  }
}
