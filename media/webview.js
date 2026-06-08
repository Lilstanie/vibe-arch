(function () {
  'use strict';
  const vscode = acquireVsCodeApi();

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const errorEl       = document.getElementById('error');
  const pFill         = document.getElementById('pFill');
  const pPct          = document.getElementById('pPct');
  const pCnt          = document.getElementById('pCnt');
  const folderNameEl  = document.getElementById('folderName');
  const pickFolderBtn = document.getElementById('pickFolder');
  const generateBtn   = document.getElementById('generateBtn');
  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const genOverlay    = document.getElementById('genOverlay');
  const genStream     = document.getElementById('genStream');
  const mapEl         = document.getElementById('map');
  const layersEl      = document.getElementById('layers');
  const svgEl         = document.getElementById('edges');
  const readyList     = document.getElementById('readyList');
  const readyCnt      = document.getElementById('readyCnt');
  const untrackedList = document.getElementById('untrackedList');
  const untrackedCnt  = document.getElementById('untrackedCnt');

  let state = null;

  // ── Buttons ───────────────────────────────────────────────────────────────────
  pickFolderBtn.addEventListener('click', () => vscode.postMessage({ type: 'pickFolder' }));
  generateBtn.addEventListener('click',   () => vscode.postMessage({ type: 'generate' }));
  copyPromptBtn.addEventListener('click', () => vscode.postMessage({ type: 'copyPrompt' }));

  // ── Message bus ──────────────────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      state = msg.state;
      render(state);
    } else if (msg.type === 'pulse') {
      pulseNodes(msg.blockIds || []);
    }
  });

  vscode.postMessage({ type: 'ready' });

  // ── Render ───────────────────────────────────────────────────────────────────
  function render(s) {
    // Generating overlay
    if (s.generating) {
      folderNameEl.textContent = s.scannedRoot || '—';
      genOverlay.classList.remove('hidden');
      mapEl.classList.add('hidden');
      generateBtn.disabled = true;
      generateBtn.textContent = '⚡ …';
      if (s.generatingChunk) genStream.textContent = s.generatingChunk;
      return;
    }
    genOverlay.classList.add('hidden');
    mapEl.classList.remove('hidden');
    generateBtn.disabled = false;
    generateBtn.textContent = '⚡ Generate';

    if (s.error) {
      folderNameEl.textContent = s.scannedRoot || '—';
      errorEl.textContent = s.error;
      errorEl.classList.remove('hidden');
      layersEl.innerHTML = '';
      svgEl.innerHTML = '';
      readyList.innerHTML = '';
      untrackedList.innerHTML = '';
      return;
    }
    errorEl.classList.add('hidden');
    folderNameEl.textContent = s.scannedRoot || '—';
    renderProgress(s);
    renderLayers(s);
    renderReady(s);
    renderUntracked(s);
    requestAnimationFrame(drawEdges);
  }

  function renderProgress(s) {
    const done  = s.blocks.filter(b => b.status === 'done').length;
    const total = s.blocks.length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    pFill.style.width = pct + '%';
    pPct.textContent  = pct + '%';
    pCnt.textContent  = done + '/' + total;
  }

  function renderLayers(s) {
    if (!s.blocks.length) {
      layersEl.innerHTML = '<div class="empty" style="text-align:center;padding:24px">No blocks found</div>';
      return;
    }

    const byLevel = new Map();
    for (const b of s.blocks) {
      if (!byLevel.has(b.level)) byLevel.set(b.level, []);
      byLevel.get(b.level).push(b);
    }

    const maxLevel = Math.max(...s.blocks.map(b => b.level));
    let html = '';
    for (let lv = 0; lv <= maxLevel; lv++) {
      const nodes = byLevel.get(lv) || [];
      html += '<div class="layer">' + nodes.map(nodeHTML).join('') + '</div>';
    }
    layersEl.innerHTML = html;

    layersEl.querySelectorAll('.node').forEach(n => {
      n.addEventListener('click', () => {
        vscode.postMessage({ type: 'cycleStatus', blockId: n.dataset.id });
      });
    });
  }

  function nodeHTML(b) {
    const meta = b.intent
      ? esc(b.intent)
      : b.fileCount + ' file' + (b.fileCount !== 1 ? 's' : '');
    return '<div class="node ' + b.status + '" data-id="' + esc(b.id) + '">' +
      '<span class="nm"><span class="led"></span>' + esc(b.label) + '</span>' +
      '<span class="meta">' + meta + '</span>' +
      '<span class="check">✓</span>' +
    '</div>';
  }

  // ── Edge drawing ─────────────────────────────────────────────────────────────
  function drawEdges() {
    if (!state || !state.edges.length) {
      svgEl.innerHTML = '';
      return;
    }

    const mapRect    = mapEl.getBoundingClientRect();
    const scrollLeft = mapEl.scrollLeft;
    const scrollTop  = mapEl.scrollTop;
    const W = mapEl.scrollWidth;
    const H = mapEl.scrollHeight;

    svgEl.setAttribute('width',   W);
    svgEl.setAttribute('height',  H);
    svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    const pos = {};
    document.querySelectorAll('.node').forEach(n => {
      const r = n.getBoundingClientRect();
      pos[n.dataset.id] = {
        x:   r.left - mapRect.left + r.width  / 2 + scrollLeft,
        top: r.top  - mapRect.top              + scrollTop,
        bot: r.bottom - mapRect.top            + scrollTop,
      };
    });

    const blockById = {};
    for (const b of state.blocks) blockById[b.id] = b;

    let paths = '';
    for (const e of state.edges) {
      const from = pos[e.from];
      const to   = pos[e.to];
      if (!from || !to) continue;

      const x1 = from.x, y1 = from.bot;
      const x2 = to.x,   y2 = to.top;
      const my = (y1 + y2) / 2;

      const fromDone = blockById[e.from]?.status === 'done';
      const toActive = blockById[e.to]?.status !== 'planned';
      const col = (fromDone && toActive) ? 'rgba(52,211,153,.55)' : 'rgba(56,189,248,.28)';

      paths += '<path d="M' + x1 + ',' + y1 +
        ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + y2 +
        '" fill="none" stroke="' + col + '" stroke-width="1.4"/>';
      paths += '<circle cx="' + x2 + '" cy="' + y2 + '" r="2.5" fill="' + col + '"/>';
    }
    svgEl.innerHTML = paths;
  }

  // ── Ready list ───────────────────────────────────────────────────────────────
  function renderReady(s) {
    const blockById = {};
    for (const b of s.blocks) blockById[b.id] = b;

    readyCnt.textContent = s.readyToWorkOn.length;
    if (!s.readyToWorkOn.length) {
      readyList.innerHTML = '<div class="empty">nothing unblocked — finish deps first</div>';
      return;
    }
    readyList.innerHTML = s.readyToWorkOn.map(id => {
      const b = blockById[id];
      return '<div class="row ready"><span class="tag"></span>' + esc(b ? b.label : id) + '</div>';
    }).join('');
  }

  // ── Untracked ────────────────────────────────────────────────────────────────
  function renderUntracked(s) {
    untrackedCnt.textContent = s.untrackedFiles.length;
    if (!s.untrackedFiles.length) {
      untrackedList.innerHTML = '<div class="empty">all files tracked</div>';
      return;
    }
    const show = s.untrackedFiles.slice(0, 20);
    untrackedList.innerHTML = show.map(f => {
      const parts = f.split('/');
      const name  = parts.pop();
      const dir   = parts.join('/');
      return '<div class="row warn"><span class="tag"></span>' +
        esc(name) + '<span class="path">' + esc(dir) + '</span></div>';
    }).join('');
    if (s.untrackedFiles.length > 20) {
      untrackedList.innerHTML +=
        '<div class="empty">…and ' + (s.untrackedFiles.length - 20) + ' more</div>';
    }
  }

  // ── Pulse ────────────────────────────────────────────────────────────────────
  function pulseNodes(ids) {
    for (const id of ids) {
      const n = document.querySelector('.node[data-id="' + CSS.escape(id) + '"]');
      if (n) {
        n.classList.remove('pulse');
        void n.offsetWidth; // force reflow
        n.classList.add('pulse');
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Resize / scroll ──────────────────────────────────────────────────────────
  new ResizeObserver(() => requestAnimationFrame(drawEdges)).observe(mapEl);
  mapEl.addEventListener('scroll', () => requestAnimationFrame(drawEdges));
})();
