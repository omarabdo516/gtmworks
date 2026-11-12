'use client';
import { useEffect, useState } from "react";
import { MobileNavScrollTracker } from "./mobile-nav-scroll";

export function useMobileNavVisibility(enabled: boolean, pathname: string): boolean {
  const [visibility, setVisibility] = useState({pathname,visible:true});

  useEffect(() => {
    if (!enabled) return;

    const scroller=document.querySelector<HTMLElement>('.app-content');
    if(!scroller) return;
    const styles = getComputedStyle(document.documentElement);
    const distance = (token: string) => Number.parseFloat(styles.getPropertyValue(token)) || 0;
    const scrollBounds = () => {
      return { top:scroller.scrollTop, max:Math.max(0,scroller.scrollHeight-scroller.clientHeight) };
    };
    const initial = scrollBounds();
    const tracker = new MobileNavScrollTracker({
      topZone: distance("--mobile-nav-scroll-top-zone"),
      hideDistance: distance("--mobile-nav-scroll-hide-distance"),
      showDistance: distance("--mobile-nav-scroll-show-distance"),
    }, initial.top, initial.max);
    let frame: number | null = null;
    const onScroll = () => {
      if (window.innerWidth>=768 || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const { top, max } = scrollBounds();
        const previous = tracker.visible;
        const next = tracker.update(top, max);
        if (next !== previous) setVisibility({pathname,visible:next});
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, pathname]);

  return visibility.pathname===pathname?visibility.visible:true;
}
