/** The one action row every overlay uses: a solid confirm word-button and a plain cancel, lowercased. */

import React from "react";
import type { Theme } from "../../theme";
import { Toolbar } from "./Toolbar";
import { Button } from "./Button";

export interface DialogActionsProps {
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  theme?: Theme;
}

export function DialogActions({
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = "cancel",
  confirmDisabled = false,
  theme,
}: DialogActionsProps): React.ReactNode {
  return (
    <Toolbar>
      <Button
        variant="solid"
        marginRight={2}
        onPress={onConfirm}
        isDisabled={confirmDisabled}
        theme={theme}
      >
        {` ${confirmLabel} `}
      </Button>
      <Button onPress={onCancel} theme={theme}>{` ${cancelLabel} `}</Button>
    </Toolbar>
  );
}
