import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const script = readFileSync(new URL('../Resources/reader-position.js', import.meta.url), 'utf8');

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<style>body{margin:0;padding:24px;font:20px/1.6 sans-serif}p{margin:0 0 32px}</style><main>${Array.from({ length: 12 }, (_, index) => `<p id="passage-${index}">Passage ${index}. A thought worth keeping. Reading gives us space to notice a detail and return to it another day.</p>`).join('')}</main>`);
  await page.evaluate(script);
  await page.evaluate(() => scrollTo(0, 1420));
  return page;
}

// Observe the rendered paragraph and scroll offset independently of capture().
// A capture/restore/capture round trip can pass when both sides share a bug.
async function visibleParagraph(page: import('@playwright/test').Page) {
  return page.locator('p').evaluateAll(paragraphs => {
    const paragraph = paragraphs.find(p => p.getBoundingClientRect().bottom > 80)!;
    const bounds = paragraph.getBoundingClientRect();
    return { id: paragraph.id, fraction: (80 - bounds.top) / bounds.height };
  });
}

test('restores the same visible paragraph after text reflow', async () => {
  const page = await fixture();
  const before = await visibleParagraph(page);
  const saved = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  await page.evaluate(position => {
    document.body.style.fontSize = '28px';
    scrollTo(0, 0);
    (globalThis as any).arcticPosition.restore(position, 80);
  }, saved);
  const after = await visibleParagraph(page);
  expect(after.id).toBe(before.id);
  expect(after.fraction).toBeCloseTo(before.fraction, 2);
  await page.close();
});

test('falls back to scroll progress when refreshed text has no saved anchor', async () => {
  const page = await fixture();
  const before = await page.evaluate(() => scrollY / (document.documentElement.scrollHeight - innerHeight));
  const saved = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  await page.evaluate(position => {
    for (const p of document.querySelectorAll('p')) p.textContent = 'Revised ' + p.textContent;
    scrollTo(0, 0);
    (globalThis as any).arcticPosition.restore(position, 80);
  }, saved);
  const after = await page.evaluate(() => scrollY / (document.documentElement.scrollHeight - innerHeight));
  expect(after).toBeCloseTo(before, 3);
  await page.close();
});

// A publisher page puts figures, advertisements and a pinned bar between the
// paragraphs that Reader keeps. Both documents share only the words.
const words = (index: number) => `Paragraph ${index} opens with words that belong to it alone, ${'and continues a careful line of thought '.repeat(4)}until the passage ends.`;
const website = (body = websiteArticle()) => `<style>body{margin:0;font:17px/1.5 Georgia,serif}header{position:sticky;top:0;height:64px;background:#fff}figure{height:260px;margin:24px 0;background:#ddd}aside{height:120px}</style>
  <header>Menu Subscribe Sign in</header><nav>World Business Culture</nav>${body}`;
function websiteArticle() {
  return `<article>${Array.from({ length: 14 }, (_, index) => `${index === 9 ? '<aside>Advertisement</aside>' : ''}<p id="w${index}">${words(index).replace('careful', '<a href="#">careful</a>')}</p>${index % 3 === 1 ? `<figure><figcaption>Photograph ${index}</figcaption></figure>` : ''}`).join('')}</article>`;
}
const reader = `<style>body{margin:0;padding:0 24px;font:22px/1.7 sans-serif}p{margin:0 0 30px}</style><main><h1>Title</h1>${Array.from({ length: 14 }, (_, index) => `<p id="r${index}">${words(index).replace('careful', '<em>careful</em>')}</p>`).join('')}</main>`;
const bar = 50;

async function page(html: string) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(html);
  await page.evaluate(script);
  return page;
}

// The first word's own box, measured without the anchor code.
async function firstWordTop(page: import('@playwright/test').Page, id: string, frame = false) {
  return page.evaluate(([id, frame]) => {
    const host = frame ? document.querySelector('iframe') : null;
    const doc = host ? host.contentDocument! : document;
    const text = doc.getElementById(id)!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 9);
    return range.getClientRects()[0].top + (host ? host.getBoundingClientRect().top : 0);
  }, [id, frame] as const);
}

test('opens Reader at the words that were at the top of the website', async () => {
  const site = await page(website());
  // Advertisement text is the first visible run; Reader does not have it.
  await site.evaluate(bar => {
    const aside = document.querySelector('aside')!;
    scrollTo(0, scrollY + aside.getBoundingClientRect().top - bar - 10);
  }, bar);
  const offset = await firstWordTop(site, 'w9') - bar;
  const anchor = await site.evaluate(top => (globalThis as any).arcticWords.capture(top), bar);
  const article = await page(reader);
  expect(await article.evaluate(([saved, top]) => (globalThis as any).arcticWords.reveal(JSON.parse(saved), top), [anchor, bar] as const)).toBe(true);
  expect(await firstWordTop(article, 'r9') - bar).toBeCloseTo(offset, 0);
  await site.close();
  await article.close();
});

// Character offsets within a paragraph's text are the same in both documents.
async function wordAtTop(page: import('@playwright/test').Page, id: string, y: number) {
  return page.evaluate(([id, y]) => {
    const paragraph = document.getElementById(id)!;
    const caret = document.caretRangeFromPoint(paragraph.getBoundingClientRect().left + 2, y)!;
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.setEnd(caret.startContainer, caret.startOffset);
    return range.toString().length;
  }, [id, y] as const);
}

async function topOfCharacter(page: import('@playwright/test').Page, id: string, offset: number) {
  return page.evaluate(([id, offset]) => {
    const walker = document.createTreeWalker(document.getElementById(id)!, NodeFilter.SHOW_TEXT);
    let left = offset;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (left < node.length) {
        const range = document.createRange();
        range.setStart(node, left);
        range.setEnd(node, left + 1);
        return range.getClientRects()[0].top;
      }
      left -= node.length;
    }
    throw new Error('offset outside paragraph');
  }, [id, offset] as const);
}

test('keeps the visible line of a paragraph that starts under the bars', async () => {
  const site = await page(website());
  await site.evaluate(bar => {
    const paragraph = document.getElementById('w5')!;
    scrollTo(0, scrollY + paragraph.getBoundingClientRect().top - bar + 40);
  }, bar);
  // The site's sticky header ends below the native bar and hides the text under it.
  const header = await site.evaluate(() => document.querySelector('header')!.getBoundingClientRect().bottom);
  const offset = await wordAtTop(site, 'w5', header + 2);
  const siteTop = await topOfCharacter(site, 'w5', offset);
  const anchor = await site.evaluate(top => (globalThis as any).arcticWords.capture(top), bar);
  const article = await page(reader);
  expect(await article.evaluate(([saved, top]) => (globalThis as any).arcticWords.reveal(JSON.parse(saved), top), [anchor, bar] as const)).toBe(true);
  expect(await topOfCharacter(article, 'r5', offset)).toBeCloseTo(Math.max(header, siteTop), 0);
  await Promise.all([site.close(), article.close()]);
});

test('moves between Reader and an Unwall frame in both directions', async () => {
  const article = await page(reader);
  await article.evaluate(bar => {
    const paragraph = document.getElementById('r6')!;
    scrollTo(0, scrollY + paragraph.getBoundingClientRect().top - bar - 12);
  }, bar);
  const offset = await firstWordTop(article, 'r6') - bar;
  const anchor = await article.evaluate(top => (globalThis as any).arcticWords.capture(top), bar);
  const frame = await page(`<style>body{margin:0}iframe{border:0;width:100%;height:9000px;display:block}</style><div style="height:90px">Unwall</div><iframe title="Article content"></iframe>`);
  await frame.evaluate(html => new Promise<void>(resolve => {
    const iframe = document.querySelector('iframe')!;
    iframe.onload = () => resolve();
    iframe.srcdoc = html;
  }), website(websiteArticle()));
  expect(await frame.evaluate(([saved, top]) => (globalThis as any).arcticWords.reveal(JSON.parse(saved), top), [anchor, bar] as const)).toBe(true);
  expect(await firstWordTop(frame, 'w6', true) - bar).toBeCloseTo(offset, 0);
  // And back again from the frame to a fresh Reader document.
  const back = await frame.evaluate(top => (globalThis as any).arcticWords.capture(top), bar);
  const fresh = await page(reader);
  expect(await fresh.evaluate(([saved, top]) => (globalThis as any).arcticWords.reveal(JSON.parse(saved), top), [back, bar] as const)).toBe(true);
  expect(await firstWordTop(fresh, 'r6') - bar).toBeCloseTo(offset, 0);
  await Promise.all([article.close(), frame.close(), fresh.close()]);
});

test('tells a repeated phrase apart by the words that follow it', async () => {
  const refrain = 'the harbour filled with a quiet green light';
  const body = (tag: string) => Array.from({ length: 10 }, (_, index) => `<${tag} id="q${index}">${refrain[0].toUpperCase()}${refrain.slice(1)}, and turn ${index} began.</${tag}><div style="height:${tag === 'p' ? 0 : 200}px"></div>`).join('');
  // A long menu before the article moves the phrase's relative position.
  const menu = Array.from({ length: 120 }, (_, index) => `Section ${index}`).join(' ');
  const site = await page(`<style>body{margin:0;font:16px/1.4 serif}</style><div>${menu}</div><main>${body('div')}</main>`);
  await site.evaluate(bar => {
    // Show the refrain of line 6 first, below the bar.
    const line = document.getElementById('q6')!;
    scrollTo(0, scrollY + line.getBoundingClientRect().top - bar);
  }, bar);
  const offset = await firstWordTop(site, 'q6') - bar;
  const anchor = await site.evaluate(top => (globalThis as any).arcticWords.capture(top), bar);
  // Room below the last line, so Reader can scroll any line to the top.
  const article = await page(`<style>body{margin:0;font:22px/1.7 sans-serif;padding-bottom:900px}</style><main>${body('p')}</main>`);
  expect(await article.evaluate(([saved, top]) => (globalThis as any).arcticWords.reveal(JSON.parse(saved), top), [anchor, bar] as const)).toBe(true);
  expect(await firstWordTop(article, 'q6') - bar).toBeCloseTo(offset, 0);
  await Promise.all([site.close(), article.close()]);
});

test('leaves Reader in place when no words match', async () => {
  const article = await page(reader);
  await article.evaluate(() => scrollTo(0, 700));
  const saved = JSON.stringify({ anchors: [{ words: ['nothing', 'here', 'matches', 'this', 'page'], offset: 0, at: 0.5 }] });
  expect(await article.evaluate(([saved, top]) => (globalThis as any).arcticWords.reveal(JSON.parse(saved), top), [saved, bar] as const)).toBe(false);
  expect(await article.evaluate(() => scrollY)).toBe(700);
  await article.close();
});
