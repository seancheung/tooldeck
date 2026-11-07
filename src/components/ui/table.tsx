/* Vendored from seancheung/retuned-ui (src/components/ui/table.tsx)
 * Source revision: 169623fdd34cea4e757532c310a53df89d046f02
 * Upstream README declares MIT. Source is maintained locally.
 */
import { cn } from "@/utils/cn";

export function Table({
  className,
  compact,
  ...props
}: React.ComponentProps<"table"> & { compact?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-base-400 bg-base-100">
      <table
        data-compact={compact || undefined}
        className={cn("group/table w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "border-base-300 border-b bg-base-200 [&>tr]:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn(
        "[&>tr:last-child]:border-b-0 [&>tr]:border-base-300 [&>tr]:border-b",
        className,
      )}
      {...props}
    />
  );
}

export function TableFooter({
  className,
  ...props
}: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "border-base-300 border-t bg-base-200 font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-base-200 data-[state=selected]:bg-base-300",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-4 text-left align-middle font-medium text-content-300 text-xs",
        "group-data-[compact]/table:h-8 group-data-[compact]/table:px-3",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle text-content-100",
        "group-data-[compact]/table:px-3 group-data-[compact]/table:py-1.5",
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      className={cn("my-4 text-content-400 text-xs", className)}
      {...props}
    />
  );
}
