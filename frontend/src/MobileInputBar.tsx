/**
 * MobileInputBar.tsx
 *
 * Termius-style mobile keyboard accessory bar.
 *
 * Normal mode  ── [🖐] │ ←scrollable: Ctrl Esc Tab ↑↓←→ chars F-keys→ │ [⋯]
 * Extra-keys   ── same bar unchanged; panel appears ABOVE it:
 *                   Row 0: [🖐] │ [Ctrl][Esc][Tab][↑↓←→] │ [✕]  ← non-scrollable mirror of bar
 *                   Row 1+: full key grid (special chars, nav, F-keys)
 *
 * Keyboard suppression:
 *   VirtualKeyboard API  → inputmode="none" + vk.hide()
 *   Fallback             → inputmode="none" (suppresses keyboard on most mobile browsers)
 */

import { useRef, useState, useEffect } from 'react';
import { Box, Paper, IconButton, Button, ButtonGroup, Divider } from '@mui/material';
import PanToolIcon from '@mui/icons-material/PanTool';
import PanToolOutlinedIcon from '@mui/icons-material/PanToolOutlined';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import KeyboardTabIcon from '@mui/icons-material/KeyboardTab';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';
import WestIcon from '@mui/icons-material/West';
import EastIcon from '@mui/icons-material/East';

import { VIBRATE_PATTERN } from './constants';
import type { TerminalHandle } from './Terminal';
import type { ScratchpadHandle } from './Scratchpad';

export interface MobileInputBarProps {
  isCtrlActive: boolean;
  setIsCtrlActive: (v: boolean) => void;
  isAltActive: boolean;
  setIsAltActive: (v: boolean) => void;
  handleSendKey: (key: string) => void;
  gestureMode: boolean;
  onGestureModeChange: (v: boolean) => void;
  extraKeysOpen: boolean;
  onExtraKeysOpenChange: (v: boolean) => void;
  /** Height of the on-screen keyboard in px (0 when keyboard is hidden) */
  keyboardHeight: number;
  getActiveTerminal: () => TerminalHandle | ScratchpadHandle | null;
}

// ── Key definitions ───────────────────────────────────────────────────────────
interface KeyDef { label: string; seq: string; wide?: boolean; }

// Groups shown in the scrollable bar (left to right)
const BAR_GROUPS: KeyDef[][] = [
  [
    { label: 'Esc', seq: '\x1b' },
    { label: '⇥', seq: '\x09' }],
  [
    { label: '←', seq: '\x1b[D' },
    { label: '↑', seq: '\x1b[A' },
    { label: '↓', seq: '\x1b[B' },
    { label: '→', seq: '\x1b[C' },
  ],
  [
    { label: '|', seq: '|' },
    { label: '/', seq: '/' },
    { label: '-', seq: '-' },
    { label: ';', seq: ';' },
  ],
];

