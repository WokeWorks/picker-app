// Plain-English text for the short codes the OpsPro server returns. Anything
// not listed here is already a readable sentence (the shared web checks return
// full messages) and is shown as-is.
const MESSAGES: Record<string, string> = {
  // Punches
  already_clocked_in: "You're already clocked in.",
  already_clocked_in_today: "You've already clocked in today.",
  already_clocked_out_today: "You've already clocked out today.",
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
  invalid_challenge: 'Something went wrong. Try again.',
  device_inactive: 'This phone is no longer registered. Ask your admin for a new setup code.',
  employee_inactive: 'Your account is not active. Ask your supervisor.',
  // Setup
  invalid_code: 'That setup code is not valid. Check it and try again.',
  expired_code: 'That setup code has expired. Ask your admin for a new one.',
  device_already_registered: 'This phone is already registered.',
  replacement_device_changed: 'Your registered phone changed while setting up. Ask your admin for a new code.',
  punch_rejected: 'The punch was not accepted. Try again, or ask your supervisor.',
};

export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  if (!raw) return 'Something went wrong. Try again.';
  return MESSAGES[raw] ?? raw;
}
