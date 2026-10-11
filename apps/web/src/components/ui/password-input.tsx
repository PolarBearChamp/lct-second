'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Input } from './field';

/** Shared password control preserves the form ref, autocomplete and accessible field metadata. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} ref={ref} type={visible ? 'text' : 'password'} className={`pr-24 ${props.className ?? ''}`} />
      <button
        type="button"
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        aria-controls={props.id}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
        className="absolute inset-y-0 right-1 min-w-20 rounded-md px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
      >
        {visible ? 'Скрыть' : 'Показать'}
      </button>
    </div>
  );
});
