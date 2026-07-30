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

import { version as PACKAGE_JSON_VERSION } from "../package.json";
import type { HostData, ButtonData, ExecRequest, ExecResult } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  HEADER_AUTHORIZATION,
  HEADER_AUTHORIZATION_BEARER_PREFIX,
  HEADER_COOKIE,
  HEADER_ORIGIN,
  HEADER_REFERER,
  HEADER_USER_AGENT,
  HEADER_X_COZYSSH_FETCH_PREFIX,
  HEADER_X_COZYSSH_URL,
  METHOD_DELETE,
  METHOD_POST,
  METHOD_PUT,
  LOCAL_VAR_PREFIX,
  DEFAULT_FONT_SIZE,
  VAR_CS_FONT_SIZE,
} from "./constants";
import {
  defaultThemeOptions,
  DefaultXtermOptions,
  generatePassword,
  getActiveMuiModal,
  liquidEngine,
  passthroughKeyShortcuts,
  blackholeShortcuts,
  disableShortcuts,
  apiReqHeaders,
  macModifierSwap,
  sendKeyDown,
} from "./common";
import {
  activatePane,
  attachSession,
  closeTabOrPane,
  getStore,
  notify,
  openHostsAsSplit2,
  setButtons,
  setHosts,
  setLocalVars,
  setMobileAppletsOpen,
  setVars,
  triggerFocus,
  useStore,
  getIntVar,
  refreshData,
  toastKeyMuteSet,
  fetchSessions,
  setFilterStr,
  fetchActiveTunnels,
  setExtraHostMenu,
  setExtraTabMenu,
  setExtraButtonMenu,
  unloadButton,
  setExtraHostFormMenu,
  setExtraButtonFormMenu,
  setExtraGroupMenu,
  setExtraTagMenu,
  setExtraMainMenu,
  setExtraTabBarMenu,
  setExtraNtdMenu,
  setExtraButtonBarMenu,
  runButton,
} from "./store";
import { dialogs } from "./Dialogs";
import type { ITerminalOptions } from "@xterm/xterm";
import { openMenu } from "./DynamicMenu";
import { moduleCache } from "./store";

window.__CS_REMAP_CTRL_L__ = undefined;
window.__CS_AUTORUN_DONE__ = undefined;
window.__CS_MODULECACHE__ = moduleCache;
window.__CS_USE_STORE__ = useStore;
window.__CS_PASSTHROUGH_SHORTCUTS__ = passthroughKeyShortcuts;
window.__CS_DISABLE_SHORTCUTS__ = disableShortcuts;
window.__CS_BLACKHOLE_SHORTCUTS__ = blackholeShortcuts;
window.__CS_LIQUID_ENGINE__ = liquidEngine;
window.__CS_RUNNING_SCRIPT__ = undefined;
window.__CS_SHORTCUT_BUTTONS__ = {};
window.__CS_CUSTOM_SHORTCUTS__ = {};
window.__CS_TOAST_KEY_MUTE_SET__ = toastKeyMuteSet;
window.__CS_MAC_MODIFIER_SWAP__ = macModifierSwap;
window.__CS_VERSION__ = PACKAGE_JSON_VERSION;
window.__CS_ENV__ = window.appToggleFullscreen ? 1 : 0;
window.__CS_LANG__ = import.meta.env.VITE_APP_LANG || "en";
document.documentElement.dataset.csEnv = `${__CS_ENV__}`;
document.documentElement.dataset.csVersion = PACKAGE_JSON_VERSION;
document.documentElement.dataset.csAutorunDone = "";

if (__CS_ENV__ === 1) {
  const urlClickHandle = function (e: MouseEvent) {
    if (e.button >= 2) {
      return;
    }
    let aEl: HTMLAnchorElement | null = null;
    let el = e.target as HTMLElement | null;
    let i = 0;
    main: while (el && i < 5) {
      i++;
      switch (el.tagName) {
        case "A":
          aEl = el as HTMLAnchorElement;
          break main;
        case "div":
        case "p":
          break main;
        default:
          el = el.parentElement;
      }
    }
    if (aEl && aEl.target === "_blank" && aEl.href) {
      e.preventDefault();
      appOpenUrl!(aEl.href);
    }
  };
  window.addEventListener("click", urlClickHandle);
  window.addEventListener("auxclick", urlClickHandle);
  const location = {};
  Object.defineProperty(location, "href", {
    get() {
      return undefined;
    },
    set(value) {
      if (value) {
        appOpenUrl!(value);
      }
    },
  });
  const dummyWindow = { location } as Window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)["_open"] = window.open;
  (window as Partial<typeof globalThis>).open = function (url) {
    if (url) {
      appOpenUrl!(new URL(url).href);
      return null;
    } else {
      return dummyWindow;
    }
  };
}

