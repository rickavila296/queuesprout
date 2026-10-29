import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import localFont from 'next/font/local';
import { ThemeScript } from '@/components/theme-script';
import './globals.css';

/** Display face (OFL, src/fonts/Archivo-OFL.txt): variable width and weight, latin subset. */
const archivo = localFont({
  src: '../fonts/archivo-latin-wdth-normal.woff2',
  variable: '--font-archivo',
  weight: '100 900',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
});

export const metadata: Metadata = {
  title: { default: 'QueueSprout', template: '%s · QueueSprout' },
  description: 'Open-source social media scheduler. Write once, publish to 12 channels.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${archivo.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-bg text-text">{children}</body>
    </html>
  );
}
