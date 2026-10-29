import type { SavedPrDraft } from "../../shared/saved-review";

/** The URL of a local image of the review's pull request draft, which Med keeps. */
export function prDraftImageUrl(reviewId: string, draft: SavedPrDraft, href: string) {
  const image = draft.images.find((entry) => entry.href === href);
  return image
    ? `/api/reviews/${encodeURIComponent(reviewId)}/pr-draft?image=${encodeURIComponent(image.file)}`
    : undefined;
}
