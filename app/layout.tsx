import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const siteUrl = new URL(process.env.SITE_URL ?? 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: 'NSE F&O Heat Map',
  description: 'Live and historical heat map for the NSE futures and options universe.',
  openGraph: {
    title: 'NSE F&O Heat Map',
    description: 'Live and historical market view for the NSE futures and options universe.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'NSE F&O Heat Map' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NSE F&O Heat Map',
    description: 'Live and historical market view for the NSE futures and options universe.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
