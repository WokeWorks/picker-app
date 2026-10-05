import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { Icon } from '@/components/Icon';
import { C } from '@/theme';

/**
 * A document, shown INSIDE the app.
 *
 * The full contents of the /document route, not a modal. That is what gives it the
 * iOS edge-swipe and the Android back button for free -- a modal sits outside the
 * navigation stack and gets neither.
 *
 * WHY THIS EXISTS
 * Handing the file to another app was the only option before: Android fires
 * ACTION_VIEW, iOS can only offer the share sheet. Both take the picker out of
 * OpsPro to read their own passport, and on iOS the share sheet is built for
 * sharing -- a preview is a second tap, when it is offered at all.
 *
 * Keeping it here also keeps the document here. Nothing is written to disk, no
 * other app receives a copy, and there is no cached file to sweep afterwards --
 * which matters more than usual, because these are passports and visas.
 *
 * WHAT IT DOES NOT COVER
 * A PDF on ANDROID. Android's WebView cannot render one, and the usual workaround
 * is to pass the URL through Google's document viewer -- which would send a
 * picker's passport to Google. The existing ACTION_VIEW path handles that case and
 * is left exactly as it was; see shouldViewInApp.
 */

/** Which files this component can actually display, per platform. */
export function shouldViewInApp(mimeType: string | null | undefined): boolean {
  const type = (mimeType ?? '').toLowerCase();
  // Images render natively on both platforms.
  if (type.startsWith('image/')) return true;
  // WKWebView renders a PDF; Android's WebView does not. See the note above.
  if (type === 'application/pdf') return Platform.OS === 'ios';
  return false;
}

export function DocumentViewer({
  url,
  mimeType,
  title,
  onClose,
}: {
  /** The signed URL. Loaded directly, so nothing is written to disk. */
  url: string | null;
  mimeType: string | null | undefined;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Read as values and applied as padding, NOT through SafeAreaView. A Modal is a
  // separate native window, and SafeAreaView inside one does not reliably receive
  // insets -- which put this header under the status bar, the notch and the
  // Dynamic Island.
  const insets = useSafeAreaInsets();

  // Reset when the DOCUMENT changes, not when the modal finishes animating.
  // onShow fires only after the slide-in completes, so the first frames of an open
  // rendered whatever the previous document left behind -- which is why an error
  // flashed up before the file appeared.
  //
  // Adjusted during RENDER, the same way SourceSheet derives `mounted`. React
  // supports this for state that depends on a prop, and it lands before anything is
  // painted -- which an effect does not, so an effect would still show one stale
  // frame. It also keeps react-hooks/set-state-in-effect satisfied.
  const [lastUrl, setLastUrl] = useState(url);
  if (url !== lastUrl) {
    setLastUrl(url);
    setLoading(true);
    setFailed(false);
  }

  const isPdf = (mimeType ?? '').toLowerCase() === 'application/pdf';

  return (
    <View style={styles.page}>
        {/* The bar starts BELOW the status bar. The fallback keeps a sensible gap
            on a phone that reports no inset at all. */}
      <View style={[styles.bar, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
        <Pressable
          accessibilityRole="button"
          // The word is gone from the screen but not from the screen reader: a
          // bare arrow announces as nothing useful without this.
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <Icon name="arrowLeft" size={22} color={C.ink} strokeWidth={2.2} />
        </Pressable>

        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>

        {/* Mirrors the back button's width so the title is centred on the BAR
            rather than on the space left over beside it. */}
        <View style={styles.closeSpacer} />
      </View>

      <View style={styles.body}>
        {failed ? (
          <View style={styles.message}>
            <Icon name="alert" size={28} color={C.danger} strokeWidth={2.2} />
            <Text style={styles.messageText}>
              That document could not be shown. Check your connection and try again.
            </Text>
          </View>
        ) : isPdf ? (
          <WebView
            // Keyed so a new document starts a clean load rather than inheriting
            // the previous one's page.
            key={url}
            source={{ uri: url ?? '' }}
            onLoadEnd={() => setLoading(false)}
            // onError only. onHttpError fires for sub-requests and for the
            // redirect a signed storage URL performs, so treating it as fatal
            // reported a failure for a document that was about to load fine.
            onError={() => { setLoading(false); setFailed(true); }}
            style={styles.filler}
          />
        ) : (
          // A ScrollView with zoom, so a passport's small print can be read.
          // maximumZoomScale is iOS-only; on Android the image is fitted and
          // legible at full width, which is how it behaved before this screen.
          <ScrollView
            style={styles.filler}
            contentContainerStyle={styles.imageWrap}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            <Image
              key={url}
              source={{ uri: url ?? '' }}
              style={styles.image}
              resizeMode="contain"
              onLoadEnd={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true); }}
              accessibilityLabel={title}
            />
          </ScrollView>
        )}

        {loading && !failed && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator size="large" color={C.brand} />
          </View>
        )}
      </View>

      {/* Keeps the document clear of the home indicator. */}
      <View style={{ height: insets.bottom }} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.canvas },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 8, paddingBottom: 10,
    backgroundColor: C.paper,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
  },
  title: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  closePressed: { backgroundColor: C.pressed },
  /** Same width as `close`, so the centred title is not pushed off-centre. */
  closeSpacer: { width: 40 },
  body: { flex: 1 },
  filler: { flex: 1 },
  imageWrap: { flexGrow: 1, justifyContent: 'center' },
  image: { width: '100%', height: '100%', minHeight: 420 },
  loading: { ...StyleSheet.absoluteFill as object, alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  messageText: { color: C.muted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
});
