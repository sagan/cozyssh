import type { Terminal } from "@xterm/xterm";
import { getKeyCombination, t } from "./common";

export interface MarkModePosition {
  col: number; // 0 to cols - 1
  row: number; // absolute line index in buffer: 0 to buffer.length - 1
}

export interface MarkModeContext {
  term: Terminal;
  cursor: MarkModePosition;
  anchor: MarkModePosition;
  isSelecting: boolean;
  moveCursor: (deltaCol: number, deltaRow: number, extendSelection?: boolean) => void;
  setCursor: (col: number, row: number, extendSelection?: boolean) => void;
  clearSelection: () => void;
  copySelection: () => Promise<string>;
  copyAndExit: () => Promise<void>;
  exit: () => void;
  scrollToCursor: () => void;
  updateVisuals: () => void;
}

export type MarkModeActionHandler = (ctx: MarkModeContext, ev?: KeyboardEvent) => void | boolean | Promise<void>;

/**
 * Built-in Action Handlers for Mark Mode
 */
export const markModeActions: Record<string, MarkModeActionHandler> = {
  moveLeft: (ctx) => ctx.moveCursor(-1, 0, false),
  moveRight: (ctx) => ctx.moveCursor(1, 0, false),
  moveUp: (ctx) => ctx.moveCursor(0, -1, false),
  moveDown: (ctx) => ctx.moveCursor(0, 1, false),

  selectLeft: (ctx) => ctx.moveCursor(-1, 0, true),
  selectRight: (ctx) => ctx.moveCursor(1, 0, true),
  selectUp: (ctx) => ctx.moveCursor(0, -1, true),
  selectDown: (ctx) => ctx.moveCursor(0, 1, true),

  lineStart: (ctx) => ctx.setCursor(0, ctx.cursor.row, false),
  lineEnd: (ctx) => ctx.setCursor(ctx.term.cols - 1, ctx.cursor.row, false),
  selectLineStart: (ctx) => ctx.setCursor(0, ctx.cursor.row, true),
  selectLineEnd: (ctx) => ctx.setCursor(ctx.term.cols - 1, ctx.cursor.row, true),

  wordLeft: (ctx) => {
    const pos = findPrevWordPosition(ctx.term, ctx.cursor);
    ctx.setCursor(pos.col, pos.row, false);
  },
  wordRight: (ctx) => {
    const pos = findNextWordPosition(ctx.term, ctx.cursor);
    ctx.setCursor(pos.col, pos.row, false);
  },
  selectWordLeft: (ctx) => {
    const pos = findPrevWordPosition(ctx.term, ctx.cursor);
    ctx.setCursor(pos.col, pos.row, true);
  },
  selectWordRight: (ctx) => {
    const pos = findNextWordPosition(ctx.term, ctx.cursor);
    ctx.setCursor(pos.col, pos.row, true);
  },

  pageUp: (ctx) => {
    const lines = Math.max(1, Math.floor(ctx.term.rows / 2));
    ctx.moveCursor(0, -lines, false);
  },
  pageDown: (ctx) => {
    const lines = Math.max(1, Math.floor(ctx.term.rows / 2));
    ctx.moveCursor(0, lines, false);
  },
  selectPageUp: (ctx) => {
    const lines = Math.max(1, Math.floor(ctx.term.rows / 2));
    ctx.moveCursor(0, -lines, true);
  },
  selectPageDown: (ctx) => {
    const lines = Math.max(1, Math.floor(ctx.term.rows / 2));
    ctx.moveCursor(0, lines, true);
  },

  topOfBuffer: (ctx) => ctx.setCursor(0, 0, false),
  bottomOfBuffer: (ctx) => ctx.setCursor(0, Math.max(0, ctx.term.buffer.active.length - 1), false),
  selectTopOfBuffer: (ctx) => ctx.setCursor(0, 0, true),
  selectBottomOfBuffer: (ctx) => ctx.setCursor(ctx.term.cols - 1, Math.max(0, ctx.term.buffer.active.length - 1), true),

  toggleVisual: (ctx) => {
    if (ctx.isSelecting) {
      ctx.clearSelection();
    } else {
      ctx.setCursor(ctx.cursor.col, ctx.cursor.row, true);
    }
  },

  selectAll: (ctx) => {
    ctx.term.selectAll();
    ctx.anchor = { col: 0, row: 0 };
    ctx.cursor = { col: ctx.term.cols - 1, row: Math.max(0, ctx.term.buffer.active.length - 1) };
    ctx.isSelecting = true;
    ctx.updateVisuals();
  },

  copy: async (ctx) => {
    await ctx.copySelection();
  },

  copyAndExit: async (ctx) => {
    await ctx.copyAndExit();
  },

  exit: (ctx) => {
    ctx.exit();
  },
};

