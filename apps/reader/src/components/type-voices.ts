/**
 * Reader's type voices. The serif names things: places, books, sheets and
 * dialogs. The sans does and labels: buttons, rows and the labels over
 * them, in sentence case. Capitals are kept for the Reader's footer, as a
 * book's running head.
 */

/**
 * A sheet's, dialog's or popover's title: a page title's serif
 * (`APP_TITLE_TYPE`), smaller.
 */
export const SURFACE_TITLE_TYPE =
  "font-serif text-[21px] leading-tight font-normal tracking-[-0.005em] text-foreground";

/**
 * A label over a group of rows, or a quiet heading inside a sheet: the
 * Library's "Reading" and a settings panel's section labels.
 */
export const GROUP_LABEL_TYPE = "text-[13px] font-medium text-muted-foreground";
