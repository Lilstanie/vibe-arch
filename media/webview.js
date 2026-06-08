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
  const untrackedList  = document.getElementById('untrackedList');
  const untrackedCnt   = document.getElementById('untrackedCnt');
  const deepCheckBtn   = document.getElementById('deepCheckBtn');
  const deepCheckBar   = document.getElementById('deepCheckBar');
  const deepBarFill    = document.getElementById('deepBarFill');
  const deepBarLabel   = document.getElementById('deepBarLabel');

  let state = null;
  // verdicts keyed by blockId — survive full re-renders
  const verdicts = new Map();

  // ── Buttons ───────────────────────────────────────────────────────────────────
  pickFolderBtn.addEventListener('click', () => vscode.postMessage({ type: 'pickFolder' }));
  generateBtn.addEventListener('click',   () => vscode.postMessage({ type: 'generate' }));
  copyPromptBtn.addEventListener('click', () => vscode.postMessage({ type: 'copyPrompt' }));
  deepCheckBtn.addEventListener('click',  () => {
    deepCheckBtn.disabled = true;
    deepCheckBtn.textContent = '🔍 …';
    deepCheckBar.classList.remove('hidden');
    deepBarFill.style.width = '0%';
    deepBarLabel.textContent = 'starting…';
    vscode.postMessage({ type: 'deepCheck' });
  });

  // ── Message bus ──────────────────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      state = msg.state;
      render(state);
    } else if (msg.type === 'pulse') {
      pulseNodes(msg.blockIds || []);
    } else if (msg.type === 'deepCheckProgress') {
      verdicts.set(msg.blockId, msg.verdict);
      applyVerdict(msg.blockId, msg.verdict);
      const pct = Math.round(msg.progress / msg.total * 100);
      deepBarFill.style.width = pct + '%';
      deepBarLabel.textContent = msg.blockId + ' (' + msg.progress + '/' + msg.total + ')';
    } else if (msg.type === 'deepCheckDone') {
      deepCheckBtn.disabled = false;
      deepCheckBtn.textContent = '🔍 Deep Check';
      deepBarLabel.textContent = 'done ✓';
      setTimeout(() => deepCheckBar.classList.add('hidden'), 2000);
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
    renderCols(s);
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

  // ── Barycentric helper ───────────────────────────────────────────────────────
  function bary(block, neighborIdx, edges, direction) {
    // direction 'left'  → look at deps  (edges where block is the 'to')
    // direction 'right' → look at dependents (edges where block is the 'from')
    const positions = edges
      .filter(e => direction === 'left' ? e.to === block.id : e.from === block.id)
      .map(e => neighborIdx.get(direction === 'left' ? e.from : e.to))
      .filter(p => p !== undefined);
    if (!positions.length) return Infinity; // no neighbors → sort to bottom
    return positions.reduce((a, b) => a + b, 0) / positions.length;
  }

  // ── Column layout (left-to-right, barycentric sorted) ────────────────────────
  function renderCols(s) {
    if (!s.blocks.length) {
      layersEl.innerHTML = '<div class="empty" style="padding:24px">No blocks found</div>';
      return;
    }

    // 1. Group by level
    const maxLevel = Math.max(...s.blocks.map(b => b.level));
    const cols = [];
    for (let lv = 0; lv <= maxLevel; lv++) {
      cols.push(s.blocks.filter(b => b.level === lv));
    }

    // 2. Three-pass barycentric crossing minimisation
    //    Pass 1 — forward sweep (sort by left neighbours)
    for (let i = 1; i < cols.length; i++) {
      const prevIdx = new Map(cols[i - 1].map((b, idx) => [b.id, idx]));
      cols[i] = cols[i].slice().sort(
        (a, b) => bary(a, prevIdx, s.edges, 'left') - bary(b, prevIdx, s.edges, 'left')
      );
    }
    //    Pass 2 — backward sweep (sort by right neighbours)
    for (let i = cols.length - 2; i >= 0; i--) {
      const nextIdx = new Map(cols[i + 1].map((b, idx) => [b.id, idx]));
      cols[i] = cols[i].slice().sort(
        (a, b) => bary(a, nextIdx, s.edges, 'right') - bary(b, nextIdx, s.edges, 'right')
      );
    }
    //    Pass 3 — forward sweep again (converge)
    for (let i = 1; i < cols.length; i++) {
      const prevIdx = new Map(cols[i - 1].map((b, idx) => [b.id, idx]));
      cols[i] = cols[i].slice().sort(
        (a, b) => bary(a, prevIdx, s.edges, 'left') - bary(b, prevIdx, s.edges, 'left')
      );
    }

    // 3. Render
    let html = '';
    for (let lv = 0; lv <= maxLevel; lv++) {
      if (!cols[lv].length) continue;
      html += '<div class="col" data-level="' + lv + '">';
      html += '<div class="col-label">L' + lv + '</div>';
      html += cols[lv].map(nodeHTML).join('');
      html += '</div>';
    }
    layersEl.innerHTML = html;

    // 4. Event listeners + re-apply any existing verdicts
    layersEl.querySelectorAll('.node').forEach(n => {
      n.addEventListener('click', () =>
        vscode.postMessage({ type: 'cycleStatus', blockId: n.dataset.id })
      );
    });
    for (const [blockId, verdict] of verdicts) {
      applyVerdictToNode(
        layersEl.querySelector('.node[data-id="' + CSS.escape(blockId) + '"]'),
        verdict
      );
    }
  }

  function nodeHTML(b) {
    const verdict = verdicts.get(b.id);
    const statusClass = verdict ? verdict.status : b.status;
    const aiTag = verdict
      ? '<span class="ai-tag conf-' + verdict.confidence + '">✦ AI</span>'
      : '';
    const metaText = verdict
      ? esc(verdict.reason)
      : (b.intent ? esc(b.intent) : b.fileCount + ' file' + (b.fileCount !== 1 ? 's' : ''));
    return (
      '<div class="node ' + statusClass + '" data-id="' + esc(b.id) + '" title="' + esc(b.label) + '">' +
        '<span class="nm"><span class="led"></span>' + esc(b.label) + aiTag + '</span>' +
        '<span class="meta">' + metaText + '</span>' +
        (verdict && verdict.missing.length
          ? '<span class="missing">' + verdict.missing.slice(0, 2).map(m => '· ' + esc(m)).join(' ') + '</span>'
          : '') +
        '<span class="check">✓</span>' +
      '</div>'
    );
  }

  function applyVerdictToNode(node, verdict) {
    if (!node) return;
    const blockId = node.dataset.id;
    const b = state?.blocks.find(bl => bl.id === blockId);
    if (!b) return;
    const html = nodeHTML(b);
    node.outerHTML = html;
    const fresh = layersEl.querySelector('.node[data-id="' + CSS.escape(blockId) + '"]');
    if (fresh) {
      fresh.addEventListener('click', () =>
        vscode.postMessage({ type: 'cycleStatus', blockId })
      );
      fresh.classList.remove('pulse');
      void fresh.offsetWidth;
      fresh.classList.add('pulse');
    }
  }

  function applyVerdict(blockId, verdict) {
    applyVerdictToNode(
      layersEl.querySelector('.node[data-id="' + CSS.escape(blockId) + '"]'),
      verdict
    );
    requestAnimationFrame(drawEdges);
  }

  // ── Edge drawing — left → right horizontal bezier ────────────────────────────
  function drawEdges() {
    if (!state || !state.edges.length) { svgEl.innerHTML = ''; return; }

    const mapRect    = mapEl.getBoundingClientRect();
    const scrollLeft = mapEl.scrollLeft;
    const scrollTop  = mapEl.scrollTop;
    const W = mapEl.scrollWidth;
    const H = mapEl.scrollHeight;

    svgEl.setAttribute('width',   W);
    svgEl.setAttribute('height',  H);
    svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // Collect node positions (right-center for source, left-center for target)
    const pos = {};
    layersEl.querySelectorAll('.node').forEach(n => {
      const r = n.getBoundingClientRect();
      pos[n.dataset.id] = {
        rx: r.right - mapRect.left + scrollLeft,          // right edge x
        lx: r.left  - mapRect.left + scrollLeft,          // left edge x
        cy: r.top + r.height / 2 - mapRect.top + scrollTop, // vertical centre
      };
    });

    const blockById = {};
    for (const b of state.blocks) blockById[b.id] = b;

    let out = '<defs>' +
      '<marker id="arr" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="5" markerHeight="4" orient="auto">' +
        '<path d="M0,0 L8,3 L0,6 Z" fill="rgba(56,189,248,.5)"/>' +
      '</marker>' +
      '<marker id="arr-g" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="5" markerHeight="4" orient="auto">' +
        '<path d="M0,0 L8,3 L0,6 Z" fill="rgba(52,211,153,.6)"/>' +
      '</marker>' +
    '</defs>';

    for (const e of state.edges) {
      const src = pos[e.from];
      const dst = pos[e.to];
      if (!src || !dst) continue;

      const x1 = src.rx, y1 = src.cy;
      const x2 = dst.lx, y2 = dst.cy;
      const cx = (x1 + x2) / 2; // control-point x = midpoint → S-curve

      const fromDone = blockById[e.from]?.status === 'done';
      const toActive = blockById[e.to]?.status  !== 'planned';
      const isGreen  = fromDone && toActive;
      const stroke   = isGreen ? 'rgba(52,211,153,.5)' : 'rgba(56,189,248,.28)';
      const markerId = isGreen ? 'arr-g' : 'arr';

      out += '<path d="M' + x1 + ',' + y1 +
        ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2 + '"' +
        ' fill="none" stroke="' + stroke + '" stroke-width="1.4"' +
        ' marker-end="url(#' + markerId + ')"/>';
    }

    svgEl.innerHTML = out;
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
