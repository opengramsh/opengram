type VisualViewportLike = {
  height: number;
  offsetTop: number;
  addEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  removeEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
};

type KeyboardWindowLike = {
  innerHeight: number;
  visualViewport?: VisualViewportLike;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (handler: () => void, timeout?: number) => number;
  clearTimeout: (handle: number | undefined) => void;
  addEventListener: (type: 'focusout' | 'resize' | 'orientationchange', listener: () => void) => void;
  removeEventListener: (type: 'focusout' | 'resize' | 'orientationchange', listener: () => void) => void;
  getComputedStyle: (elt: Element) => CSSStyleDeclaration;
  scrollTo: (x: number, y: number) => void;
};

export type KeyboardLayout = {
  keyboardOffset: number;
  visualViewportHeight: number;
};

type SafeAreaBottomCache = {
  read: () => number;
  refresh: () => number;
};

function measureSafeAreaBottom(documentObj: Document, windowObj: KeyboardWindowLike): number {
  const probe = documentObj.createElement('div');
  probe.style.position = 'absolute';
  probe.style.bottom = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
  documentObj.body.appendChild(probe);
  const parsed = Number.parseFloat(windowObj.getComputedStyle(probe).paddingBottom);
  probe.remove();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createSafeAreaBottomCache(documentObj: Document, windowObj: KeyboardWindowLike): SafeAreaBottomCache {
  let cached: number | null = null;
  return {
    read: () => {
      if (cached === null) {
        cached = measureSafeAreaBottom(documentObj, windowObj);
      }
      return cached;
    },
    refresh: () => {
      cached = measureSafeAreaBottom(documentObj, windowObj);
      return cached;
    },
  };
}

export function calculateKeyboardLayout(
  innerHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number,
  safeAreaBottom: number,
): KeyboardLayout {
  const visualViewportHeight = Math.max(0, viewportHeight + viewportOffsetTop);
  const rawKeyboardOffset = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
  const keyboardOffset = Math.max(0, rawKeyboardOffset - safeAreaBottom);
  return { keyboardOffset, visualViewportHeight };
}

export function applyKeyboardCssVars(root: HTMLElement, layout: KeyboardLayout) {
  root.style.setProperty('--visual-viewport-height', `${layout.visualViewportHeight}px`);
  root.style.setProperty('--keyboard-offset', `${layout.keyboardOffset}px`);
}

export function subscribeToKeyboardLayout(
  windowObj: KeyboardWindowLike,
  documentObj: Document,
  onLayout: (layout: KeyboardLayout) => void,
) {
  const viewport = windowObj.visualViewport;
  if (!viewport) {
    onLayout({ keyboardOffset: 0, visualViewportHeight: windowObj.innerHeight });
    return () => {};
  }

  const safeAreaBottomCache = createSafeAreaBottomCache(documentObj, windowObj);
  safeAreaBottomCache.refresh();

  let scheduledRaf: number | null = null;
  let focusoutTimer: number | null = null;

  const updateLayout = () => {
    const safeAreaBottom = safeAreaBottomCache.read();
    const nextLayout = calculateKeyboardLayout(
      windowObj.innerHeight,
      viewport.height,
      viewport.offsetTop,
      safeAreaBottom,
    );
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

  const refreshSafeAreaAndUpdate = () => {
    safeAreaBottomCache.refresh();
    scheduleLayoutUpdate();
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
  windowObj.addEventListener('resize', refreshSafeAreaAndUpdate);
  windowObj.addEventListener('orientationchange', refreshSafeAreaAndUpdate);
  windowObj.addEventListener('focusout', handleFocusOut);

  return () => {
    viewport.removeEventListener('resize', scheduleLayoutUpdate);
    viewport.removeEventListener('scroll', scheduleLayoutUpdate);
    windowObj.removeEventListener('resize', refreshSafeAreaAndUpdate);
    windowObj.removeEventListener('orientationchange', refreshSafeAreaAndUpdate);
    windowObj.removeEventListener('focusout', handleFocusOut);
    if (focusoutTimer !== null) {
      windowObj.clearTimeout(focusoutTimer);
    }
    if (scheduledRaf !== null) {
      windowObj.cancelAnimationFrame(scheduledRaf);
    }
  };
}
