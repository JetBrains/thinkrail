import { useEffect, useRef } from "react";
import { useUiStore, type PendingNewProject } from "@/store/uiStore";
import { useStartWizardStep } from "./useStartWizardStep";
import { NEW_PROJECT_CHAIN, NEW_PROJECT_SKILL, composeNewProjectKick } from "./newProjectKick";
import { NewProjectForm } from "./NewProjectForm";
import { FullScreenLayout } from "./FullScreenLayout";
import { PRODUCT_NAME } from "@/constants/branding";

/**
 * Pre-chat entry for the new-project chain (projectState === "new").
 *
 * Primary path: the idea was collected in the picker before navigation and
 * stashed in `pendingNewProject`; here — now that the project path and RPC
 * exist — we auto-start the session and clear the carry.
 *
 * Fallback: no carry (e.g. the user opened an empty existing folder) — render
 * the description form in "start" mode.
 */
export function NewProjectPreChat() {
  const pending = useUiStore((s) => s.pendingNewProject);
  if (pending) return <NewProjectAutoStart carry={pending} />;
  return <NewProjectForm mode="start" />;
}

function NewProjectAutoStart({ carry }: { carry: PendingNewProject }) {
  const startWizardStep = useStartWizardStep();
  const setProjectState = useUiStore((s) => s.setProjectState);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const setCurrentChain = useUiStore((s) => s.setCurrentChain);
  const setPendingNewProject = useUiStore((s) => s.setPendingNewProject);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setCurrentChain("new-project");
    setProjectState("initialized");
    setCenterView("sessions");
    startWizardStep({
      skillId: NEW_PROJECT_SKILL,
      chainId: NEW_PROJECT_CHAIN,
      name: carry.name,
      kick: composeNewProjectKick(carry),
    })
      .catch(() => setProjectState("new"))
      .finally(() => setPendingNewProject(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FullScreenLayout>
      <div className="np-form-header">
        <h2 className="np-form-h2">Starting…</h2>
        <p className="np-form-lead">{PRODUCT_NAME} is setting up your project.</p>
      </div>
    </FullScreenLayout>
  );
}
