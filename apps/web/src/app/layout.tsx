import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

// Фирменный шрифт ФСП — JetBrains Mono (OFL), подключён локально, без внешних запросов.
const brandFont = localFont({
  src: [
    { path: './fonts/JetBrainsMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/JetBrainsMono-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/JetBrainsMono-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-brand',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'ФСП Таланты — подбор ИТ-специалистов', template: '%s · ФСП Таланты' },
  description:
    'Платформа обратного подбора: кандидаты подтверждают навыки тестом, работодатели сами находят их и первыми присылают предложение с зарплатой.',
  icons: { icon: '/brand/fsp-mark.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#402fff',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={brandFont.variable}>
      <body className="min-h-screen antialiased">
        <a href="#main" className="skip-link">
          Перейти к содержимому
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
