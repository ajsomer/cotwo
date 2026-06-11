"use client";

import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Eye, EyeOff } from "lucide-react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, type, id, className, ...props }: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  const errorId = `${inputId}-error`;

  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-gray-800 mb-1.5"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={isPassword && showPassword ? "text" : type}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className={`w-full h-11 px-3 text-sm border rounded-lg outline-none transition-colors ${
            error
              ? "border-red-500 focus:border-red-500"
              : "border-gray-200 focus:border-teal-500"
          } ${isPassword ? "pr-10" : ""}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bare form controls — the canonical input chrome used across clinic and
// patient surfaces (the labelled Input above keeps its auth-form styling).
// Sizes: "md" is the clinic default, "lg" the patient-flow 48px control.
// ---------------------------------------------------------------------------

const CONTROL_SIZES = {
  md: "px-3 py-2 text-sm",
  lg: "h-12 px-3 text-base",
} as const;

type ControlSize = keyof typeof CONTROL_SIZES;

function controlClass(size: ControlSize, extra?: string) {
  return `w-full rounded-lg border border-gray-200 text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 ${CONTROL_SIZES[size]}${extra ? ` ${extra}` : ""}`;
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: ControlSize;
}

export function TextInput({ inputSize = "md", className, ...props }: TextInputProps) {
  return <input className={controlClass(inputSize, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={controlClass("md", `resize-none${className ? ` ${className}` : ""}`)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={controlClass("md", `bg-white${className ? ` ${className}` : ""}`)}
      {...props}
    >
      {children}
    </select>
  );
}

/** Label + control + optional error, in the clinic form idiom. */
export function FormField({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium text-gray-500"
      >
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
