import type { DependencyList } from "react";
import { useCallback, useEffect, useRef } from "react";

interface UseAutoScrollOptions {
  threshold?: number;
  behavior?: ScrollBehavior;
}

export default function useAutoScroll(deps: DependencyList, opts: UseAutoScrollOptions = {}) {
  const { threshold = 80, behavior = "instant" } = opts;
  const containerRef = useRef<HTMLElement | null>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, [threshold]);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    const el = containerRef.current;
    if (el) {
      if (behavior === "smooth") {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, deps);

  return { containerRef, handleScroll, isNearBottomRef };
}
