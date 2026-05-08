export const TERMINAL_FUNCTIONS = [
  { value: 'COPY', label: 'COPY (Buffer)' },
  { value: 'COPY_VISIBLE', label: 'COPY (Visible)' },
  { value: 'COPY_SELECTION', label: 'COPY (Selection)' },
  { value: 'COPY_LAST_COMMAND_OUTPUT', label: 'COPY (Last Cmd Output)' },
  { value: 'PASTE', label: 'PASTE (Clipboard)' },
  { value: 'INPUT', label: 'INPUT (Prompt)' },
  { value: 'CLEAR', label: 'CLEAR (Screen)' },
  { value: 'RESET', label: 'RESET (Terminal)' },
  { value: 'RECONNECT', label: 'RECONNECT (Session)' },
  { value: 'CLOSE', label: 'CLOSE (Pane/Tab)' },
  { value: 'SCROLL_TO_TOP', label: 'SCROLL (Top)' },
  { value: 'SCROLL_TO_BOTTOM', label: 'SCROLL (Bottom)' },
  { value: 'SCROLL_PAGE_UP', label: 'SCROLL (Page Up)' },
  { value: 'SCROLL_PAGE_DOWN', label: 'SCROLL (Page Down)' },
  { value: 'SEARCH', label: 'SEARCH' },
];

export const MISC_FUNCTIONS = [
  { value: 'NEXT_BUTTON_GROUP', label: 'Next Button Group' },
  { value: 'PREV_BUTTON_GROUP', label: 'Prev Button Group' },
  { value: 'OPEN_SCRATCHPAD', label: 'Open Scratchpad' },
];

export const BUILTIN_BUTTONS = [
  ...TERMINAL_FUNCTIONS.map(f => ({
    id: `builtin-${f.value}`,
    name: f.label,
    type: 'terminal_function',
    payload: f.value
  })),
  ...MISC_FUNCTIONS.map(f => ({
    id: `builtin-${f.value}`,
    name: f.label,
    type: 'misc',
    payload: f.value
  }))
];
