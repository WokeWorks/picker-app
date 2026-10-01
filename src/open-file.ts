// Opening a stored document in whatever app the picker has for it.
//
// Three steps, and each one is doing something the others cannot:
//
//   1. DOWNLOAD the signed URL to the app's cache. Android cannot hand a remote
//      https URL to a PDF viewer -- it would open a browser, which for a signed
//      storage URL means downloading it again in Chrome.
//   2. Turn the cached path into a `content://` URI. A `file://` URI thrown at
//      another app raises FileUriExposedException on Android 7+; content:// with a
//      read grant is the only way to share a file across apps.
//   3. Fire ACTION_VIEW. Android shows the chooser when more than one app can
//      handle the type, and goes straight to their default when one is set --
//      which is the behaviour asked for, and it is the OS's to decide, not ours.
//
// The whole point is that this works for a PDF, a JPEG or anything else that ends
// up in the bucket: the MIME type comes from the record, so the shortlist Android
// offers is the right one without this file knowing what types exist.
import { Platform } from 'react-native';

/** Where a viewed file is cached. Sits under the OS cache, so Android can reclaim it. */
const CACHE_DIR = 'viewed-documents';

/** How long a downloaded copy may stay in the cache. See the sweep in openRemoteFile. */
const VIEWED_CACHE_TTL_MS = 60 * 60 * 1000;

/** Short random prefix, so two documents cannot land on the same cache path. */
function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const OPEN_UNAVAILABLE =
  'This version of the app cannot open files. Ask your supervisor to update it.';

/**
 * Download `url` and hand it to another app to display.
 *
 * Throws with a message meant for the picker. Returns nothing on success — the
 * other app is on screen by then.
 */
export async function openRemoteFile(
  url: string,
  options: { mimeType?: string | null; fileName?: string | null },
): Promise<void> {
  // Lazily imported, so a build without these native modules fails HERE with a
  // sentence rather than at import time with a red screen.
  const [fs, legacy, intent] = await Promise.all([
    import('expo-file-system').catch(() => null),
    import('expo-file-system/legacy').catch(() => null),
    import('expo-intent-launcher').catch(() => null),
  ]);
  if (!fs || !legacy) throw new Error(OPEN_UNAVAILABLE);

  const mimeType = options.mimeType || guessMime(options.fileName) || 'application/octet-stream';

  // A real extension matters more than it looks: some viewers decide what they
  // can open from the filename, not from the MIME type they are handed.
  const name = safeName(options.fileName, mimeType);

  const dir = new fs.Directory(fs.Paths.cache, CACHE_DIR);
  try {
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    // Not worth failing over until the download below fails for a reason worth
    // reporting.
  }

  // Awaited. It worked un-awaited only because passing `fs` skips the dynamic
  // import, so the loop happened to run synchronously -- any await added before
  // that loop later would have had the sweep racing the download below. It never
  // throws, so awaiting costs nothing.
  await sweepViewedCache(fs);

  // Unique per download, so two documents can never share a path. The previous
  // naming derived the filename from the stored name, and two files both called
  // "document.jpg" collided.
  const target = new fs.File(dir, `${randomId()}-${name}`);

  let downloaded;
  try {
    downloaded = await fs.File.downloadFileAsync(url, target);
  } catch {
    throw new Error('That file could not be downloaded. Check your connection and try again.');
  }

  // iOS has no equivalent chooser and no FileProvider here. The app is Android-only
  // today (enroll.tsx refuses anything else), so this is a guard rather than a
  // branch -- it stops the iOS build silently doing nothing when that changes.
  if (Platform.OS !== 'android' || !intent) {
    throw new Error('Opening documents is only available on Android right now.');
  }

  let contentUri: string;
  try {
    contentUri = await legacy.getContentUriAsync(downloaded.uri);
  } catch {
    throw new Error('That file could not be opened.');
  }

  try {
    await intent.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: mimeType,
      // 1 = FLAG_GRANT_READ_URI_PERMISSION. Without it the chooser appears and
      // then whichever app they pick gets a SecurityException reading the file,
      // which looks like the document is broken rather than the grant missing.
      flags: 1,
    });
  } catch {
    // Android raises this when NOTHING on the phone handles the type -- a picker
    // with no PDF reader, most likely. Say what to do about it.
    throw new Error('No app on this phone can open that file. Install a PDF reader, or ask your supervisor to email it.');
  }
}

/** Extension from the MIME type, since the stored filename may have none. */
function extFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return 'jpg';
}

function guessMime(fileName: string | null | undefined): string | null {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return null;
}

/**
 * A filename safe to write into the cache.
 *
 * The stored name came from whichever phone uploaded it, so it is untrusted text
 * that is about to become part of a path: anything but a plain name is dropped
 * rather than escaped, and the extension is derived from the MIME type we know
 * rather than trusted from the name.
 */
function safeName(fileName: string | null | undefined, mimeType: string): string {
  const base = (fileName ?? 'document')
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 60) || 'document';
  return `${base}.${extFor(mimeType)}`;
}

/**
 * Delete viewed copies older than the retention window.
 *
 * Age-based rather than a wholesale wipe: emptying the directory on every open
 * pulled the file out from under the viewer still showing the PREVIOUS document.
 * Its content:// permission was granted, but the bytes were gone.
 *
 * Exported because running it only inside openRemoteFile means a picker who views
 * one document and never opens another keeps that copy indefinitely -- the window
 * would be a promise nothing enforced. The documents screen calls this on mount,
 * so the sweep happens on the way IN as well as on the way out.
 *
 * It is still best-effort: React Native has no background task here, so a phone
 * that never reopens the app keeps its last copy until the OS evicts the cache.
 * Said plainly rather than implied, because these are passports.
 */
export async function sweepViewedCache(fsModule?: typeof import('expo-file-system')): Promise<void> {
  try {
    const fs = fsModule ?? (await import('expo-file-system'));
    const dir = new fs.Directory(fs.Paths.cache, CACHE_DIR);
    if (!dir.exists) return;
    const cutoff = Date.now() - VIEWED_CACHE_TTL_MS;
    for (const entry of dir.list()) {
      if (!(entry instanceof fs.File)) continue;
      // modificationTime is ALREADY milliseconds since epoch (File.types.d.ts).
      // Only the /legacy API uses seconds, and multiplying by 1000 made every file
      // look millennia in the future, so nothing was ever swept.
      const touched = entry.modificationTime ?? entry.creationTime;
      // An unreadable timestamp is treated as stale: a file we cannot date is one
      // we cannot promise to clean up later.
      if (touched && touched > cutoff) continue;
      entry.delete();
    }
  } catch {
    // A failed sweep leaves files behind; it must never stop someone opening a
    // document they are entitled to see.
  }
}
