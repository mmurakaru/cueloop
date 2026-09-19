/**
 * The share overlay: a settings-style two-column modal. The left nav lists
 * "share externally" and "export"; the right pane shows either the thread's
 * share links - each an address with copy and a ⋮ menu to revoke or open its
 * settings - or, reached from "+ new link" / "open link settings", a full-body
 * wizard that names a link and toggles a GitHub-login allowlist. Export is a
 * coming-soon placeholder. The dialog's UI state (which category, whether the
 * wizard is open, its draft) lives in the shared zustand store; the link data
 * arrives from the controller through props and the actions call back into it.
 */

import React, { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { KeyBinding, MouseEvent, TextareaRenderable } from "@opentui/core";
import { DEFAULT_SHARE_HOST } from "@cueloop/daemon/share-blob";
import type { ShareLink } from "@cueloop/schema";
import type { Theme } from "../theme";
import type { NewShareLink } from "../thread-controller";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";
import { DialogActions } from "./primitives/DialogActions";
import { Button } from "./primitives/Button";
import { Switch } from "./primitives/Switch";
import { Tree } from "./primitives/Tree";
import type { TreeNode } from "./primitives/tree-model";
import { NERD } from "./primitives/icons";
import { HandleChipsInput } from "./HandleChipsInput";
import {
  newWizardDraft,
  useShareDialog,
  shareDialogStore,
  type ShareCategory,
  type ShareWizardDraft,
} from "./share-dialog-store";

// ⏎ saves the link rather than adding a newline to the one-line name field.
const NAME_KEY_BINDINGS: KeyBinding[] = [{ name: "return", action: "submit" }];

/** The two left-nav categories, in order. */
const CATEGORIES: { id: ShareCategory; label: string }[] = [
  { id: "external", label: "share externally" },
  { id: "export", label: "export" },
];

const NAV_NODES: TreeNode[] = CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label,
}));

/** Narrow a nav row id back to its category (the nav only holds the two known ids). */
function categoryFromId(id: string): ShareCategory {
  return id === "export" ? "export" : "external";
}

/** The address a viewer connects to, e.g. `p_ab12@cueloop.dev` (no `ssh ` prefix; the row is a label). */
function shareAddress(id: string): string {
  return `${id}@${DEFAULT_SHARE_HOST}`;
}

/** Leave the wizard back to the links list. */
function backToList(): void {
  shareDialogStore.getState().closeWizard();
}

/** The wizard draft that edits an existing link in place. */
function draftForLink(link: ShareLink, threadName: string): ShareWizardDraft {
  return {
    editingId: link.id,
    name: link.name ?? threadName,
    requireAuth: link.requireAuth,
    allowlist: link.allowlist,
  };
}

function NavColumn({
  activeCategory,
  onSelect,
  theme,
}: {
  activeCategory: ShareCategory;
  onSelect: (category: ShareCategory) => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);

  return (
    <box style={{ flexDirection: "column", width: 22, paddingLeft: 1, paddingRight: 1 }}>
      <Tree
        nodes={NAV_NODES}
        expandedIds={new Set<string>()}
        selectedId={activeCategory}
        hideIcons
        selectedBackground={tokens.border}
        onSelect={(id) => onSelect(categoryFromId(id))}
        onToggle={(id) => onSelect(categoryFromId(id))}
        theme={theme}
      />
    </box>
  );
}

function KebabMenu({
  onDelete,
  onSettings,
  tokens,
}: {
  onDelete: () => void;
  onSettings: () => void;
  tokens: Theme;
}): React.ReactNode {
  const item = (label: string, onPick: () => void): React.ReactNode => (
    <box
      onMouseUp={(event: MouseEvent) => {
        event.stopPropagation();
        onPick();
      }}
      style={{ paddingLeft: 1, paddingRight: 1 }}
    >
      <text fg={tokens.text}>{label}</text>
    </box>
  );

  return (
    <box
      onMouseUp={(event: MouseEvent) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: 1,
        right: 0,
        flexDirection: "column",
        border: true,
        borderStyle: "single",
        borderColor: tokens.border,
        backgroundColor: tokens.elevated,
      }}
    >
      {item("delete link", onDelete)}
      {item("open link settings", onSettings)}
    </box>
  );
}

