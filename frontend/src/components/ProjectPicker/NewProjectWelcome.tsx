import { useCallback, useState } from "react";
import { ArrowRight } from "lucide-react";
import { browseFolder } from "@/services/fs.ts";
import { FormField, FormHeading, TextInput, Textarea, PathInput, FileAttach, Button, type AttachedFile } from "@/components/ui";
import { Header } from "@/components/AppShell/Header";
import { getWizardConfig } from "@/components/Wizard/registry";
import { derivePhase } from "@/components/Wizard/phase";
import { PRODUCT_NAME } from "@/constants/branding";
import "../Wizard/NewProjectForm.css";
import "../AppShell/AppShell.css";

const CHAIN_ID = "new-project";

interface NewProjectWelcomeProps {
  onCancel: () => void;
  onContinue: (data: { name: string; location: string; description: string; attachedFile: AttachedFile | null }) => void;
}

export function NewProjectWelcome({ onCancel, onContinue }: NewProjectWelcomeProps) {
  const [sessionName, setSessionName] = useState("");
  const [location, setLocation] = useState("");
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [nameError, setNameError] = useState(false);

  const handleBrowse = useCallback(async () => {
    try {
      const data = await browseFolder();
      if (data?.path) {
        setLocation(data.path);
      }
    } catch {
      // user cancelled
    }
  }, []);

  const handleNext = useCallback(() => {
    const name = sessionName.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    if (!input.trim() && !attachedFile) return;

    onContinue({
      name,
      location: location || "~/",
      description: input,
      attachedFile,
    });
  }, [sessionName, location, input, attachedFile, onContinue]);

  const canSubmit = !!sessionName.trim() && (!!input.trim() || !!attachedFile);

  const formStepperSteps =
    getWizardConfig(CHAIN_ID, derivePhase({ session: null }))?.steps ?? [];

  return (
    <>
      <Header
        onSwitchProject={onCancel}
        variant="wizard"
        wizardSteps={formStepperSteps}
      />
      <div className="np-form-screen">
      <div className="np-form">
        <FormHeading
          title="Describe Your Project"
          subtitle={<>{PRODUCT_NAME} will help shape your idea into a clear<br />Goal &amp; Requirements document.</>}
        />

        <div className="np-form-fields">
          <FormField label="Project name" error={nameError ? "Please enter a project name" : undefined}>
            <TextInput
              placeholder="e.g. inventory service"
              value={sessionName}
              error={nameError}
              onChange={(e) => { setSessionName(e.target.value); setNameError(false); }}
              maxLength={80}
              required
            />
          </FormField>

          <FormField label="Location">
            <PathInput
              value={location}
              onChange={setLocation}
              placeholder="choose a root folder"
              onBrowse={handleBrowse}
            />
          </FormField>

          <FormField label="Description">
            <div className="np-form-textarea-wrap">
              <Textarea
                placeholder="describe your project idea, goals, or attach a document below"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={6}
              />
            </div>
          </FormField>

          <FileAttach attachedFile={attachedFile} onAttach={setAttachedFile} />
        </div>

        <div className="np-form-actions">
          <Button variant="cancel" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleNext}
            disabled={!canSubmit}
            type="button"
            trailingIcon={<ArrowRight size={16} strokeWidth={1.5} className="np-form-btn-icon" />}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}
