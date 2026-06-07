import { useEffect } from "react";

import {
  DEFAULT_TERMINAL_FONT_SIZE,
  VAR_CS_NOWAKELOCK,
  VAR_CS_REMAP_CTRL_L,
  VAR_CS_TERMINAL_FONT_SIZE,
} from "./constants";
import { CS_EVENT_VARS, getIntVar, type CSEventDetailVars } from "./common";
import { useStore, type TerminalRefMap } from "./store";
import { useWakeLock } from "./useWakeLock";

export default function SideEffect({ terminalRefs }: { terminalRefs: React.MutableRefObject<TerminalRefMap> }) {
  const tabsNotEmpty = useStore((state) => state.tabs.length > 0);
  const vars = useStore((state) => state.vars);
  const localVars = useStore((state) => state.localVars);

  useWakeLock(tabsNotEmpty && getIntVar(vars, localVars, VAR_CS_NOWAKELOCK) !== 1);

  useEffect(() => {
    __CS_REMAP_CTRL_L__ = getIntVar(vars, localVars, VAR_CS_REMAP_CTRL_L);

    const fontSize = Math.max(1, getIntVar(vars, localVars, VAR_CS_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_FONT_SIZE));
    if (fontSize !== (__CS_TERMINAL_OPTIONS__.fontSize || DEFAULT_TERMINAL_FONT_SIZE)) {
      for (const term of Object.values(terminalRefs.current)) {
        if (term && "getXterm" in term) {
          const xterm = term.getXterm();
          if (xterm) {
            xterm.options.fontSize = fontSize;
          }
        }
      }
      __CS_TERMINAL_OPTIONS__.fontSize = fontSize;
    }

    window.dispatchEvent(
      new CustomEvent(CS_EVENT_VARS, {
        detail: {
          vars,
          localVars,
        } satisfies CSEventDetailVars,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars, localVars]);

  return null;
}
