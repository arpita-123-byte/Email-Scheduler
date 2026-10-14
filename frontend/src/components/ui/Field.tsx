import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Form rows follow the compose layout: a fixed-width label on the left and the
 * control on the right, separated by a hairline, like an email client header.
 */
export function FieldRow({ label, htmlFor, hint, error, children }: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-line py-3 sm:flex sm:items-start sm:gap-4">
      <label htmlFor={htmlFor} className="mb-1 block w-36 shrink-0 pt-2 text-sm text-ink-muted sm:mb-0">
        {label}
      </label>
      <div className="min-w-0 flex-1">
        {children}
        {hint && !error && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

const control =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-2 text-sm text-ink placeholder:text-ink-muted hover:border-line focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, 'resize-y leading-relaxed', className)} {...props} />;
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'cursor-pointer', className)} {...props}>
      {children}
    </select>
  );
}

/** Compact boxed number input used for "Delay between emails" / "Hourly limit". */
export function NumberBox({ label, suffix, ...props }: { label: string; suffix?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-ink-soft">
        {label}
      </label>
      <div className="flex items-center rounded-md border border-line focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <input
          id={id}
          type="number"
          className="w-20 rounded-md bg-transparent px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
          {...props}
        />
        {suffix && <span className="pr-2 text-xs text-ink-muted">{suffix}</span>}
      </div>
    </div>
  );
}
