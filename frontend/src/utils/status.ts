/** Map session status to a display label and CSS class */
export function getStatusStyle(status: string): { label: string; cls: string } {
  switch (status) {
    case "draft":
      return { label: "Draft", cls: "badge-draft" };
    case "initializing":
      return { label: "Initializing", cls: "badge-initializing" };
    case "idle":
      return { label: "Idle", cls: "badge-idle" };
    case "running":
      return { label: "Running", cls: "badge-running" };
    case "waiting":
      return { label: "Waiting", cls: "badge-waiting" };
    case "interrupted":
      return { label: "Interrupted", cls: "badge-interrupted" };
    case "done":
      return { label: "Done", cls: "badge-done" };
    case "error":
      return { label: "Error", cls: "badge-error" };
    default:
      return { label: status, cls: "" };
  }
}
