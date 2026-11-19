import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  cleanUp,
  createHost,
  pages,
  prepareWindow,
  mount,
  readVersions,
  render,
  root,
  sessionShown,
  sessionThread,
  shown,
} from "./session-reviews-fixture";

beforeEach(prepareWindow);
afterEach(cleanUp);

test("a review that the reader has not opened has a dot in the session rail, until it shows", async () => {
  readVersions.clear();
  // Room for the session rail beside a review: a session pane of 900 pixels.
  await page.viewport(2400, 900);
  const thread = sessionThread(Date.now());
  render(
    createHost([
      {
        ...thread,
        reviews: thread.reviews.map((review) => ({ ...review, unread: true as const })),
      },
    ]),
  );
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  const reviews = page.getByRole("region", { name: "Reviews" });
  await expect.element(reviews).toBeVisible();
  await expect.poll(shown).toBe("rev-a-target");
  const dot = (name: RegExp) =>
    reviews.getByRole("button", { name }).element().querySelector('[aria-label="Not opened yet"]');
  // The thread opens on its session: the newest review loads behind it, out
  // of sight, and stays unread, as the other one does.
  await expect.poll(() => dot(/^Week view/)).not.toBeNull();
  expect(dot(/^Month view/)).not.toBeNull();
  await new Promise((done) => setTimeout(done, 300));
  expect(readVersions.size).toBe(0);

  // A review that shows is read: the host records it, and its dot goes.
  await reviews.getByRole("button", { name: /^Month view/ }).click();
  await expect.poll(shown).toBe("rev-b-target");
  await expect.poll(() => readVersions.get("rev-b")).toEqual([1]);
  await expect.poll(() => dot(/^Month view/)).toBeNull();
  expect(dot(/^Week view/)).not.toBeNull();
  await reviews.getByRole("button", { name: /^Week view/ }).click();
  await expect.poll(() => readVersions.get("rev-a")).toEqual([1]);
  await expect.poll(() => dot(/^Week view/)).toBeNull();
});

test("a session's reviews show in its one thread, and the session stays on screen", async () => {
  render(createHost([sessionThread(Date.now())]));
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  const reviews = page.getByRole("region", { name: "Reviews" });
  await expect.element(reviews).toBeVisible();
  await expect
    .element(
      page.getByRole("log", { name: "Session" }).getByText("Times in Tromsø are an hour off."),
    )
    .toBeVisible();
  // The newest review shows first.
  await expect.poll(shown).toBe("rev-a-target");

  // The other review takes its place in the same workspace; the session stays.
  await reviews.getByRole("button", { name: /^Month view/ }).click();
  await expect.poll(shown).toBe("rev-b-target");
  expect(sessionShown()).toBe(true);
  expect(document.querySelectorAll('[data-workspace-slot$="claude-s1"]').length).toBe(1);
});

test("the review's name lists the thread's reviews, also while the rail hides; a choice shows that review", async () => {
  render(createHost([sessionThread(Date.now())]));
  // A window too narrow for the session's rail beside the review.
  await page.viewport(1280, 800);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  await expect.poll(shown).toBe("rev-a-target");
  // The review opens beside the session: its row has the name.
  await userEvent.click(pages().getByRole("radio", { name: /^Review/ }));
  // The session is narrow beside the review: its rail, with Reviews, hides.
  await expect
    .poll(
      () =>
        document.querySelector('[role="region"][aria-label="Reviews"]')?.checkVisibility() ?? false,
    )
    .toBe(false);
  await userEvent.click(page.getByRole("button", { name: "Reviews of this thread" }));
  // The review on screen is the checked one.
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Week view" }))
    .toHaveAttribute("aria-checked", "true");
  await userEvent.click(page.getByRole("menuitemcheckbox", { name: "Month view" }));
  await expect.poll(shown).toBe("rev-b-target");
  expect(sessionShown()).toBe(true);
});

test("a thread with one review has no list at the review's name", async () => {
  const thread = sessionThread(Date.now());
  render(createHost([{ ...thread, reviews: thread.reviews.slice(0, 1) }]));
  await page.viewport(1280, 800);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  await expect.poll(shown).toBe("rev-a-target");
  await userEvent.click(pages().getByRole("radio", { name: /^Review/ }));
  await expect
    .poll(() => document.querySelector('header[aria-label="Review header"]')?.checkVisibility())
    .toBe(true);
  expect(document.querySelector('[aria-label="Reviews of this thread"]')).toBeNull();
});

test("a review that the reader hid beside a thread stays hidden after a reload", async () => {
  const host = createHost([sessionThread(Date.now())]);
  render(host);
  await page.viewport(2400, 900);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  await expect.poll(shown).toBe("rev-a-target");
  const changes = () => pages().getByRole("radio", { name: "Changes" });
  const checked = () =>
    pages()
      .getByRole("radio")
      .elements()
      .filter((radio) => radio.getAttribute("aria-checked") === "true").length;
  const reload = async () => {
    // The layout and the screen are saved as they change.
    await new Promise((done) => setTimeout(done, 300));
    root!.unmount();
    mount!.remove();
    render(host);
    await expect.poll(shown).toBe("rev-a-target");
    // A reload shows the screen again once the review has loaded.
    await new Promise((done) => setTimeout(done, 1000));
  };
  await expect.element(pages().getByRole("radio", { name: "Review" })).toBeVisible();
  await changes().click();
  await expect.element(changes()).toBeChecked();
  await reload();
  // The review is beside the thread again.
  await expect.poll(checked).toBe(1);

  // Changes, clicked again, hides the review: the thread fills the room,
  // also after a reload.
  await changes().click();
  await expect.element(changes()).toBeChecked();
  await changes().click();
  await expect.poll(checked).toBe(0);
  await reload();
  expect(checked()).toBe(0);
  expect(sessionShown()).toBe(true);
});
