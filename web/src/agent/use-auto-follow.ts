"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Document scrolling, with user intent taking precedence over incoming events. */
export function useAutoFollow(revision: unknown, enabled: boolean) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const lastY = useRef(0);

  const changeFollowing = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);

  const nearLatest = useCallback(() => {
    const bottom = anchorRef.current?.getBoundingClientRect().bottom;
    return bottom !== undefined && bottom >= 0 && bottom <= window.innerHeight + 80;
  }, []);

  const resume = useCallback(() => {
    changeFollowing(true);
    anchorRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
    lastY.current = window.scrollY;
  }, [changeFollowing]);

  useEffect(() => {
    if (!enabled) return;
    lastY.current = window.scrollY;
    let touchY: number | undefined;
    let lastDocumentHeight = document.documentElement.scrollHeight;

    // Scrolling down inside an excerpt is not returning to the latest execution.
    function inNestedScroller(target: EventTarget | null) {
      let element = target instanceof HTMLElement ? target : null;
      while (element && element !== document.body && element !== document.documentElement) {
        const overflow = window.getComputedStyle(element).overflowY;
        if ((overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight) {
          return true;
        }
        element = element.parentElement;
      }
      return false;
    }

    function onScroll() {
      const y = window.scrollY;
      const height = document.documentElement.scrollHeight;
      // Scroll anchoring and hiding the resume button can move the viewport.
      // Layout-driven movement must not override the user's follow preference.
      if (height === lastDocumentHeight) {
        if (y < lastY.current - 1) changeFollowing(false);
        else if (y > lastY.current + 1 && nearLatest()) changeFollowing(true);
      }
      lastY.current = y;
      lastDocumentHeight = height;
    }
    function onPointerDown(event: PointerEvent) {
      // Pause before a scrollbar drag can race the next incoming-event frame.
      if (event.clientX >= document.documentElement.clientWidth - 2) changeFollowing(false);
    }
    function onWheel(event: WheelEvent) {
      if (event.deltaY < 0) changeFollowing(false);
      else if (event.deltaY > 0 && !inNestedScroller(event.target) && nearLatest()) changeFollowing(true);
    }
    function onTouchStart(event: TouchEvent) {
      touchY = event.touches[0]?.clientY;
    }
    function onTouchMove(event: TouchEvent) {
      const y = event.touches[0]?.clientY;
      if (y !== undefined && touchY !== undefined) {
        if (y > touchY + 2) changeFollowing(false);
        else if (y < touchY - 2 && !inNestedScroller(event.target) && nearLatest()) changeFollowing(true);
      }
      touchY = y;
    }
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.closest("input, textarea, select"))) return;
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home"
        || (event.key === " " && event.shiftKey
          && !(target instanceof HTMLElement && target.closest("button, a, summary")))) {
        changeFollowing(false);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [enabled, changeFollowing, nearLatest]);

  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      if (!followingRef.current || !anchorRef.current) return;
      const bottom = anchorRef.current.getBoundingClientRect().bottom;
      const nextY = window.scrollY + bottom - window.innerHeight + 32;
      // Incoming events never scroll backwards or undo the user's upward input.
      if (nextY > window.scrollY + 1) {
        window.scrollTo({ top: nextY, behavior: "instant" });
        lastY.current = window.scrollY;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [revision, enabled]);

  return { anchorRef, following, resume };
}
