// The app's icon set: the same 24x24 stroked glyphs as the OpsPro dashboard
// (opspro-app src/components/ui/Icon.tsx), drawn with react-native-svg. Used
// instead of text glyphs and emoji, which render differently on every phone
// and can't be sized or coloured reliably.
//
// Decorative by default (hidden from screen readers) because every icon sits
// next to its own text label.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'check' | 'checkCircle' | 'alert' | 'info' | 'arrowLeft' | 'arrowRight'
  | 'pin' | 'clock' | 'lock' | 'face' | 'fingerprint' | 'phone' | 'tea' | 'calendar'
  | 'person' | 'document' | 'upload' | 'hourglass' | 'signOut'
  | 'flipCamera' | 'gallery' | 'camera';

function glyph(name: IconName) {
  switch (name) {
    case 'check': return <Path d="M4.5 12.5l5 5 10-11" />;
    case 'checkCircle': return <><Circle cx={12} cy={12} r={9} /><Path d="M8 12.2l2.8 2.8L16 9.5" /></>;
    case 'alert': return <><Path d="M12 3.5L21 19.5H3z" /><Path d="M12 9.5v4M12 16.8h.01" /></>;
    case 'info': return <><Circle cx={12} cy={12} r={9} /><Path d="M12 11.2v5.3M12 7.8h.01" /></>;
    case 'arrowLeft': return <><Path d="M20 12H5" /><Path d="M11 6l-6 6 6 6" /></>;
    case 'arrowRight': return <><Path d="M4 12h15" /><Path d="M13 6l6 6-6 6" /></>;
    case 'pin': return <><Path d="M12 21.5s-6.5-5.4-6.5-10.5a6.5 6.5 0 0 1 13 0c0 5.1-6.5 10.5-6.5 10.5z" /><Circle cx={12} cy={10.5} r={2.5} /></>;
    case 'clock': return <><Circle cx={12} cy={12} r={9} /><Path d="M12 7v5.2l3.2 2" /></>;
    case 'lock': return <><Rect x={4.5} y={10.5} width={15} height={10} rx={2} /><Path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>;
    // face and fingerprint follow Tabler Icons (MIT): face-id, fingerprint.
    case 'face': return <><Path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2-2v-2" /><Path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0" /></>;
    case 'fingerprint': return <><Path d="M18.9 7a8 8 0 0 1 1.1 5v1a6 6 0 0 0 .8 3" /><Path d="M8 11a4 4 0 0 1 8 0v1a10 10 0 0 0 2 6" /><Path d="M12 11v2a14 14 0 0 0 2.5 8" /><Path d="M8 15a18 18 0 0 0 1.8 6" /><Path d="M4.9 19a22 22 0 0 1-.9-7v-1a8 8 0 0 1 12-6.95" /></>;
    // Cup with steam, after Tabler Icons (MIT) 'coffee'.
    case 'tea': return <><Path d="M8 3a2.4 2.4 0 0 0-1 2a2.4 2.4 0 0 0 1 2M12 3a2.4 2.4 0 0 0-1 2a2.4 2.4 0 0 0 1 2" /><Path d="M3 10h14v5a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6v-5z" /><Path d="M16.75 16.73a3 3 0 1 0 .25-5.56" /></>;
    case 'calendar': return <><Rect x={3} y={5} width={18} height={16} rx={2} /><Path d="M16 2.5v4M8 2.5v4M3 10.5h18" /></>;
    case 'phone': return <><Rect x={6.5} y={2.5} width={11} height={19} rx={2} /><Path d="M11 18h2" /></>;
    // The remaining five follow Tabler Icons (MIT), as face/fingerprint/tea above
    // do: user, file-text, upload, hourglass, logout.
    case 'person': return <><Circle cx={12} cy={8} r={3.5} /><Path d="M5 20.5a7 7 0 0 1 14 0" /></>;
    case 'document': return <><Path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><Path d="M14 3.5v5h5" /><Path d="M9 13h6M9 16.5h4" /></>;
    case 'upload': return <><Path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><Path d="M12 16V3.5" /><Path d="M7.5 8L12 3.5 16.5 8" /></>;
    case 'hourglass': return <><Path d="M7 3.5h10" /><Path d="M7 20.5h10" /><Path d="M8 3.5v3.6a4 4 0 0 0 1.6 3.2L12 12l-2.4 1.7A4 4 0 0 0 8 16.9v3.6" /><Path d="M16 3.5v3.6a4 4 0 0 1-1.6 3.2L12 12l2.4 1.7a4 4 0 0 1 1.6 3.2v3.6" /></>;
    case 'signOut': return <><Path d="M13 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h6" /><Path d="M17 8.5l3.5 3.5L17 15.5" /><Path d="M20 12h-9" /></>;
    // Tabler Icons (MIT): camera-rotate, photo, camera.
    case 'flipCamera': return <><Path d="M9.5 6l1.2-2h2.6l1.2 2h2a2 2 0 0 1 2 2v3M20 15v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1" /><Path d="M15.5 12.5l2 2 2-2M8.5 11.5l-2-2-2 2" /><Circle cx={12} cy={12.5} r={2.6} /></>;
    case 'gallery': return <><Rect x={3.5} y={4.5} width={17} height={15} rx={2} /><Circle cx={8.6} cy={9.4} r={1.4} /><Path d="M4 16.5l4.6-4.2 3.3 3 3-2.6 5.1 4.3" /></>;
    case 'camera': return <><Path d="M4 8.5a2 2 0 0 1 2-2h1.3l1.2-2h6l1.2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><Circle cx={12} cy={12.5} r={3.2} /></>;
  }
}

export function Icon({ name, size = 20, color, strokeWidth = 1.8 }: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {glyph(name)}
    </Svg>
  );
}
