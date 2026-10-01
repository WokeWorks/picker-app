import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { CameraSheet } from '@/components/CameraSheet';
import { Icon } from '@/components/Icon';
import { SourceSheet } from '@/components/SourceSheet';
import { MAX_UPLOAD_SIDE, isStoragePickerAvailable, pickFromStorage } from '@/image';
import { DEVICE_ID_KEY, INSTALL_SECRET_KEY, apiPost, apiPostFile, formatPhone } from '@/native-api';
import { type Profile, describeWait } from '@/profile';
import { C } from '@/theme';

/**
 * The picker's own details.
 *
 * Name and phone are READ ONLY -- shown as text, not as fields, because there is
 * no route that would accept a change to either. The reference photo can be
 * proposed, never replaced directly: what is on screen stays the live one until a
 * supervisor approves the new one, which is the whole point of the flow.
 *
 * Two confirmations stand between a tap and an upload. The camera's own shutter,
 * and then a preview with Send/Retake. That second step exists because this photo
 * becomes what every future clock-in is checked against, so an accidental upload
 * is not a small mistake -- and because a picker cannot see their own face while
 * taking the picture.
 */
export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The captured-but-not-yet-sent photo. Its presence IS the preview step.
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // Refs, not state, for the guards below: state updates are not visible to a
  // second tap in the SAME frame, so two presses could both get through.
  const sendingRef = useRef(false);
  const pickingRef = useRef(false);
  // Whether this BUILD has the gallery native module. Resolved once -- it cannot
  // change without reinstalling the app -- so the chooser can leave the option out
  // rather than offer one that throws. Defaults to false so a slow check shows the
  // camera-only sheet instead of a row that might fail.
  const [storageOk, setStorageOk] = useState(false);

  // Which load is current. Two can overlap -- a pull-to-refresh while send()'s
  // reload is in flight -- and without this the OLDER response can land second
  // and wipe the newer data, making a successful upload look lost.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    // Set here, not only cleared in the finally. Without it `loading` is true
    // exactly once, on mount, and is false for the rest of the screen's life --
    // which left the pull-to-refresh spinner with nothing to drive it.
    setLoading(true);
    try {
      const secret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
      if (!secret) throw new Error('device_inactive');
      const data = await apiPost<Profile>('/api/mobile/profile', { install_secret: secret });
      if (seq !== loadSeq.current) return;
      setError(null);
      setProfile(data);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error && e.message === 'device_inactive'
        ? 'This phone is no longer set up. Ask your supervisor.'
        : 'Could not load your details. Pull down to try again.');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  // load() now sets `loading` before its first await, so the rule has a point --
  // but on mount that write is setLoading(true) while the state is ALREADY true,
  // which React bails out of rather than re-rendering. Load-on-mount is the
  // "subscribe to an external system" case the rule itself carves out, and this is
  // the same shape week.tsx uses.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  useEffect(() => { void isStoragePickerAvailable().then(setStorageOk); }, []);

  const chooseFromStorage = useCallback(async () => {
    // The drawer stays mounted for its close animation, so its rows are still
    // tappable. A second tap starts a second picker, and the native module throws
    // "Different document picking in progress" -- an alert on top of the real
    // picker.
    if (pickingRef.current) return;
    pickingRef.current = true;
    setChooserOpen(false);
    try {
      // No PDF here: a reference photo goes through face detection, which cannot
      // read one. The picker only offers images.
      const picked = await pickFromStorage({ maxSide: MAX_UPLOAD_SIDE });
      // null means they backed out of the OS picker — not an error, no alert.
      if (picked) setPreview(picked.uri);
    } catch (e) {
      Alert.alert('Could not use that photo', e instanceof Error ? e.message : 'Try another one.');
    } finally {
      pickingRef.current = false;
    }
  }, []);

  const send = useCallback(async () => {
    if (!preview || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const secret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY);
      if (!secret) throw new Error('device_inactive');
      await apiPostFile('/api/mobile/profile/photo', { install_secret: secret }, preview);
      setPreview(null);
      await load();
      Alert.alert('Sent', 'Your supervisor will check the new photo. Until then your current photo stays in use.');
    } catch (e) {
      // The server's own words: it explains whether no face was found, the light
      // was bad, or the file was too big -- all things the picker can act on. A
      // generic "upload failed" would send them round the same loop.
      Alert.alert('Not sent', e instanceof Error ? e.message : 'That could not be sent. Try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [preview, load]);

  const signOut = useCallback(() => {
    Alert.alert(
      'Sign out of this phone?',
      // Says the consequence plainly. Signing out is not a small thing: they
      // cannot clock in afterwards, and only a supervisor can undo it.
      'You will not be able to clock in or out from this phone again until your supervisor sets it up for you.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            // READ FIRST, and await it. Firing the read and a delete together
            // raced: expo-secure-store does not promise ordering, so the delete
            // could win, the secret came back null, and the server was never told
            // to revoke -- leaving the device active with the phone's credential
            // already gone.
            const secret = await SecureStore.getItemAsync(INSTALL_SECRET_KEY).catch(() => null);

            // Started, NOT awaited. Even a bounded wait is time in which this
            // phone is still signed in, and the reason to tap this is that it is
            // being handed to somebody else. A supervisor can revoke the device
            // from the dashboard; a secret left on a phone they no longer hold
            // cannot be undone.
            if (secret) {
              void apiPost('/api/mobile/profile/sign-out', { install_secret: secret }).catch(() => {});
            }

            // BOTH keys, each retried once, and nothing is assumed about which
            // matters more. They do different jobs and both have to go:
            //   INSTALL_SECRET_KEY authenticates every call to the server.
            //   DEVICE_ID_KEY is what index.tsx and LockGate read to decide this
            //   phone is enrolled -- so leaving it behind sends the picker to a
            //   clock screen whose every request then fails.
            // Calling the device id "a label" was wrong, and it is exactly the key
            // whose survival strands someone.
            const cleared = await Promise.all(
              [INSTALL_SECRET_KEY, DEVICE_ID_KEY].map((key) => clearKey(key)),
            );
            const [secretCleared, deviceCleared] = cleared;

            if (!secretCleared) {
              // The credential survived, so this phone really is still signed in
              // and a retry is the right thing to offer.
              Alert.alert(
                'Could not sign out',
                'This phone could not be cleared, so it is still signed in. Try again, and tell your supervisor if it keeps failing.',
              );
              return;
            }
            if (!deviceCleared) {
              // Both a delete and a blanking write failed, so the enrolment marker
              // is genuinely stuck. Navigating would bounce straight back to the
              // clock screen and fail on every call, and reopening the app does
              // the same -- index.tsx reads this key on every cold start. Only a
              // supervisor can resolve it from here.
              Alert.alert(
                'Signed out, but this phone is stuck',
                'Your phone has been signed out, but it still shows as set up and will not work for clocking in. Show this to your supervisor.',
              );
              return;
            }
            router.replace('/');
          },
        },
      ],
    );
  }, []);

  const photo = profile?.photo;
  const waiting = photo?.pending ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Icon name="arrowLeft" size={22} color={C.ink} strokeWidth={2} />
        </Pressable>
        <Text style={styles.barTitle} accessibilityRole="header">Your details</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={styles.page}
        // `&& !!profile` is the whole fix for the two-spinners-at-once bug: on a
        // first load this is a FIRST load, not a refresh, so the body spinner below
        // owns it and the pull-to-refresh control must stay quiet. Once there is
        // content the roles swap, and exactly one of the two shows at any moment.
        // Same arrangement as week.tsx.
        refreshControl={<RefreshControl refreshing={loading && !!profile} onRefresh={load} tintColor={C.brand} colors={[C.brand]} />}
      >
        {loading && !profile ? (
          <View style={styles.centre}><ActivityIndicator color={C.brand} /></View>
        ) : error && !profile ? (
          <View style={styles.notice}>
            <Icon name="alert" size={22} color={C.danger} strokeWidth={2.2} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : profile ? (
          <>
            {/* A refresh that FAILED while content is already on screen. The branch
                above only covers a failed FIRST load (error && !profile), so without
                this a pull-to-refresh that could not reach the server did nothing
                visible at all -- the same "looks like nothing happened" problem as
                the missing spinner, and the reason someone pulls five more times. */}
            {error && (
              <View style={styles.staleNotice}>
                <Icon name="alert" size={17} color={C.amber} strokeWidth={2.2} />
                <Text style={styles.staleText}>{error}</Text>
              </View>
            )}
            {/* ── Photo ─────────────────────────────────────────────────── */}
            <Text style={styles.section}>Your photo</Text>
            <View style={styles.card}>
              {/* Three cases, and the empty placeholder only earns its place in
                  one of them. With a photo on file and one waiting, both show with
                  an arrow between. With nothing on file, the waiting one shows
                  ALONE -- an empty frame beside an arrow is a comparison against
                  nothing, and it makes a first upload look like something is
                  missing rather than like it is being checked. */}
              <View style={styles.photoRow}>
                {photo?.url && (
                  <>
                    <View>
                      <Text style={styles.photoLabel}>In use now</Text>
                      <Image source={{ uri: photo.url }} style={styles.photo} accessibilityLabel="Your photo in use now" />
                    </View>
                    {waiting && <Icon name="arrowRight" size={20} color={C.muted} strokeWidth={2} />}
                  </>
                )}

                {waiting ? (
                  <View>
                    <Text style={styles.photoLabel}>Waiting</Text>
                    {waiting.url ? (
                      <Image source={{ uri: waiting.url }} style={[styles.photo, styles.photoWaiting]} accessibilityLabel="The photo waiting to be checked" />
                    ) : (
                      <View style={[styles.photo, styles.photoEmpty, styles.photoWaiting]}>
                        <Icon name="hourglass" size={26} color={C.amber} strokeWidth={1.8} />
                      </View>
                    )}
                  </View>
                ) : !photo?.url ? (
                  // No photo and nothing waiting: the only case where an empty
                  // frame says something true.
                  <View>
                    <Text style={styles.photoLabel}>No photo yet</Text>
                    <View style={[styles.photo, styles.photoEmpty]}>
                      <Icon name="person" size={30} color={C.faint} strokeWidth={1.8} />
                    </View>
                  </View>
                ) : null}
              </View>

              {waiting ? (
                <View style={styles.pendingBanner}>
                  <Icon name="hourglass" size={17} color={C.amber} strokeWidth={2} />
                  <Text style={styles.pendingText}>
                    {/* Only true when there IS one in use. On a first upload the
                        reassurance is the opposite: nothing has been replaced
                        because there was nothing there. */}
                    {describeWait(waiting.submitted_at)}{photo?.url
                      ? ' Your photo in use has not changed.'
                      : ' It will be used once your supervisor approves it.'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.help}>
                  This is the photo every clock-in is checked against.
                </Text>
              )}

              <Pressable
                accessibilityRole="button"
                onPress={() => setChooserOpen(true)}
                style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
              >
                <Icon name="upload" size={18} color={C.brand} strokeWidth={2} />
                {/* Different words when something is already waiting, because
                    "Change photo" there would suggest the first one is stuck. */}
                <Text style={styles.secondaryText}>{waiting ? 'Take a different photo' : 'Change your photo'}</Text>
              </Pressable>
            </View>

            {/* ── Read-only details ─────────────────────────────────────── */}
            <Text style={styles.section}>Your details</Text>
            <View style={styles.card}>
              <Field label="Name" value={profile.name || '—'} />
              <View style={styles.divider} />
              <Field label="Phone" value={profile.phone ? formatPhone(profile.phone) : '—'} />
              <Text style={styles.help}>
                {/* Says who to ask, instead of leaving them wondering why they
                    cannot edit their own name. */}
                Ask your supervisor if either of these is wrong.
              </Text>
            </View>

            {/* ── Documents ─────────────────────────────────────────────── */}
            <Text style={styles.section}>Documents</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/documents')}
              style={({ pressed }) => [styles.card, styles.linkRow, pressed && { backgroundColor: C.pressed }]}
            >
              <View style={styles.linkIcon}><Icon name="document" size={20} color={C.brand} strokeWidth={2} /></View>
              <View style={styles.linkCopy}>
                <Text style={styles.linkTitle}>Your documents</Text>
                <Text style={styles.linkSub}>{documentSummary(profile)}</Text>
              </View>
              <Icon name="arrowRight" size={20} color={C.muted} strokeWidth={2} />
            </Pressable>

            {/* ── Sign out ──────────────────────────────────────────────── */}
            <Pressable
              accessibilityRole="button"
              onPress={signOut}
              style={({ pressed }) => [styles.signOut, pressed && { backgroundColor: C.dangerBg }]}
            >
              <Icon name="signOut" size={19} color={C.danger} strokeWidth={2} />
              <Text style={styles.signOutText}>Sign out of this phone</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <SourceSheet
        visible={chooserOpen}
        title="Your new photo"
        // Camera or an existing file. Images only -- a PDF cannot go through face
        // detection, so offering one would be offering a certain rejection.
        options={[
          {
            icon: 'camera',
            label: 'Take a photo',
            onPress: () => { setChooserOpen(false); setCameraOpen(true); },
          },
          {
            icon: 'gallery',
            // "from your phone", not "from your gallery": Android's picker opens
            // on Files with every source in its drawer, so promising a gallery
            // would describe a screen they are not looking at.
            label: 'Choose from your phone',
            available: storageOk,
            onPress: () => void chooseFromStorage(),
          },
        ]}
        onCancel={() => setChooserOpen(false)}
      />

      {/* Capture, then preview. The sheet closes on capture and the preview card
          below takes over -- see the comment on this screen. Both sources land
          here, so the confirm step applies whichever they picked. */}
      {cameraOpen && (
        <CameraSheet
          visible={cameraOpen}
          title="Take your new photo"
          subtitle="Face the camera straight on in good light."
          onCapture={(uri) => { setCameraOpen(false); setPreview(uri); }}
          onCancel={() => setCameraOpen(false)}
        />
      )}

      {preview && (
        <View style={styles.previewLayer}>
          <SafeAreaView style={styles.previewInner}>
            <Text style={styles.previewTitle} accessibilityRole="header">Send this photo?</Text>
            <Text style={styles.previewCopy}>
              Your supervisor checks it before it replaces the one you have now.
            </Text>
            <Image source={{ uri: preview }} style={styles.previewImage} accessibilityLabel="The photo you just took" />
            <View style={styles.previewActions}>
              <Pressable
                accessibilityRole="button"
                disabled={sending}
                onPress={() => { setPreview(null); setChooserOpen(true); }}
                style={({ pressed }) => [styles.retake, pressed && styles.secondaryPressed, sending && styles.disabled]}
              >
                {/* "Choose again" rather than "Take again": the photo on screen may
                    have come from the gallery, where "take" would be wrong. */}
                <Text style={styles.retakeText}>Choose again</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: sending }}
                disabled={sending}
                onPress={() => void send()}
                style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, sending && styles.disabled]}
              >
                {sending ? <ActivityIndicator color={C.onBrand} /> : <Text style={styles.primaryText}>Send</Text>}
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      )}
    </SafeAreaView>
  );
}

