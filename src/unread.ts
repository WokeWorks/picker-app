import { useSyncExternalStore } from 'react';

/**
 * The unread count, shared between the notifications screen and the bottom bar.
 *
 * The bar shows the badge but does not own the truth: reading a message happens
 * on the notifications screen, and that screen is already tracking the count for
 * its own tabs. Without somewhere shared to put it, the bar could only re-read on
 * a tab change -- so a picker reading messages while looking at the bar watched
 * the badge go on advertising them.
 *
 * An external store rather than context: the value changes on a tap and is read
 * by exactly one component, and a context would re-render the whole tree under
 * the layout to move a number into one badge.
 */

let count = 0;
const listeners = new Set<() => void>();

/** Called by whoever has just learned the real number. */
export function setUnreadCount(next: number): void {
  const safe = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
  if (safe === count) return;
  count = safe;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): number {
  return count;
}

/** Live unread count. Re-renders the caller whenever it changes. */
export function useUnreadCount(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
