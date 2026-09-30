import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { C } from '@/theme';

// Longest side of the photo we upload, and its JPEG quality. Both deliberately
// identical to the web kiosk's LiveCameraCapture in the dashboard repo, and kept
// in step with MAX_DECODE_SIDE (1600) in src/lib/face-server.ts, which enforces a
// looser ceiling server-side because this runs on a device we do not control.
//
// The reasoning is measured, not guessed (from the kiosk's own comment): a phone
// camera hands back 4032x3024, and sending that full size costs twice over -- a
// far bigger upload on shop mobile data, and a 139MB tensor on the server, where
// ten arriving together measured 2760MB against a 2048MB instance and killed it,
// taking everyone punching at that moment with it. It buys nothing: the detector
// resizes the image itself before looking, finding the same face at 0.99
// confidence at every size from 640 up, and was FASTER small.
//
// At 1080/0.9 a selfie lands in the low hundreds of KB, so the route's 3MB cap is
// never the thing that stops a punch.
const MAX_UPLOAD_SIDE = 1080;
const UPLOAD_QUALITY = 0.9;

/**
 * Full-screen front camera for the punch selfie.
 *
 * The photo is the identity proof. The phone deliberately does NOT look at it —
 * no face detection, no descriptor, no "is this you?" decision happens here. It
 * captures pixels and uploads them; the server measures the face with the same
 * code the wall kiosk uses. Anything this app concluded about the face would be
 * a claim from an untrusted device, and worth nothing.
 *
 * Tap to capture rather than auto-capture on a timer: a timer reliably produces
 * blinks and motion blur, and every unusable photo becomes a failed punch the
 * picker has to understand and repeat.
 */
export function SelfieSheet({
  visible,
  action,
  onCapture,
  onCancel,
}: {
  visible: boolean;
  action: 'clock_in' | 'clock_out';
  onCapture: (uri: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const camera = useRef<CameraView>(null);

  const take = useCallback(async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({
        // Quality here barely matters: the capture is re-encoded below at
        // UPLOAD_QUALITY after being scaled down, so this only affects the
        // intermediate file. 1 keeps the most detail going into that resize.
        quality: 1,
        // `base64` deliberately off: the bytes go up as a file in a multipart
        // body. Base64 inflates the payload by a third and would put the whole
        // image through the JS bridge as a string for no gain.
        base64: false,
        // Orientation IS applied, despite costing a few milliseconds. With
        // skipProcessing the EXIF rotation flag is left unapplied, and the resize
        // below re-encodes the image -- which may or may not honour that flag
        // depending on platform. That risks handing the server a sideways face,
        // which is well outside the tilt the detector tolerates, and it would fail
        // as "no face found" rather than as anything diagnosable.
        skipProcessing: false,
        shutterSound: false,
      });
      if (!photo?.uri) throw new Error('no uri');

      // Scale the longest side down before it is uploaded. A full-resolution
      // capture off a modern phone is several MB, which the server would refuse
      // outright and then have to downscale anyway.
      const longest = Math.max(photo.width || 0, photo.height || 0);
      if (longest > MAX_UPLOAD_SIDE) {
        const portrait = (photo.height || 0) >= (photo.width || 0);
        const context = ImageManipulator.manipulate(photo.uri);
        // Only ONE dimension is given, so the other is derived and the aspect
        // ratio is preserved. Squashing a face would change the very distances the
        // server measures.
        context.resize(portrait ? { height: MAX_UPLOAD_SIDE } : { width: MAX_UPLOAD_SIDE });
        const rendered = await context.renderAsync();
        const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: UPLOAD_QUALITY });
        onCapture(saved.uri);
        return;
      }
      onCapture(photo.uri);
    } catch {
      setBusy(false);
    }
  }, [busy, onCapture]);

  // Reset for the next open, so a retake never shows a stale spinner.
  const close = useCallback(() => {
    setBusy(false);
    setReady(false);
    onCancel();
  }, [onCancel]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <SafeAreaView style={styles.safe}>
        {!permission ? (
          <View style={styles.centre}><ActivityIndicator color={C.onBrand} /></View>
        ) : !permission.granted ? (
          <View style={styles.centre}>
            <Icon name="alert" size={40} color={C.onBrand} strokeWidth={2} />
            <Text style={styles.askTitle}>Camera access is needed</Text>
            <Text style={styles.askCopy}>
              A photo of your face is taken each time you clock in or out, so your hours are recorded as yours.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void requestPermission()}
              style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
            >
              <Text style={styles.primaryText}>Allow camera</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              ref={camera}
              style={styles.camera}
              facing="front"
              // A mirrored preview is what people expect of a front camera; without
              // it, moving to centre yourself feels backwards. SDK 57: this is a
              // prop, the old takePictureAsync option is deprecated.
              mirror
              onCameraReady={() => setReady(true)}
            />
            <View style={styles.overlay} pointerEvents="box-none">
              <Text style={styles.hint} accessibilityRole="header">
                {action === 'clock_in' ? 'Photo to clock in' : 'Photo to clock out'}
              </Text>
              <Text style={styles.sub}>Face the camera in good light, then tap.</Text>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={close} hitSlop={10}>
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Take photo"
                  accessibilityState={{ disabled: !ready || busy }}
                  disabled={!ready || busy}
                  onPress={() => void take()}
                  style={({ pressed }) => [
                    styles.shutter,
                    (!ready || busy) && styles.shutterDisabled,
                    pressed && styles.shutterPressed,
                  ]}
                >
                  {busy ? <ActivityIndicator color={C.brand} /> : <View style={styles.shutterDot} />}
                </Pressable>
                {/* Balances the row so the shutter sits centred. */}
                <Text style={[styles.cancel, styles.invisible]}>Cancel</Text>
              </View>
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 },
  askTitle: { color: C.onBrand, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  askCopy: { color: '#CFC9C8', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  primary: {
    marginTop: 8, backgroundColor: C.paper, paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 14, minWidth: 200, alignItems: 'center',
  },
  primaryPressed: { backgroundColor: C.pressed },
  primaryText: { color: C.ink, fontSize: 17, fontWeight: '700' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 28, paddingTop: 18, alignItems: 'center', gap: 6 },
  hint: { color: C.onBrand, fontSize: 19, fontWeight: '700' },
  sub: { color: '#CFC9C8', fontSize: 14, marginBottom: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 28 },
  shutter: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: C.paper,
    alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.45)',
  },
  shutterPressed: { backgroundColor: C.pressed },
  shutterDisabled: { opacity: 0.45 },
  shutterDot: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.brand },
  cancel: { color: C.onBrand, fontSize: 16, fontWeight: '600' },
  invisible: { opacity: 0 },
});
