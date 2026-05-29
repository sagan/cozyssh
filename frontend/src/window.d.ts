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
  var __CS_AUTORUN_DONE__: undefined | number;
  var __CS_MODULECACHE__: Record<string, Record<string, unknown>>;
  var __CS_VERSION__: string;
  var __CS_USE_STORE__: UseStore;
  var __CS_PASSTHROUGH_SHORTCUTS__: Set<string>;
  var __CS_DISABLE_SHORTCUTS__: Set<string>;
  function csFocus(paneId?: string): void;
  function csNotify(msg: string, severity?: Severity): void;
  function csOpen(target: HostData | string | (HostData | string)[], options?: { name?: string }): void;
  function csClose(tabOrPaneId?: string): void;
  function csGetTerminal(paneId?: string): Terminal | undefined | null;
  function csGetTerminalHandle(paneId?: string): TerminalHandle | undefined;
  function csGetTerminalContents(lineCount?: number, paneId?: string): string;
  function csGetShellIntegration(paneId?: string): ShellIntegration | undefined;
  function csSendData(data: string, paneId?: string): void;
  function csGetAll(): {
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
  function csFetch(url: string, init?: RequestInit): Promise<Response>;
  function csGetVar(name: string): string | undefined;
  function csGetVar(): Record<string, string>;
  function csSetVar(nameOrVars: string, value: string | undefined): Promise<void>;
  function csSetVar(vars: Record<string, string | undefined>): Promise<void>;
  function csUpdateButton(btn: ButtonData): Promise<string>;
  function csDeleteButton(id: string): Promise<void>;
  function csUpdateHost(btn: HostData): Promise<void>;
  function csDeleteHost(id: string): Promise<void>;
  function csExec(cmdline: string): Promise<CsExecResult>;
  function csOpenApplet(
    name: string,
    node: Node | React.ComponentType,
    options?: { position?: AppletPosition; width?: number; height?: number }
  ): void;
  function csCloseApplet(name: string): void;
  function csGetApplet(name: string): AppletData | undefined;
  function csGetApplet(): AppletData[];
  function csRefresh(): Promise<void>;
  function csSetTheme(options: unknown, ...args: unknown[]): void;
  function csAttach(id: string, host: string, title: string, isLocked?: boolean): void;
  function csAlert(message?: string, detail?: string): Promise<void>;
  function csConfirm(message?: string, detail?: string): Promise<boolean>;
  function csPrompt(
    message?: string,
    defaultValue?: string,
    options?: {
      placeholder?: string;
      validate?: (value: string) => string | undefined;
    }
  ): Promise<string | null>;
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
