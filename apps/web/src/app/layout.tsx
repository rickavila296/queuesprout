import type { Metadata } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { ThemeScript } from '@/components/theme-script';
import './globals.css';

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
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-bg text-text">{children}</body>
    </html>
  );
}
