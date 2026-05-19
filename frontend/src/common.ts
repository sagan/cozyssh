import { createTheme } from '@mui/material';

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
