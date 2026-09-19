import React from "react";
import type { ShareLink } from "@cueloop/schema";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ShareDialog } from "./ShareDialog";
import { newWizardDraft, shareDialogStore } from "./share-dialog-store";

export const meta: StoryMeta = { title: "Dialogs/Share" };

const LINKS: ShareLink[] = [
  { id: "p_ab12cd", name: "reviewers", requireAuth: true, allowlist: ["octocat"] },
  { id: "p_ef34gh", requireAuth: false, allowlist: [] },
];

const NOOP = {
  onCreateLink: () => {},
  onUpdateLink: () => {},
  onDeleteLink: () => {},
  onCopyLink: () => {},
  onClose: () => {},
};

const SIZE = { width: 80, height: 24 };

export const EmptyList: Story = {
  render: () => {
    shareDialogStore.getState().reset();

    return (
      <ShareDialog isOpen threadName="Improve retry logic" links={[]} isOwner {...NOOP} theme={DARK} />
    );
  },
  size: SIZE,
};

export const WithLinks: Story = {
  render: () => {
    shareDialogStore.getState().reset();

    return (
      <ShareDialog
        isOpen
        threadName="Improve retry logic"
        links={LINKS}
        isOwner
        {...NOOP}
        theme={DARK}
      />
    );
  },
  size: SIZE,
};

export const ExportComingSoon: Story = {
  render: () => {
    shareDialogStore.getState().reset();
    shareDialogStore.getState().setCategory("export");

    return (
      <ShareDialog
        isOpen
        threadName="Improve retry logic"
        links={LINKS}
        isOwner
        {...NOOP}
        theme={DARK}
      />
    );
  },
  size: SIZE,
};

export const NewLinkWizard: Story = {
  render: () => {
    shareDialogStore.getState().reset();
    shareDialogStore.getState().openWizard(newWizardDraft("Improve retry logic"));

    return (
      <ShareDialog isOpen threadName="Improve retry logic" links={[]} isOwner {...NOOP} theme={DARK} />
    );
  },
  size: SIZE,
};

export const AuthWizard: Story = {
  render: () => {
    shareDialogStore.getState().reset();
    shareDialogStore.getState().openWizard({
      editingId: null,
      name: "reviewers",
      requireAuth: true,
      allowlist: ["octocat", "hubot"],
    });

    return (
      <ShareDialog isOpen threadName="Improve retry logic" links={[]} isOwner {...NOOP} theme={DARK} />
    );
  },
  size: SIZE,
};
