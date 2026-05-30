interface VirtualKeyboard extends EventTarget {
  readonly boundingRect: DOMRect;
  overlaysContent: boolean;
  ongeometrychange: ((this: VirtualKeyboard, ev: Event) => unknown) | null;
  show(): void;
  hide(): void;
  addEventListener(
    type: "geometrychange",
    listener: (this: VirtualKeyboard, ev: Event) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

declare global {
  interface Navigator {
    readonly virtualKeyboard?: VirtualKeyboard;
  }
}

export {};
