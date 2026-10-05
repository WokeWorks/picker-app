/**
 * Which way the next screen should slide in.
 *
 * The bottom bar is a row, so a move along it should look like one: Home ->
 * Schedule comes in from the right, Schedule -> Home comes back from the left.
 * Expo Router has no per-navigation animation option, so the direction is left
 * here by the bar and read by the screen that is about to mount.
 *
 * ONLY PUSHES NEED THIS. When the target screen is already in the stack, Expo
 * pops back to it and react-native-screens reverses the push animation by itself,
 * which is already the correct direction. So this value is consulted on the way
 * in and simply ignored when there is nothing to push.
 *
 * Module state rather than context on purpose: it is read once as a screen mounts,
 * never rendered, and a context would re-render all three screens to carry a value
 * that only matters for the few hundred milliseconds of a transition.
 */
export type NavAnimation = 'slide_from_right' | 'slide_from_left';

let next: NavAnimation = 'slide_from_right';

/** Called by the bar immediately before navigating. */
export function setNavDirection(direction: NavAnimation): void {
  next = direction;
}

/**
 * The direction for the screen now mounting.
 *
 * Read through a useState initialiser, so it is taken once per mount rather than
 * on every render -- re-reading mid-transition would mean a screen whose animation
 * changes under it.
 */
export function takeNavDirection(): NavAnimation {
  return next;
}