function LinkRow({
  link,
  selected,
  menuOpen,
  onCopy,
  onToggleMenu,
  onDelete,
  onSettings,
  tokens,
}: {
  link: ShareLink;
  selected: boolean;
  menuOpen: boolean;
  onCopy: () => void;
  onToggleMenu: () => void;
  onDelete: () => void;
  onSettings: () => void;
  tokens: Theme;
}): React.ReactNode {
  // the name is a short local label; unnamed links show their address instead
  const label = link.name ?? shareAddress(link.id);

  return (
    <box
      style={{
        flexDirection: "row",
        position: "relative",
        alignItems: "center",
        paddingLeft: 1,
        backgroundColor: selected ? tokens.border : undefined,
      }}
    >
      <text
        fg={selected ? tokens.text : tokens.textMuted}
        style={{ wrapMode: "none", flexShrink: 1 }}
      >
        {label}
      </text>
      <box style={{ flexGrow: 1 }} />
      <box onMouseUp={onCopy} style={{ paddingLeft: 2 }}>
        <text fg={tokens.textDim}>copy link</text>
      </box>
      <box
        onMouseUp={(event: MouseEvent) => {
          event.stopPropagation();
          onToggleMenu();
        }}
        style={{ paddingLeft: 2 }}
      >
        <text fg={tokens.textDim}>{NERD.kebab}</text>
      </box>
      {menuOpen ? <KebabMenu onDelete={onDelete} onSettings={onSettings} tokens={tokens} /> : null}
    </box>
  );
}

function LinksList({
  threadName,
  links,
  selectedIndex,
  menuOpenId,
  onCopy,
  onToggleMenu,
  onDelete,
  onSettings,
  onNewLink,
  tokens,
  theme,
}: {
  threadName: string;
  links: ShareLink[];
  selectedIndex: number;
  menuOpenId: string | null;
  onCopy: (id: string) => void;
  onToggleMenu: (id: string) => void;
  onDelete: (id: string) => void;
  onSettings: (link: ShareLink) => void;
  onNewLink: () => void;
  tokens: Theme;
  theme?: Theme;
}): React.ReactNode {
  if (links.length === 0) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <Button variant="solid" onPress={onNewLink} theme={theme}>
          {" + new link "}
        </Button>
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <text fg={tokens.textDim}>{`links created for ${threadName}`}</text>
      <text> </text>
      {links.map((link, index) => (
        <LinkRow
          key={link.id}
          link={link}
          selected={index === selectedIndex}
          menuOpen={menuOpenId === link.id}
          onCopy={() => onCopy(link.id)}
          onToggleMenu={() => onToggleMenu(link.id)}
          onDelete={() => onDelete(link.id)}
          onSettings={() => onSettings(link)}
          tokens={tokens}
        />
      ))}
      <text> </text>
      <box style={{ flexDirection: "row" }}>
        <Button variant="solid" onPress={onNewLink} theme={theme}>
          {" + new link "}
        </Button>
      </box>
    </box>
  );
}

/** The focus ring positions inside the wizard, in vertical order. */
type WizardFocus = "name" | "auth" | "allowlist" | "actions";

