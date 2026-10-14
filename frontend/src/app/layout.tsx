import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Outbox Scheduler',
  description: 'Schedule and track outbound emails',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
