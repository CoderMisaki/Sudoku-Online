import type { Metadata, Viewport } from 'next';

// The Harvest Moon open-world game is landscape-first. When it is installed as
// a PWA from any /harvest URL, THIS manifest is the one the browser stores, so
// Android/iOS launch the game already rotated to landscape (tier 1 of the
// orientation strategy — see docs/harvest-orientation-reconnect.md).
//
// The root `/manifest.json` deliberately stays `"orientation": "any"` so the
// Sudoku/lobby app is never forced to rotate.
export const metadata: Metadata = {
  title: 'Harvest Moon Together',
  description: 'Multiplayer open-world farming game',
  manifest: '/manifest.harvest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Harvest Moon',
  },
};

// Game viewport: no pinch-zoom, no overscroll, full-bleed (notch safe).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export default function HarvestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
