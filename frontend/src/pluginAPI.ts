/**
 * pluginAPI.ts
 *
 * Installs and tears down all window.cs* scripting functions.
 * Reads live state via getStore() so individual functions never go stale,
 * regardless of when they are called.
 *
 * Usage in Dashboard:
 *   useEffect(() => setupPluginAPI(callbacks), []);  // empty dep array — always stable
 */

import React from 'react';
import { getStore, type TerminalRefMap } from './dashboardStore';
import type { ButtonData } from './dashboardStore';
import type { AppletData } from './AppletWrapper';
import type { Host } from './Sidebar';
import { version as PACKAGE_JSON_VERSION } from '../package.json';

import { transform } from 'sucrase';
import * as react from "react";
import * as dompurify from 'dompurify';
import * as marked from 'marked';
import { generatePassword } from './common';

(window as any).__CS_VERSION__ = PACKAGE_JSON_VERSION;

// Expose those modules to custom scripts
const exposeModules = {
  "react": react,
  "dompurify": dompurify,
  "marked": marked,
};

// Generate Blob URLs for each exposed module
const virtualModules: Record<string, string> = {};

for (const [moduleName, moduleObj] of Object.entries(exposeModules)) {
  // Attach safely to window
  const safeName = `__plugin_expose_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  (window as any)[safeName] = moduleObj;

  // Identify named exports (everything except 'default')
  const namedExports = Object.keys(moduleObj).filter(k => k !== 'default');

  // Determine what the 'default' export should be
  // If the module already has a .default, use that. Otherwise, use the whole object.
  const shimCode = `
  const mod = window["${safeName}"];

  // Export the named members
  export const { ${namedExports.join(', ')} } = mod;

  // Export the default member
  // If 'default' exists in the namespace, export that, otherwise the namespace itself
  const defaultExport = mod.default !== undefined ? mod.default : mod;
  export default defaultExport;
`;

  // Turn it into a Blob URL
  const blob = new Blob([shimCode], { type: 'application/javascript' });
  virtualModules[moduleName] = URL.createObjectURL(blob);
}

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const virtualModulesImportRegex = (() => {
  const moduleNames = Object.keys(virtualModules).map(escapeRegExp).join('|');
  return new RegExp(
    `((?:from|import)\\s+['"])(${moduleNames})(['"])|(import\\s*\\(\\s*['"])(${moduleNames})(['"]\\))`,
    'g'
  );
})();

/**
 * id => moduleObj
 */
const moduleCache: Record<string, Record<string, any>> = {};

(window as any).__CS_MODULECACHE__ = moduleCache;

