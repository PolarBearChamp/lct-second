import Image from 'next/image';
import Link from 'next/link';

/** Supplied FSP artwork: light-background and dark-background versions, unchanged. */
export function Logo({ href = '/', dark = false }: { href?: string; dark?: boolean }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-3" aria-label="ФСП Таланты — на главную">
      <Image src={dark ? '/brand/fsp-logo-dark.svg' : '/brand/fsp-logo.svg'} alt="" width={104} height={35} className="h-auto w-20 sm:w-[104px]" preload />
      <span className={`hidden border-l pl-3 font-brand text-[15px] font-bold leading-tight sm:block ${dark ? 'border-white/30 text-white' : 'border-line text-ink'}`}>
        Таланты
        <span className={`block text-[11px] font-normal ${dark ? 'text-white/70' : 'text-muted'}`}>подбор ИТ-специалистов</span>
      </span>
    </Link>
  );
}
