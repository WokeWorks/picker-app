import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { MAX_UPLOAD_SIDE, UPLOAD_QUALITY, resizeForUpload } from '@/image';
import { C } from '@/theme';

// The upload size limits and the resize itself live in src/image.ts, shared with
// the gallery path so the two cannot drift apart.

/**
 * Full-screen camera, used for the punch selfie and for photographing documents.
 *
 * One component rather than two, deliberately. The capture flow here has been
 * wrong three separate ways -- a busy flag that only reset on the error path, a
 * `ready` flag reset on close that never came back, and a cancelled capture
 * delivered to the next punch -- and a second copy would be a second place for all
 * three to come back. Everything that varies is a prop.
 *
 * For a punch, the photo is the identity proof. The phone deliberately does NOT
 * look at it —
 * no face detection, no descriptor, no "is this you?" decision happens here. It
 * captures pixels and uploads them; the server measures the face with the same
 * code the wall kiosk uses. Anything this app concluded about the face would be
 * a claim from an untrusted device, and worth nothing.
 *
 * Tap to capture rather than auto-capture on a timer: a timer reliably produces
 * blinks and motion blur, and every unusable photo becomes a failed punch the
 * picker has to understand and repeat.
 */
export function CameraSheet({
  visible,
  action,
  title,
  subtitle,
  facing: initialFacing = 'front',
  mirror,
  maxSide = MAX_UPLOAD_SIDE,
  quality = UPLOAD_QUALITY,
  onCapture,
  onCancel,
}: {
  visible: boolean;
  /** Which punch this is for. Only used to pick the default heading. */
  action?: 'clock_in' | 'clock_out';
  /**
   * Overrides the heading, so the same camera can be used for something that is
   * not a punch -- the profile screen's reference photo. Additive and optional on
   * purpose: the punch path passes neither and behaves exactly as before.
   */
  title?: string;
  subtitle?: string;
  /**
   * Which camera to OPEN with. The picker can switch once it is open.
   *
   * 'front' for a face, 'back' for a document held in front of the phone.
   */
  facing?: 'front' | 'back';
  /**
   * Mirrored preview. Right for a face -- moving to centre yourself feels
   * backwards otherwise -- and WRONG for a document, where it would reverse the
   * writing the picker is trying to line up.
   *
   * Left undefined it follows whichever camera is CURRENTLY selected, so flipping
   * to the back camera stops mirroring by itself. Pass a boolean only to pin it.
   */
  mirror?: boolean;
  /**
   * Longest side of the uploaded image.
   *
   * 1080 for a face, matching the kiosk and the server's own limits. A DOCUMENT
   * needs more than that: the server does not measure it, a human reads it, and
   * passport text at 1080 across a full page is not reliably legible. Callers
   * photographing documents pass a larger number.
   */
  maxSide?: number;
  quality?: number;
  onCapture: (uri: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  /**
   * The camera in use. Starts at `facing` and can be flipped from the overlay.
   *
   * Asked for because a cracked or failing front camera otherwise leaves a picker
   * unable to punch at all -- the back camera is a worse selfie and an available
   * one, and the server only cares that it can find a face.
   */
  const [facing, setFacing] = useState(initialFacing);
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

      // One call, shared with the gallery path. Returns the original uri
      // untouched when it is already small enough.
      const uri = await resizeForUpload(photo.uri, {
        maxSide,
        quality,
        width: photo.width,
        height: photo.height,
      });
      // Checked as late as possible, immediately before handing the photo over:
      // the resize above is awaited, so a cancel can land during it.
      if (mine !== attempt.current) return;
      onCapture(uri);
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
  }, [busy, onCapture, maxSide, quality]);

  // Abandons whatever capture is in flight, so its photo can never be delivered
  // to the next punch, and clears the spinner so a retake does not open onto one.
  //
  // `ready` is deliberately NOT reset here -- see CameraStage.
  // Reopening starts from the caller's choice again rather than remembering the
  // last flip: the sheet stays mounted between uses, so without this a picker who
  // flipped to the back camera once would find every later punch opening on it.
  //
  // Keyed on `visible` rather than called from close(), because close() is only
  // the CANCEL path. A successful capture goes through onCapture, so resetting
  // there alone left a flipped camera in place for every punch after a successful
  // one -- which is most of them.
  // Derived during render, the pattern React documents for state that follows a
  // prop. Doing it in an effect is a synchronous setState there, which cascades a
  // render -- and would also show one frame of the old camera on reopen.
  const [lastVisible, setLastVisible] = useState(visible);
  if (lastVisible !== visible) {
    setLastVisible(visible);
    if (!visible) setFacing(initialFacing);
  }

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
            {/* key={facing} forces a REMOUNT on a flip, which is what keeps
                `ready` honest: CameraStage's unmount clears it and the new
                camera's onCameraReady sets it again. Without the key the prop
                would change on a mounted view, onCameraReady would never fire a
                second time, and the shutter would stay enabled over a camera that
                is not yet live. */}
            <CameraStage
              key={facing}
              cameraRef={camera}
              facing={facing}
              mirror={mirror ?? facing === 'front'}
              onReady={markReady}
              onGone={markGone}
            />
            <View style={styles.overlay} pointerEvents="box-none">
              <Text style={styles.hint} accessibilityRole="header">
                {title ?? (action === 'clock_out' ? 'Photo to clock out' : 'Photo to clock in')}
              </Text>
              <Text style={styles.sub}>{subtitle ?? 'Face the camera in good light, then tap.'}</Text>
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={facing === 'front' ? 'Use the back camera' : 'Use the front camera'}
                  // Disabled mid-capture: flipping while takePictureAsync is in
                  // flight tears down the camera it is reading from.
                  disabled={busy}
                  onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
                  hitSlop={10}
                  style={({ pressed }) => [styles.flip, pressed && styles.flipPressed, busy && styles.flipDisabled]}
                >
                  <Icon name="flipCamera" size={22} color={C.onBrand} strokeWidth={2} />
                </Pressable>
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
  facing,
  mirror,
  onReady,
  onGone,
}: {
  cameraRef: React.RefObject<CameraView | null>;
  facing: 'front' | 'back';
  mirror: boolean;
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
      facing={facing}
      // SDK 57: mirror is a PROP. The old takePictureAsync option is deprecated.
      mirror={mirror}
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
  // Sized to roughly match the Cancel label it sits opposite, so the shutter
  // stays centred without needing an invisible spacer.
  flip: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  flipPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  flipDisabled: { opacity: 0.4 },
});
