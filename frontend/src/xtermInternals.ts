// Workaround for https://github.com/xtermjs/xterm.js/issues/3600 .
// Adopted from https://github.com/ic4-y/kolu/pull/3/changes ,
// with some modification to make it compatible with our mobile input toolbar.

import type { Terminal } from "@xterm/xterm";

/** Unchecked cast onto xterm's private `_core`. The shape is described
 *  structurally at each call site below; the guards there are what keep us
 *  safe, since this cast asserts nothing. */
function core<T>(term: Terminal): T | undefined {
  return (term as { _core?: T })._core;
}

interface CompositionHelperShape {
  keydown?: (ev: KeyboardEvent) => boolean;
  __koluAndroidSoftKeyboardPatched?: boolean;
}

interface CoreServiceShape {
  triggerDataEvent?: (data: string, wasUserInput?: boolean) => void;
}

const ANDROID_TEXTAREA_SENTINEL = "\u200b";

/** Route Android soft-keyboard input through an autocorrect-proof password
 *  input instead of xterm's helper textarea (#1592).
 *
 *  Android keyboards treat xterm's textarea like prose despite autocorrect
 *  hints: they keep a word buffer, replace prior text (`ls` -> `LS `), apply
 *  double-space-period, and sometimes consume Backspace to undo/cycle
 *  suggestions. Trying to infer terminal intent from those transformed
 *  replacement strings is ambiguous (`". "` can be a real period key or the
 *  double-space shortcut), so do not use that editor path.
 *
 *  A password input disables the keyboard suggestion/autocorrect editor mode on
 *  Android. We focus that hidden input for touch typing, prevent its DOM edits,
 *  keep a one-codepoint sentinel so all keyboards emit Backspace, and forward
 *  raw `beforeinput` payloads through xterm's own data event. */
