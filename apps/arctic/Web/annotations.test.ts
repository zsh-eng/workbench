import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const script = readFileSync(resolve(import.meta.dir, '../Resources/annotations.js'), 'utf8');
const fixture = '<article id="reader-content"><p>Before “café” — 日本語 and a <em>quiet thought</em>.</p><p>Another quiet thought stays here.</p></article>';
async function page() {
  const page = await browser.newPage();
  await page.setContent(fixture);
  await page.evaluate(script);
  return page;
}
async function select(page: Page, selector: string) {
  return page.evaluate(selector => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector)!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    return (globalThis as any).arcticAnnotations.selection();
  }, selector);
}
const record = (quote: unknown, id = 'one') => ({ id, quote, isHighlighted: true });

test('captures exact native selection across inline elements without changing document text', async () => {
  const p = await page();
  const quote = await select(p, 'p');
  expect(quote.exact).toBe('Before “café” — 日本語 and a quiet thought.');
  const before = await p.locator('article').innerHTML();
  const missing = await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)]);
  expect(missing).toEqual([]);
  expect(await p.locator('article').innerHTML()).toBe(before);
  expect(await p.evaluate(() => [...CSS.highlights.get('arctic-yellow')!].map(range => range.toString()))).toEqual([quote.exact]);
  await p.close();
});

test('context relocates repeated quotes and leaves ambiguous changed passages unresolved', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  await p.evaluate(() => document.querySelector('article')!.prepend(document.createTextNode('A new preface. ')));
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)])).toEqual([]);
  await p.locator('article').evaluate(node => node.innerHTML = '<p>New quiet thought here.</p><p>New quiet thought there.</p>');
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)])).toEqual(['one']);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('one'))).toBe(false);
  await p.close();
});

test('recolour updates the painted ranges and tap bridge without changing the article', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  const before = await p.locator('article').innerHTML();
  await p.evaluate(() => {
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
    window.getSelection()!.removeAllRanges();
  });
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'document-one'), [record(quote)]);
  const anchor = await p.evaluate(() => (globalThis as any).arcticAnnotations.bounds('one'));
  const textBounds = await p.locator('em').boundingBox();
  expect(anchor.x).toBeCloseTo(textBounds!.x, 0);
  expect(anchor.y).toBeCloseTo(textBounds!.y, 0);
  expect(anchor.width).toBeCloseTo(textBounds!.width, 0);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.bounds('missing'))).toBeNull();
  await p.locator('em').click();
  expect(await p.evaluate(() => (globalThis as any).messages)).toEqual([{ id: 'one', token: 'document-one' }]);
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'document-one'), [{ ...record(quote), colour: 'rose' }]);
  expect(await p.evaluate(() => CSS.highlights.get('arctic-yellow')?.size ?? 0)).toBe(0);
  expect(await p.evaluate(() => [...CSS.highlights.get('arctic-rose')!].map(range => range.toString()))).toEqual([quote.exact]);
  expect(await p.locator('article').innerHTML()).toBe(before);
  await p.locator('p').nth(1).click();
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1))).toEqual({ id: '', token: 'document-one' });
  await p.close();
});

test('17.0 fallback paints overlapping mixed colours and removes them without markup loss', async () => {
  const p = await page();
  const paragraph = await select(p, 'p');
  const phrase = await select(p, 'em');
  const before = await p.locator('article').innerHTML();
  await p.evaluate(() => { (globalThis as any).Highlight = undefined; window.getSelection()!.removeAllRanges(); });
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(paragraph), { ...record(phrase, 'two'), colour: 'blue' }]);
  expect(await p.locator('em mark[data-arctic-highlight="blue"]').innerText()).toBe(phrase.exact);
  expect((await p.locator('mark[data-arctic-highlight]').allTextContents()).join('')).toBe(paragraph.exact);
  expect(await p.locator('article').textContent()).toBe(paragraph.exact + 'Another quiet thought stays here.');
  await p.evaluate(() => (globalThis as any).arcticAnnotations.render([]));
  expect(await p.locator('article').innerHTML()).toBe(before);
  await p.close();
});


