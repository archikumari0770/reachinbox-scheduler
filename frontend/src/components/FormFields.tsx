import { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

interface FieldWrapperProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function FieldWrapper({ label, hint, children }: FieldWrapperProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Input({ label, hint, className = "", ...rest }: InputProps) {
  return (
    <FieldWrapper label={label} hint={hint}>
      <input
        className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

export function Textarea({ label, hint, className = "", ...rest }: TextareaProps) {
  return (
    <FieldWrapper label={label} hint={hint}>
      <textarea
        className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
}
