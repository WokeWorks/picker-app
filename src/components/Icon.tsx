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
  | 'pin' | 'clock' | 'lock' | 'face' | 'fingerprint' | 'phone';

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
    case 'face': return <><Path d="M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16" /><Path d="M9 10h.01M15 10h.01M9.5 14.5a3.5 3.5 0 0 0 5 0" /></>;
    case 'fingerprint': return <><Path d="M6.5 7.5a7 7 0 0 1 11 0" /><Path d="M5 12a7 7 0 0 1 14 0v1" /><Path d="M8.5 20a10 10 0 0 1-1.5-6v-2a5 5 0 0 1 10 0v2.5" /><Path d="M12 12v2.5a9 9 0 0 0 2 5.5" /><Path d="M16.8 17.5a12 12 0 0 1-.3 2.5" /></>;
    case 'phone': return <><Rect x={6.5} y={2.5} width={11} height={19} rx={2} /><Path d="M11 18h2" /></>;
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