// Use Proxy to intercept __CS_TERMINAL_OPTIONS__
(function () {
  let isCallbackScheduled = false;

  function onObjectSettled(finalValue: ITerminalOptions) {
    // console.log("[Callback] __CS_TERMINAL_OPTIONS__ Object changes finalized. New state:", finalValue);
    const terminals = csGetAll().terminals;
    for (const term of Object.values(terminals)) {
      if (term && "getXterm" in term) {
        const xterm = term.getXterm();
        if (xterm) {
          xterm.options = { ...DefaultXtermOptions, ...finalValue };
          term.fit();
        }
      }
    }
  }

  function scheduleCallback() {
    if (!isCallbackScheduled) {
      isCallbackScheduled = true;
      queueMicrotask(() => {
        onObjectSettled(currentTarget);
        isCallbackScheduled = false;
      });
    }
  }

  const mutationHandler: ProxyHandler<ITerminalOptions> = {
    set(target, prop, value, receiver) {
      const success = Reflect.set(target, prop, value, receiver);
      if (success) {
        scheduleCallback();
      }
      return success;
    },
  };

  // FIX 1 & 2: Check if window.myObj already has data from previous scripts.
  // Then, immediately wrap it in a Proxy so property changes work right away.
  const initialData = window.__CS_TERMINAL_OPTIONS__ || {};
  let currentTarget: ITerminalOptions = new Proxy(initialData, mutationHandler);

  // If there was already data present on load, trigger the callback for it
  if (window.__CS_TERMINAL_OPTIONS__) {
    scheduleCallback();
  }

  Object.defineProperty(window, "__CS_TERMINAL_OPTIONS__", {
    get() {
      return currentTarget;
    },
    set(newValue: ITerminalOptions) {
      // Fallback to {} if someone sets it to null/undefined to prevent proxy crashes
      currentTarget = new Proxy(newValue || {}, mutationHandler);
      scheduleCallback();
    },
    configurable: true,
    enumerable: true,
  });
})();

let csFontSize = getIntVar(VAR_CS_FONT_SIZE, DEFAULT_FONT_SIZE);

Object.defineProperty(window, "__CS_FONT_SIZE__", {
  get() {
    return csFontSize;
  },
  set(newValue) {
    if (
      typeof newValue !== "number" ||
      Number.isNaN(newValue) ||
      newValue <= 0 ||
      newValue >= 100 ||
      newValue === csFontSize
    ) {
      return;
    }
    csFontSize = newValue;
    csSetTheme(defaultThemeOptions({ fontSize: csFontSize }));
  },
  configurable: true,
  enumerable: true,
});

Object.defineProperty(window, "__CS_EXTRA_HOST_MENU__", {
  get() {
    return getStore().extraHostMenu;
  },
  set: setExtraHostMenu,
});

Object.defineProperty(window, "__CS_EXTRA_TAB_MENU__", {
  get() {
    return getStore().extraTabMenu;
  },
  set: setExtraTabMenu,
});

Object.defineProperty(window, "__CS_EXTRA_BUTTON_MENU__", {
  get() {
    return getStore().extraButtonMenu;
  },
  set: setExtraButtonMenu,
});

Object.defineProperty(window, "__CS_EXTRA_GROUP_MENU__", {
  get() {
    return getStore().extraGroupMenu;
  },
  set: setExtraGroupMenu,
});

Object.defineProperty(window, "__CS_EXTRA_TAG_MENU__", {
  get() {
    return getStore().extraTagMenu;
  },
  set: setExtraTagMenu,
});

