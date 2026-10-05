import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { shouldViewInApp } from '@/components/DocumentViewer';
import { SourceSheet } from '@/components/SourceSheet';
import { MAX_DOCUMENT_SIDE, isPhotoLibraryAvailable, isStoragePickerAvailable, pickFromPhotoLibrary, pickFromStorage } from '@/image';
import { apiPost, apiPostFile, requireInstallSecret } from '@/native-api';
import { friendlyError } from '@/messages';
import { openRemoteFile, sweepViewedCache } from '@/open-file';
import { type Profile, type ProfileDocument, expiryState, formatDate } from '@/profile';
import { C } from '@/theme';

/**
 * The picker's documents, and sending a new one for approval.
 *
 * The rule that shapes this screen: a document that is WAITING cannot be
 * replaced. That is the opposite of the reference photo, and deliberate -- a
 * passport scan is not something you iterate on, and a supervisor part-way
 * through reading one wants it to stay still. So a waiting document shows no
 * upload button at all, and says why.
 *
 * `can_upload` comes from the server rather than being worked out here, so this
 * screen cannot offer a button the route would refuse.
 */
export default function DocumentsScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which type is being photographed, then the captured-but-unsent file. The
  // preview step exists for the same reason as on the profile screen: a document
  // photographed badly is a rejection and a wasted round trip through a human.
  const [preview, setPreview] = useState<{ doc: ProfileDocument; uri: string; mimeType: string; name: string | null } | null>(null);
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
  // iOS only. On an iPhone the Files picker cannot see the photo library at all, so
  // without this a picker who photographed their passport has no way to send it.
  // False on Android, where the one picker already reaches every gallery app.
  const [photosOk, setPhotosOk] = useState(false);
  // The document waiting on a source choice. Only used where photosOk is true; on
  // Android the picker opens straight away, exactly as before.
  const [chooserFor, setChooserFor] = useState<ProfileDocument | null>(null);
  /**
   * Whether ANY source is available, which is what an Upload button promises.
   *
   * Not storageOk alone. On iOS the two pickers are independent modules, so a
   * build with Photos but no Files would have had every Upload button removed
   * while a perfectly good source sat behind it. The Files option inside the
   * sheet is still gated on storageOk separately -- that one really is about
   * Files.
   */
  const canPick = storageOk || photosOk;
  // See profile.tsx: iOS will not present a picker over the sheet's Modal, so the
  // choice is queued and run once the sheet has really gone.
  const afterSheetRef = useRef<(() => void) | null>(null);

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
      const secret = await requireInstallSecret();
      const data = await apiPost<Profile>('/api/mobile/profile', { install_secret: secret });
      if (seq !== loadSeq.current) return;
      setError(null);
      setProfile(data);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      // apiPost has already cleared the credential and navigated to setup; an
      // error here would sit on top of that screen. The stuck case did NOT
      // navigate (it would loop), so it still needs saying.
      if (e instanceof Error && e.message === 'device_inactive') return;
      if (e instanceof Error && e.message === 'deregistered_stuck') {
        setError('This phone has been removed from your account. Show this to your supervisor.');
        return;
      }
      // A keystore that could not be READ is retryable and says how: the generic
      // "pull down to try again" below is true but omits the one thing that
      // usually clears it.
      if (e instanceof Error && e.message === 'enrolment_unreadable') {
        setError(friendlyError(e));
        return;
      }
      setError('Could not load your documents. Pull down to try again.');
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
  useEffect(() => { void isPhotoLibraryAvailable().then(setPhotosOk); }, []);

  // Sweeps old viewed copies on the way IN, not only when another document is
  // opened. Viewing one document and never opening another would otherwise keep
  // that copy -- a passport or a visa -- for as long as the app is installed.
  useEffect(() => { void sweepViewedCache(); }, []);

  const chooseFromStorage = useCallback(async (doc: ProfileDocument) => {
    // See profile.tsx: a double-tap otherwise starts two pickers, and the second
    // throws over the top of the first.
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      // PDFs allowed: a visa or labour card usually arrives as one, and nothing
      // measures a document -- a person reads it, so the original beats a photo
      // of a screen. On Android this one route covers everything, because its
      // picker lists every source on the phone including gallery apps. On iOS it
      // is the Files app, and photos are reached through chooseFromPhotos instead.
      const picked = await pickFromStorage({ maxSide: MAX_DOCUMENT_SIDE, allowPdf: true });
      // null means they backed out of the OS picker — not an error, no alert.
      if (picked) setPreview({ doc, uri: picked.uri, mimeType: picked.mimeType, name: picked.name });
    } catch (e) {
      Alert.alert('Could not use that file', e instanceof Error ? e.message : 'Try another one.');
    } finally {
      pickingRef.current = false;
    }
  }, []);

  // iOS only. Same guards and the same error handling, so the two sources cannot
  // drift in how a cancel or a failure is treated.
  const chooseFromPhotos = useCallback(async (doc: ProfileDocument) => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const picked = await pickFromPhotoLibrary({ maxSide: MAX_DOCUMENT_SIDE });
      if (picked) setPreview({ doc, uri: picked.uri, mimeType: picked.mimeType, name: picked.name });
    } catch (e) {
      Alert.alert('Could not use that file', e instanceof Error ? e.message : 'Try another one.');
    } finally {
      pickingRef.current = false;
    }
  }, []);

  /**
   * Where the upload button goes.
   *
   * Android keeps its existing behaviour exactly: one tap, picker opens. The sheet
   * appears only where there are genuinely two different places a file can live.
   */
  /**
   * Opens the viewer ROUTE. Only the document's type travels, never the signed URL:
   * navigation parameters live in router state and surface in logs and deep links,
   * and these are passports. The viewer looks the file up for itself.
   */
  const openViewer = useCallback((doc: ProfileDocument) => {
    router.push({ pathname: '/document', params: { type: doc.doc_type } });
  }, []);

  const choose = useCallback((doc: ProfileDocument) => {
    // Both sources: ask which. Only one: open it, with no pointless extra tap.
    if (photosOk && storageOk) setChooserFor(doc);
    else if (photosOk) void chooseFromPhotos(doc);
    else void chooseFromStorage(doc);
  }, [photosOk, storageOk, chooseFromPhotos, chooseFromStorage]);

  const send = useCallback(async () => {
    if (!preview || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const secret = await requireInstallSecret();
      const sent = await apiPostFile<{ request_id?: string }>(
        '/api/mobile/profile/document',
        { install_secret: secret, doc_type: preview.doc.doc_type },
        preview.uri,
      );
      // Past this line the document IS accepted, and the screen has to say so
      // IMMEDIATELY -- not when the reload lands.
      //
      // Awaiting the reload is not the answer: a failed reload would then be
      // reported as a failed upload, and the picker would send the file again.
      // But firing it and doing nothing else left can_upload stale and the button
      // live, so a second tap hit the route and was refused as already waiting --
      // an error for something that had worked.
      //
      // So the row is marked pending from the response itself. The reload below
      // only reconciles, and a failure now costs a stale timestamp rather than a
      // duplicate submission.
      const { doc, mimeType, name } = preview;
      setProfile((prev) => (prev ? {
        ...prev,
        documents: prev.documents.map((d) => (d.doc_type === doc.doc_type
          ? {
              ...d,
              can_upload: false,
              pending: {
                id: sent?.request_id ?? `local-${doc.doc_type}`,
                // No signed URL yet; the reload supplies it. The row shows the
                // waiting banner, which needs no preview.
                url: null,
                submitted_at: new Date().toISOString(),
                file_name: name,
                mime_type: mimeType,
                expiry_date: null,
              },
            }
          : d)),
      } : prev));

      const label = doc.label;
      setPreview(null);
      void load();
      Alert.alert('Sent', `Your supervisor will check your ${label}. You can send another one once they have.`);
    } catch (e) {
      Alert.alert('Not sent', e instanceof Error ? e.message : 'That could not be sent. Try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [preview, load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Icon name="arrowLeft" size={22} color={C.ink} strokeWidth={2} />
        </Pressable>
        <Text style={styles.barTitle} accessibilityRole="header">Your documents</Text>
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
            <Text style={styles.intro}>
              Your supervisor checks anything you send before it is saved. Nothing you send here
              replaces what you already have until they do.
            </Text>
            {/* With no camera on this screen, a build without the file picker's
                native module cannot upload anything at all. Say so once at the
                top rather than leaving nine buttons that throw. */}
            {!canPick && (
              <View style={styles.notice}>
                <Icon name="alert" size={22} color={C.danger} strokeWidth={2.2} />
                <Text style={styles.noticeText}>
                  This version of the app cannot open your files. Ask your supervisor to update it.
                </Text>
              </View>
            )}
            {profile.documents.map((doc) => (
              <DocumentRow
                key={doc.doc_type}
                doc={doc}
                // BOTH: canPick says this build can open SOME picker,
                // doc.can_upload is the server's rule about this document. They
                // answer different questions, and the server's is the one the
                // route will actually enforce -- so a button shown against it is
                // a button that fails after the picker has chosen a file.
                canUpload={canPick && doc.can_upload}
                onUpload={() => choose(doc)}
                onViewInApp={openViewer}
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* iOS only -- see `choose`. Rendered unconditionally because SourceSheet
          handles its own visibility and exit animation. */}
      <SourceSheet
        visible={chooserFor !== null}
        title="Where is the file?"
        options={[
          {
            icon: 'gallery',
            label: 'Choose from Photos',
            onPress: () => {
              const doc = chooserFor;
              afterSheetRef.current = () => { if (doc) void chooseFromPhotos(doc); };
              setChooserFor(null);
            },
          },
          {
            icon: 'document',
            // Where a PDF visa or labour card lives on an iPhone.
            label: 'Choose from Files',
            available: storageOk,
            onPress: () => {
              const doc = chooserFor;
              afterSheetRef.current = () => { if (doc) void chooseFromStorage(doc); };
              setChooserFor(null);
            },
          },
        ]}
        onCancel={() => { afterSheetRef.current = null; setChooserFor(null); }}
        onClosed={() => {
          const run = afterSheetRef.current;
          afterSheetRef.current = null;
          run?.();
        }}
      />

      {preview && (
        <View style={styles.previewLayer}>
          <SafeAreaView style={styles.previewInner}>
            <Text style={styles.previewTitle} accessibilityRole="header">Send this {preview.doc.label}?</Text>
            <Text style={styles.previewCopy}>
              Check this is the right file and the writing is easy to read.
            </Text>
            {preview.mimeType === 'application/pdf' ? (
              // A PDF cannot be shown inline without another native dependency, so
              // the preview confirms WHICH FILE rather than pretending to render
              // it. The name is the only thing that distinguishes two PDFs, which
              // is exactly what this step exists to let them check.
              <View style={styles.pdfCard}>
                <Icon name="document" size={46} color={C.brand} strokeWidth={1.8} />
                <Text style={styles.pdfName} numberOfLines={2}>{preview.name ?? 'PDF document'}</Text>
                <Text style={styles.pdfHint}>PDF · your supervisor will open it</Text>
              </View>
            ) : (
              <Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="contain" accessibilityLabel="The file you chose" />
            )}
            <View style={styles.previewActions}>
              <Pressable
                accessibilityRole="button"
                disabled={sending}
                onPress={() => { const doc = preview.doc; setPreview(null); void choose(doc); }}
                style={({ pressed }) => [styles.retake, pressed && styles.secondaryPressed, sending && styles.disabled]}
              >
                {/* "Choose again", because what is on screen may have come from
                    the gallery, where "take" would be the wrong verb. */}
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

function DocumentRow({ doc, canUpload, onUpload, onViewInApp }: {
  doc: ProfileDocument;
  canUpload: boolean;
  onUpload: () => void;
  /** Opens the in-app viewer. The screen owns it, so only one can be open. */
  onViewInApp: (doc: ProfileDocument) => void;
}) {
  const expiry = expiryState(doc.expiry_date);
  const expiryText = formatDate(doc.expiry_date);
  const [opening, setOpening] = useState(false);

  // Downloads, then hands the file to whatever app the phone has for its type --
  // Android shows the chooser, or their default if they have set one. A spinner
  // because the download is a real wait on shop mobile data, and a button that
  // looks inert for three seconds gets tapped again.
  const view = useCallback(async () => {
    if (opening || !doc.current_url) return;

    // Shown in the app wherever it can be. Nothing is written to disk and no other
    // app receives a copy -- which matters here, because these are passports.
    // A PDF on Android is the exception and still goes out to a reader; see
    // shouldViewInApp for why.
    if (shouldViewInApp(doc.current_mime)) {
      onViewInApp(doc);
      return;
    }

    setOpening(true);
    try {
      await openRemoteFile(doc.current_url, { mimeType: doc.current_mime, fileName: doc.current_name });
    } catch (e) {
      Alert.alert('Could not open it', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setOpening(false);
    }
  }, [opening, doc, onViewInApp]);

  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <View style={styles.rowIcon}>
          <Icon name="document" size={20} color={doc.has_current ? C.brand : C.faint} strokeWidth={2} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{doc.label}</Text>
          <Text style={styles.rowState}>{stateLine(doc)}</Text>
        </View>
        {/* One chip, and only when it means something. A row of grey "OK" badges on
            every document would make the two that need attention invisible. */}
        {doc.required && !doc.has_current && !doc.pending && <Chip tone="danger" text="Needed" />}
        {expiry === 'expired' && <Chip tone="danger" text="Expired" />}
        {expiry === 'soon' && <Chip tone="amber" text="Expiring" />}
      </View>

      {expiryText && (
        <Text style={[styles.expiry, expiry === 'expired' && styles.expiryBad, expiry === 'soon' && styles.expirySoon]}>
          {expiry === 'expired' ? `Expired ${expiryText}` : `Expires ${expiryText}`}
        </Text>
      )}

      {/* View and Upload side by side. Either can be absent -- nothing to view
          until something is on file, and no upload while one is being checked --
          and a lone button simply fills the row, which is why both are flex: 1
          rather than a fixed half. btnPair also levels the two: on their own they
          had different heights, radii and border weights, which reads as sloppy
          once they sit shoulder to shoulder. */}
      {(doc.current_url || doc.pending || canUpload) && (
        <View style={styles.btnRow}>
          {doc.current_url && (
            <Pressable
              accessibilityRole="button"
              /* The visible word is just "View", so the LABEL carries the
                 document name: a screen reader running down this page would
                 otherwise hear "View" five times with nothing to tell them
                 apart. */
              accessibilityLabel={`View your ${doc.label}`}
              disabled={opening}
              onPress={() => void view()}
              style={({ pressed }) => [styles.viewBtn, styles.btnPair, pressed && styles.secondaryPressed, opening && styles.disabled]}
            >
              {opening
                ? <ActivityIndicator color={C.brand} />
                : <>
                    <Icon name="document" size={17} color={C.brand} strokeWidth={2} />
                    <Text style={styles.viewText}>View</Text>
                  </>}
            </Pressable>
          )}

          {doc.pending ? (
            /* Takes Upload's place rather than leaving a gap, so a document being
               checked keeps the same two-button shape as every other row. A plain
               View, not a disabled Pressable: there is nothing to press at all.
               accessibilityState still says "disabled" so a screen reader
               announces an unavailable control instead of stray text. */
            <View
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel={`Your ${doc.label} is being checked by your supervisor`}
              style={[styles.secondary, styles.btnPair, styles.inReview]}
            >
              <Icon name="hourglass" size={17} color={C.amber} strokeWidth={2} />
              <Text style={styles.inReviewText}>In review</Text>
            </View>
          ) : canUpload ? (
            <Pressable
              accessibilityRole="button"
              /* Still says whether this REPLACES or ADDS, which "Upload" alone
                 does not, and which changes what tapping it does to a document
                 already on file. */
              accessibilityLabel={doc.has_current ? `Replace your ${doc.label}` : `Add your ${doc.label}`}
              onPress={onUpload}
              style={({ pressed }) => [styles.secondary, styles.btnPair, pressed && styles.secondaryPressed]}
            >
              <Icon name="upload" size={17} color={C.brand} strokeWidth={2} />
              <Text style={styles.secondaryText}>Upload</Text>
            </Pressable>
          ) : null}
        </View>
      )}

    </View>
  );
}

function stateLine(doc: ProfileDocument): string {
  if (doc.pending) return 'Being checked by your supervisor';
  if (doc.has_current) return 'On file';
  return doc.required ? 'Not sent yet — your supervisor needs this' : 'Not sent yet';
}

function Chip({ tone, text }: { tone: 'danger' | 'amber'; text: string }) {
  return (
    <View style={[styles.chip, tone === 'danger' ? styles.chipDanger : styles.chipAmber]}>
      <Text style={[styles.chipText, tone === 'danger' ? styles.chipTextDanger : styles.chipTextAmber]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center', color: C.ink, fontSize: 17, fontWeight: '700' },
  page: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  centre: { paddingVertical: 60, alignItems: 'center' },
  notice: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.dangerBg, borderRadius: 14, padding: 16, marginTop: 12 },
  noticeText: { flex: 1, color: C.ink, fontSize: 15, lineHeight: 21 },
  // Amber, not red, and inline rather than replacing the page: what is on screen
  // is still true, it is just not freshly confirmed.
  staleNotice: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.amberBg, borderRadius: 12, padding: 12, marginTop: 12 },
  staleText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 },
  intro: { color: C.muted, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 4 },

  card: { backgroundColor: C.paper, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  rowState: { color: C.muted, fontSize: 13, lineHeight: 18 },

  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  chipDanger: { backgroundColor: C.dangerBg },
  chipAmber: { backgroundColor: C.amberBg },
  chipText: { fontSize: 12, fontWeight: '700' },
  chipTextDanger: { color: C.danger },
  chipTextAmber: { color: C.amber },

  expiry: { color: C.muted, fontSize: 13 },
  expirySoon: { color: C.amber, fontWeight: '600' },
  expiryBad: { color: C.danger, fontWeight: '600' },

  viewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.canvas,
  },
  viewText: { color: C.brand, fontSize: 15, fontWeight: '700' },

  // The pair. flex: 1 so one button alone still fills the row, and the shared
  // height/radius/border so View and Upload read as one control strip rather
  // than two buttons that happen to be adjacent.
  btnRow: { flexDirection: 'row', gap: 10 },
  btnPair: { flex: 1, minHeight: 48, borderRadius: 13, borderWidth: 1.5 },
  // Amber, matching the hourglass and the waiting banner, so "being checked" reads
  // as one state across the row rather than three unrelated signals.
  inReview: { borderColor: C.amber, backgroundColor: C.amberBg },
  inReviewText: { color: C.amber, fontSize: 15, fontWeight: '700' },


  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, borderRadius: 13, borderWidth: 1.5, borderColor: C.brandBorder, backgroundColor: C.brandTint,
  },
  secondaryPressed: { backgroundColor: C.pressed },
  secondaryText: { color: C.brand, fontSize: 15, fontWeight: '700' },

  previewLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12,10,9,0.94)' },
  previewInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  previewTitle: { color: C.onBrand, fontSize: 21, fontWeight: '800', textAlign: 'center' },
  previewCopy: { color: '#CFC9C8', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  previewImage: { width: '100%', height: 320, borderRadius: 14, backgroundColor: '#000', marginVertical: 6 },
  pdfCard: {
    width: '100%', height: 320, borderRadius: 14, backgroundColor: C.paper, marginVertical: 6,
    alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24,
  },
  pdfName: { color: C.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  pdfHint: { color: C.muted, fontSize: 14 },
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
