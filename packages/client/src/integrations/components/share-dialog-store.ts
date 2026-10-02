/**
 * UI state for the share dialog, held in a zustand store rather than juggled
 * across component state: which category is open (share externally / export),
 * whether the link wizard is showing, and the wizard's draft (name, auth,
 * allowlist). The links themselves live on the thread; this is only the
 * ephemeral surface state.
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

export type ShareCategory = "external" | "export";

export interface ShareWizardDraft {
  /** The link being edited, or null when creating a new one. */
  editingId: string | null;
  name: string;
  requireAuth: boolean;
  allowlist: string[];
}

export interface ShareDialogState {
  category: ShareCategory;
  /** Null = the links list; a draft = the new/edit wizard. */
  wizard: ShareWizardDraft | null;
  setCategory: (category: ShareCategory) => void;
  openWizard: (draft: ShareWizardDraft) => void;
  closeWizard: () => void;
  setName: (name: string) => void;
  setRequireAuth: (requireAuth: boolean) => void;
  setAllowlist: (allowlist: string[]) => void;
  /** Reset to the opening state (links list, external tab) when the dialog opens. */
  reset: () => void;
}

/** A fresh wizard draft, prefilled with the thread name for a new link. */
export function newWizardDraft(threadName: string): ShareWizardDraft {
  return { editingId: null, name: threadName, requireAuth: false, allowlist: [] };
}

export const shareDialogStore = createStore<ShareDialogState>((set) => ({
  category: "external",
  wizard: null,
  setCategory: (category) => set({ category }),
  openWizard: (wizard) => set({ wizard }),
  closeWizard: () => set({ wizard: null }),
  setName: (name) => set((state) => (state.wizard ? { wizard: { ...state.wizard, name } } : {})),
  setRequireAuth: (requireAuth) =>
    set((state) => (state.wizard ? { wizard: { ...state.wizard, requireAuth } } : {})),
  setAllowlist: (allowlist) =>
    set((state) => (state.wizard ? { wizard: { ...state.wizard, allowlist } } : {})),
  reset: () => set({ category: "external", wizard: null }),
}));

/** Subscribe a component to the share dialog store. */
export function useShareDialog<T>(selector: (state: ShareDialogState) => T): T {
  return useStore(shareDialogStore, selector);
}
