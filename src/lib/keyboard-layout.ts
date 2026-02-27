type VisualViewportLike = {
  height: number;
  addEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  removeEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
};

type KeyboardWindowLike = {
  innerHeight: number;
  visualViewport?: VisualViewportLike | null;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (handler: () => void, timeout?: number) => number;
  clearTimeout: (handle: number | undefined) => void;
  addEventListener: (type: 'focusout' | 'resize' | 'orientationchange', listener: () => void) => void;
  removeEventListener: (type: 'focusout' | 'resize' | 'orientationchange', listener: () => void) => void;
  scrollTo: (x: number, y: number) => void;
};

export type KeyboardLayout = {
  keyboardOffset: number;
};

export function calculateKeyboardLayout(
  innerHeight: number,
  viewportHeight: number,
): KeyboardLayout {
  const keyboardOffset = Math.max(0, innerHeight - viewportHeight);
  return { keyboardOffset };
}

export function applyKeyboardCssVars(root: HTMLElement, layout: KeyboardLayout) {
  root.style.setProperty('--keyboard-offset', `${layout.keyboardOffset}px`);
}

export function subscribeToKeyboardLayout(
  windowObj: KeyboardWindowLike,
  documentObj: Document,
  onLayout: (layout: KeyboardLayout) => void,
) {
  const viewport = windowObj.visualViewport;
  if (!viewport) {
    onLayout({ keyboardOffset: 0 });
    return () => {};
  }

  let scheduledRaf: number | null = null;
  let focusoutTimer: number | null = null;

  const updateLayout = () => {
    const nextLayout = calculateKeyboardLayout(windowObj.innerHeight, viewport.height);
    onLayout(nextLayout);
    if (nextLayout.keyboardOffset === 0) {
      windowObj.scrollTo(0, 0);
    }
  };

  const scheduleLayoutUpdate = () => {
    if (scheduledRaf !== null) {
      return;
    }
    scheduledRaf = windowObj.requestAnimationFrame(() => {
      scheduledRaf = null;
      updateLayout();
    });
  };

  const handleFocusOut = () => {
    if (focusoutTimer !== null) {
      windowObj.clearTimeout(focusoutTimer);
    }
    focusoutTimer = windowObj.setTimeout(() => {
      focusoutTimer = null;
      const active = documentObj.activeElement;
      if (!active || active === documentObj.body || active === documentObj.documentElement) {
        scheduleLayoutUpdate();
      }
    }, 300);
  };

  scheduleLayoutUpdate();
  viewport.addEventListener('resize', scheduleLayoutUpdate);
  viewport.addEventListener('scroll', scheduleLayoutUpdate);
  windowObj.addEventListener('resize', scheduleLayoutUpdate);
  windowObj.addEventListener('orientationchange', scheduleLayoutUpdate);
  windowObj.addEventListener('focusout', handleFocusOut);

  return () => {
    viewport.removeEventListener('resize', scheduleLayoutUpdate);
    viewport.removeEventListener('scroll', scheduleLayoutUpdate);
    windowObj.removeEventListener('resize', scheduleLayoutUpdate);
    windowObj.removeEventListener('orientationchange', scheduleLayoutUpdate);
    windowObj.removeEventListener('focusout', handleFocusOut);
    if (focusoutTimer !== null) {
      windowObj.clearTimeout(focusoutTimer);
    }
    if (scheduledRaf !== null) {
      windowObj.cancelAnimationFrame(scheduledRaf);
    }
  };
}
