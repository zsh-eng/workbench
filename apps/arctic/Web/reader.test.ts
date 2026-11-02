import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const script = readFileSync(resolve(import.meta.dir, '../Resources/reader.js'), 'utf8');

test('preserves the lead image in the body without adding an OG hero', async () => {
  const page = await browser.newPage();
  await page.route('https://fixture.example/**', route => route.fulfill(route.request().resourceType() === 'image'
    ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"></svg>' }
    : { contentType: 'text/html', body: readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/story.html'), 'utf8') }));
  await page.goto('https://fixture.example/story');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.author).toBe('Alex Reader');
  expect(result.description).toContain('On walking slowly');
  expect(result.image).toBe('');
  expect(result.favicon).toEndWith('cover.png');
  expect(result.content.match(/<img/g)).toHaveLength(1);
  expect(result.content).toContain('hljs-keyword');
  expect(result.content).toContain('hljs-string');
  expect(result.content).not.toContain('<script');
  expect(result.authorImage).toBe('');
  await page.close();
});

test('a bot check is never read as the article', async () => {
  const check = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
  const prose = '<p>Sea ice forms, drifts and thins with the seasons, and the people who read it keep careful notes about where it goes.</p>'.repeat(3);
  const pages = [
    check('Checking your browser...', `<script>var HASHCASH_CONFIG = {};</script><main>${prose}</main>`),
    check('A quiet page', `<main><h1>Checking your browser</h1>${prose}</main>`),
  ];
  for (const body of pages) {
    const page = await browser.newPage();
    await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body }));
    await page.goto('https://fixture.example/gated');
    await page.evaluate(script);
    const failure = await page.evaluate(() => {
      try { (globalThis as any).extractArticle(); return ''; } catch (error) { return (error as Error).message; }
    });
    expect(failure).toContain('browser check');
    await page.close();
  }
  const page = await browser.newPage();
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: check('On browser checks', `<main><h1>On browser checks</h1>${prose}<p>Checking your browser is what these pages say.</p></main>`) }));
  await page.goto('https://fixture.example/about-checks');
  await page.evaluate(script);
  expect((await page.evaluate(() => (globalThis as any).extractArticle())).content).toContain('Sea ice forms');
  await page.close();
});

test('missing author, subtitle, and images remain absent', async () => {
  const page = await browser.newPage();
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/next.html'), 'utf8') }));
  await page.goto('https://fixture.example/next');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.author).toBe('');
  expect(result.description).toBe('');
  expect(result.image).toBe('');
  expect(result.authorImage).toBe('');
  await page.close();
});

test('uses only the declared author image from structured metadata', async () => {
  const page = await browser.newPage();
  const html = readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/story.html'), 'utf8')
    .replace('</head>', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"The quiet art of paying attention","author":{"@type":"Person","name":"Alex Reader","image":{"url":"https://fixture.example/portrait.png"}}}</script></head>');
  await page.route('https://fixture.example/**', route => route.fulfill(route.request().resourceType() === 'image'
      ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"></svg>' }
      : { contentType: 'text/html', body: html }));
  await page.goto('https://fixture.example/story');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.authorImage).toBe('https://fixture.example/portrait.png');
  await page.close();
});

test('preserves Unicode punctuation and selectable text through extraction', async () => {
  const page = await browser.newPage();
  const sentence = '“Slow down,” she said — café, naïve, 日本語. Keep every character intact.';
  const html = readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/unicode.html'), 'utf8');
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://fixture.example/unicode');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.content).toContain(sentence);
  const css = readFileSync(resolve(import.meta.dir, '../Resources/reader.css'), 'utf8');
  await page.setContent(`<meta charset="utf-8"><style>${css}</style><main><article id="reader-content">${result.content}</article></main>`);
  const selected = await page.evaluate(sentence => {
    const paragraph = [...document.querySelectorAll('p')].find(node => node.textContent === sentence)!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return { text: selection.toString(), selectable: getComputedStyle(paragraph).userSelect };
  }, sentence);
  expect(selected.text).toBe(sentence);
  expect(selected.selectable).not.toBe('none');
  await page.close();
});

