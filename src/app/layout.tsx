import type { Metadata } from 'next';
import { AppProvider } from '@/components/app-provider';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ResourceDex — Good materials, new possibilities',
    template: '%s · ResourceDex',
  },
  description:
    'Find and share free materials, spare parts, and tools in your community. Give useful things their next chapter.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
