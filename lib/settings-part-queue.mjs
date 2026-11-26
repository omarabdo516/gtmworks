// The Engine reads of one Settings page wait their turn here (#898, ADR 0030): at most `limit` are open at once, so one
// page cannot fill its Engine listener's callLimit and push it into `slow`. A read starts in the order it was asked; one
// whose signal is aborted before its turn is never sent; a read that fails frees its place as one that answers does.
/** @param {number} limit */
export function partQueue(limit) {
  let open = 0;
  /** @type {(() => void)[]} */
  const waiting = [];
  const next = () => { while (open < limit && waiting.length) waiting.shift()?.(); };
  /** @template T @param {() => Promise<T>} read @param {AbortSignal} [signal] @returns {Promise<T>} */
  return (read, signal) => new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('The read is no longer wanted', 'AbortError'));
    waiting.push(() => {
      if (signal?.aborted) { aborted(); return; }
      open++;
      new Promise(started => started(read())).then(resolve, reject).finally(() => { open--; next(); });
    });
    next();
  });
}

// The one queue every Engine-backed part of Settings shares in this browser.
export const settingsReads = partQueue(4);
