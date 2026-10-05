'use client';

import clsx from 'clsx';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  tone: 'success' | 'danger' | 'info';
  message: string;
}

const ToastContext = createContext<{ notify: (message: string, tone?: ToastItem['tone']) => void }>({ notify: () => undefined });

/** Короткие уведомления о результате действий; объявляются экранным дикторам через aria-live. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-2), { id, tone, message }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={clsx(
              'pointer-events-auto w-full max-w-md rounded-xl border px-4 py-3 text-[15px] shadow-lg',
              item.tone === 'success' && 'border-[#abefc6] bg-success-50 text-success-700',
              item.tone === 'danger' && 'border-[#fecdca] bg-danger-50 text-danger-700',
              item.tone === 'info' && 'border-brand-200 bg-brand-50 text-brand-800',
            )}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
