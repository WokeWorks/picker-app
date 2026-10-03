import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { Icon, type IconName } from '@/components/Icon';
import { friendlyError, isDeregistered } from '@/messages';
import { apiPost, INSTALL_SECRET_KEY, requireInstallSecret } from '@/native-api';
import { C } from '@/theme';

type Note = {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

/** Which half of the inbox is on screen. Matches the server's `state`. */
type InboxState = 'unread' | 'read';

/**
 * How long a notification stays in the Unread list after being read.
 *
 * Not zero, because a row vanishing under the finger that tapped it reads as the
 * app losing it. Five seconds is long enough to see what happened and short
 * enough that the list is honest about what is still unread.
 */
const SETTLE_MS = 5000;

/** The slide-and-fade once the settle window is up. */
const EXIT_MS = 260;

type Anchor = { before: string; beforeId: string } | null;
type Page = {
  notifications: Note[];
  /** Read by the clock screen's badge; this screen shows the rows themselves. */
  unread: number;
  // Both halves of the anchor. The timestamp alone is not enough: rows written in
  // one transaction share a created_at, and a page boundary inside such a group
  // would skip the rest of it permanently.
  next_before: string | null;
  next_before_id: string | null;
};

// An unknown kind falls back to a bell rather than breaking the row. That is why
// the server does not constrain `kind` to a fixed list: adding a new kind of
// message should never need an app release to render.
const ICONS: Record<string, IconName> = {
  roster_published: 'calendar',
  shift_changed: 'calendar',
  shift_removed: 'calendar',
  roster_removed: 'calendar',
  // The cover ones get their own icons: being sent to a store, or untold, is a
  // different kind of news from a roster edit and should not look the same.
  cover_assigned: 'pin',
  cover_ended: 'info',
  shift_covered: 'info',
};

// "2 hours ago" reads better than a timestamp for anything recent, which is most
// of what an inbox holds; older than a week and the date is more use than the gap.
function when(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function NotificationsScreen() {
  const [state, setState] = useState<InboxState>('unread');
  const [notes, setNotes] = useState<Note[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  /**
   * Rows that have been read but are still on screen, mid-settle or mid-exit.
   *
   * Held separately from `notes` so the row keeps its place in the list while it
   * fades: removing it from `notes` is the LAST step, after the animation, not the
   * first. Their timers are tracked so a refresh or an unmount can cancel them --
   * a fired timer against a list that no longer holds the row would be a setState
   * on nothing, and against a remounted one would delete an innocent row.
   */
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [next, setNext] = useState<Anchor>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * A pull-to-refresh in progress, as distinct from the first load.
   *
   * Its own state rather than reusing `loading`, because `loading` swaps the whole
   * FlatList out for a full-screen spinner -- right on a first load, and wrong for
   * a refresh, where it would tear the list down mid-pull and throw away the
   * picker's scroll position. profile.tsx and documents.tsx can share one flag
   * because their first-load spinner sits INSIDE the scroll view; this one does not.
   *
   * It is also not the `refreshing` ref below: that is read synchronously by
   * loadMore to decide whether to start, and a ref cannot drive a re-render.
   */
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Selection mode is entered by long-pressing a row, so a normal tap still just
  // opens the thing the notification is about.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selecting = selected.size > 0;

  // Pull-to-refresh and load-more both write the same array, and they could
  // interleave: a load-more that started before a refresh would append its page
  // onto a list that no longer existed, so rows appeared twice and the paging
  // anchor pointed into a gap in the middle of the list. Every refresh takes a
  // new generation; a request that started under an older one throws its page
  // away instead of merging it into a list it never saw.
  const generation = useRef(0);
  const refreshing = useRef(false);
  /**
   * Writes sent but not yet acknowledged.
   *
   * The focus refresh would otherwise race them: open a notification, which marks
   * it read locally and navigates, come straight back, and the refresh lands
   * before the server has stored the read -- so the row returns UNREAD and the
   * badge goes back up, and stays wrong until something refreshes again. Local
   * state is already correct and optimistic, so the right move is to let the
   * write finish rather than re-ask mid-flight.
   */
  const pendingWrites = useRef(0);

  // Every pending settle/exit timer, dropped. Called before any list replacement
  // and on unmount.
  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const load = useCallback(async (anchor: Anchor = null, which: InboxState = state) => {
    const secret = await requireInstallSecret();
    return apiPost<Page>('/api/mobile/notifications', {
      install_secret: secret,
      state: which,
      before: anchor?.before ?? null,
      before_id: anchor?.beforeId ?? null,
    });
  }, [state]);

  const anchorOf = (page: Page): Anchor =>
    page.next_before && page.next_before_id
      ? { before: page.next_before, beforeId: page.next_before_id }
      : null;

  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    refreshing.current = true;
    try {
      const page = await load(null);
      if (gen !== generation.current) return;
      // Cleared here rather than at the top: setting state synchronously inside
      // an effect triggers a cascading render, and this runs from one on mount.
      setError(null);
      // Any row mid-settle is about to be replaced by the server's own answer, so
      // its timer must not outlive this list -- that is what makes "leave the
      // screen and come back" land the row in Read with no special case.
      clearTimers();
      setExiting(new Set());
      setNotes(page.notifications);
      setUnreadCount(page.unread);
      setNext(anchorOf(page));
    } catch (e) {
      if (gen !== generation.current) return;
      // Same as every other screen behind an enrolled device: a revoked phone goes
      // to setup rather than showing an error it can never clear.
      // apiPost already cleared the credential and navigated to setup.
      if (isDeregistered(e)) return;
      setError(friendlyError(e));
    } finally {
      if (gen === generation.current) {
        refreshing.current = false;
        setLoading(false);
      }
    }
  }, [load, clearTimers]);

  // Wraps refresh so the control has something to spin on. The flag is cleared in
  // a finally, so a failed refresh releases the spinner rather than leaving it
  // turning over a list that is not being updated.
  const pullToRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Refetch on every RETURN to the screen, not just on mount. Tapping a
  // notification pushes /week or /clock on top of this screen, which stays
  // mounted, so coming back would otherwise show the same list -- including a row
  // that is now read and belongs in the other half. The first focus is skipped
  // because the mount effect above has already fetched it.
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focused.current) { focused.current = true; return; }
    // Skipped while a write is in flight. What is on screen is already the
    // optimistic result of that write, and asking the server now would get the
    // pre-write answer back and undo it.
    if (pendingWrites.current > 0) return;
    void refresh();
  }, [refresh]));

  // Anchored paging: ask for what is older than the last row held, never "page 3".
  // New notifications arriving at the top cannot shift this and cause a repeat.
  const loadMore = useCallback(async () => {
    // Refusing to start during a refresh as well as the generation check: the
    // whole list is about to be replaced, so a page fetched against the old
    // anchor is wasted work at best.
    if (!next || loadingMore || refreshing.current) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const page = await load(next);
      if (gen !== generation.current) return;
      setNotes((prev) => {
        // A row can cross the page boundary between the two calls, so append
        // only what is not already held -- a duplicate here is a duplicate React
        // key, not just a repeated row.
        const held = new Set(prev.map((n) => n.id));
        return [...prev, ...page.notifications.filter((n) => !held.has(n.id))];
      });
      setNext(anchorOf(page));
    } catch {
      // Silent: they still have everything already loaded, and an alert on scroll
      // would be worse than a page that simply stops.
    } finally {
      // Only the request that is still current may clear the flag. An abandoned
      // page settling later would otherwise switch off a spinner belonging to the
      // tab that replaced it.
      if (gen === generation.current) setLoadingMore(false);
    }
  }, [next, loadingMore, load]);

  // Switching half. The list, the anchor and any settle timers all belong to the
  // half that is leaving, so they go together -- keeping the old rows while the new
  // page loads would show Read rows under an Unread heading for a moment, and the
  // stale anchor would page the wrong list.
  const show = useCallback((which: InboxState) => {
    if (which === state) return;
    generation.current++;
    clearTimers();
    setExiting(new Set());
    setSelected(new Set());
    setNotes([]);
    setNext(null);
    setError(null);
    // Belongs to the half that is leaving. Left set, the new tab shows a footer
    // spinner it never started and loadMore refuses to fetch anything until the
    // abandoned request settles.
    setLoadingMore(false);
    setLoading(true);
    setState(which);
  }, [state, clearTimers]);

  // state changes, so `load` changes, so `refresh` changes, so the mount effect
  // above re-runs and fetches the new half. Nothing else to schedule here.

  const act = useCallback(async (action: 'read' | 'delete', ids?: string[]) => {
    // The generation this request belongs to. Its failure path refreshes, and a
    // refresh that lands after a tab switch would fill the NEW tab with the OLD
    // tab's rows -- Read rows under an Unread heading. Captured here rather than
    // read in the catch, which would already be the new value.
    const gen = generation.current;
    const secret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
    if (!secret) return;
    // Applied locally first so the list responds immediately; a failure is
    // corrected by the refresh below rather than by blocking on the round trip.
    if (action === 'delete') {
      // The badge counts UNREAD rows, so removing one has to take it off the
      // count as well. Without this, deleting an unread notification left the
      // tab showing a number that included rows no longer in the list, until
      // something else forced a refresh.
      const goneUnread = notes.filter((n) => !n.read_at && (!ids || ids.includes(n.id))).length;
      if (goneUnread) setUnreadCount((c) => Math.max(0, c - goneUnread));
      setNotes((prev) => prev.filter((n) => !ids || !ids.includes(n.id)));
    }
    else setNotes((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    setSelected(new Set());
    pendingWrites.current += 1;
    try {
      await apiPost('/api/mobile/notifications/update', { install_secret: secret, action, ids });
    } catch {
      // Only if this is still the list that asked.
      if (gen === generation.current) void refresh();
    } finally {
      pendingWrites.current -= 1;
    }
  }, [refresh, notes]);

  /**
   * Start a row's exit from the Unread list: settle, then slide, then drop.
   *
   * Only in the unread half -- in Read there is nowhere for it to go. The read mark
   * itself has already been sent by `act`; this is purely how the row leaves.
   */
  const settleOut = useCallback((id: string) => {
    if (state !== 'unread' || timers.current.has(id)) return;
    const t = setTimeout(() => {
      timers.current.delete(id);
      // Hands the row to the animation. It removes itself when that finishes, via
      // onExited below, so the gap never closes before the row has gone.
      setExiting((prev) => new Set(prev).add(id));
    }, SETTLE_MS);
    timers.current.set(id, t);
  }, [state]);

  // The last step, once the slide has played out.
  const dropRow = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setExiting((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /**
   * THE one way rows become read. Every caller goes through it -- a single tap,
   * "Mark read" on a selection, "Mark all read" -- so all three colour the rows,
   * hold them for the settle, then slide them out identically.
   *
   * No refetch here, deliberately. "Mark all read" used to call act('read') and
   * refresh() together and that was a race with a visible symptom: the refetch
   * frequently won, replacing the rows just marked read locally with the server's
   * copies, still unread because the mark had not landed yet. The list stayed
   * unread-coloured and the rows then jumped to Read a moment later. The server is
   * told once; the focus refetch reconciles when they next come back.
   */
  const markRead = useCallback((ids: string[]) => {
    // Already-read ids are dropped: they have no colour left to change, and
    // settling one again would restart a timer against a row mid-slide.
    // `!timers.current.has(n.id)` is the part that stops a double count. `notes`
    // is a closure, so a second press before React has re-rendered still sees the
    // row as unread and would decrement again -- reading one row twice took 10 to
    // 8. A pending settle timer is the durable record that this row has already
    // been marked, and it is set synchronously.
    const unread = notes
      .filter((n) => !n.read_at && !timers.current.has(n.id) && ids.includes(n.id))
      .map((n) => n.id);
    if (!unread.length) return;
    setUnreadCount((n) => Math.max(0, n - unread.length));
    // Explicit ids, never "all": the rows that slide out are then exactly the rows
    // that were marked. Anything unread on a page not yet loaded stays unread,
    // which is honest -- it is still in the list, just further down.
    void act('read', unread);
    unread.forEach(settleOut);
  }, [notes, act, settleOut]);

  const openNote = useCallback((note: Note) => {
    if (!note.read_at) markRead([note.id]);
    const screen = typeof note.data?.screen === 'string' ? note.data.screen : null;
    if (screen === 'week') router.push('/week');
    else if (screen === 'clock') router.push('/clock');
  }, [markRead]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Icon name="arrowLeft" size={20} color={C.brand} strokeWidth={2} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        {selecting ? (
          <View style={styles.bulk}>
            <Pressable accessibilityRole="button" onPress={() => markRead([...selected])} hitSlop={8}>
              <Text style={styles.bulkText}>Mark read</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void act('delete', [...selected])} hitSlop={8}>
              <Text style={[styles.bulkText, styles.bulkDanger]}>Remove</Text>
            </Pressable>
          </View>
        ) : state === 'unread' && notes.some((n) => !n.read_at) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => markRead(notes.filter((n) => !n.read_at).map((n) => n.id))}
            hitSlop={8}
          >
            <Text style={styles.bulkText}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.title} accessibilityRole="header">
        {selecting ? `${selected.size} selected` : 'Notifications'}
      </Text>

      {/* The two halves. Unread is what the screen opens on; Read is the archive.
          Hidden while selecting, because switching half mid-selection would carry a
          selection across a list that no longer contains it. */}
      {!selecting && (
        <View style={styles.tabs}>
          {(['unread', 'read'] as const).map((which) => {
            const on = state === which;
            return (
              <Pressable
                key={which}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={which === 'unread'
                  ? `Unread notifications${unreadCount ? `, ${unreadCount}` : ''}`
                  : 'Notifications you have already read'}
                onPress={() => show(which)}
                style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && !on && { backgroundColor: C.pressed }]}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>
                  {which === 'unread' ? 'Unread' : 'Read'}
                </Text>
                {/* The count rides on the Unread tab, so the badge they saw on the
                    clock screen is explained by the thing they tapped into. */}
                {which === 'unread' && unreadCount > 0 && (
                  <View style={[styles.tabCount, on && styles.tabCountOn]}>
                    <Text style={[styles.tabCountText, on && styles.tabCountTextOn]}>{unreadCount}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {loading ? (
        <View style={styles.centre}><ActivityIndicator color={C.brand} size="large" /></View>
      ) : error ? (
        // A retry, because there was none: the error branch rendered text only and
        // the pull-to-refresh lives on the list in the other branch, so the only
        // way out was to leave the screen and come back.
        <View style={styles.centre}>
          <Icon name="alert" size={34} color={C.faint} strokeWidth={2} />
          <Text style={styles.empty}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={() => { setLoading(true); void refresh(); }}
            style={({ pressed }) => [styles.retry, pressed && { backgroundColor: C.brandDeep }]}
            hitSlop={8}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(n) => n.id}
          contentContainerStyle={notes.length ? styles.list : styles.listEmpty}
          // `refreshing` was hardcoded false, so pulling down fetched a new page
          // and gave no sign it had: it looked like nothing happened, which is how
          // someone concludes the screen is broken and pulls repeatedly.
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pullToRefresh()} tintColor={C.brand} colors={[C.brand]} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListEmptyComponent={
            <View style={styles.centre}>
              <Icon name="check" size={34} color={C.faint} strokeWidth={2} />
              <Text style={styles.empty}>
                {state === 'unread'
                  ? 'Nothing new.\nAnything you have read is under Read.'
                  : 'Nothing read yet.\nMessages move here once you open them.'}
              </Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={C.brand} /> : null}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            return (
              <ExitShell id={item.id} exiting={exiting.has(item.id)} onExited={dropRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.body}. ${when(item.created_at)}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => (selecting ? toggle(item.id) : openNote(item))}
                onLongPress={() => toggle(item.id)}
                style={({ pressed }) => [
                  styles.row,
                  !item.read_at && styles.rowUnread,
                  isSelected && styles.rowSelected,
                  pressed && { backgroundColor: C.pressed },
                ]}
              >
                <View style={[styles.icon, !item.read_at && styles.iconUnread]}>
                  <Icon
                    name={isSelected ? 'check' : ICONS[item.kind] ?? 'info'}
                    size={20}
                    color={isSelected ? C.onBrand : item.read_at ? C.muted : C.brand}
                    strokeWidth={2}
                  />
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, !item.read_at && styles.rowTitleUnread]} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.rowText} numberOfLines={3}>{item.body}</Text>
                  <Text style={styles.rowWhen}>{when(item.created_at)}</Text>
                </View>
                {!item.read_at && !isSelected && <View style={styles.dot} />}
              </Pressable>
              </ExitShell>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * Plays a row out of the list, then tells the parent to remove it.
 *
 * Opacity and translateX only -- both run on the compositor, so the slide stays
 * smooth on the cheap phones this app targets. Height is deliberately NOT animated:
 * collapsing it needs the measured height and behaves differently across RN
 * versions, and the gap closing a fraction after the row has gone is not something
 * anyone notices.
 */
function ExitShell({ id, exiting, onExited, children }: { id: string; exiting: boolean; onExited: (id: string) => void; children: React.ReactNode }) {
  // useState, not useRef: the value must survive re-renders but is also read while
  // rendering (the style below), and reading a ref during render is exactly what
  // react-hooks/refs forbids. The initialiser runs once, so this is still one
  // Animated.Value for the life of the row.
  const [anim] = useState(() => new Animated.Value(1));

  // `id` and a STABLE `onExited` rather than a closure: a fresh `() => drop(id)`
  // on every render would be a new dependency every time and restart the
  // animation mid-slide.
  useEffect(() => {
    if (!exiting) return;
    const a = Animated.timing(anim, { toValue: 0, duration: EXIT_MS, useNativeDriver: true });
    a.start(({ finished }) => { if (finished) onExited(id); });
    // Stopped rather than left running: an unmount mid-slide (a refresh landing,
    // or the tab being switched) would otherwise fire the callback against a list
    // that has already been replaced.
    return () => {
      a.stop();
      // Reset, not just stopped. stop() leaves anim wherever it got to, so a row
      // whose exit is cancelled -- a refresh arriving mid-slide -- would render
      // again still half-faded and shifted left, or invisible if it had almost
      // finished.
      anim.setValue(1);
    };
  }, [exiting, anim, id, onExited]);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-36, 0] }) }],
      }}
      pointerEvents={exiting ? 'none' : 'auto'}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, minHeight: 40 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: C.brand, fontSize: 16, fontWeight: '600' },
  bulk: { flexDirection: 'row', gap: 18 },
  bulkText: { color: C.brand, fontSize: 15, fontWeight: '700' },
  bulkDanger: { color: C.danger },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 14 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
    borderWidth: 1.5, borderColor: C.line, backgroundColor: C.paper,
  },
  tabOn: { borderColor: C.brand, backgroundColor: C.brand },
  tabText: { color: C.inkMid, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: C.onBrand },
  tabCount: { minWidth: 20, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999, backgroundColor: C.brandTint, alignItems: 'center' },
  tabCountOn: { backgroundColor: C.brandDeep },
  tabCountText: { color: C.brand, fontSize: 12, fontWeight: '800' },
  tabCountTextOn: { color: C.onBrand },
  title: { color: C.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, paddingTop: 60 },
  empty: { color: C.muted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retry: { marginTop: 6, backgroundColor: C.brand, paddingVertical: 12, paddingHorizontal: 26, borderRadius: 14 },
  retryText: { color: C.onBrand, fontSize: 16, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 28, gap: 10 },
  listEmpty: { flexGrow: 1 },
  more: { marginVertical: 18 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14,
    backgroundColor: C.paper, borderRadius: 16, borderWidth: 1, borderColor: C.line,
  },
  rowUnread: { borderColor: C.brandBorder, backgroundColor: C.brandTint },
  rowSelected: { borderColor: C.brand, borderWidth: 2 },
  icon: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.canvas,
  },
  iconUnread: { backgroundColor: C.paper },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: C.inkMid, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  rowTitleUnread: { color: C.ink, fontWeight: '700' },
  rowText: { color: C.muted, fontSize: 14, lineHeight: 19 },
  rowWhen: { color: C.faint, fontSize: 12, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.brand, marginTop: 6 },
});