/**
 * Default Keybindings Map for Mark Mode
 */
export const defaultMarkModeKeymap: Record<string, string | MarkModeActionHandler> = {
  // Arrow key movement
  arrowleft: "moveLeft",
  arrowright: "moveRight",
  arrowup: "moveUp",
  arrowdown: "moveDown",

  // Arrow key selection
  "shift+arrowleft": "selectLeft",
  "shift+arrowright": "selectRight",
  "shift+arrowup": "selectUp",
  "shift+arrowdown": "selectDown",

  // Vim movement (h, j, k, l)
  h: "moveLeft",
  j: "moveDown",
  k: "moveUp",
  l: "moveRight",

  // Vim selection (H, J, K, L / Shift + h, j, k, l)
  H: "selectLeft",
  "shift+h": "selectLeft",
  J: "selectDown",
  "shift+j": "selectDown",
  K: "selectUp",
  "shift+k": "selectUp",
  L: "selectRight",
  "shift+l": "selectRight",

  // Line navigation
  home: "lineStart",
  "0": "lineStart",
  "^": "lineStart",
  end: "lineEnd",
  $: "lineEnd",
  "shift+home": "selectLineStart",
  "shift+end": "selectLineEnd",

  // Word navigation
  w: "wordRight",
  e: "wordRight",
  b: "wordLeft",
  W: "selectWordRight",
  "shift+w": "selectWordRight",
  B: "selectWordLeft",
  "shift+b": "selectWordLeft",
  "ctrl+arrowleft": "wordLeft",
  "ctrl+arrowright": "wordRight",
  "ctrl+shift+arrowleft": "selectWordLeft",
  "ctrl+shift+arrowright": "selectWordRight",

  // Scrolling & Buffer jumps
  pageup: "pageUp",
  pagedown: "pageDown",
  "shift+pageup": "selectPageUp",
  "shift+pagedown": "selectPageDown",
  "ctrl+u": "pageUp",
  "ctrl+d": "pageDown",
  "ctrl+b": "pageUp",
  "ctrl+f": "pageDown",
  g: "topOfBuffer",
  G: "bottomOfBuffer",
  "shift+g": "bottomOfBuffer",
  "ctrl+home": "topOfBuffer",
  "ctrl+end": "bottomOfBuffer",
  "ctrl+shift+home": "selectTopOfBuffer",
  "ctrl+shift+end": "selectBottomOfBuffer",

  // Visual mode / Selection toggle
  v: "toggleVisual",
  V: "toggleVisual",
  "ctrl+a": "selectAll",

  // Copy & Exit
  enter: "copyAndExit",
  "ctrl+enter": "copyAndExit",
  y: "copyAndExit",
  "ctrl+c": "copyAndExit",
  "ctrl+shift+c": "copyAndExit",

  // Exit
  escape: "exit",
  "ctrl+[": "exit",
  "ctrl+shift+m": "exit",
};

/**
 * Helper: Find the next word start in the buffer
 */
function findNextWordPosition(term: Terminal, current: MarkModePosition): MarkModePosition {
  const buffer = term.buffer.active;
  let { col, row } = current;
  const maxRow = buffer.length - 1;

  while (row <= maxRow) {
    const line = buffer.getLine(row);
    if (!line) {
      row++;
      col = 0;
      continue;
    }
    const text = line.translateToString(false);
    let i = col + 1;

    // Skip current word characters
    while (i < term.cols && isWordChar(text[i])) {
      i++;
    }
    // Skip whitespace / non-word characters
    while (i < term.cols && !isWordChar(text[i])) {
      i++;
    }

    if (i < term.cols) {
      return { col: i, row };
    }
    row++;
    col = -1;
  }

  return { col: term.cols - 1, row: Math.max(0, maxRow) };
}

/**
 * Helper: Find the previous word start in the buffer
 */
function findPrevWordPosition(term: Terminal, current: MarkModePosition): MarkModePosition {
  const buffer = term.buffer.active;
  let { col, row } = current;

  while (row >= 0) {
    const line = buffer.getLine(row);
    if (!line) {
      row--;
      col = term.cols - 1;
      continue;
    }
    const text = line.translateToString(false);
    let i = col - 1;

    // Skip whitespace / non-word characters backwards
    while (i >= 0 && !isWordChar(text[i])) {
      i--;
    }
    // Skip word characters backwards to find beginning of word
    while (i >= 0 && isWordChar(text[i])) {
      i--;
    }

    if (i + 1 < col || row < current.row) {
      return { col: Math.max(0, i + 1), row };
    }
    row--;
    col = term.cols;
  }

  return { col: 0, row: 0 };
}

