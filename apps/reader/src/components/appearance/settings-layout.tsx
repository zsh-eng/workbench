import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Settings set out as Linear's are: rounded groups of rows, with each
 * section's heading and description outside the group, lined up with the
 * text inside it rather than with the group's edge.
 *
 * The group's padding plus its 1px border is the text inset, so headings
 * carry the same inset: `px-4` + 1px on a page, `px-3.5` + 1px in a panel.
 */
export function SettingsSection({
  id,
  title,
  description,
  compact = false,
  className,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  /** A panel's section: a small muted heading and no description. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      data-settings-section={id}
      className={cn("min-w-0", className)}
    >
      {compact ? (
        <h3
          id={titleId}
          className="px-[15px] pb-2 text-[13px] font-medium text-muted-foreground"
        >
          {title}
        </h3>
      ) : (
        <>
          <h2
            id={titleId}
            className="px-[17px] text-[17px] font-semibold tracking-[-0.01em] text-foreground"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1 px-[17px] text-[13px] leading-[18px] text-muted-foreground">
              {description}
            </p>
          )}
        </>
      )}
      <div className={compact ? undefined : "mt-3"}>{children}</div>
    </section>
  );
}

/** A rounded group; its rows are divided by hairlines. */
export function SettingsGroup({
  compact = false,
  className,
  children,
}: {
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-foreground/[0.07] border border-foreground/[0.07] bg-foreground/[0.035]",
        compact ? "rounded-[14px] px-3.5" : "rounded-2xl px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A row: its name (and a line on what it does) at the left, a control at the right. */
export function SettingsRow({
  label,
  description,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The control's id, so the name labels it. */
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[3.25rem] items-center justify-between gap-4 py-2.5",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="cursor-pointer text-sm font-medium text-foreground"
          >
            {label}
          </label>
        ) : (
          <div className="text-sm font-medium text-foreground">{label}</div>
        )}
        {description && (
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center">{children}</div>}
    </div>
  );
}

/** A segmented control's track and items, sized for a settings row. */
export const ROW_SEGMENTED_GROUP =
  "flex shrink-0 rounded-[10px] bg-foreground/[0.07] p-0.5";
export const ROW_SEGMENTED_ITEM =
  "h-8 min-w-0 gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted-foreground data-[pressed]:text-foreground";