export function patchAndroidSoftKeyboardInput(term: Terminal): void {
  // The proxy input workaround is specifically for Android GBoard composition bugs (#3600).
  // On desktop operating systems (Windows, macOS, Linux), xterm's native textarea
  // handles hardware keyboards and shortcuts like Ctrl+C natively.
  const isAndroid = /android/i.test(navigator.userAgent);
  if (!isAndroid) {
    return;
  }

  const textarea = term.textarea;
  const coreShape = core<{
    _compositionHelper?: CompositionHelperShape;
    coreService?: CoreServiceShape;
  }>(term);
  const helper = coreShape?._compositionHelper;
  const coreService = coreShape?.coreService;
  if (
    !textarea ||
    !helper ||
    helper.__koluAndroidSoftKeyboardPatched ||
    typeof coreService?.triggerDataEvent !== "function"
  ) {
    return;
  }
  const triggerDataEvent = coreService.triggerDataEvent.bind(coreService);
  const keydown = helper.keydown;
  if (typeof keydown !== "function") return;

  // xterm sets some anti-correction attributes, but Android/GBoard is picky:
  // `autocapitalize="off"` is not the canonical value, and autocomplete is
  // absent. Apply the full set to the actual focused helper textarea so GBoard
  // treats it like a terminal transport, not prose.
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocapitalize", "none");
  textarea.setAttribute("spellcheck", "false");
  textarea.setAttribute("aria-autocomplete", "none");

  const input = document.createElement("input");
  input.type = "password";
  input.className = "kolu-android-keyboard-input";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("aria-hidden", "true");
  input.setAttribute("enterkeyhint", "enter");
  input.style.position = "absolute";
  input.style.left = "0";
  input.style.top = "0";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  input.style.zIndex = "-10";
  textarea.parentElement?.appendChild(input);

  const resetSentinel = () => {
    input.value = ANDROID_TEXTAREA_SENTINEL;
    input.selectionStart = ANDROID_TEXTAREA_SENTINEL.length;
    input.selectionEnd = ANDROID_TEXTAREA_SENTINEL.length;
  };

  resetSentinel();

  const termWithMutableFocus = term as Terminal & { focus: () => void };
  const focus = termWithMutableFocus.focus.bind(termWithMutableFocus);
  let isRedirectingFocus = false;

  const focusAndroidInput = () => {
    // When the MobileInputBar's extra-keys panel is open, it sets
    // textarea.inputMode = "none" to suppress the system keyboard.
    // Don't steal focus in that state — the panel sends keys directly
    // through the store, and redirecting focus would blur the textarea
    // and close the panel.
    if (textarea.inputMode === "none") return;
    // Mark xterm's internal focus state as true so xterm renders the prompt cursor
    focus();
    resetSentinel();
    isRedirectingFocus = true;
    try {
      input.focus({ preventScroll: true });
    } finally {
      isRedirectingFocus = false;
    }
    try {
      term.refresh(0, Math.max(0, term.rows - 1));
    } catch {
      // ignore
    }
  };

  termWithMutableFocus.focus = () => {
    focusAndroidInput();
  };

  helper.keydown = function patchedAndroidGboardKeydown(ev) {
    if (ev.keyCode === 229) {
      return false;
    }
    return keydown.call(this, ev);
  };

  let lastEnterTime = 0;
  const handleEnter = (ev: Event) => {
    ev.preventDefault();
    const now = Date.now();
    if (now - lastEnterTime > 50) {
      lastEnterTime = now;
      triggerDataEvent("\r", true);
    }
    resetSentinel();
  };

  input.addEventListener(
    "beforeinput",
    (ev) => {
      if (
        ev.inputType === "insertLineBreak" ||
        ev.inputType === "insertParagraph" ||
        (ev.inputType === "insertText" &&
          typeof ev.data === "string" &&
          (ev.data === "\r" || ev.data === "\n" || ev.data === "\r\n"))
      ) {
        handleEnter(ev);
        return;
      }

      ev.preventDefault();
      resetSentinel();

      if (ev.inputType === "insertText" && typeof ev.data === "string") {
        triggerDataEvent(ev.data, true);
      } else if (ev.inputType === "deleteContentBackward") {
        triggerDataEvent("\x7f", true);
      }
    },
    { capture: true },
  );

  input.addEventListener("input", () => resetSentinel(), { capture: true });

  // On a single-line <input type="password">, Android keyboards fire keydown
  // for Enter (and some action keys) instead of beforeinput. Without this
  // handler the browser's default action blurs the input and dismisses the
  // keyboard, and Enter is never forwarded to the terminal.
  input.addEventListener(
    "keydown",
    (ev) => {
      const isEnter =
        ev.key === "Enter" ||
        ev.keyCode === 13 ||
        ev.code === "Enter" ||
        (ev.keyCode === 229 && (ev.key === "Enter" || ev.code === "Enter"));
      if (isEnter) {
        handleEnter(ev);
        return;
      }

      // Handle Ctrl combinations (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L, etc.)
      if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
        const key = ev.key.toLowerCase();
        ev.preventDefault();
        const ctrlCode = String.fromCharCode(key.charCodeAt(0) - 96);
        triggerDataEvent(ctrlCode, true);
        resetSentinel();
        return;
      }
    },
    { capture: true },
  );

  input.addEventListener(
    "keyup",
    (ev) => {
      const isEnter = ev.key === "Enter" || ev.keyCode === 13 || ev.code === "Enter";
      if (isEnter) {
        ev.preventDefault();
        resetSentinel();
      }
    },
    { capture: true },
  );

  // If Enter caused Android OS to attempt to blur the input, re-focus immediately
  // so the soft keyboard remains active.
  input.addEventListener("blur", () => {
    if (Date.now() - lastEnterTime < 300 && textarea.inputMode !== "none") {
      resetSentinel();
      input.focus({ preventScroll: true });
    }
  });

  // When the proxy hasn't received focus yet (e.g. on initial terminal
  // open before the user toggles the extra-keys panel), the keyboard is
  // still attached to the textarea. The helper.keydown patch above
  // returns false for keyCode 229 which disrupts xterm's own Enter
  // handling. Catch Enter on the textarea so it always works, and
  // redirect focus to the proxy for subsequent keystrokes.
  textarea.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Enter" || ev.keyCode === 13 || ev.code === "Enter") {
        ev.preventDefault();
        triggerDataEvent("\r", true);
        // Also redirect focus to the proxy so future input flows
        // through the autocorrect-proof path.
        focusAndroidInput();
      }
    },
    { capture: true },
  );

  textarea.addEventListener("focus", focusAndroidInput);

  // Intercept blur on textarea when focus is transferred to proxy input.
  // xterm.js has an internal blur listener on textarea that marks the terminal
  // as unfocused (hiding the cursor). By stopping propagation on blur when
  // focus moves to our proxy input, xterm retains its focused state and keeps
  // the input cursor visible.
  textarea.addEventListener(
    "blur",
    (ev) => {
      const related = ev.relatedTarget;
      if (
        isRedirectingFocus ||
        (related instanceof HTMLElement && related.classList.contains("kolu-android-keyboard-input")) ||
        document.activeElement === input
      ) {
        ev.stopImmediatePropagation();
      }
    },
    { capture: true },
  );

  // Explicitly listen for user pointer/click/touch interactions on the terminal container
  // to force terminal focus synchronously within the user gesture event stack.
  const termElement = term.element || textarea.parentElement;
  if (termElement) {
    const handleUserGestureFocus = () => {
      if (textarea.inputMode === "none") return;
      focusAndroidInput();
    };
    termElement.addEventListener("pointerdown", handleUserGestureFocus, { capture: true });
    termElement.addEventListener("click", handleUserGestureFocus, { capture: true });
    termElement.addEventListener("touchstart", handleUserGestureFocus, { capture: true, passive: true });
  }

  // Ensure initial terminal state check
  window.setTimeout(() => {
    if (textarea.inputMode !== "none") {
      focusAndroidInput();
    }
  }, 0);

  helper.__koluAndroidSoftKeyboardPatched = true;

  // The MobileInputBar suppresses the system keyboard by setting
  // textarea.inputMode = "none". Since the actual keyboard target is
  // now the proxy <input>, mirror inputMode changes to it and
  // blur/refocus as needed so the keyboard actually hides/shows.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === "inputmode") {
        const mode = textarea.inputMode;
        input.inputMode = mode;
        if (mode === "none") {
          // Dismiss the keyboard by blurring the proxy
          input.blur();
        }
      }
    }
  });
  observer.observe(textarea, { attributes: true, attributeFilter: ["inputmode"] });
}