/**
 * Clear one SecureStore key: delete, retry, then blank it.
 *
 * The blanking step is the one that matters. Every reader of these keys tests
 * TRUTHINESS, and readEnrolment() in native-api.ts normalises an empty string to
 * null, so a blanked key reads exactly like a missing one everywhere it is used.
 *
 * That turns the one state with no way out into a recoverable one. If the device
 * id survives while the secret is gone, a cold start routes straight back to
 * /clock and every call there fails; "close and reopen the app" does not help,
 * because index.tsx reads the same key again and does the same thing. Writing an
 * empty value is a second, independent way to reach the same result, and a
 * keystore that refuses a delete may well accept a write.
 *
 * One retry before that, not a loop: if a delete fails twice it is not transient,
 * and the picker should be told rather than held at a spinner.
 */
async function clearKey(key: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await SecureStore.deleteItemAsync(key);
      return true;
    } catch {
      // Fall through to the retry, then to the blanking fallback below.
    }
  }
  try {
    await SecureStore.setItemAsync(key, '');
    return true;
  } catch {
    return false;
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

/** One line for the documents row: what needs doing, or that nothing does. */
function documentSummary(profile: Profile): string {
  const waiting = profile.documents.filter((d) => d.pending).length;
  const missing = profile.documents.filter((d) => d.required && !d.has_current && !d.pending).length;
  if (waiting && missing) return `${waiting} being checked · ${missing} still needed`;
  if (waiting) return `${waiting} being checked`;
  if (missing) return `${missing} still needed`;
  return 'All up to date';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center', color: C.ink, fontSize: 17, fontWeight: '700' },
  page: { paddingHorizontal: 20, paddingBottom: 40 },
  centre: { paddingVertical: 60, alignItems: 'center' },
  notice: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.dangerBg, borderRadius: 14, padding: 16, marginTop: 12 },
  noticeText: { flex: 1, color: C.ink, fontSize: 15, lineHeight: 21 },
  // Amber, not red, and inline rather than replacing the page: what is on screen
  // is still true, it is just not freshly confirmed.
  staleNotice: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.amberBg, borderRadius: 12, padding: 12, marginTop: 12 },
  staleText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 },

  section: { color: C.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 },
  card: { backgroundColor: C.paper, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 14 },

  // Centred, and it has to hold for BOTH states: one photo on its own, and the
  // current-plus-waiting pair with an arrow between them. justifyContent on the
  // row is what does it in both cases -- the row simply has one child or three,
  // and centring the row centres whichever it is, with no second rule to keep in
  // step when a photo starts or stops waiting.
  photoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  // Centred over its OWN photo rather than the row, so "In use now" and "Waiting"
  // each sit above the image they label instead of drifting toward the middle.
  photoLabel: { color: C.muted, fontSize: 12, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  photo: { width: 104, height: 128, borderRadius: 12, backgroundColor: C.canvas },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  photoWaiting: { borderWidth: 2, borderColor: C.amber },

  pendingBanner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.amberBg, borderRadius: 12, padding: 12 },
  pendingText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 },
  help: { color: C.muted, fontSize: 13, lineHeight: 19 },

  field: { gap: 3 },
  fieldLabel: { color: C.muted, fontSize: 13 },
  fieldValue: { color: C.ink, fontSize: 17, fontWeight: '600' },
  divider: { height: 1, backgroundColor: C.line },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  linkIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' },
  linkCopy: { flex: 1, gap: 2 },
  linkTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  linkSub: { color: C.muted, fontSize: 13 },

  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 50, borderRadius: 13, borderWidth: 1.5, borderColor: C.brandBorder, backgroundColor: C.brandTint,
  },
  secondaryPressed: { backgroundColor: C.pressed },
  secondaryText: { color: C.brand, fontSize: 16, fontWeight: '700' },

  signOut: {
    marginTop: 32, minHeight: 52, borderRadius: 13, borderWidth: 1, borderColor: C.danger,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  signOutText: { color: C.danger, fontSize: 16, fontWeight: '700' },

  previewLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12,10,9,0.94)' },
  previewInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 28 },
  previewTitle: { color: C.onBrand, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  previewCopy: { color: '#CFC9C8', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  previewImage: { width: 220, height: 280, borderRadius: 16, backgroundColor: '#000', marginVertical: 6 },
  previewActions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
  retake: {
    flex: 1, minHeight: 54, borderRadius: 13, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  retakeText: { color: C.onBrand, fontSize: 16, fontWeight: '700' },
  primary: { flex: 1, minHeight: 54, borderRadius: 13, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  primaryPressed: { backgroundColor: C.brandDeep },
  primaryText: { color: C.onBrand, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
