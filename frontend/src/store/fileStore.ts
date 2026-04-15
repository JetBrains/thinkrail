import { create } from "zustand";
import { readFile, writeFile, openExternal as openExternalFile } from "@/services/files.ts";
import { useUiStore } from "./uiStore.ts";


export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  mode: "preview" | "edit";
  isDirty: boolean;
  saving: boolean;
  error?: string;
}

interface FileStore {
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;
  previewFilePath: string | null;
  previewFile: OpenFile | null;

  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  activateFile: (path: string) => void;
  loadPreview: (path: string) => Promise<void>;
  clearPreview: () => void;
  pinPreview: () => void;
  setMode: (path: string, mode: "preview" | "edit") => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  openExternal: (path: string, editor: string) => Promise<void>;
  onFileChanged: (path: string) => void;
  unload: () => void;
}

function getProjectPath(): string {
  return useUiStore.getState().projectPath ?? "";
}

export const useFileStore = create<FileStore>((set, get) => ({
  openFiles: new Map(),
  activeFilePath: null,
  previewFilePath: null,
  previewFile: null,

  openFile: async (path) => {
    // Already open — just activate
    if (get().openFiles.has(path)) {
      set({ activeFilePath: path });
      return;
    }

    const project = getProjectPath();
    if (!project) return;

    try {
      const data = await readFile(project, path);
      if (!data) {
        console.error("Failed to read file");
        return;
      }

      const file: OpenFile = {
        path,
        name: data.name,
        content: data.content,
        originalContent: data.content,
        mode: "preview",
        isDirty: false,
        saving: false,
      };

      set((s) => {
        const next = new Map(s.openFiles);
        next.set(path, file);
        return { openFiles: next, activeFilePath: path };
      });
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  },

  closeFile: (path) => {
    set((s) => {
      const next = new Map(s.openFiles);
      next.delete(path);
      const newActive =
        s.activeFilePath === path
          ? (next.keys().next().value ?? null)
          : s.activeFilePath;
      return { openFiles: next, activeFilePath: newActive };
    });
  },

  activateFile: (path) => set({ activeFilePath: path, previewFilePath: null, previewFile: null }),

  loadPreview: async (path) => {
    // If already pinned, just activate it
    if (get().openFiles.has(path)) {
      get().activateFile(path);
      return;
    }

    // Already previewing this exact path with content loaded
    if (get().previewFilePath === path && get().previewFile) return;

    // Set path immediately so the tab appears and takes focus
    set({ previewFilePath: path, previewFile: null, activeFilePath: null });

    const project = getProjectPath();
    if (!project) return;

    try {
      const data = await readFile(project, path);
      if (!data) {
        console.error("Failed to read file for preview");
        return;
      }

      // Guard against stale response (user already clicked another file)
      if (get().previewFilePath !== path) return;

      const file: OpenFile = {
        path,
        name: data.name,
        content: data.content,
        originalContent: data.content,
        mode: "preview",
        isDirty: false,
        saving: false,
      };

      set({ previewFile: file });
    } catch (e) {
      console.error("Failed to preview file:", e);
    }
  },

  clearPreview: () => set({ previewFilePath: null, previewFile: null }),

  unload: () => set({ openFiles: new Map(), activeFilePath: null, previewFilePath: null, previewFile: null }),

  pinPreview: () => {
    const { previewFilePath, previewFile } = get();
    if (!previewFilePath || !previewFile) return;

    set((s) => {
      const next = new Map(s.openFiles);
      if (!next.has(previewFilePath)) {
        next.set(previewFilePath, previewFile);
      }
      return {
        openFiles: next,
        activeFilePath: previewFilePath,
        previewFilePath: null,
        previewFile: null,
      };
    });
  },

  setMode: (path, mode) => {
    set((s) => {
      const file = s.openFiles.get(path);
      if (file) {
        const next = new Map(s.openFiles);
        next.set(path, { ...file, mode });
        return { openFiles: next };
      }
      // Auto-pin preview file when switching to edit mode
      if (s.previewFilePath === path && s.previewFile) {
        const next = new Map(s.openFiles);
        next.set(path, { ...s.previewFile, mode });
        return {
          openFiles: next,
          activeFilePath: path,
          previewFilePath: null,
          previewFile: null,
        };
      }
      return s;
    });
  },

  updateContent: (path, content) => {
    set((s) => {
      const file = s.openFiles.get(path);
      if (!file) return s;
      const next = new Map(s.openFiles);
      next.set(path, {
        ...file,
        content,
        isDirty: content !== file.originalContent,
      });
      return { openFiles: next };
    });
  },

  saveFile: async (path) => {
    const file = get().openFiles.get(path);
    if (!file) return;
    const project = getProjectPath();
    if (!project) return;

    set((s) => {
      const next = new Map(s.openFiles);
      next.set(path, { ...file, saving: true });
      return { openFiles: next };
    });

    try {
      await writeFile(project, path, file.content);

      set((s) => {
        const f = s.openFiles.get(path);
        if (!f) return s;
        const next = new Map(s.openFiles);
        next.set(path, {
          ...f,
          originalContent: f.content,
          isDirty: false,
          saving: false,
        });
        return { openFiles: next };
      });
    } catch (e) {
      set((s) => {
        const f = s.openFiles.get(path);
        if (!f) return s;
        const next = new Map(s.openFiles);
        next.set(path, { ...f, saving: false, error: String(e) });
        return { openFiles: next };
      });
    }
  },

  openExternal: async (path, editor) => {
    const project = getProjectPath();
    if (!project) return;
    try {
      await openExternalFile(project, path, editor);
    } catch (e) {
      console.error("Failed to open external editor:", e);
    }
  },

  onFileChanged: (path) => {
    const { openFiles, previewFilePath, previewFile } = get();
    const project = getProjectPath();
    if (!project) return;

    // Reload open file if not dirty
    const openFile = openFiles.get(path);
    if (openFile && !openFile.isDirty) {
      readFile(project, path)
        .then((data) => {
          if (!data) return;
          set((s) => {
            const f = s.openFiles.get(path);
            if (!f || f.isDirty) return s;
            const next = new Map(s.openFiles);
            next.set(path, { ...f, content: data.content, originalContent: data.content });
            return { openFiles: next };
          });
        })
        .catch(() => {});
    }

    // Reload preview file
    if (previewFilePath === path && previewFile) {
      readFile(project, path)
        .then((data) => {
          if (!data || get().previewFilePath !== path) return;
          set((s) => {
            if (!s.previewFile || s.previewFilePath !== path) return s;
            return {
              previewFile: { ...s.previewFile, content: data.content, originalContent: data.content },
            };
          });
        })
        .catch(() => {});
    }
  },
}));
