import { useEffect, useRef } from "react";
import { renderCard } from "@/lib/markdown/cards";
import { ReviewImagePreloader } from "@/lib/images/preload";
import type { CardWithMetadata } from "@/lib/types";

/**
 * Renders the current card and the next 20 in the Markdown worker, behind
 * any card on screen, and keeps their images decoded. The next card after a
 * grade then paints from the cache.
 */
export default function PreloadReviewImages({
  current,
  queue,
}: {
  current?: CardWithMetadata;
  queue: CardWithMetadata[];
}) {
  const preloader = useRef<ReviewImagePreloader>();
  const cards = [
    ...(current ? [current] : []),
    ...queue.filter((card) => card.id !== current?.id).slice(0, 20),
  ];
  const contents = JSON.stringify(
    cards.flatMap((card) => [card.front, card.back]),
  );
  useEffect(() => {
    const instance = new ReviewImagePreloader();
    preloader.current = instance;
    return () => {
      instance.dispose();
      preloader.current = undefined;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const contentsList: string[] = JSON.parse(contents);
    const images: string[][] = [];
    // In queue order, so the nearest cards' images load first.
    contentsList.forEach((content, index) =>
      renderCard(content, "later").then((card) => {
        if (cancelled) return;
        images[index] = card.images;
        preloader.current?.update([...new Set(images.flat())]);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [contents]);
  return null;
}
