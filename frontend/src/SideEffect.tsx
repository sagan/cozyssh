import { useEffect } from "react";

import {
  DEFAULT_BUTTON_GROUP,
  DEFAULT_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  VAR_CS_FONT_SIZE,
  VAR_CS_NOWAKELOCK,
  VAR_CS_REMAP_CTRL_L,
  VAR_CS_TERMINAL_FONT_SIZE,
} from "./constants";
import { type CSEventDetailVars, CS_EVENT_VARS } from "./common";
import { useStore, getIntVar, triggerFocus } from "./store";
import { useWakeLock } from "./useWakeLock";
import type { ButtonData } from "./api";

export default function SideEffect() {
  const tabsNotEmpty = useStore((state) => state.tabs.length > 0);
  const vars = useStore((state) => state.vars);
  const localVars = useStore((state) => state.localVars);
  const buttons = useStore((state) => state.buttons);
  const activeGroup = useStore((state) => state.activeGroup);

  const anyDialogOpen = useStore(
    (state) =>
      state.editButtonDialogOpen ||
      state.newTabDialogOpen ||
      state.inputDialogOpen ||
      state.editHostDialogOpen ||
      state.asyncDialogOpen,
  );

  useEffect(() => {
    if (!anyDialogOpen) {
      setTimeout(triggerFocus, 0);
    }
  }, [anyDialogOpen]);

  useEffect(() => {
    const shortcutButtons: Record<string, ButtonData> = {};
    for (const btn of buttons) {
      if ((btn.group || DEFAULT_BUTTON_GROUP) === activeGroup) {
        continue;
      }
      if (btn.shortcut && btn.shortcut.length > 1) {
        shortcutButtons[btn.shortcut.toLowerCase()] = btn;
      }
    }
    // active group button shortcut has priority
    for (const btn of buttons) {
      if ((btn.group || DEFAULT_BUTTON_GROUP) !== activeGroup) {
        continue;
      }
      if (btn.shortcut && btn.shortcut.length > 1) {
        shortcutButtons[btn.shortcut.toLowerCase()] = btn;
      }
    }
    __CS_SHORTCUT_BUTTONS__ = shortcutButtons;
  }, [buttons, activeGroup]);

  // It's OK to use static (non-reactive) getIntVar() here because the function scope vars & localVars
  // variables (introduced by Zustand useStore selectors) will cause the component to re-render if they change.
  useWakeLock(tabsNotEmpty && getIntVar(VAR_CS_NOWAKELOCK) !== 1);

  useEffect(() => {
    __CS_REMAP_CTRL_L__ = getIntVar(VAR_CS_REMAP_CTRL_L);

    const terminalFontSize = Math.max(1, getIntVar(VAR_CS_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_FONT_SIZE));
    if (terminalFontSize !== __CS_TERMINAL_OPTIONS__.fontSize) {
      __CS_TERMINAL_OPTIONS__.fontSize = terminalFontSize;
    }

    const fontSize = Math.max(1, getIntVar(VAR_CS_FONT_SIZE, DEFAULT_FONT_SIZE));
    if (fontSize !== __CS_FONT_SIZE__) {
      __CS_FONT_SIZE__ = fontSize;
    }

    window.dispatchEvent(
      new CustomEvent(CS_EVENT_VARS, {
        detail: {
          vars,
          localVars,
        } satisfies CSEventDetailVars,
      }),
    );
  }, [vars, localVars]);

  return null;
}
