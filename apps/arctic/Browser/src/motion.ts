/**
 * Moves the library's cards to their new places when a change adds or
 * removes one: a removed card fades out, the cards below close the gap, and
 * a new card fades in at its place. Only the cards on screen take part, so
 * a long library costs no more than a short one. Without view transitions,
 * or with reduced motion, the change simply happens.
 */
export async function listMotion<T>(update: () => Promise<T>): Promise<T> {
  const grid = document.querySelector<HTMLElement>(".grid");
  if (
    !grid?.checkVisibility() ||
    !document.startViewTransition ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return update();
  const named: HTMLElement[] = [];
  const name = () => {
    for (const card of grid.querySelectorAll<HTMLElement>(".card")) {
      const box = card.getBoundingClientRect();
      if (box.top > innerHeight) break;
      if (box.bottom < 0 || !card.dataset.id) continue;
      card.style.setProperty(
        "view-transition-name",
        `card-${card.dataset.id.slice(0, 20)}`,
      );
      named.push(card);
    }
  };
  name();
  let result!: T;
  const transition = document.startViewTransition(async () => {
    result = await update();
    // The store renders the change in a microtask; let it finish.
    await new Promise((resolve) => setTimeout(resolve));
    name();
  });
  transition.ready.catch(() => {});
  void transition.finished
    .finally(() => {
      for (const card of named)
        card.style.removeProperty("view-transition-name");
    })
    .catch(() => {});
  await transition.updateCallbackDone;
  return result;
}