export async function runScript(
  btn: ButtonData,
  notify: (msg: string, severity?: 'success' | 'info' | 'warning' | 'error') => void,
  getTerminalRefs: () => TerminalRefMap
) {
  let moduleObj: any = null;
  let cached = false;

  if (!moduleCache[btn.id]) {
    let scriptCode = btn.payload;
    // Do a single replace pass
    scriptCode = scriptCode.replace(virtualModulesImportRegex, (match, p1, p2, p3, p4, p5, p6) => {
      // Determine which capture group caught the module name
      const matchedModule = p2 || p5;
      const blobUrl = virtualModules[matchedModule];

      // Reconstruct the string using the mapped Blob URL
      if (p1 && p3) return `${p1}${blobUrl}${p3}`; // Standard & Side-effect import
      if (p4 && p6) return `${p4}${blobUrl}${p6}`; // Dynamic import

      return match; // Fallback
    });
    scriptCode = transform(scriptCode, { transforms: ['typescript', 'jsx'] }).code;

    const blob = new Blob([scriptCode], { type: 'application/javascript' });
    // Create a temporary URL pointing to that Blob
    const url = URL.createObjectURL(blob);

    try {
      moduleObj = await import(url);
    } catch (e) {
      console.error(`Script ${btn.name} Import Error:`, e);
      notify(`Script ${btn.name} Import Error: ${e}`, 'error');
      return;
    } finally {
      // Always clean up the URL to prevent memory leaks
      URL.revokeObjectURL(url);
    }
    if (moduleObj.cache) {
      moduleCache[btn.id] = moduleObj;
    }
  } else {
    moduleObj = moduleCache[btn.id];
    cached = true;
  }

  if (typeof moduleObj.run === 'function') {
    try {
      await moduleObj.run();
    } catch (e) {
      console.error(`Script ${btn.name} run() Error:`, e);
      notify(`Script ${btn.name} run() Error: ${e}`, 'error');
    }
  } else if (cached) {
    notify(`Script ${btn.name} is already imported & cached, and has no run function. Reload the page to clear the cache`, 'info');
    return;
  }

  if (!moduleObj.noFocus) {
    const refs = getTerminalRefs();
    const activePaneId = getStore().activePaneId;
    refs[activePaneId]?.focus();
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PluginAPICallbacks {
  /** Show a toast notification */
  notify: (msg: string, severity?: 'success' | 'info' | 'warning' | 'error') => void;
  /** Apply a new MUI theme */
  setTheme: (options: any, ...args: any[]) => void;
  /** Open a new terminal tab */
  handleSelectHost: (host: string, customTitle?: string) => Promise<void>;
  /** Open a split-pane tab from a tag */
  handleSelectTagAsSplit: (tag: string, hosts: string[]) => void;
  /** Attach to an existing backend session */
  handleAttach: (id: string, host: string, title: string, isLocked?: boolean) => Promise<void>;
  /** Refresh all data from the server */
  handleRefresh: () => Promise<void>;
  /** React state setter for applets */
  setApplets: React.Dispatch<React.SetStateAction<AppletData[]>>;
  /** React state setter for the mobile applets drawer */
  setMobileAppletsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Whether we're in mobile layout */
  isMobile: boolean;
  /** Ref for the next z-index to assign to a widget applet */
  maxZIndexRef: React.MutableRefObject<number>;
  /** Update localVars in the store (and sync to localStorage via Dashboard) */
  setLocalVars: (v: Record<string, string | undefined>) => void;
  /** Getter for the live terminal ref map (avoids store coupling) */
  getTerminalRefs: () => import('./dashboardStore').TerminalRefMap;
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

/**
 * Installs all window.cs* functions using the provided stable callbacks.
 * Returns a teardown function that removes them all.
 *
 * Call once per Dashboard mount:
 *   useEffect(() => setupPluginAPI(callbacks), []);
 */
export function setupPluginAPI(cb: PluginAPICallbacks): () => void {
  const w = window as any;

  // ── Variable API ─────────────────────────────────────────────────────────

  w.csGetVar = (name?: string) => {
    const { vars, localVars } = getStore();
    if (name) {
      if (name.toLowerCase().startsWith('local')) return localVars[name];
      return vars[name];
    }
    return { ...vars, ...localVars };
  };

  w.csSetVar = async (
    nameOrVars: string | Record<string, string | undefined>,
    value?: string | undefined
  ) => {
    const { vars, localVars } = getStore();
    const token = localStorage.getItem('cozy_token');
    let updates: Record<string, string | null> = {};
    let localUpdates: Record<string, string | undefined> = {};

    if (typeof nameOrVars === 'string') {
      if (nameOrVars.toLowerCase().startsWith('local')) {
        localUpdates[nameOrVars] = value;
      } else {
        updates[nameOrVars] = value === undefined ? null : value;
      }
    } else {
      for (const k in nameOrVars) {
        const v = nameOrVars[k];
        if (k.toLowerCase().startsWith('local')) {
          localUpdates[k] = v;
        } else {
          updates[k] = v === undefined ? null : v;
        }
      }
    }

    if (Object.keys(localUpdates).length > 0) {
      cb.setLocalVars({ ...localVars, ...localUpdates });
    }
    if (Object.keys(updates).length === 0) return;

    const r = await fetch('/api/vars', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error(await r.text());

    const nextVars = { ...vars };
    for (const k in updates) {
      const v = updates[k];
      if (v === null) delete nextVars[k];
      else nextVars[k] = v;
    }
    getStore().setVars(nextVars);
  };

  // ── Terminal API ──────────────────────────────────────────────────────────

  w.csGetTerminal = (paneId?: string) => {
    const { activePaneId } = getStore();
    const refs = cb.getTerminalRefs();
    const term: any = refs[paneId ?? activePaneId];
    return term?.getXterm?.();
  };

  w.csGetShellIntegration = (paneId?: string) => {
    const { shellIntegrations, activePaneId } = getStore();
    return shellIntegrations[paneId ?? activePaneId];
  };

  w.csGetAll = () => {
    const { activePaneId, shellIntegrations, tabs, hosts, buttons, vars, localVars } = getStore();
    return { activePaneId, terminals: cb.getTerminalRefs(), shellIntegrations, tabs, hosts, buttons, vars, localVars };
  };

  w.csSendData = (data: string, paneId?: string) => {
    const { activePaneId } = getStore();
    const refs = cb.getTerminalRefs();
    const term: any = refs[paneId ?? activePaneId];
    term?.sendData?.(data);
  };

  w.csGetTerminalContents = (lineCount = 100, paneId?: string) => {
    const { activePaneId } = getStore();
    const refs = cb.getTerminalRefs();
    const term: any = refs[paneId ?? activePaneId];
    const xterm = term?.getXterm?.();
    if (!xterm) return '';

    const buffer = xterm.buffer.active;
    const lines: string[] = [];
    const end = buffer.baseY + buffer.cursorY;
    const start = lineCount <= 0 ? 0 : Math.max(0, end - lineCount);
    for (let i = start; i <= end; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString().trimEnd());
    }
    return lines.join('\n');
  };

  w.csFocus = (paneId?: string) => {
    const { activePaneId, tabs } = getStore();
    const refs = cb.getTerminalRefs();
    if (paneId) {
      const allPanes = tabs.flatMap((t) => t.panes.map((p) => ({ tabId: t.id, paneId: p.id })));
      if (allPanes.length === 0) return;
      const idx = allPanes.findIndex((p) => p.paneId === paneId);
      if (idx < 0) return;
      const target = allPanes[idx];
      getStore().setActiveTabId(target.tabId);
      setTimeout(() => refs[target.paneId]?.focus(), 10);
    } else if (activePaneId) {
      setTimeout(() => refs[activePaneId]?.focus(), 0);
    }
  };

  w.csNotify = (msg: string, severity?: any) => cb.notify(msg, severity);

  w.csFetch = async (url: string, options: any = {}) => {
    const token = localStorage.getItem('cozy_token');
    const proxyUrl = `/api/fetch?url=${encodeURIComponent(url)}`;
    const rawHeaders = options.headers || {};
    const headers: any = {};
    const restricted = ['authorization', 'referer', 'origin', 'user-agent', 'cookie'];
    headers['Authorization'] = `Bearer ${token}`;
    for (const key in rawHeaders) {
      if (restricted.includes(key.toLowerCase())) {
        headers[`X-CozySSH-${key}`] = rawHeaders[key];
      } else {
        headers[key] = rawHeaders[key];
      }
    }
    return fetch(proxyUrl, { method: options.method || 'GET', headers, body: options.body });
  };

  w.csExec = async (cmdline: string) => {
    const token = localStorage.getItem('cozy_token');
    const res = await fetch('/api/exec', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmdline }),
    });
    if (!res.ok) throw new Error('Exec failed: ' + res.statusText);
    return res.json();
  };

  w.csSetTheme = (options: any, ...args: any[]) => cb.setTheme(options, ...args);

  // ── Navigation API ────────────────────────────────────────────────────────

  w.csOpen = (target: any, options: { name?: string } = {}) => {
    console.log('csOpen called:', target, options);
    const { hosts } = getStore();
    const targets = Array.isArray(target) ? target.slice(0, 4) : [target];
    const hostNames = targets.map((t: any) => {
      if (typeof t === 'string') {
        if (t === 'local') return 'local';
        const known = hosts.find((h) => h.name === t || h.hostname === t);
        return known ? known.name : t;
      }
      return t.name;
    });
    const title = options.name || hostNames[0];
    if (hostNames.length > 1) {
      cb.handleSelectTagAsSplit(title, hostNames);
    } else {
      cb.handleSelectHost(hostNames[0], options.name);
    }
  };

  w.csAttach = (id: string, host: string, title: string, isLocked = false) => {
    cb.handleAttach(id, host, title, isLocked);
  };

  w.csRefresh = async () => {
    await cb.handleRefresh();
  };

  // ── Applet API ────────────────────────────────────────────────────────────

  w.csOpenApplet = (
    name: string,
    node: any,
    options: { position?: 'widget' | 'sidebar' | 'dialog'; width?: number; height?: number } = {}
  ) => {
    let parsedPos: 'widget' | 'sidebar' | 'dialog';
    if (options.position === 'dialog') {
      parsedPos = 'dialog';
    } else if (options.position === 'sidebar' || cb.isMobile) {
      parsedPos = 'sidebar';
    } else {
      parsedPos = 'widget';
    }
    if (cb.isMobile && parsedPos === 'sidebar' && (window as any).__CS_AUTORUN_DONE__) {
      cb.setMobileAppletsOpen(true);
    }
    cb.setApplets((prev) => {
      const existing = prev.find((a) => a.name === name);
      if (existing) {
        return prev.map((a) =>
          a.name === name
            ? { ...a, node, width: options.width ?? a.width, height: options.height ?? a.height }
            : a
        );
      }
      return [
        ...prev,
        {
          name,
          node,
          position: parsedPos,
          width: options.width,
          height: options.height,
          zIndex: cb.maxZIndexRef.current++,
        },
      ];
    });
  };

  w.csCloseApplet = (name: string) => {
    cb.setApplets((prev) => prev.filter((a) => a.name !== name));
  };

  w.csGetApplet = (_name?: string) => {
    // applets live in React state — overwritten immediately by Dashboard's
    // own csGetApplet useEffect that depends on [applets].
    // We leave it as-is in Dashboard rather than fighting React here.
  };

  // ── Button / Host CRUD API ────────────────────────────────────────────────

  w.csUpdateButton = async (btn: ButtonData): Promise<string> => {
    const { buttons } = getStore();
    const targetId = btn.id || generatePassword(12);
    const exists = btn.id ? buttons.some(b => b.id === btn.id) : false;

    const token = localStorage.getItem('cozy_token');
    const method = exists ? 'PUT' : 'POST';
    const url = exists ? `/api/buttons/${targetId}` : '/api/buttons';

    const body = {
      id: targetId,
      name: btn.name ?? '',
      type: btn.type ?? 'send_string',
      payload: btn.payload ?? '',
      group: btn.group ?? 'Default',
      autorun: btn.autorun ?? 0,
      order: btn.order ?? 0,
      shortcut: btn.shortcut ?? '',
    };

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Failed to update button: ${res.statusText}`);
    }

    // Refresh buttons in store
    const refreshRes = await fetch('/api/buttons', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      getStore().setButtons(data || []);
    }

    return targetId;
  };

  w.csDeleteButton = async (id: string): Promise<void> => {
    const token = localStorage.getItem('cozy_token');
    const res = await fetch(`/api/buttons/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to delete button: ${res.statusText}`);
    }

    // Refresh buttons in store
    const refreshRes = await fetch('/api/buttons', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      getStore().setButtons(data || []);
    }
  };

  w.csUpdateHost = async (host: Host): Promise<void> => {
    const { hosts } = getStore();
    const exists = hosts.some(h => h.name === host.name && h.source === 'config');

    const token = localStorage.getItem('cozy_token');
    const method = exists ? 'PUT' : 'POST';
    const url = exists ? `/api/hosts/${encodeURIComponent(host.name)}` : '/api/hosts';

    const body = {
      alias: host.name,
      hostname: host.hostname,
      user: host.user ?? 'root',
      port: host.port ? String(host.port) : '22',
      identity_file: host.identity_file ?? (host as any).identityFile ?? '',
      proxy_jump: host.proxy_jump ?? (host as any).proxyJump ?? '',
      remote_command: host.remote_command ?? (host as any).remoteCommand ?? '',
      tags: host.tags ?? [],
      comment: host.comment ?? '',
    };

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Failed to update host: ${res.statusText}`);
    }

    // Refresh hosts in store
    const refreshRes = await fetch('/api/hosts', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      getStore().setHosts(data || []);
    }
  };

  w.csDeleteHost = async (alias: string): Promise<void> => {
    const token = localStorage.getItem('cozy_token');
    const res = await fetch(`/api/hosts/${encodeURIComponent(alias)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to delete host: ${res.statusText}`);
    }

    // Refresh hosts in store
    const refreshRes = await fetch('/api/hosts', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      getStore().setHosts(data || []);
    }
  };

  // ── Teardown ──────────────────────────────────────────────────────────────

  return () => {
    const keys = [
      'csGetVar', 'csSetVar', 'csGetTerminal', 'csGetShellIntegration', 'csGetAll',
      'csSendData', 'csGetTerminalContents', 'csFocus', 'csNotify', 'csFetch', 'csExec',
      'csSetTheme', 'csOpen', 'csAttach', 'csRefresh', 'csOpenApplet', 'csCloseApplet',
      'csGetApplet', 'csUpdateButton', 'csDeleteButton', 'csUpdateHost', 'csDeleteHost',
    ];
    for (const k of keys) delete (window as any)[k];
  };
}
