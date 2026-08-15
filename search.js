/* =================================================================
   Site search — Vasudev Malyan
   Drop <script src="search.js" defer></script> before </body> on
   every page. The script injects its own button into the nav and
   builds the overlay, so no other HTML changes are needed.

   On first use it fetches the pages listed in PAGES and searches
   their real text, so there is no index file to keep in sync —
   publish new content and it becomes searchable immediately.
   ================================================================= */
(function () {
  'use strict';

  var PAGES = [
    { url: 'index.html',        label: 'Home' },
    { url: 'about.html',        label: 'About' },
    { url: 'research.html',     label: 'Research' },
    { url: 'publications.html', label: 'Publications' },
    { url: 'teaching.html',     label: 'Teaching' },
    { url: 'beyond.html',       label: 'Beyond research' },
    { url: 'contact.html',      label: 'Contact' }
  ];

  var records = null;      // built once, then cached for the session
  var loading = false;
  var activeIndex = -1;
  var lastResults = [];

  /* ---------- build the UI ---------- */

  var nav = document.querySelector('header nav');
  if (!nav) return;

  var openBtn = document.createElement('button');
  openBtn.className = 'search-btn';
  openBtn.type = 'button';
  openBtn.setAttribute('aria-label', 'Search this site');
  openBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
  nav.appendChild(openBtn);

  var overlay = document.createElement('div');
  overlay.className = 'search-overlay';
  overlay.setAttribute('hidden', '');
  overlay.innerHTML =
    '<div class="search-panel" role="dialog" aria-modal="true" aria-label="Search">' +
      '<div class="search-field">' +
        '<i class="fa-solid fa-magnifying-glass"></i>' +
        '<input type="search" id="searchInput" placeholder="Search publications, research, teaching\u2026" ' +
               'autocomplete="off" spellcheck="false" aria-label="Search query">' +
        '<button type="button" class="search-close" aria-label="Close search">Esc</button>' +
      '</div>' +
      '<div class="search-results" id="searchResults"></div>' +
    '</div>';
  document.body.appendChild(overlay);

  var input   = overlay.querySelector('#searchInput');
  var results = overlay.querySelector('#searchResults');

  /* ---------- fetch and index ---------- */

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function harvest(doc, page) {
    var out = [];
    var main = doc.querySelector('main') || doc.body;
    var heading = '';

    // Walk the content in document order so each block of text keeps the
    // nearest heading above it — that heading becomes the result's context.
    var nodes = main.querySelectorAll('h1,h2,h3,p,li,td,figcaption,.chip,.what,.where');
    Array.prototype.forEach.call(nodes, function (el) {
      if (el.closest('nav') || el.closest('footer')) return;

      var t = textOf(el);
      if (!t) return;

      if (/^H[123]$/.test(el.tagName)) {
        heading = t;
        out.push({ page: page, heading: '', text: t, isHeading: true });
        return;
      }
      if (t.length < 3) return;

      // an anchor inside the block gives us something to link straight to
      var link = el.querySelector('a[href]');
      out.push({
        page: page,
        heading: heading,
        text: t,
        href: link ? link.getAttribute('href') : null,
        isHeading: false
      });
    });
    return out;
  }

  function build() {
    if (records || loading) return Promise.resolve();
    loading = true;
    results.innerHTML = '<div class="search-msg">Loading\u2026</div>';

    return Promise.all(PAGES.map(function (page) {
      return fetch(page.url)
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (html) {
          if (!html) return [];
          var doc = new DOMParser().parseFromString(html, 'text/html');
          return harvest(doc, page);
        })
        .catch(function () { return []; });
    })).then(function (chunks) {
      records = [].concat.apply([], chunks);
      loading = false;
    });
  }

  /* ---------- searching ---------- */

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Trim a long block down to the neighbourhood of the first match and
  // mark every query term inside it.
  function snippet(text, terms) {
    var lower = text.toLowerCase();
    var at = lower.indexOf(terms[0]);
    if (at < 0) at = 0;

    var start = Math.max(0, at - 60);
    var end = Math.min(text.length, at + 180);
    var cut = text.slice(start, end);
    if (start > 0) cut = '\u2026' + cut;
    if (end < text.length) cut += '\u2026';

    cut = escapeHtml(cut);
    terms.forEach(function (term) {
      cut = cut.replace(new RegExp('(' + escapeRe(escapeHtml(term)) + ')', 'gi'), '<mark>$1</mark>');
    });
    return cut;
  }

  function score(rec, terms) {
    var lower = rec.text.toLowerCase();
    var n = 0;
    for (var i = 0; i < terms.length; i++) {
      if (lower.indexOf(terms[i]) < 0) return 0;   // every term must appear
      n += 1;
    }
    var s = n * 10;
    if (rec.isHeading) s += 25;                    // headings outrank body text
    if (lower.indexOf(terms.join(' ')) >= 0) s += 15; // exact phrase
    if (rec.text.length < 120) s += 5;             // short, specific lines
    return s;
  }

  function render(query) {
    var q = query.trim().toLowerCase();
    if (q.length < 2) {
      results.innerHTML = '<div class="search-msg">Type at least two characters.</div>';
      lastResults = [];
      return;
    }
    if (!records) {
      results.innerHTML = '<div class="search-msg">Loading\u2026</div>';
      return;
    }

    var terms = q.split(/\s+/);
    var hits = [];
    records.forEach(function (rec) {
      var s = score(rec, terms);
      if (s > 0) hits.push({ rec: rec, score: s });
    });

    hits.sort(function (a, b) { return b.score - a.score; });

    // one entry per page+heading pair, so a matching section is not
    // repeated once per paragraph inside it
    var seen = {};
    hits = hits.filter(function (h) {
      var key = h.rec.page.url + '|' + (h.rec.heading || h.rec.text);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 12);

    lastResults = hits;
    activeIndex = -1;

    if (!hits.length) {
      results.innerHTML = '<div class="search-msg">No matches for &ldquo;' +
        escapeHtml(query.trim()) + '&rdquo;.</div>';
      return;
    }

    results.innerHTML = hits.map(function (h, i) {
      var rec = h.rec;
      var target = rec.href && /^https?:/.test(rec.href)
        ? rec.href
        : rec.page.url + '#:~:text=' + encodeURIComponent(rec.text.slice(0, 60));
      var external = rec.href && /^https?:/.test(rec.href);
      return '<a class="search-hit" href="' + target + '"' +
             (external ? ' target="_blank" rel="noreferrer"' : '') +
             ' data-i="' + i + '">' +
               '<span class="search-hit-meta">' + escapeHtml(rec.page.label) +
                 (rec.heading ? ' <span class="sep">&middot;</span> ' + escapeHtml(rec.heading) : '') +
               '</span>' +
               '<span class="search-hit-text">' + snippet(rec.text, terms) + '</span>' +
             '</a>';
    }).join('');
  }

  /* ---------- open / close ---------- */

  function open() {
    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    input.value = '';
    results.innerHTML = '<div class="search-msg">Type at least two characters.</div>';
    input.focus();
    build().then(function () { if (input.value) render(input.value); });
  }

  function close() {
    overlay.setAttribute('hidden', '');
    document.body.style.overflow = '';
    openBtn.focus();
  }

  openBtn.addEventListener('click', open);
  overlay.querySelector('.search-close').addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  var debounce;
  input.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { render(input.value); }, 120);
  });

  /* ---------- keyboard ---------- */

  function highlight(i) {
    var items = results.querySelectorAll('.search-hit');
    if (!items.length) return;
    activeIndex = (i + items.length) % items.length;
    Array.prototype.forEach.call(items, function (el, n) {
      el.classList.toggle('is-active', n === activeIndex);
    });
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      overlay.hasAttribute('hidden') ? open() : close();
      return;
    }
    if (e.key === '/' && !typing && overlay.hasAttribute('hidden')) {
      e.preventDefault();
      open();
      return;
    }
    if (overlay.hasAttribute('hidden')) return;

    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); highlight(activeIndex + 1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); highlight(activeIndex - 1); }
    else if (e.key === 'Enter' && activeIndex >= 0) {
      var el = results.querySelectorAll('.search-hit')[activeIndex];
      if (el) el.click();
    }
  });
})();
