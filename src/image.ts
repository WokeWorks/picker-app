// Preparing an image for upload.
//
// Extracted from CameraSheet so the GALLERY path cannot drift from the camera
// path. A photo picked from the gallery is often a far bigger file than one the
// camera just took -- a shared album download, a screenshot, something saved from
// WhatsApp -- and sending it unresized would mean a slow upload on shop mobile
// data and, past the route's cap, an outright refusal. Two copies of this logic
// would mean two places for that to be got wrong.
import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Longest side of the photo we upload, and its JPEG quality.
 *
 * Both deliberately identical to the web kiosk's LiveCameraCapture, and kept in
 * step with MAX_DECODE_SIDE (1600) in the server's src/lib/face-server.ts, which
 * enforces a looser ceiling because it runs on a device we do not control.
 *
 * The reasoning is measured, not guessed (from the kiosk's own comment): a phone
 * camera hands back 4032x3024, and sending that full size costs twice over -- a
 * far bigger upload, and a 139MB tensor on the server, where ten arriving together
 * measured 2760MB against a 2048MB instance and killed it, taking everyone
 * punching at that moment with it. It buys nothing: the detector resizes the image
 * itself before looking, finding the same face at 0.99 confidence at every size
 * from 640 up, and was FASTER small.
 *
 * At 1080/0.9 a selfie lands in the low hundreds of KB, so the route's 3MB cap is
 * never the thing that stops a punch.
 */
export const MAX_UPLOAD_SIDE = 1080;
export const UPLOAD_QUALITY = 0.9;

/**
 * Longest side for a DOCUMENT rather than a face.
 *
 * Bigger, because nothing measures a document -- a person reads it. A full
 * passport page at 1080 across is not reliably legible, and an unreadable scan is
 * a rejection and a wasted round trip through a human. 1600 matches the server's
 * own MAX_DECODE_SIDE and still lands well inside the document route's 4MB cap.
 */
export const MAX_DOCUMENT_SIDE = 1600;

/**
 * Scale an image down to `maxSide` on its longest edge, re-encoded as JPEG.
 *
 * Returns the ORIGINAL uri untouched when it is already small enough, so a photo
 * that needs nothing is not re-encoded for no reason -- re-encoding is lossy, and
 * doing it twice to a face is doing it twice to the thing being measured.
 *
 * `width`/`height` are optional because a gallery asset reports them and a bare
 * uri does not. Without them the image is resized unconditionally, which is the
 * safe direction to be wrong in: a small image resized to a larger maxSide is
 * left alone by the resize anyway.
 */
export async function resizeForUpload(
  uri: string,
  options: { maxSide: number; quality?: number; width?: number | null; height?: number | null },
): Promise<string> {
  const { maxSide, quality = UPLOAD_QUALITY, width, height } = options;

  let w = width ?? 0;
  let h = height ?? 0;

  // MEASURE rather than assume when the caller could not say. The file picker
  // reports no dimensions, and guessing "portrait" was wrong twice over: a
  // landscape 4000x3000 pinned by HEIGHT came out 1440x1080, still over the cap,
  // and a small 600x800 was UPSCALED to 1080 -- a bigger file carrying no more
  // detail, fed to the face detector.
  if (!w || !h) {
    try {
      const measured = await ImageManipulator.manipulate(uri).renderAsync();
      w = measured.width;
      h = measured.height;
    } catch {
      // Fall through with zeros and resize anyway: a re-encode is wasteful but
      // safe, whereas skipping it could send a 12MB original.
    }
  }

  const longest = Math.max(w, h);
  if (longest && longest <= maxSide) return uri;

  // Pin the LONGER side, so the result fits inside maxSide whichever way up it is.
  const portrait = h >= w;

  const context = ImageManipulator.manipulate(uri);
  // Only ONE dimension is given, so the other is derived and the aspect ratio is
  // preserved. Squashing a face would change the very distances the server
  // measures against the reference photo.
  context.resize(portrait ? { height: maxSide } : { width: maxSide });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  return saved.uri;
}

/** What the picker chose, ready to preview and send. */
export type PickedFile = {
  uri: string;
  /** From the picker itself, so a PDF is known to be a PDF before it is sent. */
  mimeType: string;
  /** Original filename, for the preview card. Null when the picker gives none. */
  name: string | null;
};

export const PICKER_UNAVAILABLE =
  'Choosing a file needs a newer version of the app. Take a photo instead.';

/**
 * expo-document-picker, loaded lazily.
 *
 * Deliberately NOT expo-image-picker, which this replaced. Two reasons:
 *
 *   1. On Android 13+ expo-image-picker opens the SYSTEM PHOTO PICKER, which on a
 *      Samsung routes straight into Google Photos with no way to choose Samsung
 *      Gallery or Files. getDocumentAsync goes through the Storage Access
 *      Framework instead, which is the "Open from" chooser -- every provider on
 *      the phone, and Android remembers the one they prefer.
 *   2. It cannot pick a PDF at all, and a visa or labour card usually arrives as
 *      one. The server has accepted PDFs since day one; the app was the only thing
 *      that could not send them.
 *
 * Cached including the failure, so the import is attempted once.
 */
let cached: typeof import('expo-document-picker') | null | undefined;

async function documentPicker(): Promise<typeof import('expo-document-picker') | null> {
  if (cached !== undefined) return cached;
  try {
    // Dynamic, so a build without the native module rejects this promise rather
    // than taking the screen down at import time.
    cached = await import('expo-document-picker');
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether this BUILD can open the file picker at all. See the note above. */
export async function isStoragePickerAvailable(): Promise<boolean> {
  return !!(await documentPicker());
}

/**
 * Let the picker choose a file from their phone, resized ready for upload.
 *
 * Returns null when they backed out, and throws only for a real failure, so a
 * cancel is never reported to them as an error.
 *
 * A PDF is passed through untouched: there is nothing to resize, and re-encoding
 * it is not something this app should attempt. Images are resized exactly as a
 * camera capture is, through the same helper.
 */
export async function pickFromStorage(
  options: { maxSide: number; allowPdf?: boolean },
): Promise<PickedFile | null> {
  const Picker = await documentPicker();
  if (!Picker) throw new Error(PICKER_UNAVAILABLE);

  const result = await Picker.getDocumentAsync({
    // An explicit allowlist rather than '*/*': offering every file on the phone
    // invites a .docx that the server will refuse after the upload has finished.
    type: options.allowPdf ? ['image/*', 'application/pdf'] : ['image/*'],
    // Copies into the app's cache, which is what makes the uri readable by the
    // upload. Without it a SAF content:// uri is a permission grant that can
    // expire before the file is read.
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error('That file could not be read. Try another one.');


  const name = asset.name ?? null;
  // Extension as well as the reported type: some providers hand back
  // 'application/octet-stream' for a PDF, which would otherwise go to the image
  // resizer and throw a native error at the picker.
  const looksPdf = asset.mimeType === 'application/pdf'
    || (asset.name ?? '').toLowerCase().endsWith('.pdf');

  if (looksPdf) {
    // The `type` argument is a HINT: a provider may ignore it and return a PDF
    // anyway. Refusing here is the difference between a clear sentence now and a
    // blank preview followed by a rejection from the server.
    if (!options.allowPdf) {
      throw new Error('That has to be a photo, not a PDF.');
    }
    return { uri: asset.uri, mimeType: 'application/pdf', name };
  }

  // Dimensions are not reported by the document picker, so resizeForUpload has
  // nothing to compare against and resizes unconditionally. That is the safe
  // direction: an image already smaller than maxSide is left alone by the resize
  // itself, and the cost is one re-encode of a file about to be uploaded anyway.
  const uri = await resizeForUpload(asset.uri, { maxSide: options.maxSide });
  // The resize always writes JPEG, so report that rather than the source type --
  // a HEIC that is now a JPEG must not be announced as HEIC.
  return { uri, mimeType: 'image/jpeg', name };
}

/**
 * Pick an image from the PHOTO LIBRARY. iOS only, and the reason is concrete.
 *
 * On iOS, getDocumentAsync opens the FILES app, and an iPhone keeps its photos in
 * PHOTOS, not Files. So the document picker opens onto a screen with none of the
 * user's pictures in it -- there is nothing wrong with the call, there is simply
 * nothing there to choose. Android does not have this problem: its document UI
 * lists every provider on the phone, gallery apps included, which is exactly why
 * the comment below says a separate gallery picker was removed.
 *
 * So this is ADDITIVE and iOS-only. The Android path is untouched: it still goes
 * through getDocumentAsync, still reaches Samsung Gallery and Google Photos through
 * the provider drawer, and still handles PDFs.
 *
 * PDFs are not offered here. The photo library holds no PDFs; on iOS those live in
 * Files, which is what pickFromStorage still covers.
 */
let cachedImagePicker: typeof import('expo-image-picker') | null | undefined;

async function imagePicker(): Promise<typeof import('expo-image-picker') | null> {
  if (cachedImagePicker !== undefined) return cachedImagePicker;
  try {
    cachedImagePicker = await import('expo-image-picker');
  } catch {
    cachedImagePicker = null;
  }
  return cachedImagePicker;
}

/**
 * Whether to offer "Photos" as a separate source.
 *
 * iOS only by design -- see above. Returning false on Android keeps that platform's
 * behaviour exactly as it was rather than adding a second route to the same place.
 */
export async function isPhotoLibraryAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return !!(await imagePicker());
}

export async function pickFromPhotoLibrary(
  options: { maxSide: number },
): Promise<PickedFile | null> {
  const Picker = await imagePicker();
  if (!Picker) throw new Error(PICKER_UNAVAILABLE);

  // No permission request: PHPickerViewController runs out of process and hands
  // back only what was chosen, so iOS grants no library access and asks for none.
  const result = await Picker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    // No editing step. Cropping a face before the server measures it would change
    // the very distances being compared against the reference photo.
    allowsEditing: false,
    exif: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error('That photo could not be read. Try another one.');

  // Width and height ARE reported here, unlike the document picker, so
  // resizeForUpload can skip the re-encode when the photo is already small enough.
  const uri = await resizeForUpload(asset.uri, {
    maxSide: options.maxSide,
    width: asset.width,
    height: asset.height,
  });
  // An iPhone photo is usually HEIC; the resize writes JPEG, so report JPEG. When
  // the resize was skipped the original is already small, and the server accepts
  // what the picker reports.
  return { uri, mimeType: uri === asset.uri ? (asset.mimeType ?? 'image/jpeg') : 'image/jpeg', name: asset.fileName ?? null };
}

/**
 * Why there is no separate "gallery" picker any more ON ANDROID.
 *
 * (iOS does have one again -- see pickFromPhotoLibrary above. This note is about
 * Android, where the document picker genuinely does reach every gallery app.)
 *
 * There was one, built on ACTION_GET_CONTENT through expo-intent-launcher, and it
 * failed twice over:
 *
 *   1. NO CHOOSER. IntentLauncherModule.kt calls startActivityForResult with the
 *      raw intent and never wraps it in Intent.createChooser, so Android goes
 *      straight to whichever app already handles GET_CONTENT image/* -- Google
 *      Photos, with no way to pick Samsung Gallery. The module cannot express it.
 *   2. It returned a content:// URI owned by another app, which then had to be
 *      copied into our cache by hand, and that copy was what kept failing.
 *
 * getDocumentAsync has neither problem: Android's own document UI lists every
 * provider on the phone in its drawer -- Samsung Gallery, Google Photos, Drive,
 * Files -- so the choice is still there, and `copyToCacheDirectory` does the copy
 * natively instead of leaving it to us.
 */
