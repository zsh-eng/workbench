// Reader-only checkpoints. Anchor to a text block; percentage is a fallback
// when a refreshed extraction no longer contains that passage.
(() => {
  const blocks = () => [...document.querySelectorAll('main h1, main h2, main h3, main p, main li, main pre')];
  const text = node => node.textContent.trim().replace(/\s+/g, ' ').slice(0, 180);
  const limit = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
  globalThis.arcticPosition = {
    capture(top) {
      const nodes = blocks();
      const index = nodes.findIndex(node => node.getBoundingClientRect().bottom > top + 1);
      const node = nodes[index], rect = node?.getBoundingClientRect();
      return JSON.stringify({ index, anchor: node ? text(node) : '',
        fraction: rect ? (top - rect.top) / Math.max(1, rect.height) : 0,
        progress: Math.max(0, Math.min(1, scrollY / limit())) });
    },
    restore(position, top) {
      const nodes = blocks();
      let node = nodes[position.index];
      if (!node || text(node) !== position.anchor) node = nodes.find(n => text(n) === position.anchor);
      const rect = node?.getBoundingClientRect();
      const y = rect ? scrollY + rect.top + position.fraction * rect.height - top
        : position.progress * limit();
      // WebKit accounts for native toolbar insets. A manual DOM-height clamp
      // would stop above the saved passage near the end of the article.
      scrollTo(0, y);
    }
  };

  // Website and Reader share words, not layout: a site can put images, ads or
  // links between paragraphs that Reader removes. A word anchor records the
  // first visible words of one document and finds them again in the other.
  const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'SELECT',
    'TEXTAREA', 'NAV', 'SVG']);
  const pattern = /[\p{L}\p{N}\u00AD\u200B-\u200D\u2060]+/gu;
  const clean = token => token.replace(/[\u00AD\u200B-\u200D\u2060]/g, '').toLowerCase();
  const length = 12, shortest = 3;

  // Unwall shows the article in a same-origin child document.
  const source = () => {
    const frame = document.querySelector('iframe[title="Article content"]');
    const inner = frame?.contentDocument;
    return inner?.body ? { doc: inner, frame } : { doc: document, frame: null };
  };

  const tokens = doc => {
    const list = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
        : skipped.has(node.tagName.toUpperCase()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.data.matchAll(pattern)) {
        const word = clean(match[0]);
        if (word) list.push({ node, start: match.index, end: match.index + match[0].length, word });
      }
    }
    return list;
  };

  // A word's first line box, or the whole box of a run of lines.
  const box = (doc, from, to) => {
    const range = doc.createRange();
    range.setStart(from.node, from.start);
    range.setEnd((to ?? from).node, (to ?? from).end);
    return to ? range.getBoundingClientRect() : range.getClientRects()[0] ?? range.getBoundingClientRect();
  };

  // Text in a fixed or sticky bar stays on screen; it does not mark a place.
  const bar = node => {
    for (let element = node; element; element = element.parentElement) {
      const position = element.ownerDocument.defaultView.getComputedStyle(element).position;
      if (position === 'fixed' || position === 'sticky') return element;
    }
    return null;
  };
  const pinned = node => bar(node.parentElement) !== null;

  // A site's own bar can hide text below the native bar. Find its lower edge.
  const visibleTop = (doc, frame, top) => {
    let edge = top;
    const layers = frame ? [[document, 0], [doc, frame.getBoundingClientRect().top]] : [[document, 0]];
    for (const [layer, shift] of layers) {
      for (let step = 0; step < 3; step += 1) {
        const hit = layer.elementFromPoint(layer.documentElement.clientWidth / 2, edge + 1 - shift);
        const cover = hit && bar(hit);
        const bottom = cover ? cover.getBoundingClientRect().bottom + shift : edge;
        if (bottom <= edge) break;
        edge = bottom;
      }
    }
    return edge;
  };

  globalThis.arcticWords = {
    // Up to four anchors from different text runs, in reading order. A caption
    // or an advertisement that Reader removed falls through to the next one.
    capture(top) {
      const { doc, frame } = source();
      const shift = frame ? frame.getBoundingClientRect().top : 0;
      const bottom = innerHeight;
      const edge = visibleTop(doc, frame, top);
      const list = tokens(doc);
      const anchors = [];
      let index = 0;
      while (index < list.length && anchors.length < 4) {
        const node = list[index].node;
        let last = index;
        while (last + 1 < list.length && list[last + 1].node === node) last += 1;
        const run = box(doc, list[index], list[last]);
        const runTop = run.top + shift, runBottom = run.bottom + shift;
        // Reading order mostly follows the page; stop once text is below the screen.
        if (anchors.length > 0 && runTop >= bottom) break;
        if (run.height > 0 && runBottom > edge + 1 && runTop < bottom && !pinned(node)) {
          let first = index;
          while (first < last && box(doc, list[first]).bottom + shift <= edge + 1) first += 1;
          const rect = box(doc, list[first]);
          // Keep the words at the same height on screen, below any bar.
          anchors.push({
            words: list.slice(first, first + length).map(token => token.word),
            offset: Math.max(edge - top, Math.min(bottom * 0.6, rect.top + shift - top)),
            at: first / list.length,
          });
        }
        index = last + 1;
      }
      return JSON.stringify({ anchors });
    },

    // Scroll so the anchor's first word sits at the same height below the bar.
    // Returns false and leaves the document in place when no anchor matches.
    reveal(saved, top) {
      const { doc, frame } = source();
      const list = tokens(doc);
      for (const anchor of saved.anchors ?? []) {
        const words = anchor.words ?? [];
        if (words.length < 2) continue;
        // The longest match wins; a repeated phrase is told apart by the words after it.
        for (let count = words.length; count >= Math.min(shortest, words.length); count -= 1) {
          let best = -1;
          for (let index = 0; index + count <= list.length; index += 1) {
            let same = true;
            for (let offset = 0; offset < count && same; offset += 1) same = list[index + offset].word === words[offset];
            if (!same) continue;
            const expected = anchor.at * list.length;
            if (best < 0 || Math.abs(index - expected) < Math.abs(best - expected)) best = index;
          }
          if (best < 0) continue;
          const distance = () => box(doc, list[best]).top + (frame ? frame.getBoundingClientRect().top : 0)
            - Math.max(top + anchor.offset, visibleTop(doc, frame, top));
          // A sticky bar can appear only after the first move, so settle twice.
          for (let step = 0; step < 2; step += 1) {
            scrollBy({ top: distance(), behavior: 'instant' });
            // An Unwall frame may scroll on its own instead of the page.
            if (frame && Math.abs(distance()) > 1) frame.contentWindow.scrollBy({ top: distance(), behavior: 'instant' });
          }
          return true;
        }
      }
      return false;
    },
  };
})();
