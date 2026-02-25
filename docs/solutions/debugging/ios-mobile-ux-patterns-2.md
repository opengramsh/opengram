---
title: iOS Mobile UX Patterns — Safe Area, Element Bleed, Drag-to-Dismiss, SSE Architecture
category: debugging
tags: [ios, mobile, ux, safe-area, pointer-events, gesture, drag-dismiss, sse]
date: 2026-02-25
task: KAI-215
---

# iOS Mobile UX Patterns (Part 2)

Four more iOS UX issues and their fixes, continuing from KAI-214.

## 1. Safe Area Insets Not Respected

**Problem:** Bottom action bar / composer is cut off on iPhones with a home indicator (notch-era devices). The app doesn't respect iOS safe area insets.

**Fix — two parts:**

1. Add `viewport-fit=cover` to the viewport meta tag:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

2. Apply safe area padding in CSS where content touches screen edges:
```css
padding-bottom: env(safe-area-inset-bottom);
```

**Key detail:** `viewport-fit=cover` is **required** — without it, `env(safe-area-inset-*)` values are always 0. This is the most commonly missed step.

**Where to apply:** Bottom-anchored elements (composers, tab bars, toolbars). Top-anchored elements rarely need it unless your app hides the status bar.

## 2. Background Element Bleed-Through (Swipe Actions)

**Problem:** A swipe-to-delete button (absolutely positioned behind a chat row) bleeds through as visible red lines, even when no swipe is active. Caused by sub-pixel rendering, antialiasing, or rounding differences between the foreground row and background button.

**Fix:** Conditionally render the background action element only when it's needed:

```tsx
{offsetX < 0 && (
  <button className="absolute inset-y-0 right-0 z-0 w-[86px] bg-red-500 ...">
    Delete
  </button>
)}
```

**Why this over `overflow: hidden` or `z-index`?**
- `overflow: hidden` on the container was already present — sub-pixel rendering can still cause bleed at element boundaries.
- Higher z-index on the foreground row doesn't help if the background element paints at the same pixel coordinates.
- **Conditional rendering is the only 100% reliable fix** — if the element doesn't exist in the DOM, it can't bleed through.

**Trade-off:** The button mounts/unmounts on each swipe. Since it's a simple DOM node and React efficiently handles this, there's no perceptible performance cost.

## 3. Drag-to-Dismiss Gesture (Image Viewer)

**Problem:** User expects to swipe down on an image preview to dismiss it (standard iOS pattern), but the image viewer only has a Close button.

**Fix:** Pointer-event-based vertical drag gesture with axis locking and threshold dismissal.

### Architecture

```tsx
const DISMISS_THRESHOLD = 100; // px

function ImageViewerDialog({ ... }) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const lockedRef = useRef<'vertical' | null>(null);
```

### Key techniques

1. **Axis locking:** Don't commit to vertical drag until `|dy| > 8px && |dy| > |dx|`. This prevents accidental dismissal during horizontal scrolling or tapping.

2. **Pointer capture:** Call `setPointerCapture(pointerId)` on pointer down so all subsequent move/up events route to the element, even if the pointer leaves its bounds.

3. **One-directional constraint:** `setDragY(Math.max(0, dy))` — only allow dragging downward, never upward past origin.

4. **Visual feedback during drag:**
   - `transform: translateY(${dragY}px)` moves the dialog
   - Opacity fades: `Math.max(0.2, 1 - dragY / 400)`
   - `transition: none` during active drag, smooth ease-out on release

5. **Threshold check on release:** If `dragY > DISMISS_THRESHOLD`, close. Otherwise, animate back to origin.

6. **CSS prerequisites on the drag target:**
   - `touch-none` — prevents browser default touch handling (scroll, zoom)
   - `select-none` on `<img>` — prevents text selection UI
   - `draggable={false}` on `<img>` — prevents native image drag

### Integration with Radix Dialog

The drag gesture is applied to the **image container div** (not the DialogContent), while `DialogContent` receives the `style` for transform/opacity. This way the dialog's built-in close-on-overlay-click still works, and the drag only activates on the image area.

On dismiss, both `resetDrag()` and `setViewerMediaId(null)` are called to ensure clean state.

## 4. SSE Architecture — Mobile Screen Separation

**Problem:** On desktop, inbox and chat panels are visible simultaneously, so typing indicators work in both. On mobile, the inbox is a separate screen — does it still receive typing events?

**Finding:** No code change needed. The SSE subscription lives at a high level in the component tree (above the router), and `streamingChatIds` flows down as props to both the inbox list and the chat view. When the user navigates to the inbox, the component re-renders with current streaming state.

**Lesson:** When designing real-time features with SSE/WebSocket, place the subscription as high as possible in the component tree and pass state down. This avoids the "mobile screen separation" problem entirely — each screen gets the same live state regardless of navigation.

**Verification approach:** Since no code change was needed, 3 unit tests were added to confirm the behavior:
- Typing indicator appears on chat row when `streamingChatIds` includes that chat
- Avatar animation (blink) activates for streaming chats
- No typing indicator when `streamingChatIds` is empty

## Testing Approach

- **Drag gestures:** Use `fireEvent.pointerDown/pointerMove/pointerUp` with explicit `clientY` deltas. Remember to set `pointerId` on all events for pointer capture to work.
- **Safe area:** Cannot be tested in unit tests — requires real device or iOS Simulator with home indicator.
- **Element bleed:** Visual issue only — test by verifying the conditional render logic (`offsetX < 0`).
- **SSE subscription:** Test at the component level by passing `streamingChatIds` as a prop and asserting on rendered output.
