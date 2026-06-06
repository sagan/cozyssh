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

import React from "react";
import { transform } from "sucrase";

// Expose those modules to custom scripts
import * as react from "react";
import * as dompurify from "dompurify";
import * as marked from "marked";

import type { HostData, ButtonData, ExecRequest, ExecResult } from "./api";
import { version as PACKAGE_JSON_VERSION } from "../package.json";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_CONTENT_TYPE,
  HEADER_COOKIE,
  HEADER_ORIGIN,
  HEADER_REFERER,
  HEADER_USER_AGENT,
  HEADER_X_COZYSSH_FETCH_PREFIX,
  HEADER_X_COZYSSH_URL,
  METHOD_DELETE,
  METHOD_POST,
  METHOD_PUT,
  MIME_JSON,
  LOCAL_NAME,
  LOCAL_VAR_PREFIX,
  DEFAULT_TERMINAL_FONT_SIZE,
} from "./constants";
import { generatePassword, isMuiDialogOpen, terminalIgnoreKeyShortcuts, terminalKeyShortcuts } from "./common";
import {
  type TerminalRefMap,
  getStore,
  notify,
  setActivePaneId,
  setActiveTabId,
  setButtons,
  setHosts,
  setTabs,
  setVars,
  triggerFocus,
  useStore,
} from "./store";
import { dialogs } from "./Dialogs";
import type { AppletData, AppletPosition } from "./AppletWrapper";
import { disableShortcuts } from "./useKeyboardManager";

/**
 * The module type of custom script
 */
export interface CsScriptModule {
  default?: CsScript;
  // [key: string]: unknown;
}

/**
 * id => moduleObj
 */
export const moduleCache: Record<string, CsScriptModule> = {};

window.__CS_REMAP_CTRL_L__ = undefined;
window.__CS_TERMINAL_FONT_SIZE__ = DEFAULT_TERMINAL_FONT_SIZE;
window.__CS_TERMINAL_OPTIONS__ = undefined;
window.__CS_AUTORUN_DONE__ = undefined;
window.__CS_MODULECACHE__ = moduleCache;
window.__CS_VERSION__ = PACKAGE_JSON_VERSION;
window.__CS_USE_STORE__ = useStore;
window.__CS_PASSTHROUGH_SHORTCUTS__ = terminalKeyShortcuts;
window.__CS_TERMINAL_IGNORE_SHORTCUTS__ = terminalIgnoreKeyShortcuts;
window.__CS_DISABLE_SHORTCUTS__ = disableShortcuts;

// window.csSetSidebarFilter = undefined; // Assigned in Sidebar useEffect
window.csAlert = dialogs.alert;
window.csConfirm = dialogs.confirm;
window.csPrompt = dialogs.prompt;
window.csPromptPassword = dialogs.promptPassword;
window.csRunScript = runScript;
window.csNotify = notify;

export interface CsExecResult {
  error: unknown;
  stdout: string;
  stderr: string;
}

const exposeModules = {
  react: react,
  dompurify: dompurify,
  marked: marked,
};

// Generate Blob URLs for each exposed module
const virtualModules: Record<string, string> = {};

for (const [moduleName, moduleObj] of Object.entries(exposeModules)) {
  // Attach safely to window
  const safeName = `__plugin_expose_${moduleName.replace(/[^a-zA-Z0-9]/g, "_")}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[safeName] = moduleObj;

  // Identify named exports (everything except 'default')
  const namedExports = Object.keys(moduleObj).filter((k) => k !== "default");

  // Determine what the 'default' export should be
  // If the module already has a .default, use that. Otherwise, use the whole object.
  const shimCode = `
  const mod = window["${safeName}"];

  // Export the named members
  export const { ${namedExports.join(", ")} } = mod;

  // Export the default member
  // If 'default' exists in the namespace, export that, otherwise the namespace itself
  const defaultExport = mod.default !== undefined ? mod.default : mod;
  export default defaultExport;
`;

  // Turn it into a Blob URL
  const blob = new Blob([shimCode], { type: "application/javascript" });
  virtualModules[moduleName] = URL.createObjectURL(blob);
}

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const virtualModulesImportRegex = (() => {
  const moduleNames = Object.keys(virtualModules).map(escapeRegExp).join("|");
  return new RegExp(
    `((?:from|import)\\s+['"])(${moduleNames})(['"])|(import\\s*\\(\\s*['"])(${moduleNames})(['"]\\))`,
    "g",
  );
})();

