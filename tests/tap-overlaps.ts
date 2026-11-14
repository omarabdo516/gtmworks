import type { Locator } from '@playwright/test';

// Tap areas that sit on top of each other. Each target is measured by the part a person can reach: the part its
// ancestors do not clip, as the browser clips it (#48). An ancestor clips an axis only when its overflow on that axis
// is not `visible`, and only if it clips this element at all: nothing above a fixed element clips it, and an absolute
// element is clipped only by its containing block and what lies above that, not by the boxes in between.
export async function tapOverlaps(targets: Locator) {
  return targets.evaluateAll(nodes => {
    // Whether a box is the containing block of an absolute descendant.
    const contains = (style: CSSStyleDeclaration) => style.position !== 'static' || style.transform !== 'none' || style.perspective !== 'none'
      || style.filter !== 'none' || /transform|perspective|filter/.test(style.willChange) || /paint|layout|strict|content/.test(style.contain);
    const reach = (node: Element) => {
      const own = node.getBoundingClientRect();
      const box = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
      let position = getComputedStyle(node).position;
      for (let parent = node.parentElement; parent && position !== 'fixed'; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clips = position !== 'absolute' || contains(style);
        if (clips) {
          const clip = parent.getBoundingClientRect();
          if (style.overflowX !== 'visible') { box.left = Math.max(box.left, clip.left); box.right = Math.min(box.right, clip.right); }
          if (style.overflowY !== 'visible') { box.top = Math.max(box.top, clip.top); box.bottom = Math.min(box.bottom, clip.bottom); }
        }
        // Past its containing block an absolute element is clipped like the block itself; a positioned ancestor
        // (absolute or fixed) then decides for everything above it.
        if (clips || position !== 'absolute') position = style.position === 'absolute' || style.position === 'fixed' ? style.position : 'static';
      }
      return box;
    };
    return nodes.flatMap((node, index) => nodes.slice(index + 1).filter(other => {
      const a = reach(node), b = reach(other);
      const shown = a.right > a.left && a.bottom > a.top && b.right > b.left && b.bottom > b.top;
      return shown && !node.contains(other) && !other.contains(node) && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }).map(other => `${node.textContent} / ${other.textContent}`));
  });
}
