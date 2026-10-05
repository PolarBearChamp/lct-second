'use client';

import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <div className="card p-8" role="alert">
        <h1 className="text-2xl font-bold">Что-то пошло не так</h1>
        <p className="mt-2 text-muted">Попробуйте обновить страницу. Если ошибка повторяется, сообщите код: {error.digest ?? '—'}.</p>
        <Button className="mt-6" onClick={reset}>
          Повторить
        </Button>
      </div>
    </main>
  );
}