test('reserves declared OG image geometry before decorative image bytes arrive', async () => {
  const page = await browser.newPage();
  const html = readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/story.html'), 'utf8')
    .replace('<img src="cover.png" alt="A quiet landscape">', '')
    .replace('<meta property="og:image" content="cover.png">', '<meta property="og:image" content="https://fixture.example/og-only.png"><meta property="og:image:width" content="1600"><meta property="og:image:height" content="900">');
  await page.route('https://fixture.example/**', route => route.fulfill(route.request().resourceType() === 'image'
      ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"></svg>' }
      : { contentType: 'text/html', body: html }));
  await page.goto('https://fixture.example/story');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.heroWidth).toBe('1600');
  expect(result.heroHeight).toBe('900');
  expect(result.content).toContain('A little room to think');
  await page.close();
});

for (const lead of [
  '<figure><img src="editorial.png" width="1400" height="900"><figcaption>A real caption</figcaption></figure>',
  '<img src="editorial.png">',
]) {
  test('suppresses a different social hero when editorial media leads: ' + lead.slice(0, 20), async () => {
    const page = await browser.newPage();
    const html = readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/story.html'), 'utf8')
      .replace('<img src="cover.png" alt="A quiet landscape">', lead);
    await page.route('https://fixture.example/**', route => route.fulfill(route.request().resourceType() === 'image'
      ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"></svg>' }
      : { contentType: 'text/html', body: html }));
    await page.goto('https://fixture.example/story');
    await page.evaluate(script);
    const result = await page.evaluate(() => (globalThis as any).extractArticle());
    expect(result.image).toBe('');
    expect(result.content).toContain('editorial.png');
    if (lead.includes('figcaption')) expect(result.content).toContain('A real caption');
    await page.close();
  });
}

test('full-width media crosses the text gutter and caps portrait height', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const css = readFileSync(resolve(import.meta.dir, '../Resources/reader.css'), 'utf8');
  const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400"></svg>');
  await page.setContent(`<style>${css}</style><main><article id="reader-content"><p>Inset text</p><figure class="reader-wide-media"><img src="${src}"><figcaption>Caption</figcaption></figure><img width="32" height="32" src="${src}"></article></main>`);
  await page.locator('figure img').evaluate((image: HTMLImageElement) => image.decode());
  const picture = await page.locator('figure img').boundingBox();
  const text = await page.locator('p').boundingBox();
  const icon = await page.locator('article > img').boundingBox();
  expect(picture!.x).toBe(0);
  expect(picture!.width).toBe(390);
  expect(picture!.height).toBeLessThanOrEqual(507);
  expect(text!.x).toBe(18);
  expect(icon!.width).toBe(32);
  await page.close();
});

test('renders a native-fetched X article with Defuddle and sanitizes rich content', async () => {
  const page = await browser.newPage();
  await page.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><head><title>X</title></head><body>Open in app</body></html>' }));
  await page.goto('https://x.com/reader/status/1234');
  await page.evaluate(script);
  const payload = { code: 200, tweet: { author: { screen_name: 'reader' }, article: {
    title: 'A small observation', preview_text: 'What stays with us.',
    content: { blocks: [{ type: 'unstyled', text: '“Slow down,” she said — café, 日本語. <script>not code</script>', inlineStyleRanges: [], entityRanges: [], data: {} }], entityMap: [] },
    media_entities: [], cover_media: {},
  } } };
  const result = await page.evaluate(async payload => await (globalThis as any).extractArticle(JSON.stringify(payload)), payload);
  expect(result.title).toBe('A small observation');
  expect(result.author).toBe('@reader');
  expect(result.content).toContain('日本語');
  expect(result.content).not.toContain('<script>');
  expect(result.content).not.toContain('Open in app');
  await page.close();
});
