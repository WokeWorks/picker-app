// GrowHub palette — the same values as the OpsPro dashboard (opspro-app
// src/lib/brands.ts + theme.ts), so the app and the dashboard read as one
// product. Brand ramp derived from #1B5746; neutrals are warm, from growhub.ae.
// Status colours are independent of the brand.
//
// Yellow and pink are GrowHub accents, kept for later. Deliberately unused:
// yellow is not readable as text and must not be mistaken for a warning.
export const C = {
  canvas: '#F5F2F2',     // page ground (growhub.ae --bg-body)
  paper: '#FFFFFF',
  pressed: '#EEE9E9',
  line: '#E4DEDD',
  lineStrong: '#D3CBCA',

  ink: '#241F1E',        // primary text
  inkMid: '#574F4D',     // secondary text
  muted: '#756C6A',      // muted text, still readable
  faint: '#9A908E',      // placeholders, disabled

  brand: '#1B5746',      // fills, primary buttons, brand text
  brandDeep: '#184D3E',  // pressed brand
  brandTint: '#ECF9F5',  // soft brand background
  brandBorder: '#B1E7D8',
  onBrand: '#FFFFFF',    // text on a brand fill
  onBrandMuted: '#AEC1BB',

  green: '#15803D', greenBg: '#DCFCE7',
  amber: '#B45309', amberBg: '#FEF3C7',
  danger: '#DC2626', dangerBg: '#FEE2E2',

  // GrowHub orange (growhub.ae). Too light for white text (2.8:1), so it is
  // always paired with dark ink (5.9:1). Used for breaks.
  orange: '#F47824',
  orangeDeep: '#CB5A2A',
  orangeTint: '#FFF1E8',
  onOrange: '#241F1E',

  accentYellow: '#EFE565',
  accentPink: '#F16885',
} as const;
