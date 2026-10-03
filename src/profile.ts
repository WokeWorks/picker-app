// The shape of /api/mobile/profile, and the small helpers both profile screens
// need. Kept out of src/app/ because only route files belong there.

/** A file the picker has sent that nobody has decided on yet. */
export type PendingUpload = {
  id: string;
  url: string | null;
  submitted_at: string;
};

export type ProfileDocument = {
  doc_type: string;
  label: string;
  required: boolean;
  has_current: boolean;
  current_url: string | null;
  current_name: string | null;
  current_mime: string | null;
  uploaded_at: string | null;
  /** Only passport and EID record one today; everything else is null. */
  expiry_date: string | null;
  accepts_expiry: boolean;
  pending: (PendingUpload & { file_name: string | null; mime_type: string; expiry_date: string | null }) | null;
  /**
   * Decided by the SERVER, not worked out here.
   *
   * A document may not be replaced while one is waiting, and that rule lives in
   * the route and in a database index. Trusting a local copy of it would let the
   * button disagree with what the server will accept, which is how a picker ends
   * up tapping something that always fails.
   */
  can_upload: boolean;
};

export type Profile = {
  /** Read-only. There is no route that accepts a change to either. */
  name: string;
  phone: string | null;
  photo: {
    url: string | null;
    has_photo: boolean;
    pending: PendingUpload | null;
    /** Always true: a photo may be replaced even while one is waiting. */
    can_upload: boolean;
  };
  documents: ProfileDocument[];
};


/** How many days until a date, negative once it has passed. Null if absent. */
export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - Date.now()) / 86_400_000);
}

export type ExpiryState = 'none' | 'expired' | 'soon' | 'ok';

/**
 * Whether an expiry needs attention.
 *
 * 60 days because that is roughly the notice a UAE visa or passport renewal
 * needs to be started without it becoming urgent. It is a display threshold only
 * -- nothing in payroll or attendance reads it -- so it is safe to keep here
 * rather than in the shared config the punch rules live in.
 */
export const EXPIRY_SOON_DAYS = 60;

export function expiryState(date: string | null): ExpiryState {
  const days = daysUntil(date);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= EXPIRY_SOON_DAYS) return 'soon';
  return 'ok';
}

/** "12 Mar 2027", or null. Locale-independent order so it cannot read as US dates. */
export function formatDate(date: string | null): string | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
