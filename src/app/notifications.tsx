import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { Icon, type IconName } from '@/components/Icon';
import { friendlyError } from '@/messages';
import { apiPost, INSTALL_SECRET_KEY } from '@/native-api';
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [next, setNext] = useState<Anchor>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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

  const load = useCallback(async (anchor: Anchor = null) => {
    const secret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
    if (!secret) throw new Error('device_inactive');
    return apiPost<Page>('/api/mobile/notifications', {
      install_secret: secret,
      before: anchor?.before ?? null,
      before_id: anchor?.beforeId ?? null,
    });
  }, []);

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
      setNotes(page.notifications);
      setNext(anchorOf(page));
    } catch (e) {
      if (gen !== generation.current) return;
      setError(friendlyError(e));
    } finally {
      if (gen === generation.current) {
        refreshing.current = false;
        setLoading(false);
      }
    }
  }, [load]);

  useEffect(() => { void refresh(); }, [refresh]);

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
      setLoadingMore(false);
    }
  }, [next, loadingMore, load]);

  const act = useCallback(async (action: 'read' | 'delete', ids?: string[]) => {
    const secret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
    if (!secret) return;
    // Applied locally first so the list responds immediately; a failure is
    // corrected by the refresh below rather than by blocking on the round trip.
    if (action === 'delete') setNotes((prev) => prev.filter((n) => !ids || !ids.includes(n.id)));
    else setNotes((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    setSelected(new Set());
    try {
      await apiPost('/api/mobile/notifications/update', { install_secret: secret, action, ids });
    } catch {
      void refresh();
    }
  }, [refresh]);

  const openNote = useCallback((note: Note) => {
    if (!note.read_at) void act('read', [note.id]);
    const screen = typeof note.data?.screen === 'string' ? note.data.screen : null;
    if (screen === 'week') router.push('/week');
    else if (screen === 'clock') router.push('/clock');
  }, [act]);

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
            <Pressable accessibilityRole="button" onPress={() => void act('read', [...selected])} hitSlop={8}>
              <Text style={styles.bulkText}>Mark read</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void act('delete', [...selected])} hitSlop={8}>
              <Text style={[styles.bulkText, styles.bulkDanger]}>Remove</Text>
            </Pressable>
          </View>
        ) : notes.some((n) => !n.read_at) ? (
          <Pressable accessibilityRole="button" onPress={() => void act('read')} hitSlop={8}>
            <Text style={styles.bulkText}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.title} accessibilityRole="header">
        {selecting ? `${selected.size} selected` : 'Notifications'}
      </Text>

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
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={C.brand} colors={[C.brand]} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListEmptyComponent={
            <View style={styles.centre}>
              <Icon name="check" size={34} color={C.faint} strokeWidth={2} />
              <Text style={styles.empty}>Nothing yet.{'\n'}Changes to your roster will show up here.</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={C.brand} /> : null}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            return (
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
            );
          }}
        />
      )}
    </SafeAreaView>
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
