import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Sudoku Multiplayer",
  description: "Play real-time multiplayer Sudoku!",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sudoku",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
              <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem('sudoku_theme') === 'dark' || (!('sudoku_theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                } else if (localStorage.getItem('sudoku_theme') === 'light') {
                  document.documentElement.classList.add('light');
                }
              } catch (_) {}

                if ('serviceWorker' in navigator) {
                  window.addEventListener('load', () => {
                    navigator.serviceWorker.register('/sw.js').catch((err) => {
                      console.error('ServiceWorker registration failed:', err);
                    });
                  });
                }
            `,
          }}
        />
      <body className="min-h-full flex flex-col">{children}<Toaster /></body>
    </html>
  );
}