function isWordChar(char?: string): boolean {
  if (!char) return false;
  return /[\w\d_.-]/.test(char);
}

/**
 * MarkModeManager manages the mark mode lifecycle, keyboard routing, and cursor/selection rendering.
 */
export class MarkModeManager {
  private _term: Terminal;
  private _container: HTMLElement;
  private _isActive = false;
  private _cursor: MarkModePosition = { col: 0, row: 0 };
  private _anchor: MarkModePosition = { col: 0, row: 0 };
  private _isSelecting = false;

  private _cursorElement: HTMLDivElement | null = null;
  private _badgeElement: HTMLDivElement | null = null;
  private _disposables: Array<() => void> = [];

  public keymap: Record<string, string | MarkModeActionHandler>;
  public actions: Record<string, MarkModeActionHandler>;
  public onStateChange?: (isActive: boolean) => void;

  constructor(term: Terminal, container: HTMLElement) {
    this._term = term;
    this._container = container;
    this.keymap = { ...defaultMarkModeKeymap };
    this.actions = { ...markModeActions };
  }

  public get isActive(): boolean {
    return this._isActive;
  }

  public get cursor(): MarkModePosition {
    return { ...this._cursor };
  }

  public get anchor(): MarkModePosition {
    return { ...this._anchor };
  }

  public get isSelecting(): boolean {
    return this._isSelecting;
  }

  /**
   * Enter Mark Mode
   */
  public enter(): void {
    if (this._isActive) {
      return;
    }

    this._isActive = true;
    const buf = this._term.buffer.active;

    // Check if terminal has an existing selection
    const selPos = this._term.getSelectionPosition();
    if (selPos) {
      this._anchor = { col: selPos.start.x, row: selPos.start.y };
      this._cursor = { col: selPos.end.x, row: selPos.end.y };
      this._isSelecting = true;
    } else {
      // Default to terminal prompt cursor position
      this._cursor = {
        col: Math.min(Math.max(0, buf.cursorX), this._term.cols - 1),
        row: Math.min(Math.max(0, buf.baseY + buf.cursorY), Math.max(0, buf.length - 1)),
      };
      this._anchor = { ...this._cursor };
      this._isSelecting = false;
      this._term.clearSelection();
    }

    this._setupDOM();

    const d1 = this._term.onScroll(() => this.updateVisuals());
    const d2 = this._term.onRender(() => this.updateVisuals());
    const d3 = this._term.onResize(() => this.updateVisuals());

    this._disposables.push(
      () => d1.dispose(),
      () => d2.dispose(),
      () => d3.dispose(),
    );

    this.scrollToCursor();
    this.updateVisuals();

    this.onStateChange?.(true);
  }

  /**
   * Exit Mark Mode
   */
  public exit(): void {
    if (!this._isActive) {
      return;
    }

    this._isActive = false;
    this._teardownDOM();

    for (const d of this._disposables) {
      try {
        d();
      } catch {
        /* empty */
      }
    }
    this._disposables = [];

    // Refocus the terminal for normal typing
    try {
      this._term.focus();
    } catch {
      /* empty */
    }

    this.onStateChange?.(false);
  }

  /**
   * Toggle Mark Mode
   */
  public toggle(): void {
    if (this._isActive) {
      this.exit();
    } else {
      this.enter();
    }
  }

  /**
   * Move cursor relative to current position
   */
  public moveCursor(deltaCol: number, deltaRow: number, extendSelection = false): void {
    if (!this._isActive) return;

    const buf = this._term.buffer.active;
    let newCol = this._cursor.col + deltaCol;
    let newRow = this._cursor.row + deltaRow;

    // Line wrap handling for horizontal movements
    if (deltaCol < 0 && newCol < 0) {
      if (newRow > 0) {
        newRow--;
        newCol = this._term.cols - 1;
      } else {
        newCol = 0;
      }
    } else if (deltaCol > 0 && newCol >= this._term.cols) {
      if (newRow < buf.length - 1) {
        newRow++;
        newCol = 0;
      } else {
        newCol = this._term.cols - 1;
      }
    }

    this.setCursor(newCol, newRow, extendSelection);
  }

