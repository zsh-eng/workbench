// This API runs only in WebKit's app-owned content world. Reader marks its
// cleaned article as #reader-content. On a website the article root is the page
// body, or Unwall's same-origin article frame, which can load after the page.
// Quotes use DOM text (UTF-16) so native selection and cached HTML share offsets.
(() => {
  if (globalThis.arcticAnnotations) return;
  const reader = document.getElementById('reader-content');
  const rootElement = () => {
    if (reader) return reader;
    const frame = document.querySelector('iframe[title="Article content"]');
    return frame?.contentDocument?.body ?? document.body;
  };
  const colours = ['yellow', 'sage', 'rose', 'blue'];
  const css = `
    :root { --annotation-yellow: rgba(245,199,64,.38); --annotation-sage: rgba(75,171,111,.24);
      --annotation-rose: rgba(229,104,140,.24); --annotation-blue: rgba(56,164,209,.24); }
    :root[data-theme="Ink"], :root[data-theme="Night"] {
      --annotation-yellow: rgba(245,199,64,.30); --annotation-sage: rgba(99,200,134,.30);
      --annotation-rose: rgba(241,137,166,.30); --annotation-blue: rgba(102,197,234,.30); }
    ${colours.map(colour => `::highlight(arctic-${colour}) {
      background-color: var(--annotation-${colour}); color: inherit;
    } mark[data-arctic-highlight="${colour}"] {
      background: var(--annotation-${colour}); color: inherit;
    }`).join('\n')}
  `;
  let resolved = new Map(), hitRanges = [], documentToken = '', focused = '', revealing = false;
  let painted = null;
  // Only trusted input is activity. Scroll/layout events also come from image
  // loading, position restoration and Show passage, so they do not count.
  // UIKit reports real drags separately; leave WebKit touch recognition alone.
  let lastActivity = -Infinity;
  const activity = event => {
    if (!event.isTrusted || !documentToken || document.hidden) return;
    const now = performance.now();
    if (now - lastActivity < 1000) return;
    lastActivity = now;
    globalThis.webkit?.messageHandlers?.arcticReadingActivity?.postMessage(documentToken);
  };
  const colourOf = record => colours.includes(record.colour) ? record.colour : 'yellow';
  function notify(id = '') {
    if (!id && !focused) return;
    focused = id;
    globalThis.webkit?.messageHandlers?.arcticAnnotationTap?.postMessage({ id, token: documentToken });
  }
  // Each document gets the paint styles and listeners once: Reader's own, a
  // website's, or an Unwall frame that loads after its page.
  const prepared = new WeakSet();
  function prepare(doc) {
    if (prepared.has(doc)) return;
    prepared.add(doc);
    const win = doc.defaultView;
    const style = doc.createElement('style');
    style.textContent = css;
    (doc.head ?? doc.documentElement).append(style);
    for (const name of ['click', 'keydown']) {
      doc.addEventListener(name, activity, { passive: true, capture: true });
    }
    // CSS highlights have no DOM element. Hit-test the cached ranges only on tap,
    // never on scroll or in the rendering loop. Last-painted overlap wins.
    doc.addEventListener('click', event => {
      if (!rootElement().contains(event.target) || !win.getSelection()?.isCollapsed
          || event.target.closest?.('a')) {
        notify();
        return;
      }
      for (const { id, range } of [...hitRanges].reverse()) {
        if ([...range.getClientRects()].some(rect => event.clientX >= rect.left
            && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) {
          event.preventDefault();
          notify(id);
          return;
        }
      }
      notify();
    });
    doc.addEventListener('selectionchange', () => {
      // A fresh selection supersedes the focused saved passage. Collapsing the
      // selection after Highlight must not dismiss its newly opened controls.
      if (!win.getSelection()?.isCollapsed) notify();
    });
    win.addEventListener('scroll', () => { if (!revealing) notify(); }, { passive: true });
  }
  prepare(document);
  const current = () => {
    const root = rootElement();
    prepare(root.ownerDocument);
    return root;
  };
  // A website's scripts and styles are text nodes too; they are not article text.
  const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  function content(root) {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
        : skipped.has(node.tagName.toUpperCase()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
    });
    const nodes = [];
    let text = '', node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    return { nodes, text };
  }
  function rangeAt(root, nodes, start, end) {
    const first = nodes.find(item => item.start + item.node.length > start);
    const last = nodes.find(item => item.start + item.node.length >= end);
    if (!first || !last) return null;
    const range = root.ownerDocument.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }
  // The text offset of a range start, counted as content() counts it.
  function offsetOf(nodes, range) {
    for (const item of nodes) {
      if (item.node === range.startContainer) return item.start + range.startOffset;
      if (range.comparePoint(item.node, item.node.length) >= 0) return item.start;
    }
    return nodes.length ? nodes.at(-1).start + nodes.at(-1).node.length : 0;
  }
  const bare = value => value.replace(/\s+/g, '');
  function locate(text, quote) {
    if (!quote.exact) return -1;
    const matchesContext = i => (!quote.prefix || text.slice(0, i).endsWith(quote.prefix))
      && (!quote.suffix || text.slice(i + quote.exact.length).startsWith(quote.suffix));
    if (text.slice(quote.start, quote.start + quote.exact.length) === quote.exact
        && matchesContext(quote.start)) return quote.start;
    const matches = [];
    let i = text.indexOf(quote.exact);
    while (i >= 0) {
      matches.push(i);
      i = text.indexOf(quote.exact, i + 1);
    }
    const contextual = matches.filter(matchesContext);
    if (contextual.length === 1) return contextual[0];
    // Reader and a website share words, not the text between blocks: a site's
    // advertisement can change one side of the context. Score each side on
    // nearby text without spaces; only a single best candidate is used.
    const before = bare(quote.prefix ?? '').slice(-16), after = bare(quote.suffix ?? '').slice(0, 16);
    if (matches.length > 1 && (before || after)) {
      const end = i => i + quote.exact.length;
      const scores = matches.map(i =>
        (before && bare(text.slice(Math.max(0, i - 160), i)).endsWith(before) ? 1 : 0)
        + (after && bare(text.slice(end(i), end(i) + 160)).startsWith(after) ? 1 : 0));
      const best = Math.max(...scores);
      if (best > 0 && scores.indexOf(best) === scores.lastIndexOf(best)) return matches[scores.indexOf(best)];
    }
    // A unique quote remains safe after nearby prose changes. Ambiguous quotes
    // stay in Notes, rather than silently jumping to a different occurrence.
    return matches.length === 1 ? matches[0] : -1;
  }
  function unwrap(root) {
    for (const mark of root.querySelectorAll('mark[data-arctic-highlight]')) {
      mark.replaceWith(...mark.childNodes);
    }
    root.normalize();
  }
  function fallbackMark(root, nodes, intervals) {
    // Partition each text node at every boundary. Later records win overlaps,
    // and adjacent runs of the same colour merge without nested DOM wrappers.
    for (const item of nodes) {
      const pieces = intervals.map(([start, end, colour]) => [
        Math.max(0, start - item.start), Math.min(item.node.length, end - item.start), colour
      ]).filter(([start, end]) => end > start);
      const boundaries = [...new Set(pieces.flatMap(([start, end]) => [start, end]))].sort((a, b) => a - b);
      const merged = [];
      for (let i = 0; i + 1 < boundaries.length; i++) {
        const start = boundaries[i], end = boundaries[i + 1];
        const owner = [...pieces].reverse().find(piece => piece[0] <= start && piece[1] >= end);
        if (!owner) continue;
        const previous = merged[merged.length - 1];
        if (previous && previous[1] === start && previous[2] === owner[2]) previous[1] = end;
        else merged.push([start, end, owner[2]]);
      }
      for (const [start, end, colour] of merged.reverse()) {
        const selected = item.node.splitText(start);
        selected.splitText(end - start);
        const mark = root.ownerDocument.createElement('mark');
        mark.dataset.arcticHighlight = colour;
        selected.replaceWith(mark);
        mark.append(selected);
      }
    }
  }
  function clearPaint(win) {
    // Empty replacement Highlight objects can leave old pixels painted in
    // WebKit even when their registry size is zero. Invalidate the old ranges
    // and remove their entries before resolving and registering the new ones.
    for (const colour of colours) {
      const name = 'arctic-' + colour;
      win?.CSS?.highlights?.get(name)?.clear();
      win?.CSS?.highlights?.delete(name);
    }
  }
  // Ranges in a frame measure from the frame; the native host measures the page.
  const shiftOf = root => root.ownerDocument === document ? { x: 0, y: 0 }
    : root.ownerDocument.defaultView.frameElement.getBoundingClientRect();
  globalThis.arcticAnnotations = {
    // A mirror of native focus, including creation and Show passage. This lets
    // ordinary text selection avoid unnecessary messages to the SwiftUI host.
    setFocused(id, token) {
      if (token === documentToken) focused = id;
    },
    clearSelection() {
      rootElement().ownerDocument.defaultView.getSelection()?.removeAllRanges();
    },
    selection() {
      const root = current();
      const selection = root.ownerDocument.defaultView.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
      const exact = range.toString();
      if (!exact.trim()) return null;
      const { nodes, text } = content(root);
      const start = offsetOf(nodes, range);
      return { exact, start, prefix: text.slice(Math.max(0, start - 48), start),
        suffix: text.slice(start + exact.length, start + exact.length + 48) };
    },
    render(records, token = '') {
      documentToken = token;
      const root = current();
      const win = root.ownerDocument.defaultView;
      if (painted && painted !== win) clearPaint(painted);
      clearPaint(win);
      painted = win;
      unwrap(root);
      const { nodes, text } = content(root);
      const ranges = new Map(colours.map(colour => [colour, []])), intervals = [], missing = [];
      hitRanges = [];
      resolved = new Map();
      for (const record of records) {
        if (!record.quote) continue; // Article notes have no DOM anchor or paint.
        const start = locate(text, record.quote);
        const range = start < 0 ? null : rangeAt(root, nodes, start, start + record.quote.exact.length);
        if (!range) { missing.push(record.id); continue; }
        resolved.set(record.id, record.quote);
        hitRanges.push({ id: record.id, range });
        if (record.isHighlighted) {
          const colour = colourOf(record);
          ranges.get(colour).push(range);
          intervals.push([start, start + record.quote.exact.length, colour]);
        }
      }
      if (win.CSS?.highlights && win.Highlight) {
        for (const colour of colours) {
          const paint = ranges.get(colour);
          if (paint.length) win.CSS.highlights.set('arctic-' + colour, new win.Highlight(...paint));
        }
      } else {
        fallbackMark(root, nodes, intervals);
        // splitText moves live Range boundaries: rebuild after fallback wrapping.
        const rebuilt = content(root);
        hitRanges = [...resolved].flatMap(([id, quote]) => {
          const start = locate(rebuilt.text, quote);
          const range = start < 0 ? null : rangeAt(root, rebuilt.nodes, start, start + quote.exact.length);
          return range ? [{ id, range }] : [];
        });
      }
      return missing;
    },
    bounds(id) {
      const range = hitRanges.find(item => item.id === id)?.range;
      if (!range) return null;
      const rect = range.getBoundingClientRect(), shift = shiftOf(rootElement());
      return { x: rect.x + shift.x, y: rect.y + shift.y, width: rect.width, height: rect.height };
    },
    reveal(id) {
      const quote = resolved.get(id);
      if (!quote) return false;
      const root = current();
      const { nodes, text } = content(root);
      const start = locate(text, quote);
      const range = start < 0 ? null : rangeAt(root, nodes, start, start + quote.exact.length);
      if (!range) return false;
      const distance = () => range.getBoundingClientRect().top + shiftOf(root).y - window.innerHeight * 0.3;
      // Let this programmatic jump settle before treating scroll as dismissal.
      revealing = true;
      window.scrollTo({ top: Math.max(0, window.scrollY + distance()), behavior: 'instant' });
      // An Unwall frame may scroll on its own instead of the page.
      if (root.ownerDocument !== document && Math.abs(distance()) > 1) {
        root.ownerDocument.defaultView.scrollBy({ top: distance(), behavior: 'instant' });
      }
      requestAnimationFrame(() => requestAnimationFrame(() => { revealing = false; }));
      return true;
    }
  };
})();
