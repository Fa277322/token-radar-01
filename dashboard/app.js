// dashboard/app.js — renders window.RADAR (written by main.ts) with no framework and no network.
(() => {
  'use strict';

  const root = document.getElementById('board');
  const R = window.RADAR;

  if (!root) return;
  root.setAttribute('aria-busy', 'false');
  if (!R || !Array.isArray(R.rows)) {
    root.textContent = 'No radar data found — build first: node main.ts --input snapshot.json';
    return;
  }

  const M = R.model;
  const rows = R.rows;
  const live = Array.isArray(R.live) ? R.live : [];
  const watchSet = new Set(R.watchlist || []);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const maxImplied = rows.reduce((m, r) => Math.max(m, r.implied_value_usd || 0), 0);
  const categories = [...new Set(rows.concat(live).map((r) => r.category).filter((c) => c !== null))].sort();

  // ------------------------------------------------------------- formatting

  const fmtUSD = (v) => (v === null || v === undefined ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
  const fmtCompact = (v) => {
    if (v === null || v === undefined) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 1 : 2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  };
  const fmtPct = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
  const fmtAge = (d) => (d === null || d === undefined ? 'unknown' : d.toLocaleString('en-US') + ' d');

  // ------------------------------------------------------------- dom helper

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    for (const kid of kids || []) {
      if (kid !== null && kid !== undefined) node.append(kid);
    }
    return node;
  }

  // ------------------------------------------------------------- hash state

  const state = { tab: 'board', q: '', category: '', sortKey: 'rank', sortDir: 1, open: null };

  function readHash() {
    const out = {};
    for (const part of location.hash.replace(/^#/, '').split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = eq < 0 ? part : part.slice(0, eq);
      out[decodeURIComponent(key)] = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1));
    }
    return out;
  }

  function writeHash() {
    const parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    if (state.open) parts.push('p=' + encodeURIComponent(state.open));
    const next = parts.length ? '#' + parts.join('&') : location.pathname + location.search;
    if (location.hash !== (parts.length ? next : '')) history.replaceState(null, '', next);
  }

  // ------------------------------------------------------------- filtering and sorting

  function matches(r, q) {
    if (!q) return true;
    return [r.name, r.slug, r.category].concat(r.chains || []).filter(Boolean).join(' ').toLowerCase().includes(q);
  }

  function currentData() {
    const q = state.q.trim().toLowerCase();
    let list = (state.tab === 'live' ? live : rows).filter((r) => matches(r, q));
    if (state.category) list = list.filter((r) => r.category === state.category);
    return list;
  }

  const SORTS = {
    rank: (r) => r.rank,
    protocol: (r) => r.name.toLowerCase(),
    tvl: (r) => r.tvl_usd || 0,
    change: (r) => (r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d),
    age: (r) => (r.age_days === null || r.age_days === undefined ? Infinity : r.age_days),
    implied: (r) => r.implied_value_usd,
    status: (r) => (watchSet.has(r.slug) ? 0 : 1),
  };
  const SORT_DEFAULT_DIR = { rank: 1, protocol: 1, tvl: -1, change: -1, age: -1, implied: -1, status: 1 };

  function sortList(list) {
    const key = SORTS[state.sortKey] || SORTS.rank;
    return list.slice().sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return c * state.sortDir || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
  }

  function setSort(key) {
    if (state.sortKey === key) state.sortDir = -state.sortDir;
    else {
      state.sortKey = key;
      state.sortDir = SORT_DEFAULT_DIR[key] || 1;
    }
    renderDynamic();
  }

  // ------------------------------------------------------------- shared pieces

  function pill(slug) {
    const onWatchlist = watchSet.has(slug);
    return el('span', { class: 'pill ' + (onWatchlist ? 'pill-watchlist' : 'pill-early'), text: onWatchlist ? 'watchlist' : 'early' });
  }

  function chainsText(r) {
    return (r.chains || []).join(' · ') || '—';
  }

  // ------------------------------------------------------------- static skeleton

  const search = el('input', {
    type: 'search',
    placeholder: 'Search name, slug, category, chain…',
    value: state.q,
    'aria-label': 'Search protocols',
  });
  const catSelect = el('select', { 'aria-label': 'Filter by category' });
  const tabBoard = el('button', { class: 'tab', type: 'button', text: 'Pre-token board' });
  const tabLive = el('button', { class: 'tab', type: 'button', text: 'Live tokens (' + R.live_size + ')' });
  const countEl = el('span', { class: 'count' });
  const boardWrap = el('section', { class: 'tablewrap' });
  const liveWrap = el('section', { class: 'tablewrap' });

  function fact(label, value) {
    return el('div', { class: 'fact' }, [el('dt', { text: label }), el('dd', { text: value })]);
  }

  const head = el('header', { class: 'head' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'logo', text: 'Token Radar' }),
      el('span', { class: 'asof', text: 'snapshot ' + R.as_of + ' · model ' + R.model_version }),
    ]),
    el('h1', { text: R.watchlist_size + ' watched protocols, ranked by what their TVL could claim' }),
    el('p', {
      class: 'lede',
      text: 'A floor of ' + fmtUSD(R.floor_usd) + ' in TVL separates signal from noise: every board row is a pre-token protocol below that floor, priced by what a token launched on this record might claim from the same TVL.',
    }),
    el('p', {
      class: 'lede',
      text: 'Beyond the watchlist, the early radar sweeps every rankable pre-token protocol under the floor — CEXs and version-suffixed forks excluded — and keeps the ' + R.early_size + ' largest by TVL. Nothing here trades yet; every number is a model, not a market.',
    }),
    el('dl', { class: 'facts' }, [
      fact('watchlist covered', coveredCount() + ' of ' + R.watchlist_size),
      fact('rows scored', String(R.board_size)),
      fact('early rows', String(R.early_size)),
      fact('live set aside', String(R.live_size)),
    ]),
  ]);

  function coveredCount() {
    return rows.filter((r) => watchSet.has(r.slug)).length;
  }

  function modelPanel() {
    const formula =
      'implied = round( tvl_usd × comparable(category) × (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 × ' + M.growth_weight + ') × (' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' × ' + M.maturity_range + ') )';
    const sentence =
      'comparable(category) is the median market-cap/TVL of the snapshot’s live-token protocols of the same category, clamped into [' +
      M.comp_min + ', ' + M.comp_max + '] when at least ' + M.comp_min_sample + ' comparables exist, else the default ' + M.comp_default +
      '; age unknown uses ' + M.unknown_age_days + ' days.';
    return el('section', { class: 'modelpanel' }, [
      el('h3', { text: 'The model' }),
      el('code', { class: 'formula', text: formula }),
      el('p', { text: sentence }),
    ]);
  }

  root.replaceChildren(
    head,
    el('div', { class: 'controls' }, [search, catSelect, tabBoard, tabLive, countEl]),
    boardWrap,
    liveWrap,
    modelPanel(),
  );

  catSelect.append(el('option', { value: '', text: 'All categories' }));
  for (const c of categories) catSelect.append(el('option', { value: c, text: c }));
  catSelect.value = state.category;
  catSelect.addEventListener('change', () => {
    state.category = catSelect.value;
    writeHash();
    renderDynamic();
  });
  search.addEventListener('input', () => {
    state.q = search.value;
    writeHash();
    renderDynamic();
  });
  tabBoard.addEventListener('click', () => {
    state.tab = 'board';
    renderDynamic();
  });
  tabLive.addEventListener('click', () => {
    state.tab = 'live';
    renderDynamic();
  });

  // ------------------------------------------------------------- board table

  const COLUMNS = [
    { key: 'rank', label: 'Rank' },
    { key: 'protocol', label: 'Protocol' },
    { key: 'tvl', label: 'TVL', num: true },
    { key: 'change', label: '7d', num: true },
    { key: 'age', label: 'Age', num: true },
    { key: 'implied', label: 'Implied value', num: true },
    { key: 'status', label: 'Token' },
  ];

  function openRow(slug) {
    return (event) => {
      event.stopPropagation();
      openDetail(slug);
    };
  }

  function rowKeydown(slug) {
    return (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail(slug);
      }
    };
  }

  function boardRow(r) {
    const change = r.change_7d;
    const changeClass = change === null || change === undefined ? 'flat' : change >= 0 ? 'pos' : 'neg';
    const barPct = maxImplied > 0 ? Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) : 2;
    return el('tr', { class: 'row', tabindex: '0', 'data-slug': r.slug, onclick: openRow(r.slug), onkeydown: rowKeydown(r.slug) }, [
      el('td', { class: 'num rank', text: '#' + r.rank }),
      el('td', {}, [
        el('span', { class: 'pname', text: r.name }),
        pill(r.slug),
        el('div', { class: 'psub', text: (r.category || 'uncategorized') + ' · ' + chainsText(r) }),
      ]),
      el('td', { class: 'num', text: fmtCompact(r.tvl_usd) }),
      el('td', { class: 'num ' + changeClass, text: fmtPct(change) }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', {}, [
        el('div', { class: 'barwrap' }, [el('div', { class: 'bar', style: 'width:' + barPct + '%' })]),
        el('div', { class: 'impl', text: fmtUSD(r.implied_value_usd) }),
      ]),
      el('td', { class: 'status', text: 'pre-token' }),
    ]);
  }

  function boardTable(list) {
    const ths = COLUMNS.map((c) => {
      const active = state.sortKey === c.key;
      return el('th', {
        class: (c.num ? 'num ' : '') + (active ? 'sorted' : ''),
        scope: 'col',
        'aria-sort': active ? (state.sortDir === 1 ? 'ascending' : 'descending') : 'none',
        onclick: () => setSort(c.key),
        text: c.label + (active ? (state.sortDir === 1 ? ' ▲' : ' ▼') : ''),
      });
    });
    const body = list.length
      ? list.map(boardRow)
      : [el('tr', {}, [el('td', { class: 'empty', colspan: String(COLUMNS.length), text: 'No protocols match the current filters.' })])];
    return el('table', { class: 'grid' }, [el('thead', {}, [el('tr', {}, ths)]), el('tbody', {}, body)]);
  }

  // ------------------------------------------------------------- live table

  function liveTable(list) {
    const labels = ['Protocol', 'Category', 'TVL', 'Market cap', '7d', 'Token'];
    const ths = labels.map((h, i) => el('th', { class: i >= 2 ? 'num' : '', scope: 'col', text: h }));
    const body = list.length
      ? list.map((r) => {
          const change = r.change_7d;
          const changeClass = change === null || change === undefined ? 'flat' : change >= 0 ? 'pos' : 'neg';
          return el('tr', { class: 'row' }, [
            el('td', {}, [el('span', { class: 'pname', text: r.name }), el('div', { class: 'psub', text: r.slug })]),
            el('td', { text: r.category || 'uncategorized' }),
            el('td', { class: 'num', text: fmtCompact(r.tvl_usd) }),
            el('td', { class: 'num', text: fmtCompact(r.mcap_usd) }),
            el('td', { class: 'num ' + changeClass, text: fmtPct(change) }),
            el('td', { class: 'status', text: 'already trades' }),
          ]);
        })
      : [el('tr', {}, [el('td', { class: 'empty', colspan: '6', text: 'No live tokens match the current filters.' })])];
    return el('table', { class: 'grid' }, [el('thead', {}, [el('tr', {}, ths)]), el('tbody', {}, body)]);
  }

  // ------------------------------------------------------------- detail dialog

  const dialog = el('dialog', { class: 'detail', 'aria-label': 'Protocol detail' });
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    state.open = null;
    writeHash();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  function openDetail(slug) {
    const r = bySlug.get(slug);
    if (!r) return;
    state.open = slug;
    writeHash();
    renderDetail(r);
    if (!dialog.open) dialog.showModal();
  }

  function eqRow(label, value) {
    return el('div', { class: 'eqrow' }, [el('span', { class: 'eqlabel', text: label }), el('span', { class: 'eqvalue', text: value })]);
  }

  function stepLi(step) {
    const m = /^(.*)\s+Cost: (.*?)\. Time: (.*?)\.$/.exec(step);
    if (!m) return el('li', { text: step });
    return el('li', {}, [
      el('span', { class: 'step', text: m[1] }),
      el('span', { class: 'cost', text: 'Cost: ' + m[2] }),
      el('span', { class: 'time', text: 'Time: ' + m[3] }),
    ]);
  }

  function renderDetail(r) {
    const peers = r.comparable_sample !== null && r.comparable_sample !== undefined && r.comparable_sample >= M.comp_min_sample
      ? 'from ' + r.comparable_sample + ' live peers'
      : '(default)';
    const clamped = r.change_7d !== null && r.change_7d !== undefined && (r.change_7d < M.growth_floor || r.change_7d > M.growth_cap);
    const recompute = Math.max(1, Math.round(r.tvl_usd * r.comparable_multiple * r.growth_multiplier * r.maturity_multiplier));
    const matches = recompute === r.implied_value_usd;
    dialog.replaceChildren(
      el('header', { class: 'dhead' }, [
        el('h2', { text: '#' + r.rank + ' — ' + r.name }),
        el('div', { class: 'dsub' }, [
          pill(r.slug),
          el('span', { text: r.category || 'uncategorized' }),
          el('span', { text: chainsText(r) }),
        ]),
      ]),
      el('section', { class: 'equation' }, [
        el('h3', { text: 'How the implied value is built' }),
        eqRow('TVL', fmtUSD(r.tvl_usd)),
        eqRow('Comparable multiple (' + (r.category || 'none') + ')', r.comparable_multiple.toFixed(4) + ' × ' + peers),
        eqRow('Seven-day growth', fmtPct(r.change_7d) + (clamped ? ' (clamped into [' + M.growth_floor + ', ' + M.growth_cap + '])' : '')),
        eqRow(
          'Age with no token',
          r.age_days === null || r.age_days === undefined
            ? 'unknown — no listing date on the record, the model assumes ' + M.unknown_age_days + ' days'
            : r.age_days.toLocaleString('en-US') + ' days (no token yet)',
        ),
        eqRow('Growth multiplier', r.growth_multiplier.toFixed(4) + ' ×'),
        eqRow('Maturity multiplier', r.maturity_multiplier.toFixed(4) + ' ×'),
        eqRow(
          'Implied value',
          fmtUSD(r.implied_value_usd) + ' = round(' + fmtCompact(r.tvl_usd) + ' × ' + r.comparable_multiple.toFixed(4) + ' × ' + r.growth_multiplier.toFixed(4) + ' × ' + r.maturity_multiplier.toFixed(4) + ')',
        ),
        el('p', {
          class: 'recheck ' + (matches ? 'ok' : 'bad'),
          text: matches
            ? 'Recomputed on the page: ' + fmtUSD(recompute) + ' — matches board.json.'
            : 'Recomputed on the page: ' + fmtUSD(recompute) + ' — differs from board.json (' + fmtUSD(r.implied_value_usd) + ').',
        }),
      ]),
      el('section', { class: 'plan' }, [
        el('h3', { text: 'Farm plan — six steps, costs and times from the record' }),
        el('ol', {}, r.farm_steps.map(stepLi)),
      ]),
    );
  }

  // ------------------------------------------------------------- dynamic render

  function renderDynamic() {
    const list = sortList(currentData());
    countEl.textContent = list.length + ' of ' + (state.tab === 'live' ? R.live_size : R.board_size) + ' rows';
    if (state.tab === 'live') {
      boardWrap.hidden = true;
      liveWrap.hidden = false;
      liveWrap.replaceChildren(liveTable(list));
    } else {
      liveWrap.hidden = true;
      boardWrap.hidden = false;
      boardWrap.replaceChildren(boardTable(list));
    }
    tabBoard.classList.toggle('active', state.tab === 'board');
    tabLive.classList.toggle('active', state.tab === 'live');
  }

  // ------------------------------------------------------------- init

  const initial = readHash();
  if (initial.q) state.q = String(initial.q);
  if (initial.category && categories.includes(initial.category)) state.category = initial.category;
  search.value = state.q;
  catSelect.value = state.category;
  renderDynamic();
  if (initial.p && bySlug.has(String(initial.p))) openDetail(String(initial.p));
})();
