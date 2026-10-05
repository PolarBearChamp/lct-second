import clsx from 'clsx';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const control =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-[#8a8d99] transition-colors hover:border-[#a8a9b4] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-canvas disabled:text-muted aria-[invalid=true]:border-danger-600';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  className?: string;
}

/** Поле формы: подпись, подсказка и ошибка связаны с элементом через aria-атрибуты. */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="text-danger-600" aria-hidden>
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[13px] font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(control, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(control, 'min-h-28', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(control, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, description, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      <input id={id} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong accent-brand-500" {...rest} />
      <label htmlFor={id} className="text-[15px] leading-6">
        {label}
        {description ? <span className="block text-[13px] text-muted">{description}</span> : null}
      </label>
    </div>
  );
}

/** Группа выбора «плашками» (checkbox или radio) — доступна с клавиатуры как обычные input. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  multiple,
  error,
  name,
  columns = 2,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  options: Array<{ value: T; label: ReactNode; description?: ReactNode; disabled?: boolean }>;
  value: T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
  error?: string;
  name: string;
  columns?: 1 | 2 | 3;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-ink">{legend}</legend>
      {hint ? <p className="mb-2 text-[13px] text-muted">{hint}</p> : null}
      <div className={clsx('grid gap-2', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
        {options.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={option.value}
              className={clsx(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300',
                checked ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-line-strong',
                option.disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => {
                  if (multiple) onChange(checked ? value.filter((v) => v !== option.value) : [...value, option.value]);
                  else onChange([option.value]);
                }}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-500"
              />
              <span className="min-w-0">
                <span className="block text-[15px]">{option.label}</span>
                {option.description ? <span className="block text-[13px] text-muted">{option.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-[13px] font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