Object.defineProperty(window, "__CS_EXTRA_HOST_FORM_MENU__", {
  get() {
    return getStore().extraHostFormMenu;
  },
  set: setExtraHostFormMenu,
});
Object.defineProperty(window, "__CS_EXTRA_BUTTON_FORM_MENU__", {
  get() {
    return getStore().extraButtonFormMenu;
  },
  set: setExtraButtonFormMenu,
});

Object.defineProperty(window, "__CS_EXTRA_MAIN_MENU__", {
  get() {
    return getStore().extraMainMenu;
  },
  set: setExtraMainMenu,
});

Object.defineProperty(window, "__CS_EXTRA_TAB_BAR_MENU__", {
  get() {
    return getStore().extraTabBarMenu;
  },
  set: setExtraTabBarMenu,
});

Object.defineProperty(window, "__CS_EXTRA_BUTTON_BAR_MENU__", {
  get() {
    return getStore().extraButtonBarMenu;
  },
  set: setExtraButtonBarMenu,
});

Object.defineProperty(window, "__CS_EXTRA_NTD_MENU__", {
  get() {
    return getStore().extraNtdMenu;
  },
  set: setExtraNtdMenu,
});

window.csAlert = dialogs.alert;
window.csConfirm = dialogs.confirm;
window.csPrompt = dialogs.prompt;
window.csPromptPassword = dialogs.promptPassword;
window.csChoose = dialogs.choose;
window.csRunButton = runButton;
window.csNotify = notify;
window.csOpen = openHostsAsSplit2;
window.csOpenMenu = openMenu;
window.csAttach = attachSession;
window.csRefresh = refreshData;
window.csClose = closeTabOrPane;
window.csGetSessions = fetchSessions;
window.csGetTunnels = fetchActiveTunnels;
window.csSetSidebarFilter = setFilterStr;
window.csSendKeyDown = sendKeyDown;

window.csFocus = (tabOrPaneId?: string) => {
  if (getActiveMuiModal()) {
    return;
  }
  if (tabOrPaneId) {
    const tab = getStore().tabs.find((t) => t.id === tabOrPaneId);
    if (tab) {
      activatePane(tab.activePaneId, tab.id);
    } else {
      activatePane(tabOrPaneId);
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
  const res = await fetch("/api/exec", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ cmdline } satisfies ExecRequest),
  });
  if (!res.ok) {
    throw new Error("Exec failed: " + res.statusText);
  }
  return res.json() as Promise<ExecResult>;
};

window.csExecInTerminal = async (cmdline: string, paneId?: string) => {
  // Resolve paneId: use provided value, fall back to active pane.
  const resolvedPaneId = paneId ?? getStore().activePaneId;
  const res = await fetch("/api/exec_in_terminal", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify({ cmdline, paneId: resolvedPaneId }),
  });
  if (!res.ok) {
    throw new Error("ExecInTerminal failed: " + res.statusText);
  }
  return res.json() as Promise<ExecResult>;
};

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

window.csGetShellIntegration = (paneId?: string) => {
  const { shellIntegrations, activePaneId } = getStore();
  return shellIntegrations[paneId ?? activePaneId];
};