export async function runScript(btn: Pick<ButtonData, "id" | "name" | "type" | "payload">) {
  let moduleObj: CsScriptModule;
  let cached = false;

  if (!btn.id || !moduleCache[btn.id]) {
    let scriptCode = btn.payload;
    // Do a single replace pass
    scriptCode = scriptCode.replace(virtualModulesImportRegex, (match, p1, p2, p3, p4, p5, p6) => {
      // Determine which capture group caught the module name
      const matchedModule = p2 || p5;
      const blobUrl = virtualModules[matchedModule];

      // Reconstruct the string using the mapped Blob URL
      if (p1 && p3) {
        return `${p1}${blobUrl}${p3}`; // Standard & Side-effect import
      }
      if (p4 && p6) {
        return `${p4}${blobUrl}${p6}`; // Dynamic import
      }
      return match; // Fallback
    });
    try {
      scriptCode = transform(scriptCode, { transforms: ["typescript", "jsx"] }).code;
    } catch (e) {
      console.error(`Script ${btn.name} Transform Error:`, e);
      notify(`Script ${btn.name} Transform Error: ${e}`, "error");
      return;
    }
    const blob = new Blob([scriptCode], { type: "application/javascript" });
    // Create a temporary URL pointing to that Blob
    const url = URL.createObjectURL(blob);
    try {
      moduleObj = await import(url);
    } catch (e) {
      console.error(`Script ${btn.name} Import Error:`, e);
      notify(`Script ${btn.name} Import Error: ${e}`, "error");
      return;
    } finally {
      // Always clean up the URL to prevent memory leaks
      URL.revokeObjectURL(url);
    }
    if (btn.id && moduleObj.default?.cache) {
      moduleCache[btn.id] = moduleObj;
    }
  } else {
    moduleObj = moduleCache[btn.id];
    cached = true;
  }

  if (moduleObj.default?.run) {
    try {
      await moduleObj.default.run();
    } catch (e) {
      console.error(`Script ${btn.name} run() Error:`, e);
      notify(`Script ${btn.name} run() Error: ${e}`, "error");
    }
  } else if (cached) {
    notify(
      `Script ${btn.name} is already imported & cached, and has no run function. Reload the page to clear the cache`,
      "info",
    );
    return;
  }

  if (!moduleObj.default?.noFocus) {
    triggerFocus();
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PluginAPICallbacks {
  /** Apply a new MUI theme */
  setTheme: (options: unknown, ...args: unknown[]) => void;
  /** Open a new terminal tab */
  handleSelectHost: (
    host: string,
    options?: { title?: string; target?: string; options?: Record<string, string> },
  ) => Promise<void>;
  /** Open a split-pane tab from a tag */
  handleSelectTagAsSplit: (tag: string, hosts: string[], hostOptions?: (Record<string, string> | undefined)[]) => void;
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
  setLocalVars: (v: Record<string, string>) => void;
  /** Getter for the live terminal ref map (avoids store coupling) */
  getTerminalRefs: () => TerminalRefMap;
  getApplets: () => AppletData[];
  /** Close tab or pane */
  handleCloseTabOrPane: (tabOrPaneId?: string) => void;
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
  // ── Variable API ─────────────────────────────────────────────────────────

  window.csGetVar = ((name?: string) => {
    const { vars, localVars } = getStore();
    if (name) {
      if (name.toLowerCase().startsWith(LOCAL_VAR_PREFIX)) {
        return localVars[name];
      }
      return vars[name];
    }
    return { ...vars, ...localVars };
  }) as typeof window.csGetVar;

  window.csSetVar = async (nameOrVars: string | Record<string, string | undefined>, value?: string | undefined) => {
    const { vars, localVars } = getStore();
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const updates: Record<string, string | null> = {};
    const localUpdates: Record<string, string | undefined> = {};

    if (typeof nameOrVars === "string") {
      if (nameOrVars.toLowerCase().startsWith(LOCAL_VAR_PREFIX)) {
        localUpdates[nameOrVars] = value;
      } else {
        updates[nameOrVars] = value === undefined ? null : value;
      }
    } else {
      for (const k in nameOrVars) {
        const v = nameOrVars[k];
        if (k.toLowerCase().startsWith(LOCAL_VAR_PREFIX)) {
          localUpdates[k] = v;
        } else {
          updates[k] = v === undefined ? null : v;
        }
      }
    }

    if (Object.keys(localUpdates).length > 0) {
      const newLocalVars = { ...localVars };
      for (const [key, value] of Object.entries(localUpdates)) {
        if (value === undefined) {
          delete newLocalVars[key];
        } else {
          newLocalVars[key] = value;
        }
      }
      cb.setLocalVars(newLocalVars);
    }
    if (Object.keys(updates).length === 0) {
      return;
    }

    const r = await fetch("/api/vars", {
      method: METHOD_PUT,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(updates),
    });
    if (!r.ok) {
      throw new Error(await r.text());
    }

    const nextVars = { ...vars };
    for (const k in updates) {
      const v = updates[k];
      if (v === null) {
        delete nextVars[k];
      } else {
        nextVars[k] = v;
      }
    }
    setVars(nextVars);
  };

  window.csGetApplet = ((name?: string) => {
    const applets = cb.getApplets();
    return name ? applets.find((a) => a.name === name) : applets;
  }) as typeof window.csGetApplet;

  // ── Terminal API ──────────────────────────────────────────────────────────

  window.csGetTerminal = (paneId?: string) => {
    const { activePaneId } = getStore();
    const refs = cb.getTerminalRefs();
    const term = refs[paneId ?? activePaneId];
    return term && "getXterm" in term ? term.getXterm() : undefined;
  };

  window.csGetTerminalHandle = (paneId?: string) => {
    const { activePaneId } = getStore();
    const refs = cb.getTerminalRefs();
    const ref = refs[paneId ?? activePaneId];
    return ref && "getXterm" in ref ? ref : undefined;
  };

  window.csGetShellIntegration = (paneId?: string) => {
    const { shellIntegrations, activePaneId } = getStore();
    return shellIntegrations[paneId ?? activePaneId];
  };

  window.csGetAll = () => {
    const { activeTabId, activePaneId, shellIntegrations, tabs, hosts, buttons, vars, localVars } = getStore();
    return {
      activeTabId,
      activePaneId,
      terminals: cb.getTerminalRefs(),
      shellIntegrations,
      tabs,
      hosts,
      buttons,
      vars,
      localVars,
    };
  };

  window.csSendData = (data: string, paneId?: string) => {
    const { activePaneId } = getStore();
    const refs = cb.getTerminalRefs();
    const term = refs[paneId ?? activePaneId];
    if (term && "getXterm" in term) {
      term.sendData(data);
    }
  };

  window.csGetTerminalContents = (lineCount = 100, paneId?: string) => {
    const { activePaneId } = getStore();
    const refs = cb.getTerminalRefs();
    const term = refs[paneId ?? activePaneId];
    if (!term || !("getXterm" in term)) {
      return "";
    }
    const xterm = term.getXterm();
    if (!xterm) {
      return "";
    }

    const buffer = xterm.buffer.active;
    const lines: string[] = [];
    const end = buffer.baseY + buffer.cursorY;
    const start = lineCount <= 0 ? 0 : Math.max(0, end - lineCount);
    for (let i = start; i <= end; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    return lines.join("\n");
  };

  window.csFocus = (tabOrPaneId?: string) => {
    if (isMuiDialogOpen()) {
      return;
    }
    const { activePaneId, tabs } = getStore();
    if (tabOrPaneId) {
      const tab = tabs.find((t) => t.id === tabOrPaneId);
      if (tab) {
        setActiveTabId(tab.id);
        setActivePaneId(tab.activePaneId);
      } else if (tabOrPaneId !== activePaneId) {
        const allPanes = tabs.flatMap((t) => t.panes.map((p) => ({ tabId: t.id, paneId: p.id })));
        const idx = allPanes.findIndex((p) => p.paneId === tabOrPaneId);
        if (idx >= 0) {
          const target = allPanes[idx];
          setActiveTabId(target.tabId);
          setActivePaneId(target.paneId);
          setTabs((tabs) => tabs.map((t) => (t.id === target.tabId ? { ...t, activePaneId: target.paneId } : t)));
        }
      }
    }
    triggerFocus();
  };

  window.csFetch = async (url: string, options = {}) => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const { key: t, ...fetchOptions } = options;
    const proxyUrl = `/api/fetch?_t=${t || `${Date.now()}-${generatePassword(12)}`}`;
    const rawHeaders = new Headers(fetchOptions.headers);
    const headers: Record<string, string> = {};
    const restricted = [HEADER_AUTHORIZATION, HEADER_REFERER, HEADER_ORIGIN, HEADER_USER_AGENT, HEADER_COOKIE];
    headers[HEADER_AUTHORIZATION] = HEADER_AUTHORIZATION_BEARER_PREFIX + token;
    headers[HEADER_X_COZYSSH_URL] = url;
    for (const key in rawHeaders) {
      if (restricted.includes(key.toLowerCase())) {
        headers[HEADER_X_COZYSSH_FETCH_PREFIX + key] = rawHeaders.get(key)!;
      } else {
        headers[key] = rawHeaders.get(key)!;
      }
    }
    return fetch(proxyUrl, { ...fetchOptions, headers });
  };

  window.csExec = async (cmdline: string) => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const res = await fetch("/api/exec", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify({ cmdline } satisfies ExecRequest),
    });
    if (!res.ok) {
      throw new Error("Exec failed: " + res.statusText);
    }
    return res.json() as Promise<ExecResult>;
  };

  window.csSetTheme = (options, ...args) => cb.setTheme(options, ...args);

  // ── Navigation API ────────────────────────────────────────────────────────

  window.csOpen = (host, { title, target }: { title?: string; target?: string } = {}) => {
    const { hosts } = getStore();
    const targetHosts = Array.isArray(host) ? host.slice(0, 4) : [host];
    const hostNames: string[] = [];
    const hostOptions: (Record<string, string> | undefined)[] = [];
    for (let targetHost of targetHosts) {
      if (typeof targetHost === "object") {
        hostNames.push(targetHost.name);
        hostOptions.push(undefined);
      } else if (typeof targetHost === "string") {
        let option: Record<string, string> | undefined = undefined;
        const i = targetHost.lastIndexOf("?");
        if (i !== -1) {
          option = Object.fromEntries(new URLSearchParams(targetHost.slice(i)));
          targetHost = targetHost.slice(0, i);
        }
        hostOptions.push(option);
        if (targetHost === LOCAL_NAME) {
          hostNames.push(LOCAL_NAME);
        } else {
          const known = hosts.find((h) => h.name === targetHost || h.hostname === targetHost);
          if (known) {
            hostNames.push(known.name);
          } else {
            hostNames.push(targetHost);
          }
        }
      }
    }
    title = title || hostNames[0];
    if (target === "_self") {
      target = getStore().activeTabId;
    } else if (target === "_blank") {
      target = undefined;
    }
    if (hostNames.length > 1) {
      cb.handleSelectTagAsSplit(title, hostNames, hostOptions);
    } else {
      cb.handleSelectHost(hostNames[0], { title, target, options: hostOptions[0] });
    }
  };

  window.csAttach = (id: string, host: string, title: string, isLocked = false) => {
    cb.handleAttach(id, host, title, isLocked);
  };

  window.csRefresh = async () => {
    await cb.handleRefresh();
  };

  window.csClose = (tabOrPaneId?: string) => {
    cb.handleCloseTabOrPane(tabOrPaneId);
  };

  // ── Applet API ────────────────────────────────────────────────────────────

  window.csOpenApplet = (
    name,
    node,
    options: { position?: AppletPosition; width?: number | string; height?: number | string } = {},
  ) => {
    let parsedPos: AppletPosition;
    if (options.position === "dialog") {
      parsedPos = "dialog";
    } else if (options.position === "sidebar" || cb.isMobile) {
      parsedPos = "sidebar";
    } else {
      parsedPos = "widget";
    }
    if (cb.isMobile && parsedPos === "sidebar" && window.__CS_AUTORUN_DONE__) {
      cb.setMobileAppletsOpen(true);
    }
    cb.setApplets((prev) => {
      const existing = prev.find((a) => a.name === name);
      if (existing) {
        return prev.map((a) =>
          a.name === name ? { ...a, node, width: options.width ?? a.width, height: options.height ?? a.height } : a,
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

  window.csCloseApplet = (name: string) => {
    cb.setApplets((prev) => prev.filter((a) => a.name !== name));
  };

  // applets live in React state
  // own csGetApplet useEffect that depends on [applets].
  // We leave it as-is in Dashboard rather than fighting React here.
  // window.csGetApplet = (_name?: string) => {};

  // ── Button / Host CRUD API ────────────────────────────────────────────────

  window.csUpdateButton = async (btn: ButtonData | ButtonData[]): Promise<void> => {
    const btns = Array.isArray(btn) ? btn : [btn];
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);

    const res = await fetch("/api/buttons", {
      method: METHOD_POST,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(btns),
    });

    if (!res.ok) {
      throw new Error(`Failed to update button: ${res.statusText}`);
    }

    // Refresh buttons in store
    const refreshRes = await fetch("/api/buttons", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    if (refreshRes.ok) {
      const data: ButtonData[] = await refreshRes.json();
      setButtons(data || []);
    }
  };

  window.csDeleteButton = async (id: string): Promise<void> => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const res = await fetch(`/api/buttons/${id}`, {
      method: METHOD_DELETE,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to delete button: ${res.statusText}`);
    }

    // Refresh buttons in store
    const refreshRes = await fetch("/api/buttons", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    if (refreshRes.ok) {
      const data: ButtonData[] = await refreshRes.json();
      setButtons(data || []);
    }
  };

  window.csUpdateHost = async (host: HostData): Promise<void> => {
    const { hosts } = getStore();
    const exists = hosts.some((h) => h.name === host.name && h.source === "config");

    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const method = exists ? METHOD_PUT : METHOD_POST;
    const url = exists ? `/api/hosts/${encodeURIComponent(host.name)}` : "/api/hosts";

    const body: HostData = {
      name: host.name,
      hostname: host.hostname,
      user: host.user || "root",
      port: host.port ? String(host.port) : "22",
      identity_file: host.identity_file || "",
      proxy_jump: host.proxy_jump || "",
      remote_command: host.remote_command || "",
      tags: host.tags || [],
      comment: host.comment || "",
      source: host.source || "",
    };

    const res = await fetch(url, {
      method,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
        [HEADER_CONTENT_TYPE]: MIME_JSON,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Failed to update host: ${res.statusText}`);
    }

    // Refresh hosts in store
    const refreshRes = await fetch("/api/hosts", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    if (refreshRes.ok) {
      const data: HostData[] = await refreshRes.json();
      setHosts(data || []);
    }
  };

  window.csDeleteHost = async (name: string): Promise<void> => {
    const token = localStorage.getItem(BROWSER_STORAGE_KEY_TOKEN);
    const res = await fetch(`/api/hosts/${encodeURIComponent(name)}`, {
      method: METHOD_DELETE,
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to delete host: ${res.statusText}`);
    }

    // Refresh hosts in store
    const refreshRes = await fetch("/api/hosts", {
      headers: {
        [HEADER_AUTHORIZATION]: HEADER_AUTHORIZATION_BEARER_PREFIX + token,
      },
    });
    if (refreshRes.ok) {
      const data: HostData[] = await refreshRes.json();
      setHosts(data || []);
    }
  };

  // ── Teardown ──────────────────────────────────────────────────────────────

  return () => {
    const keys = [
      "csGetVar",
      "csSetVar",
      "csGetTerminal",
      "csGetTerminalHandle",
      "csGetShellIntegration",
      "csGetAll",
      "csSendData",
      "csGetTerminalContents",
      "csFocus",
      "csFetch",
      "csExec",
      "csSetTheme",
      "csOpen",
      "csAttach",
      "csRefresh",
      "csClose",
      "csOpenApplet",
      "csCloseApplet",
      "csGetApplet",
      "csUpdateButton",
      "csDeleteButton",
      "csUpdateHost",
      "csDeleteHost",
    ] as const;
    for (const k of keys) {
      delete (window as Partial<typeof globalThis>)[k];
    }
  };
}
