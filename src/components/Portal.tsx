import { render, type ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/**
 * Renders children into a node appended to `document.body`, so a floating
 * popover escapes an ancestor's `overflow: hidden` (and WebKitGTK's habit of
 * treating `position: fixed` inside a scroll container as `absolute`).
 */
export function Portal({ children }: { children: ComponentChildren }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  // Attached immediately (not in an effect) so a layout effect further up —
  // e.g. one measuring this popover's size right after mount — sees a node
  // that's actually part of the document instead of a detached, zero-size one.
  if (!elRef.current) {
    elRef.current = document.createElement("div");
    document.body.appendChild(elRef.current);
  }

  useEffect(() => {
    const el = elRef.current!;
    return () => {
      render(null, el);
      document.body.removeChild(el);
    };
  }, []);

  render(children, elRef.current);
  return null;
}
