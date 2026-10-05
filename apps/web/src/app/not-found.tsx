import { PublicHeader } from '@/components/layout/public-header';
import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="font-brand text-5xl font-bold text-brand-500">404</p>
        <h1 className="mt-3 text-2xl font-bold">Страница не найдена</h1>
        <p className="mt-2 text-muted">Возможно, ссылка устарела или у вас нет доступа к этому объекту.</p>
        <LinkButton href="/" className="mt-6">
          На главную
        </LinkButton>
      </main>
    </>
  );
}
