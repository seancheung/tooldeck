/* Vendored from seancheung/retuned-ui (src/components/ui/input.tsx)
 * Source revision: 169623fdd34cea4e757532c310a53df89d046f02
 * Upstream README declares MIT. Source is maintained locally.
 */
"use client";

import { cva, type VariantProps } from "class-variance-authority";

const variants = cva(
  "has-icon inline-flex min-w-50 items-center justify-center gap-1.5 rounded-md border bg-base-100 icon:text-content-400 text-content-100 transition-all",
  {
    variants: {
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-9 px-3.5 text-base",
      },
      error: {
        true: "border-error focus-within:ring-3 focus-within:ring-error/10",
        false:
          "border-base-400 focus-within:border-primary-500 focus-within:ring-3 focus-within:ring-ring/10",
      },
      disabled: {
        true: "opacity-40",
        false: "",
      },
    },
    defaultVariants: {
      size: "md",
      error: false,
      disabled: false,
    },
  },
);

export type InputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "size"
> &
  VariantProps<typeof variants> & {
    value?: string | null;
    defaultValue?: string;
    icon?: React.ReactNode;
    onChange?: (value: string) => void;
    onNativeChange?: React.ChangeEventHandler<HTMLInputElement>;
  };

export default function Input({
  error,
  icon,
  className,
  size,
  disabled,
  value,
  defaultValue,
  onChange,
  onNativeChange,
  ...props
}: InputProps) {
  return (
    <div className={variants({ className, size, error, disabled })}>
      {icon}
      <input
        {...props}
        disabled={disabled}
        className="w-0 flex-1 border-none bg-transparent outline-none"
        value={value === null ? "" : value}
        defaultValue={defaultValue}
        onChange={(e) => { onChange?.(e.target.value); onNativeChange?.(e); }}
      />
    </div>
  );
}
