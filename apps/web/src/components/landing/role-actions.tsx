import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';

export function RoleActions() {
  return (
    <div>
      <div className="border-t-2 border-ink pb-7 pt-5">
        <h2 className="text-xl font-semibold">Ищу работу</h2>
        <p className="mb-5 mt-2 max-w-sm text-[15px] leading-relaxed text-muted">Заполните профиль, подтвердите грейд и откройте его для подбора.</p>
        <LinkButton href="/register?role=CANDIDATE" size="lg" className="w-full justify-between px-4">
          Я ищу работу <span aria-hidden>→</span>
        </LinkButton>
      </div>
      <div className="border-t border-line py-5">
        <h2 className="text-xl font-semibold">Нанимаю специалистов</h2>
        <p className="mb-3 mt-2 max-w-sm text-[15px] leading-relaxed text-muted">Опишите потребность. Получите подборку с объяснением, почему кандидат подходит.</p>
        <Link href="/register?role=EMPLOYER" className="inline-flex min-h-11 items-center gap-3 font-semibold text-brand-700 underline-offset-4 hover:underline">
          Я ищу специалиста <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
