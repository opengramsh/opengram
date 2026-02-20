/**
 * Polyfills for jsdom that libraries like vaul (Drawer) and Radix UI require.
 * Loaded via vitest.config.ts setupFiles for jsdom environments.
 */

if (typeof window !== 'undefined') {
  // vaul uses setPointerCapture/releasePointerCapture for drag handling
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }

  // vaul's getTranslate reads getComputedStyle(el).transform
  const originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function (this: typeof window, el: Element, pseudoElt?: string | null) {
    const style = originalGetComputedStyle.call(this, el, pseudoElt);
    if (!style.transform) {
      Object.defineProperty(style, 'transform', {
        get: () => 'none',
        configurable: true,
      });
    }
    return style;
  } as typeof window.getComputedStyle;

  // Radix Presence component listens for animationend to unmount closed content.
  // jsdom does not run CSS animations, so we need to make getComputedStyle report
  // no animations. This causes Radix Presence to skip animation waiting and unmount
  // closed content immediately.
  const origAnimate = Element.prototype.animate;
  Element.prototype.animate = function (...args: Parameters<typeof origAnimate>) {
    try {
      return origAnimate.apply(this, args);
    } catch {
      return { finished: Promise.resolve(), cancel: () => {}, play: () => {} } as unknown as Animation;
    }
  };

  // Ensure getAnimations returns empty (no pending animations)
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => [];
  }
}
