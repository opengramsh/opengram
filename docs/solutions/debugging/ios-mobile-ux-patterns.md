---
title: iOS Mobile UX Patterns — Scroll-Tap, Input Zoom, Enter Key
category: debugging
tags: [ios, mobile, ux, touch, safari, css, pointer-events]
date: 2026-02-25
task: KAI-214
---

# iOS Mobile UX Patterns

Three common iOS UX issues and their fixes, discovered during real-device testing.

## 1. Scroll Triggers Tap in Touch Lists

**Problem:** In a scrollable list with pointer-event-based row interactions, a vertical scroll gesture fires `pointerUp` which the handler interprets as a tap (opening the item).

**Fix:** Track vertical displacement with a `scrolledRef` and suppress the tap action when `Math.abs(deltaY) > threshold`.

```tsx
const scrolledRef = useRef(false);

// In pointerDown — reset
scrolledRef.current = false;

// In pointerMove — detect scroll intent
if (!scrolledRef.current && Math.abs(deltaY) > 10) {
  scrolledRef.current = true;
}

// In pointerUp — guard the open action
if (!isDragging && !longPressTriggeredRef.current && !scrolledRef.current) {
  onOpen();
}
```

**Key detail:** 10px threshold works well — it's large enough to ignore finger jitter but small enough to catch real scrolls. This approach integrates cleanly with existing swipe-to-archive pointer logic.

## 2. iOS Safari Input Zoom on Focus

**Problem:** iOS Safari auto-zooms the viewport when an input with `font-size < 16px` receives focus. This is disorienting and the zoom doesn't always revert.

**Fix:** Force `font-size: 16px` on form elements, scoped to WebKit touch devices via `@supports`:

```css
@supports (-webkit-touch-callout: none) {
  input, textarea, select {
    font-size: 16px;
  }
}
```

**Caveats:**
- `@supports (-webkit-touch-callout: none)` also matches **desktop Safari** (not just iOS). In practice this is acceptable since 16px is a reasonable base size, but be aware if you need pixel-perfect desktop Safari sizing.
- An alternative is the viewport meta `maximum-scale=1`, but that **disables pinch-to-zoom** entirely — an accessibility concern. The CSS approach is preferred.
- No `!important` needed — component-level Tailwind classes that set larger sizes will still win via specificity.

## 3. Enter Key Inserts Newline on Mobile (No Shift+Enter)

**Problem:** Mobile keyboards have no `Shift+Enter` distinction. If `Enter` sends the message, users can't insert newlines at all.

**Fix:** Detect touch device via `matchMedia` and skip the Enter-to-send behavior:

```ts
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
```

```tsx
onKeyDown={(event) => {
  if (event.key === 'Enter' && !event.shiftKey && !isTouchDevice() && hasContent) {
    event.preventDefault();
    void sendMessage();
  }
}}
```

**Why `pointer: coarse` over `navigator.maxTouchPoints` or `'ontouchstart' in window`?**
- `pointer: coarse` reflects the **primary** input device, not just capability. A laptop with a touchscreen still reports `pointer: fine`.
- `matchMedia` is synchronous and fast — no need to cache the result.
- SSR-safe with the `typeof window` guard.

**Trade-off:** On touch devices, users must tap the send button. This matches native messaging app behavior (iMessage, WhatsApp).

## Testing Approach

- **Scroll-tap:** Use `fireEvent.pointerDown/pointerMove/pointerUp` with explicit `clientX`/`clientY` deltas to simulate scroll vs tap gestures.
- **Touch detection:** Mock `window.matchMedia` to return `{ matches: true/false }` for `(pointer: coarse)`.
- Always test with real iOS device — simulators don't reproduce zoom or touch-pointer behavior accurately.
