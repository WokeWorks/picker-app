import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const camera = useRef<CameraView>(null);
  /**
   * Which open of the sheet a capture belongs to. Bumped whenever the sheet is
   * closed without a photo.
   *
   * Capturing and resizing takes long enough to cancel during, and the parent
   * hands each open a fresh one-shot resolver. So a capture that finished after
   * a cancel used to land on the resolver belonging to the NEXT punch: tap
   * shutter, cancel, punch again quickly, and the photo from the abandoned
   * attempt was uploaded as the new punch's selfie. Hand the phone over between
   * the two and that is one picker's face submitted for another's clock-in, which
   * the server only flags after the fact rather than refusing.
   */
  const attempt = useRef(0);

  const take = useCallback(async () => {
    if (!camera.current || busy) return;
    const mine = attempt.current;
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
        // Checked as late as possible, immediately before handing the photo over:
        // everything above is awaited, so the cancel can land at any point in it.
        if (mine !== attempt.current) return;
        onCapture(saved.uri);
        return;
      }
      if (mine !== attempt.current) return;
      onCapture(photo.uri);
    } catch {
      // Surfaces as a tap that did nothing. The picker can simply tap again,
      // which is a better answer than an alert explaining a camera fault they
      // cannot do anything about.
    } finally {
      // The reset lives in a finally so that EVERY exit path clears it --
      // success, failure, and anything added later. That is the whole bug this
      // replaces: the reset used to exist only on the error path, so a
      // successful clock-IN left busy stuck true and the shutter was dead for
      // the clock-OUT. A picker could clock in and then not clock out without
      // force-closing the app.
      //
      // This sheet stays MOUNTED between punches, so state left behind here is
      // state the next punch inherits -- which is why the fix has to be here
      // rather than relying on the component being torn down.
      //
      // Scoped to the live attempt, because busy is SHARED and a cancelled
      // capture can outlive the punch it belonged to: cancel mid-capture, punch
      // again, and the abandoned capture landing would otherwise clear the
      // spinner while the new photo was still being taken. The picker sees a
      // shutter that looks idle mid-capture, taps again, and two captures race
      // for one punch.
      //
      // This cannot strand busy at true: an attempt only becomes stale via
      // close(), which resets busy itself.
      if (mine === attempt.current) setBusy(false);
    }
  }, [busy, onCapture]);

  // Abandons whatever capture is in flight, so its photo can never be delivered
  // to the next punch, and clears the spinner so a retake does not open onto one.
  //
  // `ready` is deliberately NOT reset here -- see CameraStage.
  const close = useCallback(() => {
    attempt.current += 1;
    setBusy(false);
    onCancel();
  }, [onCancel]);

  const markReady = useCallback(() => setReady(true), []);
  const markGone = useCallback(() => setReady(false), []);

  /**
   * Re-read the camera permission whenever the app comes back to the foreground
   * while this sheet is open and still blocked.
   *
   * Without this, sending the picker to the system settings page is a dead end:
   * useCameraPermissions only reads the status when the component that calls it
   * MOUNTS, and this sheet stays mounted for the whole life of the clock screen.
   * So a picker who turns the camera back on and returns still sees "camera
   * access was turned off", and no amount of cancelling and re-punching changes
   * it -- only force-quitting the app does.
   *
   * Listening only while blocked and open keeps this off the normal punch path
   * entirely.
   */
  useEffect(() => {
    if (!visible || permission?.granted) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [visible, permission?.granted, getPermission]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <SafeAreaView style={styles.safe}>
        {!permission ? (
          <View style={styles.centre}><ActivityIndicator color={C.onBrand} /></View>
        ) : !permission.granted ? (
          <View style={styles.centre}>
            <Icon name="alert" size={40} color={C.onBrand} strokeWidth={2} />
            <Text style={styles.askTitle}>Camera access is needed</Text>
            {/* Once canAskAgain is false the OS will never show the prompt again,
                so requestPermission() returns denied without displaying anything.
                Offering "Allow camera" there is a button that cannot work, and it
                leaves the picker unable to punch at all with no way out -- the
                only route back is the system settings page. */}
            <Text style={styles.askCopy}>
              {permission.canAskAgain
                ? 'A photo of your face is taken each time you clock in or out, so your hours are recorded as yours.'
                : 'Camera access was turned off for this app. Turn it back on in your phone settings and come straight back here — you cannot clock in or out until you do.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
              style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
            >
              <Text style={styles.primaryText}>
                {permission.canAskAgain ? 'Allow camera' : 'Open phone settings'}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraStage cameraRef={camera} onReady={markReady} onGone={markGone} />
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

/**
 * The camera preview, which reports when it is ready AND when it goes away.
 *
 * `ready` has to follow the camera's MOUNT rather than the sheet's visibility,
 * because those are not the same thing: RN's Modal unmounts its children on
 * Android when `visible` goes false, but KEEPS them mounted on iOS so it can
 * animate out (`_shouldShowModal`/`isRendered` in Libraries/Modal/Modal.js).
 *
 * Resetting `ready` on close was therefore right on Android and wrong on iOS,
 * where onCameraReady never fires a second time -- so the shutter stayed
 * disabled for good and the picker could not punch at all. Letting the camera's
 * own unmount clear the flag is correct on both, with no platform check to get
 * out of step with a future RN change.
 */
function CameraStage({
  cameraRef,
  onReady,
  onGone,
}: {
  cameraRef: React.RefObject<CameraView | null>;
  onReady: () => void;
  onGone: () => void;
}) {
  // The cleanup IS the whole point: it runs when this component unmounts, which
  // is exactly when the camera stops being ready.
  useEffect(() => onGone, [onGone]);
  return (
    <CameraView
      ref={cameraRef}
      style={styles.camera}
      facing="front"
      // A mirrored preview is what people expect of a front camera; without it,
      // moving to centre yourself feels backwards. SDK 57: this is a prop, the
      // old takePictureAsync option is deprecated.
      mirror
      onCameraReady={onReady}
    />
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
