import Image from 'next/image';
import type { ReactNode } from 'react';
import { PublicFooter, PublicHeader } from '@/components/layout/public-header';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto grid min-h-[calc(100vh-180px)] max-w-6xl items-start gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-2 lg:gap-12">
        <aside className="brand-auth brand-hero-frame hidden overflow-hidden p-8 lg:block">
          <p className="brand-eyebrow text-white/65">ФСП / Таланты</p>
          <h2 className="mt-6 text-3xl font-medium leading-tight">Навыки, которые<br />открывают двери.</h2>
          <p className="mt-5 text-sm leading-relaxed text-white/75">Подтверждённый грейд. Понятный подбор. Предложение с зарплатой до начала общения.</p>
          <Image src="/brand/wireframe-face.png" alt="" width={332} height={313} className="mx-auto mt-8 h-auto w-64" />
          <p className="mt-6 border-t border-white/20 pt-5 text-xs leading-relaxed text-white/65">Кандидат подтверждает навыки. Работодатель первым направляет приглашение. Кандидат решает, раскрывать ли контакты.</p>
        </aside>
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
      <PublicFooter />
    </>
  );
}