function Wizard({
  draft,
  focus,
  saveDisabled,
  onName,
  onToggleAuth,
  onAllowlist,
  onSave,
  onCancel,
  tokens,
  theme,
}: {
  draft: ShareWizardDraft;
  focus: WizardFocus;
  saveDisabled: boolean;
  onName: (name: string) => void;
  onToggleAuth: () => void;
  onAllowlist: (logins: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
  tokens: Theme;
  theme?: Theme;
}): React.ReactNode {
  const nameRef = useRef<TextareaRenderable | null>(null);

  useEffect(() => {
    if (focus !== "name") return;
    nameRef.current?.focus();
    if (nameRef.current) nameRef.current.cursorOffset = draft.name.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 1 }}>
      <text fg={focus === "name" ? tokens.accent : tokens.textDim}>link name</text>
      <textarea
        ref={nameRef}
        focused={focus === "name"}
        initialValue={draft.name}
        placeholder="link name"
        keyBindings={NAME_KEY_BINDINGS}
        onSubmit={onSave}
        onContentChange={() => onName(nameRef.current?.plainText ?? "")}
        style={{
          height: 1,
          backgroundColor: tokens.elevated,
          focusedBackgroundColor: tokens.elevated,
          textColor: tokens.text,
          focusedTextColor: tokens.text,
        }}
      />
      <text> </text>
      <box style={{ flexDirection: "row", alignItems: "center" }}>
        <text fg={focus === "auth" ? tokens.accent : tokens.textDim}>require auth</text>
        <box style={{ flexGrow: 1 }} />
        <Switch on={draft.requireAuth} onToggle={onToggleAuth} theme={theme} />
      </box>
      {draft.requireAuth ? (
        <box style={{ marginTop: 1 }}>
          <HandleChipsInput
            logins={draft.allowlist}
            onChange={onAllowlist}
            focused={focus === "allowlist"}
            onEmptyBackspace={onToggleAuth}
            theme={theme}
          />
        </box>
      ) : null}
      <box style={{ flexGrow: 1 }} />
      <DialogActions
        confirmLabel={draft.editingId ? "save" : "create"}
        onConfirm={onSave}
        onCancel={onCancel}
        confirmDisabled={saveDisabled}
        theme={theme}
      />
    </box>
  );
}

export interface ShareDialogProps {
  isOpen: boolean;
  /** The thread's title, shown in the list header and prefilled as a new link's name. */
  threadName: string;
  /** The thread's live share links, newest last. */
  links: ShareLink[];
  /** Owners publish and edit; an observer sees the list read-only (no create/edit/delete). */
  isOwner: boolean;
  onCreateLink: (input: NewShareLink) => void;
  onUpdateLink: (id: string, input: NewShareLink) => void;
  onDeleteLink: (id: string) => void;
  onCopyLink: (id: string) => void;
  onClose: () => void;
  theme?: Theme;
}