test('removal unregisters paint while keeping a note-only passage revealable', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  await p.evaluate(() => window.getSelection()!.removeAllRanges());
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)]);
  expect(await p.evaluate(() => CSS.highlights.has('arctic-yellow'))).toBe(true);
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [{ ...record(quote), isHighlighted: false, note: 'Keep this note.' }]);
  expect(await p.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('arctic-')))).toEqual([]);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('one'))).toBe(true);
  expect(await p.locator('mark[data-arctic-highlight]').count()).toBe(0);
  await p.close();
});


test('unanchored article notes never paint or appear as unmatched quotes', async () => {
  const p = await page();
  const missing = await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [
    { id: 'standalone', note: 'An article thought.', isHighlighted: false },
    { id: 'null-quote', quote: null, note: 'Another thought.', isHighlighted: false }
  ]);
  expect(missing).toEqual([]);
  expect(await p.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('arctic-')))).toEqual([]);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('standalone'))).toBe(false);
  await p.close();
});


test('native-created focus dismisses on tap-away and selecting another passage', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  await p.evaluate(() => window.getSelection()!.removeAllRanges());
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'doc'), [record(quote)]);
  await p.evaluate(() => {
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
  });
  // Native creation opens the toolbar and mirrors focus without a DOM tap.
  await p.evaluate(() => (globalThis as any).arcticAnnotations.setFocused('one', 'doc'));
  await p.locator('p').nth(1).click();
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1))).toEqual({ id: '', token: 'doc' });
  await p.locator('em').click();
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1).id)).toBe('one');
  await select(p, 'p:nth-child(2)');
  await p.waitForFunction(() => (globalThis as any).messages.at(-1).id === '');
  // Removing selection after saving must not dismiss the new native focus.
  await p.evaluate(() => { (globalThis as any).messages = []; window.getSelection()!.removeAllRanges(); });
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await p.evaluate(() => (globalThis as any).messages)).toEqual([]);
  expect(await p.evaluate(() => CSS.highlights.get('arctic-yellow')?.size)).toBe(1);
  await p.close();
});

test('highlighted links retain navigation and clear focus', async () => {
  const p = await page();
  await p.locator('em').evaluate(node => { node.innerHTML = '<a href="#next">quiet thought</a>'; });
  const quote = await select(p, 'a');
  await p.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
  });
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'doc'), [record(quote)]);
  await p.evaluate(() => (globalThis as any).arcticAnnotations.setFocused('one', 'doc'));
  await p.locator('a').click();
  expect(new URL(p.url()).hash).toBe('#next');
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1))).toEqual({ id: '', token: 'doc' });
  await p.close();
});

test('Show passage retains focus and a subsequent user scroll dismisses it', async () => {
  const p = await page();
  await p.locator('p').first().evaluate(node => (node as HTMLElement).style.height = '1200px');
  const quote = await select(p, 'p:nth-child(2)');
  await p.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
  });
  await p.evaluate(records => {
    (globalThis as any).arcticAnnotations.render(records, 'doc');
    (globalThis as any).arcticAnnotations.reveal('one');
    (globalThis as any).arcticAnnotations.setFocused('one', 'doc');
  }, [record(quote)]);
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await p.evaluate(() => (globalThis as any).messages)).toEqual([]);
  await p.mouse.wheel(0, -100);
  await p.waitForFunction(() => (globalThis as any).messages.at(-1)?.id === '');
  expect(await p.evaluate(() => CSS.highlights.get('arctic-yellow')?.size)).toBe(1);
  await p.close();
});


test('reading activity excludes synthetic input and restored scroll, and throttles trusted input', async () => {
  const p = await page();
  await p.evaluate(() => {
    (globalThis as any).activityMessages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticReadingActivity: {
      postMessage(token: string) { (globalThis as any).activityMessages.push(token); },
    } } };
    (globalThis as any).arcticAnnotations.render([], 'reading-document');
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    window.scrollTo(0, 100);
  });
  expect(await p.evaluate(() => (globalThis as any).activityMessages)).toEqual([]);
  await p.locator('em').click();
  await p.keyboard.press('ArrowDown');
  expect(await p.evaluate(() => (globalThis as any).activityMessages)).toEqual(['reading-document']);
  await p.close();
});

