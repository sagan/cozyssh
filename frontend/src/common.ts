import { createTheme } from '@mui/material';
import { z } from 'zod';

export const buttonDataSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "name cannot be empty"),
  type: z.enum(['send_string', 'terminal_function', 'misc', 'open_terminal', 'run_script']),
  payload: z.string(),
  group: z.string().optional().default('Default'),
  autorun: z.number().int().min(0).max(1).optional().default(0),
  order: z.number().int().optional().default(0),
  shortcut: z.string().optional().default('')
});

export type ButtonData = Omit<z.infer<typeof buttonDataSchema>, 'id'> & { id: string };


export const defaultTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    background: { default: '#ffffff', paper: '#f4f6f8' },
  },
});

export const loginTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
  },
});


/**
 * Return effective value for a variable:
 * 1. Lookup in localVars (with "local_" prefix)
 * 2. Lookup in vars
 * 3. Return defaultValue
 * @param vars variable map
 * @param localVars local variable map
 * @param name variable name
 * @param defaultValue fallback value, default is ""
 */
export function getVar(vars: Record<string, string | undefined>, localVars: Record<string, string | undefined>, name: string, defaultValue = ""): string {
  if (localVars["local_" + name]) return localVars["local_" + name]!;
  if (vars[name]) return vars[name]!;
  return defaultValue;
}

/**
 * Return integer variable value:
 * 1. Lookup in localVars (with "local_" prefix)
 * 2. Lookup in vars
 * @param vars variable map
 * @param localVars local variable map
 * @param name variable name
 * @param defaultValue fallback value, default is 0. Used if variable not found, or not a valid integer.
 */
export function getIntVar(vars: Record<string, string | undefined>, localVars: Record<string, string | undefined>, name: string, defaultValue = 0): number {
  const value = getVar(vars, localVars, name);
  if (value === "") return defaultValue;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a key combination string from a KeyboardEvent
 * @param ev KeyboardEvent
 * @returns key combination string, e.g. "ctrl+alt+shift+meta+a",
 * modifiers are in order, all lowercase.
 */
export function getKeyCombination(ev: KeyboardEvent): string {
  let mods = "";
  if (ev.ctrlKey) mods += "ctrl+";
  if (ev.altKey) mods += "alt+";
  if (ev.shiftKey) mods += "shift+";
  if (ev.metaKey) mods += "meta+";
  mods += ev.key.toLowerCase();
  return mods;
}

/**
 * Generate a cryptographically strong password of format /[a-zA-Z0-9]{length}/
 * @param digitOnly bool. If true, output will be comprised of digit chars ([0-9]) only.
 */
export function generatePassword(length: number, digitOnly?: boolean) {
  if (length <= 0) {
    return "";
  }

  const PWD_CHARS = digitOnly ? "0123456789" : "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const PWD_CHARS_LEN = PWD_CHARS.length;

  // To avoid modulo bias, we only use random numbers that are less than
  // the largest multiple of PWD_CHARS_LEN that fits in the range of a Uint16 value [0, 65535].
  // (0xFFFF + 1) is the total number of possible Uint16 values (65536).
  const MAX_VALID_THRESHOLD = Math.floor((0xffff + 1) / PWD_CHARS_LEN) * PWD_CHARS_LEN;

  let password = "";
  // Buffer for random values to reduce calls to crypto.getRandomValues.
  // A size of length * 2 is a heuristic, generally sufficient for typical password lengths.
  const randomValuesBuffer = new Uint16Array(length * 2);
  let bufferIndex = randomValuesBuffer.length; // Start as if the buffer is exhausted

  while (password.length < length) {
    if (bufferIndex >= randomValuesBuffer.length) {
      crypto.getRandomValues(randomValuesBuffer);
      bufferIndex = 0;
    }

    const randomValue = randomValuesBuffer[bufferIndex++];
    if (randomValue < MAX_VALID_THRESHOLD) {
      password += PWD_CHARS[randomValue % PWD_CHARS_LEN];
    }
  }
  return password;
}
