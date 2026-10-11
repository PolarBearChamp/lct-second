import type { ReactNode } from 'react';
import { PublicFooter, PublicHeader } from '@/components/layout/public-header';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto flex min-h-[calc(100vh-180px)] max-w-6xl items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <PublicFooter />
    </>
  );
}