// These checks exercise the shipping selection bridge, not browser selection itself.
test('empty and outside-article selections cannot become saved quotes', async () => {
  const p = await page();
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.selection())).toBeNull();
  await p.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<header>Publisher navigation</header>'));
  expect(await select(p, 'header')).toBeNull();
  await p.close();
});

// Website mode: the same records, a publisher page as the document.
const site = `<header>Menu Subscribe</header><script>window.data = { body: "Another quiet thought stays here." };</script>
  <main><p>Before “café” — 日本語 and a <a href="#">quiet thought</a>.</p><aside>Advertisement</aside>
  <p>Another quiet thought stays here.</p></main>`;
async function website(html = site) {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.evaluate(script);
  return page;
}

test('a Reader passage paints on the website, where scripts and other blocks surround it', async () => {
  const reader = await page();
  const quote = await select(reader, 'p:nth-child(2)');
  await reader.close();
  const p = await website();
  // The page script repeats the passage; only article text counts.
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)])).toEqual([]);
  expect(await p.evaluate(() => [...CSS.highlights.get('arctic-yellow')!].map(range => range.toString()))).toEqual([quote.exact]);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('one'))).toBe(true);
  await p.close();
});

test('a repeated phrase keeps its place by nearby words when blocks differ', async () => {
  const reader = await page();
  const phrase = await select(reader, 'em');
  await reader.close();
  // The advertisement changes the context after the passage; the words before it
  // still tell it apart from the same phrase later in the page.
  const p = await website(site.replace('</main>', '<p>Read more: a quiet thought.</p></main>'));
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(phrase)])).toEqual([]);
  const painted = await p.evaluate(() => {
    const range = [...CSS.highlights.get('arctic-yellow')!][0] as Range;
    return range.startContainer.parentElement!.tagName;
  });
  expect(painted).toBe('A');
  await p.close();
});

test('website selection creates a quote that Reader can paint', async () => {
  const p = await website();
  const quote = await select(p, 'main p:last-of-type');
  expect(quote.exact).toBe('Another quiet thought stays here.');
  await p.close();
  const reader = await page();
  expect(await reader.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)])).toEqual([]);
  expect(await reader.evaluate(() => [...CSS.highlights.get('arctic-yellow')!].map(range => range.toString()))).toEqual([quote.exact]);
  await reader.close();
});

test('an Unwall article frame paints, measures and reports taps', async () => {
  const p = await browser.newPage();
  await p.setContent('<div style="height:80px">Unwall</div><iframe title="Article content" style="border:0;width:100%;height:600px"></iframe>');
  await p.evaluate(html => new Promise<void>(resolve => {
    const frame = document.querySelector('iframe')!;
    frame.onload = () => resolve();
    frame.srcdoc = html;
  }), fixture);
  await p.evaluate(script);
  await p.evaluate(() => {
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
  });
  const quote = await p.evaluate(() => {
    const doc = document.querySelector('iframe')!.contentDocument!;
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('em')!);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    const quote = (globalThis as any).arcticAnnotations.selection();
    doc.getSelection()!.removeAllRanges();
    return quote;
  });
  expect(quote.exact).toBe('quiet thought');
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'frame'), [record(quote)])).toEqual([]);
  expect(await p.evaluate(() => document.querySelector('iframe')!.contentWindow!.CSS.highlights.has('arctic-yellow'))).toBe(true);
  const bounds = await p.evaluate(() => (globalThis as any).arcticAnnotations.bounds('one'));
  const em = await p.frameLocator('iframe').locator('em').boundingBox();
  expect(bounds.y).toBeCloseTo(em!.y, 0);
  await p.frameLocator('iframe').locator('em').click();
  expect(await p.evaluate(() => (globalThis as any).messages)).toEqual([{ id: 'one', token: 'frame' }]);
  await p.close();
});