window.csSetVar = async (nameOrVars: string | Record<string, string | undefined>, value?: string | undefined) => {
  const { vars, localVars } = getStore();
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
    setLocalVars(newLocalVars);
  }
  if (Object.keys(updates).length === 0) {
    return;
  }

  const res = await fetch("/api/vars", {
    method: METHOD_PUT,
    headers: apiReqHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    throw new Error(`status=${res.status}, msg=${await res.text()}`);
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

// ── Button / Host CRUD API ────────────────────────────────────────────────

window.csUpdateButton = async (btn: ButtonData | ButtonData[]): Promise<void> => {
  const btns = Array.isArray(btn) ? btn : [btn];

  const res = await fetch("/api/buttons", {
    method: METHOD_POST,
    headers: apiReqHeaders(),
    body: JSON.stringify(btns),
  });

  if (!res.ok) {
    throw new Error(`Failed to update button: ${res.statusText}`);
  }

  // Refresh buttons in store
  const refreshRes = await fetch("/api/buttons", { headers: apiReqHeaders() });
  if (refreshRes.ok) {
    const data: ButtonData[] = await refreshRes.json();
    setButtons(data || []);
  }
};

window.csDeleteButton = async (id: string, unloadOnly = false): Promise<void> => {
  unloadButton(id);
  if (unloadOnly) {
    return;
  }
  const res = await fetch(`/api/buttons/${id}`, { method: METHOD_DELETE, headers: apiReqHeaders() });

  if (!res.ok) {
    throw new Error(`Failed to delete button: ${res.statusText}`);
  }

  // Refresh buttons in store
  const refreshRes = await fetch("/api/buttons", { headers: apiReqHeaders() });
  if (refreshRes.ok) {
    const data: ButtonData[] = await refreshRes.json();
    setButtons(data || []);
  }
};

window.csUpdateHost = async (host: HostData | HostData[]): Promise<void> => {
  const res = await fetch("/api/hosts", {
    method: METHOD_PUT,
    headers: apiReqHeaders(),
    body: JSON.stringify(Array.isArray(host) ? host : [host]),
  });

  if (!res.ok) {
    throw new Error(`Failed to update host: ${res.statusText}`);
  }

  // Refresh hosts in store
  const refreshRes = await fetch("/api/hosts", { headers: apiReqHeaders() });
  if (refreshRes.ok) {
    const data: HostData[] = await refreshRes.json();
    setHosts(data || []);
  }
};

window.csDeleteHost = async (name: string): Promise<void> => {
  const res = await fetch(`/api/hosts/${encodeURIComponent(name)}`, {
    method: METHOD_DELETE,
    headers: apiReqHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to delete host: ${res.statusText}`);
  }

  // Refresh hosts in store
  const refreshRes = await fetch("/api/hosts", { headers: apiReqHeaders() });
  if (refreshRes.ok) {
    const data: HostData[] = await refreshRes.json();
    setHosts(data || []);
  }
};

window.csGetAll = () => {
  const { activeTabId, activePaneId, shellIntegrations, tabs, hosts, buttons, vars, localVars } = getStore();
  return {
    activeTabId,
    activePaneId,
    terminals: __CS_TERMINALS__.current,
    shellIntegrations,
    tabs,
    hosts,
    buttons,
    vars,
    localVars,
  };
};

window.csSendData = (data: string | BufferSource | Blob, paneId?: string) => {
  const { activePaneId } = getStore();
  const term = __CS_TERMINALS__.current[paneId ?? activePaneId];
  if (term && "getXterm" in term) {
    term.sendData(data);
  }
};

window.csGetTerminal = (paneId?: string) => {
  const { activePaneId } = getStore();
  const term = __CS_TERMINALS__.current[paneId ?? activePaneId];
  return term && "getXterm" in term ? term.getXterm() : undefined;
};

window.csGetTerminalHandle = (paneId?: string) => {
  const { activePaneId } = getStore();
  const ref = __CS_TERMINALS__.current[paneId ?? activePaneId];
  return ref && "getXterm" in ref ? ref : undefined;
};

window.csGetTerminalContents = (lineCount = 100, paneId?: string) => {
  const { activePaneId } = getStore();
  const term = __CS_TERMINALS__.current[paneId ?? activePaneId];
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

window.csGetApplet = ((name?: string) => {
  return name ? __CS_APPLETS__.current.find((a) => a.name === name) : __CS_APPLETS__.current;
}) as typeof window.csGetApplet;

window.csOpenApplet = (name, node, options = {}) => {
  // eslint-disable-next-line prefer-const
  let { position, ...opts } = options;
  if (!position) {
    if (__CS_IS_MOBILE__) {
      position = "sidebar";
    } else {
      position = "widget";
    }
  }
  if (!opts.zIndex) {
    opts.zIndex = __CS_MAX_ZINDEX__.current++;
  } else if (opts.zIndex > __CS_MAX_ZINDEX__.current) {
    __CS_MAX_ZINDEX__.current = opts.zIndex;
  }
  if (__CS_IS_MOBILE__ && position === "sidebar" && window.__CS_AUTORUN_DONE__) {
    setMobileAppletsOpen(true);
  }
  csSetApplets((prev) => {
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
        position,
        ...opts,
      },
    ];
  });
};

window.csCloseApplet = (name?: string) => {
  csSetApplets(name ? (prev) => prev.filter((a) => a.name !== name) : []);
};
