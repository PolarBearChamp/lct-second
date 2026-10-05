import Image from 'next/image';
import Link from 'next/link';

/** Логотип ФСП из брендбука (версия для светлого фона) и название сервиса. */
export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3" aria-label="ФСП Таланты — на главную">
      <Image src="/brand/fsp-logo.svg" alt="" width={104} height={35} priority />
      <span className="hidden border-l border-line pl-3 font-brand text-[15px] font-bold leading-tight text-ink sm:block">
        Таланты
        <span className="block text-[11px] font-normal text-muted">подбор ИТ-специалистов</span>
      </span>
    </Link>
  );
}