// Rows shown in the extra-keys panel (below the top-row mirror)
const EXTRA_ROWS: KeyDef[][] = [
  // Arrow keys first — always reachable even on narrow screens where the top row overflows
  [
    { label: '←', seq: '\x1b[D' },
    { label: '↑', seq: '\x1b[A' },
    { label: '↓', seq: '\x1b[B' },
    { label: '→', seq: '\x1b[C' },
    { label: '|', seq: '|' },
    { label: '/', seq: '/' },
    { label: '-', seq: '-' },
    { label: ';', seq: ';' },
  ],
  [
    { label: '_', seq: '_' },
    { label: 'Home', seq: '\x1b[H', wide: true },
    { label: 'End', seq: '\x1b[F', wide: true },
    { label: 'PgUp', seq: '\x1b[5~', wide: true },
    { label: 'PgDn', seq: '\x1b[6~', wide: true },
    { label: 'Ins', seq: '\x1b[2~', wide: true },
    { label: 'Del', seq: '\x1b[3~', wide: true },
    { label: 'BS', seq: '\x7f', wide: true }, // Backspace, compatible with Linux & Windows ConPTY
  ],
  [
    { label: '~', seq: '~' },
    { label: '`', seq: '`' },
    { label: '"', seq: '"' },
    { label: "'", seq: "'" },
    { label: '&', seq: '&' },
    { label: '*', seq: '*' },
    { label: '?', seq: '?' },
    { label: '=', seq: '=' },
  ],
  [
    { label: '{', seq: '{' },
    { label: '}', seq: '}' },
    { label: '[', seq: '[' },
    { label: ']', seq: ']' },
    { label: '(', seq: '(' },
    { label: ')', seq: ')' },
    { label: '<', seq: '<' },
    { label: '>', seq: '>' },
  ],
  [
    { label: '#', seq: '#' },
    { label: '!', seq: '!' },
    { label: '@', seq: '@' },
    { label: '%', seq: '%' },
    { label: '^', seq: '^' },
    { label: '+', seq: '+' },
    { label: ':', seq: ':' },
    { label: '\\', seq: '\\' },
  ],
  [
    { label: 'F1', seq: '\x1bOP', wide: true },
    { label: 'F2', seq: '\x1bOQ', wide: true },
    { label: 'F3', seq: '\x1bOR', wide: true },
    { label: 'F4', seq: '\x1bOS', wide: true },
    { label: 'F5', seq: '\x1b[15~', wide: true },
    { label: 'F6', seq: '\x1b[17~', wide: true },
    { label: 'F7', seq: '\x1b[18~', wide: true },
    { label: 'F8', seq: '\x1b[19~', wide: true },
  ],
  [
    { label: 'F9', seq: '\x1b[20~', wide: true },
    { label: 'F10', seq: '\x1b[21~', wide: true },
    { label: 'F11', seq: '\x1b[23~', wide: true },
    { label: 'F12', seq: '\x1b[24~', wide: true },
    { label: '^C', seq: '\x03', wide: true }, // Ctrl+C
    { label: '^L', seq: '\x0c', wide: true }, // Ctrl+L
    { label: '^Z', seq: '\x1a', wide: true }, // Ctrl+Z
    { label: '^D', seq: '\x04', wide: true }, // Ctrl+D
  ],
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const ICON_SZ = { fontSize: 14 } as const;

function KeyIcon({ label }: { label: string }) {
  switch (label) {
    case '↑':
      return <NorthIcon sx={ICON_SZ} />;
    case '↓':
      return <SouthIcon sx={ICON_SZ} />;
    case '←':
      return <WestIcon sx={ICON_SZ} />;
    case '→':
      return <EastIcon sx={ICON_SZ} />;
    case '⇥':
      return <KeyboardTabIcon sx={ICON_SZ} />;
    default:
      return <>{label}</>;
  }
}

const BTN_SX = (wide?: boolean) => ({
  minWidth: wide ? 40 : 30,
  height: 28,
  px: 0.4,
  fontSize: '0.7rem',
  fontFamily: 'monospace',
  flexShrink: 0,
  textTransform: 'none',
} as const);

const PANEL_BTN_SX = (wide?: boolean) => ({
  flex: wide ? 2 : 1,
  minWidth: 0,
  height: 34,
  px: 0.25,
  fontSize: '0.72rem',
  fontFamily: 'monospace',
  textTransform: 'none',
  bgcolor: 'background.paper',
  '&:active': { bgcolor: 'action.selected' },
} as const);

// ── Component ─────────────────────────────────────────────────────────────────
export default function MobileInputBar({
  isCtrlActive, setIsCtrlActive, isAltActive, setIsAltActive, handleSendKey, gestureMode, onGestureModeChange,
  extraKeysOpen, onExtraKeysOpenChange, keyboardHeight, getActiveTerminal,
}: MobileInputBarProps) {

  const [lastKeyboardHeight, setLastKeyboardHeight] = useState(0);

  useEffect(() => {
    if (keyboardHeight > 60) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastKeyboardHeight(keyboardHeight);
    }
  }, [keyboardHeight]);

  const vibe = () => window.navigator.vibrate?.(VIBRATE_PATTERN);

  const startCoords = useRef<{ x: number; y: number } | null>(null);

  const getTapProps = (action: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      startCoords.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      if (!startCoords.current) {
        return;
      }
      const dx = e.clientX - startCoords.current.x;
      const dy = e.clientY - startCoords.current.y;
      startCoords.current = null;
      if (Math.sqrt(dx * dx + dy * dy) < 10) {
        action();
      }
    },
    onPointerCancel: () => {
      startCoords.current = null;
    },
  });
  const sendKey = (seq: string) => {
    vibe();
    // Alt prefix: send ESC before the sequence, then auto-clear Alt
    if (isAltActive) {
      handleSendKey('\x1b' + seq);
      setIsAltActive(false);
    } else {
      handleSendKey(seq);
    }
  };

  const handleExtraKeysToggle = () => {
    const next = !extraKeysOpen;

    if (next) {
      // ── Opening the extra-keys panel ──────────────────────────────────────
      // Suppress system keyboard immediately, then show the panel.
      onExtraKeysOpenChange(true);
      const term = getActiveTerminal();
      if (term && "getXterm" in term) {
        const textarea = term.getXterm()?.textarea;
        if (textarea) {
          textarea.inputMode = 'none';
        }
        navigator.virtualKeyboard?.hide();
      }
    } else {
      // ── Closing the extra-keys panel ──────────────────────────────────────
      // The system keyboard opens asynchronously.  If we remove the panel
      // immediately, there's a brief gap where neither the panel nor the
      // keyboard is covering the bottom of the screen, causing a visible
      // flick.  Strategy: restore inputMode and focus the textarea first
      // (which triggers the keyboard to open), then wait for the visual
      // viewport to shrink before actually removing the panel.
      const term = getActiveTerminal();
      if (term && "getXterm" in term) {
        const textarea = term.getXterm()?.textarea;
        if (textarea) textarea.inputMode = '';
        // Focus triggers the system keyboard to begin opening
        term.focus();
      }

      const vv = window.visualViewport;
      if (vv) {
        const heightAtClose = vv.height;
        let done = false;

        const finish = () => {
          if (done) {
            return;
          }
          done = true;
          vv.removeEventListener('resize', onVVResize);
          onExtraKeysOpenChange(false);
        };

        const onVVResize = () => {
          // The viewport shrank → the system keyboard is now visible
          if (vv.height < heightAtClose - 30) {
            finish();
          }
        };

        vv.addEventListener('resize', onVVResize);
        // Safety timeout: if the keyboard doesn't open (e.g. hardware keyboard
        // attached, or focus fails), remove the panel anyway after 400ms.
        setTimeout(finish, 400);
      } else {
        // No visualViewport API — fall back to a simple delay
        setTimeout(() => onExtraKeysOpenChange(false), 300);
      }
    }
  };

  const activeKbHeight = keyboardHeight > 60 ? keyboardHeight : lastKeyboardHeight;
  const panelHeight = activeKbHeight > 60 ? (activeKbHeight + 40) : Math.floor(window.innerHeight * 0.38);

  // ── Shared sub-components ──────────────────────────────────────────────────

  /** The gesture toggle button (leftmost of both bar and panel top row) */
  const GestureBtn = <IconButton
    size="small"
    {...getTapProps(() => { vibe(); onGestureModeChange(!gestureMode); })}
    sx={{
      color: gestureMode ? 'primary.main' : 'text.secondary',
      bgcolor: gestureMode ? 'primary.50' : 'transparent',
      borderRadius: 1,
      width: 34,
      height: 34,
      flexShrink: 0,
    }}
  >
    {gestureMode ? <PanToolIcon fontSize="small" /> : <PanToolOutlinedIcon fontSize="small" />}
  </IconButton>

  const topBar = <>
    <Button
      size="small"
      variant={isCtrlActive ? 'contained' : 'outlined'}
      {...getTapProps(() => { vibe(); setIsCtrlActive(!isCtrlActive); })}
      sx={{
        width: 44, minWidth: 44, height: 28, px: 0, fontWeight: 700,
        flexShrink: 0, fontSize: '0.72rem', boxSizing: 'border-box'
      }}
    >
      Ctrl
    </Button>
    <Button
      size="small"
      variant={isAltActive ? 'contained' : 'outlined'}
      {...getTapProps(() => { vibe(); setIsAltActive(!isAltActive); })}
      sx={{
        width: 38, minWidth: 38, height: 28, px: 0, fontWeight: 700,
        flexShrink: 0, fontSize: '0.72rem', boxSizing: 'border-box'
      }}
    >
      Alt
    </Button>
    {BAR_GROUPS.map((group, gi) => (
      <ButtonGroup key={gi} size="small" variant="outlined" sx={{ flexShrink: 0 }}>
        {group.map((k) => (
          <Button
            key={k.label}
            {...getTapProps(() => sendKey(k.seq))}
            sx={BTN_SX(k.wide)}
          >
            <KeyIcon label={k.label} />
          </Button>
        ))}
      </ButtonGroup>
    ))}
  </>;

  return (
    <Box
      id="mobile-input-bar"
      sx={{
        flexShrink: 0,
        // When open, it takes 0 space in the flex flow to prevent jumping
        height: extraKeysOpen ? 0 : 'auto',
        order: 10,
        display: {
          xs: 'block',
          sm: 'block',
          md: 'none',
        },
        '@media (pointer: coarse)': {
          display: 'block',
        },
      }}
    >
      {/* ── Extra-keys panel (replaces the accessory bar when open) ── */}
      {extraKeysOpen && (
        <Paper
          id="mobile-input-bar-full"
          elevation={8}
          square
          sx={{
            height: panelHeight,
            position: 'fixed',
            // bottom: 0, // Set it to 0 or 1 will cause layout shift when extra keys panel is toggled on / off.
            // I don't know exactly why, CSS is difficult
            left: 0,
            right: 0,
            bgcolor: '#e8eaed',
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10000,
            overflow: 'hidden',
          }}
        >
          {/* ── Top row: non-scrollable version of the accessory bar ── */}
          <Box
            id="mobile-input-bar-full-top"
            sx={{
              height: 40,
              flexShrink: 0,
              bgcolor: '#f0f2f5',
              borderBottom: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            {/* LEFT: gesture toggle */}
            <Box sx={{ px: 0.5, flexShrink: 0 }}>
              {GestureBtn}
            </Box>

            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />

            {/* CENTER: same keys as bar, but non-scrollable (no overflow) */}
            <Box
              id="mobile-input-bar-full-top-center"
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 0.75,
                height: '100%',
                overflow: 'hidden',
              }}
            >
              {topBar}
            </Box>

            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />

            {/* RIGHT: "..." toggle to close the panel */}
            <Box sx={{ px: 0.5, flexShrink: 0 }}>
              <IconButton
                size="small"
                {...getTapProps(() => { vibe(); handleExtraKeysToggle(); })}
                sx={{
                  color: 'primary.main',
                  bgcolor: 'primary.50',
                  borderRadius: 1,
                  width: 34,
                  height: 34,
                }}
              >
                <MoreHorizIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          {/* ── Extra key grid ── */}
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-evenly',
              px: 0.75,
              py: 0.5,
              overflowY: 'auto',
            }}
          >
            {EXTRA_ROWS.map((row, ri) => (
              <Box key={ri} sx={{ display: 'flex', gap: 0.5 }}>
                {row.map((k) => (
                  <Button
                    key={k.label}
                    size="small"
                    variant="outlined"
                    {...getTapProps(() => sendKey(k.seq))}
                    sx={PANEL_BTN_SX(k.wide)}
                  >
                    <KeyIcon label={k.label} />
                  </Button>
                ))}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* ── Accessory bar (only visible when extra-keys panel is closed) ── */}
      {!extraKeysOpen && (
        <Paper
          id="mobile-input-bar-mini"
          elevation={3}
          square
          sx={{
            height: 40,
            bgcolor: '#f0f2f5',
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            flexShrink: 0,
            position: 'relative',
            zIndex: 10,
          }}
        >
          {/* LEFT: gesture toggle */}
          <Box sx={{ px: 0.5, flexShrink: 0 }}>
            {GestureBtn}
          </Box>

          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />

          {/* CENTER: horizontally scrollable shortcuts */}
          <Box
            id="mobile-input-bar-mini-center"
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              overflowX: 'auto',
              overflowY: 'hidden',
              gap: 0.75,
              px: 0.75,
              height: '100%',
              '&::-webkit-scrollbar': { display: 'none' },
              scrollbarWidth: 'none',
            }}
          >
            {topBar}
          </Box>

          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />

          {/* RIGHT: extra-keys toggle */}
          <Box sx={{ px: 0.5, flexShrink: 0 }}>
            <IconButton
              size="small"
              {...getTapProps(() => { vibe(); handleExtraKeysToggle(); })}
              sx={{
                color: 'text.secondary',
                bgcolor: 'transparent',
                borderRadius: 1,
                width: 34,
                height: 34,
              }}
            >
              <MoreHorizIcon fontSize="small" />
            </IconButton>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
