// Plain-English text for the short codes the OpsPro server returns. Anything
// not listed here is already a readable sentence (the shared web checks return
// full messages) and is shown as-is.
const MESSAGES: Record<string, string> = {
  // Punches
  already_clocked_in: "You're already clocked in.",
  already_clocked_in_today: "You've already clocked in today.",
  no_open_shift: "You're not clocked in, so there's nothing to clock out of.",
  wrong_clock_out_location: 'Clock out at the store where you clocked in.',
  not_rostered_here_now: "You're not rostered at this store right now.",
  outside_geofence: "You're too far from the store. Move closer and try again.",
  poor_gps_accuracy: 'Your location is not accurate enough. Step outside or near the entrance and try again.',
  mock_location_detected: 'A fake-location app is turned on. Turn it off and try again.',
  invalid_coordinates: 'Your location could not be read. Try again.',
  location_inactive: 'This store is closed. Ask your supervisor where to clock in.',
  location_missing: 'This store could not be found. Ask your supervisor.',
  challenge_expired: 'That took too long. Try again.',
  challenge_used: 'That punch was already sent. Pull down to refresh your status.',
  duplicate_punch: 'That punch was already sent. Pull down to refresh your status.',
  invalid_challenge: 'Something went wrong. Try again.',
  device_inactive: 'This phone is no longer registered. Ask your admin for a new setup code.',
  service_unavailable: 'The office system is not responding. Try again in a moment.',
  employee_inactive: 'Your account is not active. Ask your supervisor.',
  // Setup
  invalid_code: 'That setup code is not valid. Check the 8 digits and try again.',
  code_or_phone_mismatch: "That mobile number and code don't match. Check both and try again.",
  expired_code: 'That setup code has expired. Ask your supervisor for a new one.',
  device_already_registered: 'This phone is already registered.',
  replacement_device_changed: 'Your registered phone changed while setting up. Ask your admin for a new code.',
  break_already_taken: "You've already taken your break this shift.",
  punch_rejected: 'The punch was not accepted. Try again, or ask your supervisor.',
  // Face check
  no_face_captured: 'No face was found in the photo. Move into good light, fill the frame and take it again.',
  face_engine_unavailable: 'The face check is not working right now. Tell your supervisor — retaking the photo will not help.',
  app_update_required: 'This version of the app is out of date. Update it from the Play Store, then clock in again.',
  selfie_too_large: 'That photo was too big to send. Try again.',
};

export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  if (!raw) return 'Something went wrong. Try again.';
  return MESSAGES[raw] ?? raw;
}

/**
 * True when the server has told us this phone is no longer a registered device.
 *
 * Distinct from any other failure, because it is the one the picker CANNOT fix by
 * retrying: a supervisor revoked the phone, or the picker signed out elsewhere.
 * apiPost has already dropped the stored credential by the time this is true, so
 * the caller's job is simply to send them to setup rather than leave them on a
 * screen that will never load.
 *
 * Note what this deliberately does NOT match: 'service_unavailable', which the
 * server returns when it could not READ the device rather than when the device is
 * gone. That one is retryable and must never take anybody to setup.
 */
export function isDeregistered(error: unknown): boolean {
  return error instanceof Error && error.message === 'device_inactive';
}