export function ShareDialog({
  isOpen,
  threadName,
  links,
  isOwner,
  onCreateLink,
  onUpdateLink,
  onDeleteLink,
  onCopyLink,
  onClose,
  theme,
}: ShareDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  const category = useShareDialog((state) => state.category);
  const wizard = useShareDialog((state) => state.wizard);

  const [activeZone, setActiveZone] = useState<"nav" | "body">("nav");
  const [listCursor, setListCursor] = useState(0);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [wizardFocus, setWizardFocus] = useState<WizardFocus>("name");

  const rowCount = links.length + 1; // links plus the "+ new link" row

  const openWizardWith = (draft: ShareWizardDraft): void => {
    setMenuOpenId(null);
    setWizardFocus("name");
    shareDialogStore.getState().openWizard(draft);
  };

  const wizardRing = (): WizardFocus[] =>
    wizard?.requireAuth ? ["name", "auth", "allowlist", "actions"] : ["name", "auth", "actions"];

  const moveWizardFocus = (delta: number): void => {
    const ring = wizardRing();
    const at = Math.max(0, ring.indexOf(wizardFocus));
    setWizardFocus(ring[Math.min(ring.length - 1, Math.max(0, at + delta))] ?? "name");
  };

  // a private link needs at least one handle, else the gateway locks everyone out
  const saveDisabled = wizard !== null && wizard.requireAuth && wizard.allowlist.length === 0;

  const saveWizard = (): void => {
    if (!wizard || saveDisabled) return;
    const input: NewShareLink = {
      name: wizard.name.trim() || undefined,
      requireAuth: wizard.requireAuth,
      allowlist: wizard.allowlist,
    };

    if (wizard.editingId) onUpdateLink(wizard.editingId, input);
    else onCreateLink(input);
    backToList();
  };

  const activateListRow = (): void => {
    if (listCursor >= links.length) return openWizardWith(newWizardDraft(threadName));
    const link = links[listCursor];

    if (link) onCopyLink(link.id);
  };

  // turning auth on drops the cursor straight into the handles field; turning it off resets them
  const toggleAuth = (): void => {
    if (!wizard) return;
    const next = !wizard.requireAuth;

    shareDialogStore.getState().setRequireAuth(next);
    if (!next) shareDialogStore.getState().setAllowlist([]);
    setWizardFocus(next ? "allowlist" : "auth");
  };

  // grammar keys only bite outside a focused text field, where they cannot be typed
  const handleWizardKey = (name: string): void => {
    if (!wizard) return;
    if (name === "escape") return backToList();
    if (name === "down") return moveWizardFocus(1);
    if (name === "up") return moveWizardFocus(-1);
    const activated = name === "return" || name === "enter";

    if (wizardFocus === "auth" && (activated || name === "space")) return toggleAuth();
    if (wizardFocus === "actions" && activated) saveWizard();
  };

  const handleNavKey = (name: string): void => {
    if (name === "j" || name === "down") return shareDialogStore.getState().setCategory("export");
    if (name === "k" || name === "up") return shareDialogStore.getState().setCategory("external");
    const enter = name === "l" || name === "return" || name === "enter" || name === "tab";

    if (enter && category === "external" && isOwner) setActiveZone("body");
  };

  const editLinkAtCursor = (): void => {
    const link = links[listCursor];

    if (link) openWizardWith(draftForLink(link, threadName));
  };

  const handleBodyKey = (name: string): void => {
    if (name === "h") return setActiveZone("nav");
    if (name === "j" || name === "down")
      return setListCursor((cursor) => Math.min(cursor + 1, rowCount - 1));
    if (name === "k" || name === "up") return setListCursor((cursor) => Math.max(cursor - 1, 0));
    if (name === "return" || name === "enter") return activateListRow();
    if (listCursor >= links.length) return;
    if (name === "e") return editLinkAtCursor();
    if (name === "d") onDeleteLink(links[listCursor]!.id);
  };

  useKeyboard((key) => {
    if (!isOpen) return;
    if (wizard) return handleWizardKey(key.name);
    if (menuOpenId !== null) return void (key.name === "escape" && setMenuOpenId(null));
    if (key.name === "escape") return onClose();
    if (activeZone === "nav") return handleNavKey(key.name);
    handleBodyKey(key.name);
  });

  if (!isOpen) return null;

  const footerHint = wizard
    ? "↑/↓ move · space toggle · enter save · esc back"
    : activeZone === "nav"
      ? "j/k nav · l/enter open · esc close"
      : "j/k row · enter copy · e edit · d delete · h back";

  return (
    <Dialog
      isOpen
      title=" Share "
      width={Math.min(76, terminalWidth - 6)}
      height={Math.min(22, terminalHeight - 4)}
      background={tokens.elevated}
      onDismiss={onClose}
      theme={theme}
    >
      {wizard ? (
        <Wizard
          draft={wizard}
          focus={wizardFocus}
          saveDisabled={saveDisabled}
          onName={(name) => shareDialogStore.getState().setName(name)}
          onToggleAuth={toggleAuth}
          onAllowlist={(logins) => shareDialogStore.getState().setAllowlist(logins)}
          onSave={saveWizard}
          onCancel={backToList}
          tokens={tokens}
          theme={theme}
        />
      ) : (
        <box style={{ flexDirection: "row", flexGrow: 1 }}>
          <NavColumn
            activeCategory={category}
            onSelect={(next) => {
              shareDialogStore.getState().setCategory(next);
              setActiveZone("nav");
            }}
            theme={theme}
          />
          <box style={{ borderStyle: "single", border: ["left"], borderColor: tokens.border }} />
          <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 1 }}>
            {category === "export" ? (
              <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
                <text fg={tokens.textDim}>coming soon</text>
              </box>
            ) : (
              <LinksList
                threadName={threadName}
                links={links}
                selectedIndex={activeZone === "body" ? listCursor : -1}
                menuOpenId={menuOpenId}
                onCopy={onCopyLink}
                onToggleMenu={(id) => setMenuOpenId((open) => (open === id ? null : id))}
                onDelete={(id) => {
                  setMenuOpenId(null);
                  onDeleteLink(id);
                }}
                onSettings={(link) => openWizardWith(draftForLink(link, threadName))}
                onNewLink={() => openWizardWith(newWizardDraft(threadName))}
                tokens={tokens}
                theme={theme}
              />
            )}
          </box>
        </box>
      )}
      <box style={{ flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={tokens.textDim}>{footerHint}</text>
      </box>
    </Dialog>
  );
}
