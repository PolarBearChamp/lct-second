import { LinkButton } from '@/components/ui/button';
import { Logo } from './logo';

export function PublicHeader() {
  return (
    <header className="border-b border-white/20 bg-ink">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo dark />
        <nav aria-label="Вход" className="flex items-center gap-2">
          <LinkButton href="/login" variant="ghost" size="sm" className="text-white hover:bg-white/10">
            Войти
          </LinkButton>
          <LinkButton href="/register" size="sm">
            Регистрация
          </LinkButton>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
        <span>MVP для хакатона Федерации спортивного программирования. Данные демонстрационные.</span>
        <span>Интеграция с ФСП — демонстрационная.</span>
      </div>
    </footer>
  );
}