  /**
   * Set absolute cursor position
   */
  public setCursor(col: number, row: number, extendSelection = false): void {
    if (!this._isActive) return;

    const buf = this._term.buffer.active;
    const maxRow = Math.max(0, buf.length - 1);
    const clampedCol = Math.min(Math.max(0, col), this._term.cols - 1);
    const clampedRow = Math.min(Math.max(0, row), maxRow);

    this._cursor = { col: clampedCol, row: clampedRow };

    if (extendSelection) {
      this._isSelecting = true;
      this._applySelection();
    } else {
      this._isSelecting = false;
      this._anchor = { ...this._cursor };
      this._term.clearSelection();
    }

    this.scrollToCursor();
    this.updateVisuals();
  }

  /**
   * Clears selection without exiting mark mode
   */
  public clearSelection(): void {
    this._isSelecting = false;
    this._anchor = { ...this._cursor };
    this._term.clearSelection();
    this.updateVisuals();
  }

  /**
   * Copy current selection (or character/word under cursor) to clipboard
   */
  public async copySelection(): Promise<string> {
    let text = this._term.getSelection();
    if (!text) {
      // If nothing selected, copy character under mark mode cursor
      const line = this._term.buffer.active.getLine(this._cursor.row);
      const char = line?.getCell(this._cursor.col)?.getChars() || "";
      if (char) {
        text = char;
      }
    }

    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        console.warn("[MarkMode] Clipboard write failed:", err);
      }
    }

    return text;
  }

  /**
   * Copy selection and exit mark mode
   */
  public async copyAndExit(): Promise<void> {
    await this.copySelection();
    this.exit();
  }

  /**
   * Scroll terminal viewport so that the mark mode cursor is visible
   */
  public scrollToCursor(): void {
    if (!this._isActive) return;

    const buf = this._term.buffer.active;
    const viewportY = buf.viewportY;
    const rows = this._term.rows;

    if (this._cursor.row < viewportY) {
      this._term.scrollLines(this._cursor.row - viewportY);
    } else if (this._cursor.row >= viewportY + rows) {
      this._term.scrollLines(this._cursor.row - (viewportY + rows - 1));
    }
  }

  /**
   * Update visual elements (cursor overlay & thumbtack)
   */
  public updateVisuals(): void {
    if (!this._isActive || !this._cursorElement) {
      return;
    }

    const { width: cellWidth, height: cellHeight } = this._getCellDimensions();
    const viewportRow = this._cursor.row - this._term.buffer.active.viewportY;

    if (viewportRow >= 0 && viewportRow < this._term.rows) {
      this._cursorElement.style.display = "block";
      this._cursorElement.style.left = `${this._cursor.col * cellWidth}px`;
      this._cursorElement.style.top = `${viewportRow * cellHeight}px`;
      this._cursorElement.style.width = `${Math.max(1, cellWidth)}px`;
      this._cursorElement.style.height = `${Math.max(1, cellHeight)}px`;
    } else {
      this._cursorElement.style.display = "none";
    }
  }

  /**
   * Called when terminal buffer changes (e.g. onWriteParsed / resize / clear)
   */
  public onBufferChange(): void {
    if (!this._isActive) return;

    const buf = this._term.buffer.active;

    // If buffer was cleared/wiped
    if (buf.length <= this._term.rows && buf.baseY === 0 && this._cursor.row > buf.length) {
      this.exit();
      return;
    }

    // Clamp coordinates to valid range
    const maxRow = Math.max(0, buf.length - 1);
    this._cursor.row = Math.min(this._cursor.row, maxRow);
    this._anchor.row = Math.min(this._anchor.row, maxRow);

    if (this._isSelecting) {
      this._applySelection();
    }
    this.updateVisuals();
  }

  /**
   * Keyboard event dispatcher for Mark Mode
   */
  public handleKeyDown(e: KeyboardEvent): boolean {
    if (!this._isActive) {
      return false;
    }

    // Mark mode intercepts all keyboard events so nothing goes to server
    e.preventDefault();
    e.stopPropagation();

    const keycomb = getKeyCombination(e);
    let action = this.keymap[keycomb];

    // Fallback checks for single char keys if modified by shift
    if (!action && e.key) {
      action = this.keymap[e.key];
    }

    const ctx = this._getContext();

    if (typeof action === "function") {
      action(ctx, e);
      return true;
    } else if (typeof action === "string" && this.actions[action]) {
      this.actions[action]!(ctx, e);
      return true;
    }

    // Intercept unmapped keys silently without typing into terminal
    return true;
  }

  /**
   * Register custom action
   */
  public registerAction(name: string, handler: MarkModeActionHandler): void {
    this.actions[name] = handler;
  }

  /**
   * Register custom keybinding
   */
  public registerKeybinding(keycomb: string, actionOrName: string | MarkModeActionHandler): void {
    this.keymap[keycomb] = actionOrName;
  }

  public dispose(): void {
    this.exit();
  }

  // ──────────────── Private Helpers ────────────────

  private _applySelection(): void {
    const isReversed =
      this._cursor.row < this._anchor.row ||
      (this._cursor.row === this._anchor.row && this._cursor.col < this._anchor.col);

    const start = isReversed ? this._cursor : this._anchor;
    const end = isReversed ? this._anchor : this._cursor;

    let length: number;
    if (start.row === end.row) {
      length = end.col - start.col + 1;
    } else {
      length = (this._term.cols - start.col) + (end.row - start.row - 1) * this._term.cols + (end.col + 1);
    }

    this._term.select(start.col, start.row, Math.max(1, length));
  }

  private _getCellDimensions(): { width: number; height: number } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (this._term as any)._core;
    const cssCell = core?._renderService?.dimensions?.css?.cell;
    if (cssCell?.width && cssCell?.height) {
      return { width: cssCell.width, height: cssCell.height };
    }

    const screenEl = (this._term.element?.querySelector(".xterm-screen") || this._container) as HTMLElement | null;
    if (screenEl && this._term.cols > 0 && this._term.rows > 0) {
      return {
        width: screenEl.clientWidth / this._term.cols,
        height: screenEl.clientHeight / this._term.rows,
      };
    }

    return { width: 9, height: 17 };
  }

  private _setupDOM(): void {
    this._container.classList.add("cs-mark-mode-active");

    // Thumbtack cursor element
    if (!this._cursorElement) {
      const cursor = document.createElement("div");
      cursor.className = "cs-mark-mode-cursor";

      const pin = document.createElement("span");
      pin.className = "cs-mark-mode-pin";
      pin.textContent = "📌";
      cursor.appendChild(pin);

      // Attach cursor inside the .xterm-screen or container so it scrolls nicely
      const screenEl = this._term.element?.querySelector(".xterm-screen") || this._container;
      screenEl.appendChild(cursor);
      this._cursorElement = cursor;
    }

    // Floating UI Badge with instructions and quick actions
    if (!this._badgeElement) {
      const badge = document.createElement("div");
      badge.className = "cs-mark-mode-badge";

      const title = document.createElement("span");
      title.style.display = "inline-flex";
      title.style.alignItems = "center";
      title.style.gap = "4px";
      title.innerHTML = `📌 <b>${t("Mark Mode")}</b>`;
      badge.appendChild(title);

      const copyBtn = document.createElement("button");
      copyBtn.className = "cs-mark-mode-badge-btn";
      copyBtn.innerHTML = `<span>${t("Copy")}</span> <kbd style="opacity:0.7">Enter</kbd>`;
      copyBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.copyAndExit();
      };
      badge.appendChild(copyBtn);

      const exitBtn = document.createElement("button");
      exitBtn.className = "cs-mark-mode-badge-btn exit-btn";
      exitBtn.innerHTML = `<span>${t("Exit")}</span> <kbd style="opacity:0.7">Esc</kbd>`;
      exitBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.exit();
      };
      badge.appendChild(exitBtn);

      this._container.appendChild(badge);
      this._badgeElement = badge;
    }
  }

  private _teardownDOM(): void {
    this._container.classList.remove("cs-mark-mode-active");
    if (this._cursorElement) {
      this._cursorElement.remove();
      this._cursorElement = null;
    }
    if (this._badgeElement) {
      this._badgeElement.remove();
      this._badgeElement = null;
    }
  }

  private _getContext(): MarkModeContext {
    return {
      term: this._term,
      cursor: this._cursor,
      anchor: this._anchor,
      isSelecting: this._isSelecting,
      moveCursor: (dCol, dRow, extend) => this.moveCursor(dCol, dRow, extend),
      setCursor: (col, row, extend) => this.setCursor(col, row, extend),
      clearSelection: () => this.clearSelection(),
      copySelection: () => this.copySelection(),
      copyAndExit: () => this.copyAndExit(),
      exit: () => this.exit(),
      scrollToCursor: () => this.scrollToCursor(),
      updateVisuals: () => this.updateVisuals(),
    };
  }
}
