/** Shared measures for the headers of the Library, Highlights and Sessions. */

/** The width and side space that each page's header and content share. */
export const APP_PAGE_FRAME = "mx-auto w-full max-w-[1160px] px-4 md:px-12";

/** Top space above the header, below the status bar of an installed app. */
export const APP_HEADER_TOP =
  "pt-[calc(env(safe-area-inset-top)+1rem)] md:pt-12";

/** The large serif of a page title, shared by the places and the search. */
export const APP_TITLE_TYPE =
  "font-serif text-[22px] leading-none tracking-[-0.01em] md:text-[30px]";

/**
 * Header controls: 40 px targets on a phone, 44 px beside the larger titles
 * of a tablet or a laptop. The ink sits between the titles you are not on
 * and the one you are, so the tools hold their own beside the large serif.
 */
export const APP_HEADER_BUTTON =
  "grid size-10 shrink-0 place-items-center rounded-full text-foreground/70 outline-none transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-foreground/[0.05] data-[popup-open]:text-foreground disabled:pointer-events-none disabled:opacity-40 md:size-11";

/** A header control's icon: half its target. */
export const APP_HEADER_ICON = "size-4 md:size-[22px]";

/** The space between header controls. */
export const APP_HEADER_GAP = "gap-0.5 md:gap-1.5";

/**
 * The page's main action, such as Add books: the same target, filled beside
 * the titles. On a phone it sits plain among the filters.
 */
export const APP_HEADER_PRIMARY =
  "md:bg-foreground/[0.07] md:text-foreground md:hover:bg-foreground/[0.11]";
