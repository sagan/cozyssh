import type { Terminal } from "@xterm/xterm";

import type { ButtonData, HostData } from "./api";
import type {
  CS_EVENT_SHELL_INTEGRATION,
  CS_EVENT_TERMINAL_CHANGE,
  CS_EVENT_TERMINAL_CONNECTED,
  CS_EVENT_TERMINAL_DATA,
  CS_EVENT_TERMINAL_DISCONNECTED,
  CS_EVENT_TERMINAL_NEW,
  CS_EVENT_TERMINAL_RESIZE,
  CSEventDetailActiveGroupChange,
  CSEventDetailShellIntegration,
  CSEventDetailTerminalConnected,
  CSEventDetailTerminalData,
  CSEventDetailTerminalDisconnected,
  CSEventDetailTerminalNew,
  CSEventDetailTerminalResize,
  Severity,
} from "./common";
import type { AppletPosition, CsExecResult } from "./pluginAPI";
import type { TerminalRefMap, TabData, UseStore } from "./store";
import type { AppletData } from "./AppletWrapper";
import type { ShellIntegration, TerminalHandle } from "./Terminal";
import type { DialogApi } from "./Dialogs";

interface VirtualKeyboard extends EventTarget {
  readonly boundingRect: DOMRect;
  overlaysContent: boolean;
  ongeometrychange: ((this: VirtualKeyboard, ev: Event) => unknown) | null;
  show(): void;
  hide(): void;
  addEventListener(
    type: "geometrychange",
    listener: (this: VirtualKeyboard, ev: Event) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
}

declare global {
  interface Navigator {
    readonly virtualKeyboard?: VirtualKeyboard;
  }
  interface Window {
    __CS_AUTORUN_DONE__: undefined | number;
    __CS_MODULECACHE__: Record<string, Record<string, unknown>>;
    __CS_VERSION__: string;
    __CS_USE_STORE__: UseStore;
    __CS_PASSTHROUGH_SHORTCUTS__: Set<string>;
    __CS_DISABLE_SHORTCUTS__: Set<string>;
    csFocus: (paneId?: string) => void;
    csNotify: (msg: string, severity?: Severity) => void;
    csOpen: (target: HostData | string | (HostData | string)[], options?: { name?: string }) => void;
    csClose: (tabOrPaneId?: string) => void;
    csGetTerminal: (paneId?: string) => Terminal | undefined | null;
    csGetTerminalHandle: (paneId?: string) => TerminalHandle | undefined;
    csGetTerminalContents: (lineCount?: number, paneId?: string) => string;
    csGetShellIntegration: (paneId?: string) => ShellIntegration | undefined;
    csSendData: (data: string, paneId?: string) => void;
    csGetAll: () => {
      activeTabId: string | undefined;
      activePaneId: string | undefined;
      terminals: TerminalRefMap;
      shellIntegrations: Record<string, ShellIntegration>;
      tabs: TabData[];
      hosts: HostData[];
      buttons: ButtonData[];
      vars: Record<string, string | undefined>;
      localVars: Record<string, string | undefined>;
    };
    csFetch: (url: string, init?: RequestInit) => Promise<Response>;
    csGetVar: ((name: string) => string | undefined) | (() => Record<string, string>);
    csSetVar:
      | ((nameOrVars: string, value: string | undefined) => Promise<void>)
      | ((vars: Record<string, string | undefined>) => Promise<void>);
    csUpdateButton: (btn: ButtonData) => Promise<string>;
    csDeleteButton: (id: string) => Promise<void>;
    csUpdateHost: (btn: HostData) => Promise<void>;
    csDeleteHost: (id: string) => Promise<void>;
    csExec: (cmdline: string) => Promise<CsExecResult>;
    csOpenApplet(
      name: string,
      node: Node | React.ComponentType,
      options?: { position?: AppletPosition; width?: number; height?: number }
    ): void;
    csCloseApplet: (name: string) => void;
    csGetApplet: ((name: string) => AppletData | undefined) | (() => AppletData[]);
    csRefresh: () => Promise<void>;
    csSetTheme: (options: unknown, ...args: unknown[]) => void;
    csAttach: (id: string, host: string, title: string, isLocked?: boolean) => void;
    csAlert: DialogApi["alert"];
    csConfirm: DialogApi["confirm"];
    csPrompt: DialogApi["prompt"];
  }
  interface WindowEventMap {
    [CS_EVENT_TERMINAL_NEW]: CustomEvent<CSEventDetailTerminalNew>;
    [CS_EVENT_TERMINAL_CONNECTED]: CustomEvent<CSEventDetailTerminalConnected>;
    [CS_EVENT_TERMINAL_DISCONNECTED]: CustomEvent<CSEventDetailTerminalDisconnected>;
    [CS_EVENT_TERMINAL_DATA]: CustomEvent<CSEventDetailTerminalData>;
    [CS_EVENT_TERMINAL_RESIZE]: CustomEvent<CSEventDetailTerminalResize>;
    [CS_EVENT_TERMINAL_CHANGE]: CustomEvent<CSEventDetailActiveGroupChange>;
    [CS_EVENT_SHELL_INTEGRATION]: CustomEvent<CSEventDetailShellIntegration>;
  }
}

export {};
