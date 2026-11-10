(() => {
  'use strict';
  const DATA = window.GENEALOGY;
  if (!DATA || !DATA.people || !DATA.documents) return;
  const P = DATA.people, D = DATA.documents, $ = id => document.getElementById(id);
  const LABEL = { A: 'Acte lu', L: 'Livret', F: 'Famille', T: 'Transcription', R: 'Relevé', P: 'À confirmer' };
  const COLORS = { A: '#625a53', L: '#69767c', F: '#9a805c', T: '#a58168', R: '#a58168', P: '#a58168' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = a => Array.isArray(a) ? a : [];
  const statusCode = s => Object.hasOwn(LABEL, s) ? s : 'P';
  const badge = (s, label) => `<span class="proof-badge ${statusCode(s)}">${esc(label || LABEL[statusCode(s)])}</span>`;
  const parents = id => id === 'eric' ? [] : list(P[id]?.parents).filter(r => P[r.id]);
  const families = { ...(DATA.families || {}) };
  if (!families.ensemble) families.ensemble = { root: 'isabelle', label: 'Toute la famille', subtitle: 'À partir d’Isabelle, remontez les branches Bonnefond et Maggiore.' };
  let family = new URLSearchParams(location.search).get('famille');
  if (!families[family] || !P[families[family].root]) family = P.isabelle ? 'ensemble' : Object.keys(families)[0];
  let root = families[family].root, expanded = new Set(), zoom = 1, view = 'tree';
  let currentPerson = null, currentDoc = null, scanIndex = 0, scanScale = 1, lastFocus = null, docFocus = null;
  let layout = { nodes: [], width: 0, height: 0, depth: 0 };
  const NODE_W = 226, NODE_H = 148, SLOT = 252, ROW = 218, PAD = 32, TOP = 44;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function allIds(id, seen = new Set()) {
    if (!P[id] || seen.has(id)) return seen;
    seen.add(id);
    parents(id).forEach(r => allIds(r.id, seen));
    return seen;
  }
  function setExpanded(level) {
    expanded.clear();
    function walk(id, depth, path) {
      if (!P[id] || depth >= level - 1 || path.has(id)) return;
      expanded.add(id);
      const next = new Set(path); next.add(id);
      parents(id).forEach(r => walk(r.id, depth + 1, next));
    }
    walk(root, 0, new Set());
  }
  function expandEverything() { expanded = new Set([...allIds(root)].filter(id => parents(id).length)); }
  function hideSearch() { $('search-results').hidden = true; $('search').setAttribute('aria-expanded', 'false'); }
  function updateLocation() {
    const url = new URL(location.href);
    url.searchParams.set('famille', family);
    if (root !== families[family].root) url.searchParams.set('racine', root); else url.searchParams.delete('racine');
    url.searchParams.delete('personne');
    history.replaceState({}, '', url);
  }
  function switchFamily(f) {
    if (!families[f] || !P[families[f].root]) return;
    family = f; root = families[f].root;
    setExpanded(4); $('generations').value = '4';
    $('search').value = ''; hideSearch(); updateLocation();
    renderShell(); renderTree(); renderDocs();
    showView('tree'); requestAnimationFrame(() => scrollToNode('root', false));
  }
  function renderShell() {
    const f = families[family];
    $('family-title').textContent = f.label || 'Toute la famille';
    $('family-subtitle').textContent = f.subtitle || 'Suivez les parents de génération en génération et ouvrez les fiches pour consulter les actes.';
    $('dossier-count').textContent = `${Object.keys(P).length} fiches de personnes dans le dossier · ${Object.keys(D).length} actes et références`;
    $('rail-root').textContent = family === 'ensemble' ? 'René Bonnefond et Éliane Maggiore' : P[f.root].name;
    document.title = `${f.label || 'Toute la famille'} — L’arbre d’Isabelle`;
    document.querySelectorAll('[data-family]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.family === family)));
    $('focus-name').textContent = P[root].name;
  }

  function makeLayout() {
    let leaves = 0;
    const nodes = [], edges = [];
    function walk(id, depth, key, path) {
      const node = { id, key, depth, x: 0, y: 0, role: 'ancestor', cycle: path.has(id) };
      nodes.push(node);
      const relations = !node.cycle && expanded.has(id) ? parents(id) : [];
      if (relations.length) {
        const next = new Set(path); next.add(id);
        const ps = relations.map((r, i) => {
          const parent = walk(r.id, depth + 1, `${key}-${i}`, next);
          edges.push({ from: key, to: parent.key, status: statusCode(r.status), reason: r.reason || '' });
          return parent;
        });
        node.x = ps.reduce((sum, n) => sum + n.x, 0) / ps.length;
      } else node.x = PAD + leaves++ * SLOT;
      return node;
    }
    const first = walk(root, 0, 'root', new Set());
    const maxDepth = Math.max(...nodes.map(n => n.depth));
    nodes.forEach(n => { n.y = TOP + (maxDepth - n.depth) * ROW; });
    if (family === 'ensemble' && root === 'isabelle') {
      if (P.eric) nodes.push({ id: 'eric', key: 'spouse', depth: 0, x: first.x + SLOT, y: first.y, role: 'spouse' });
      const children = ['theo', 'jordan'].filter(id => P[id]);
      const center = first.x + (P.eric ? SLOT / 2 : 0);
      children.forEach((id, i) => {
        const key = `child-${id}`;
        nodes.push({ id, key, depth: -1, x: center + (i - (children.length - 1) / 2) * SLOT, y: first.y + ROW, role: 'child' });
        parents(id).filter(r => r.id === 'isabelle' || (r.id === 'eric' && P.eric)).forEach(r => {
          edges.push({ from: key, to: r.id === 'isabelle' ? 'root' : 'spouse', status: statusCode(r.status), reason: r.reason || '' });
        });
      });
    }
    const minX = Math.min(...nodes.map(n => n.x));
    if (minX < PAD) nodes.forEach(n => { n.x += PAD - minX; });
    const contentWidth = Math.max(480, ...nodes.map(n => n.x + NODE_W + PAD));
    const width = Math.max(contentWidth, $('tree-scroll').clientWidth / zoom);
    if (width > contentWidth) nodes.forEach(n => { n.x += (width - contentWidth) / 2; });
    return { nodes, edges, depth: maxDepth, width, height: Math.max(390, ...nodes.map(n => n.y + NODE_H + PAD)) };
  }
  function renderTree() {
    layout = makeLayout();
    const { nodes, edges, width, height, depth } = layout;
    const byKey = Object.fromEntries(nodes.map(n => [n.key, n]));
    $('tree-stage').style.width = `${width * zoom}px`; $('tree-stage').style.height = `${height * zoom}px`;
    const lines = $('tree-lines');
    lines.setAttribute('width', width * zoom); lines.setAttribute('height', height * zoom); lines.setAttribute('viewBox', `0 0 ${width} ${height}`);
    let svg = '<defs>' + Object.entries(COLORS).map(([k, color]) => `<marker id="parent-arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${color}"/></marker>`).join('') + '</defs>';
    for (let d = 0; d <= depth; d++) {
      const y = TOP + (depth - d) * ROW - 16;
      const label = d === 0 ? 'POINT DE DÉPART' : d === 1 ? 'PARENTS' : d === 2 ? 'GRANDS-PARENTS' : `GÉNÉRATION ${d + 1}`;
      svg += `<text class="generation-label" x="${PAD}" y="${y}">${label}</text>`;
    }
    for (const e of edges) {
      const child = byKey[e.from], parent = byKey[e.to];
      const x1 = child.x + NODE_W / 2, y1 = child.y - 2;
      const x2 = parent.x + NODE_W / 2, y2 = parent.y + NODE_H + 4;
      const mid = (y1 + y2) / 2;
      svg += `<path class="edge ${e.status}" marker-end="url(#parent-arrow-${e.status})" d="M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}"><title>${esc(e.reason || LABEL[e.status])}</title></path>`;
    }
    lines.innerHTML = svg;
    $('tree-nodes').innerHTML = nodes.map(n => {
      const p = P[n.id], ps = parents(n.id), open = expanded.has(n.id);
      const canExpand = n.role === 'ancestor' && ps.length && !n.cycle;
      const toggle = canExpand ? `<button class="node-toggle" data-toggle="${esc(n.id)}" aria-expanded="${open}" aria-label="${open ? 'Replier' : 'Afficher'} les parents de ${esc(p.name)}">${open ? 'Replier −' : 'Parents ↑'}</button>` : `<span class="unknown-parents">${n.cycle ? 'Lien à vérifier' : n.role === 'spouse' ? 'Conjoint d’Isabelle' : n.role === 'child' ? 'Fils d’Isabelle' : 'Parents à retrouver'}</span>`;
      return `<article class="node ${n.key === 'root' ? 'focus-node' : ''}" style="left:${n.x * zoom}px;top:${n.y * zoom}px;transform:scale(${zoom});transform-origin:0 0" data-node-id="${esc(n.id)}" data-node-key="${esc(n.key)}"><button class="node-main" data-person="${esc(n.id)}" aria-label="Ouvrir la fiche de ${esc(p.name)}"><span class="node-name">${esc(p.name)}</span><span class="node-dates">${esc(p.dates || 'Dates à retrouver')}</span></button><div class="node-bottom">${badge(p.status)}${toggle}</div></article>`;
    }).join('');
    const unique = new Set(nodes.map(n => n.id)).size, known = allIds(root).size;
    $('tree-count').textContent = `${unique} fiches visibles · ${known} fiches dans cette ascendance renseignée · ${depth + 1} générations ouvertes`;
    const proofCounts = edges.reduce((counts, edge) => {
      const key = ['A', 'L'].includes(edge.status) ? 'actes' : edge.status === 'F' ? 'famille' : edge.status === 'P' ? 'pistes' : 'copies';
      counts[key]++; return counts;
    }, { actes: 0, famille: 0, copies: 0, pistes: 0 });
    $('proof-summary').textContent = `Liens affichés : ${proofCounts.actes} appuyés par un acte lu ou un livret · ${proofCounts.famille} communiqués par la famille · ${proofCounts.copies} issus de transcriptions ou relevés · ${proofCounts.pistes} à confirmer.`;
    $('zoom-label').textContent = `${Math.round(zoom * 100)} %`;
    $('live-status').textContent = `${unique} fiches visibles. Les parents sont au-dessus de leurs enfants.`;
  }
  function scrollToNode(key, smooth = true) {
    const n = layout.nodes.find(item => item.key === key);
    if (!n) return;
    const scroller = $('tree-scroll');
    scroller.scrollTo({ left: Math.max(0, (n.x + NODE_W / 2) * zoom - scroller.clientWidth / 2), top: Math.max(0, n.y * zoom - Math.max(40, (scroller.clientHeight - NODE_H * zoom) * .42)), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }
  function goOldest() {
    const candidates = layout.nodes.filter(n => n.depth === layout.depth);
    const middle = candidates[Math.floor(candidates.length / 2)];
    if (middle) scrollToNode(middle.key);
  }
  function returnToIsabelle() {
    if (!P.isabelle) return;
    if (family === 'ensemble' && root === 'isabelle') { showView('tree'); scrollToNode('root'); }
    else switchFamily('ensemble');
  }
  function changeZoom(delta) {
    const scroller = $('tree-scroll'), before = zoom;
    const cx = (scroller.scrollLeft + scroller.clientWidth / 2) / before;
    const cy = (scroller.scrollTop + scroller.clientHeight / 2) / before;
    zoom = Math.max(.5, Math.min(1.5, +(zoom + delta).toFixed(1)));
    renderTree();
    scroller.scrollTo(Math.max(0, cx * zoom - scroller.clientWidth / 2), Math.max(0, cy * zoom - scroller.clientHeight / 2));
  }

  function docCard(id, thumb = true) {
    const d = D[id]; if (!d) return '';
    const type = d.evidenceStatus && LABEL[d.evidenceStatus] ? d.evidenceStatus : d.kind === 'Acte lu' ? 'A' : d.kind === 'Document familial' ? 'F' : d.kind === 'Relevé' ? 'R' : 'T';
    const images = list(d.images);
    return `<article class="document-card"><button class="doc-button" data-doc="${esc(id)}">${thumb && images.length ? `<img class="doc-thumb" loading="lazy" src="${esc(images[0])}" alt="Aperçu de ${esc(d.title)}">` : ''}<span class="doc-title">${esc(d.title)}</span>${badge(type, d.kind)}<span class="doc-source">${esc(d.source)}</span></button></article>`;
  }
  function renderDocs() {
    const docs = Object.values(D).filter(d => family === 'ensemble' || d.family === family || d.family === 'commun');
    $('docs-description').textContent = `${docs.length} actes et références accompagnés de leur lecture. Ouvrez une notice pour les images, les explications et le PDF public.`;
    $('documents-grid').innerHTML = docs.map(d => docCard(d.id)).join('');
  }
  function renderHistoric() {
    const groups = [...list(DATA.historicGroups)].sort((a,b) => (parseInt(a.period) || 9999) - (parseInt(b.period) || 9999));
    $('historic-count').textContent = groups.length ? `${groups.length} groupes ou pistes de recherche conservés` : '';
    $('historic-grid').innerHTML = groups.length ? groups.map(g => `<article class="historic-card" id="historic-${esc(g.id)}"><span class="historic-period">${esc(g.period || 'Période à préciser')}</span><h3>${esc(g.title)}</h3><p>${esc(g.summary)}</p>${list(g.relationships).length ? `<ul>${g.relationships.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}${list(g.people).length ? `<div class="relative-links">${g.people.filter(id => P[id]).map(personButton).join('')}</div>` : ''}<p class="historic-status">Raccord à l’arbre d’Isabelle à vérifier.</p><div class="historic-sources">${list(g.docs).filter(id => D[id]).map(id => `<button data-doc="${esc(id)}">▤ ${esc(D[id].title)}</button>`).join('') || '<span>Référence détaillée à compléter dans le dossier.</span>'}</div></article>`).join('') : '<div class="no-document"><h3>Les groupes anciens ne sont pas encore rassemblés dans cette vue.</h3><p>Les références déjà disponibles restent consultables dans « Actes & explications ». Aucun raccord supplémentaire n’est supposé.</p></div>';
  }
  function showView(v) {
    view = v;
    ['tree', 'docs', 'historic'].forEach(name => {
      $(`${name}-view`).hidden = name !== v;
      $(`show-${name}`).classList.toggle('active', name === v);
      $(`show-${name}`).setAttribute('aria-pressed', String(name === v));
    });
    if (v === 'historic') renderHistoric();
    const route = new URL(location.href);
    if (v === 'tree') route.searchParams.delete('vue'); else route.searchParams.set('vue', v === 'historic' ? 'moyen-age' : 'actes');
    history.replaceState({}, '', route);
  }
  function personButton(id) { return P[id] ? `<button data-person="${esc(id)}">${esc(P[id].name)}</button>` : ''; }
  function openPerson(id) {
    if (!P[id]) return;
    if ($('person-drawer').hidden) lastFocus = document.activeElement;
    currentPerson = id;
    const p = P[id], ps = parents(id);
    let html = `<p class="eyebrow">FICHE GÉNÉALOGIQUE</p><div class="person-badges">${badge(p.status)}${p.researchGroup ? '<span class="research-badge">Mention de recherche</span>' : ''}</div><h2 id="person-title">${esc(p.name)}</h2><div class="person-date">${esc(p.dates || 'Dates non établies')}</div>`;
    html += `<dl class="person-facts"><dt>Naissance</dt><dd>${esc(p.birthPlace || 'À retrouver')}</dd><dt>Décès</dt><dd>${esc(p.deathPlace || 'À retrouver')}</dd><dt>Métier</dt><dd>${esc(p.occupation || 'À retrouver')}</dd>${p.place ? `<dt>Autres lieux</dt><dd>${esc(p.place)}</dd>` : ''}</dl>`;
    if (p.notes) html += `<div class="explanation"><p>${esc(p.notes)}</p></div>`;
    html += '<h3>Ses parents</h3>';
    html += ps.length ? ps.map(r => `<button class="parent-card" data-person="${esc(r.id)}"><span>${esc(P[r.id].name)} ${badge(r.status)}</span><small>${esc(r.reason || 'Niveau de preuve indiqué ci-dessus.')}</small></button>`).join('') : '<div class="no-document">Aucun parent supplémentaire n’est renseigné pour cette personne dans les données actuelles.</div>';
    const spouses = list(p.spouses).filter(x => P[x]), siblings = list(p.siblings).filter(x => P[x]);
    if (spouses.length) html += `<h3>Conjoint${spouses.length > 1 ? 's' : ''}</h3><div class="relative-links">${spouses.map(personButton).join('')}</div>`;
    if (siblings.length) html += `<h3>Frères et sœurs suivis</h3><div class="relative-links">${siblings.map(personButton).join('')}</div>`;
    if (list(p.otherRelations).length) html += '<h3>Autres parentés citées</h3>' + p.otherRelations.filter(r => P[r.id]).map(r => `<div class="identity-card">${esc(r.label)} ${badge(r.status)}<div class="relative-links">${personButton(r.id)}</div></div>`).join('');
    const kids = Object.values(P).filter(x => parents(x.id).some(r => r.id === id));
    if (kids.length) html += `<h3>Enfants suivis dans ce dossier</h3><div class="relative-links">${kids.map(x => personButton(x.id)).join('')}</div>`;
    const candidates = list(DATA.identityCandidates).filter(c => c.from === id || c.to === id);
    if (candidates.length) {
      html += '<h3>Rapprochements à vérifier</h3><p>Ces mentions sont conservées dans des fiches distinctes. Leur rapprochement ne constitue pas une identité établie ni une filiation.</p>';
      html += candidates.map(c => {
        const relatedDocs = list(c.docs).filter(d => D[d]);
        return `<section class="identity-card">${badge('P', LABEL[c.status] || c.status || 'À vérifier')}<div class="identity-people">${personButton(c.from)}<span aria-hidden="true">↔</span>${personButton(c.to)}</div><p>${esc(c.reason || 'Rapprochement à vérifier dans les actes.')}</p>${relatedDocs.length ? `<div class="identity-sources">${relatedDocs.map(d => `<button data-doc="${esc(d)}">▤ ${esc(D[d].title)}</button>`).join('')}</div>` : ''}</section>`;
      }).join('');
    }
    const docs = list(p.docs).filter(d => D[d]);
    html += `<h3>Actes & explications</h3>${docs.length ? docs.map(d => docCard(d)).join('') : '<div class="no-document">Aucun acte individuel n’est joint à cette fiche. Le renseignement conserve le niveau de preuve indiqué.</div>'}`;
    html += `<button class="ancestor-button" id="focus-person">Voir cette personne dans l’arbre ↑</button>`;
    $('person-content').innerHTML = html; $('person-drawer').hidden = false; $('drawer-backdrop').hidden = false;
    $('person-drawer').scrollTop = 0; document.body.style.overflow = 'hidden'; $('close-person').focus();
  }
  function closePerson() {
    const open = !$('person-drawer').hidden;
    $('person-drawer').hidden = true; $('drawer-backdrop').hidden = true;
    if ($('document-modal').hidden) document.body.style.overflow = '';
    if (open && lastFocus?.isConnected) lastFocus.focus();
  }
  function focusPerson(id) {
    if (!P[id]) return;
    root = id; setExpanded(4); $('generations').value = '4';
    closePerson(); showView('tree'); renderShell(); renderTree(); updateLocation();
    requestAnimationFrame(() => scrollToNode('root', false));
  }
  function sourceUrl(value) {
    if (!value) return '';
    try {
      const u = new URL(value, location.href);
      if (!['http:', 'https:'].includes(u.protocol) || /(^|\.)chatgpt\.com$/i.test(u.hostname)) return '';
      return u.href;
    } catch { return ''; }
  }
  function openDoc(id) {
    if (!D[id]) return;
    docFocus = document.activeElement; currentDoc = D[id]; scanIndex = 0; scanScale = 1;
    $('document-title').textContent = currentDoc.title; $('document-reading').textContent = currentDoc.reading || 'Lecture à compléter.';
    $('document-source').textContent = currentDoc.source || 'Référence à compléter.'; $('document-kind').textContent = currentDoc.kind || 'Référence';
    const url = sourceUrl(currentDoc.url);
    $('document-links').innerHTML = `<a class="local-document-link" href="fiche.html?acte=${encodeURIComponent(currentDoc.id)}">${currentDoc.pdf ? 'Lire la fiche et télécharger son PDF' : 'Lire ou imprimer la fiche'} →</a>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Consulter la source ↗</a>` : ''}${currentDoc.page ? `<p class="link-help">Repère dans le dossier de recherche : page ${esc(currentDoc.page)}.</p>` : ''}`;
    const route = new URL(location.href); route.searchParams.set('acte', id); history.replaceState({}, '', route);
    $('document-modal').hidden = false; document.body.style.overflow = 'hidden'; updateScan(); $('close-document').focus();
  }
  function updateScan() {
    if (!currentDoc) return;
    const images = list(currentDoc.images), has = images.length > 0;
    $('scan-image').hidden = !has; $('no-scan').hidden = has;
    $('scan-previous').disabled = scanIndex <= 0; $('scan-next').disabled = scanIndex >= images.length - 1;
    $('scan-page').textContent = has ? `Image ${scanIndex + 1} / ${images.length}` : 'Notice sans image';
    ['scan-minus', 'scan-plus', 'scan-fit'].forEach(id => { $(id).disabled = !has; });
    if (has) { $('scan-image').src = images[scanIndex]; $('scan-image').alt = `${currentDoc.title} — image ${scanIndex + 1}`; $('scan-image').style.width = `${100 * scanScale}%`; $('scan-viewport').scrollTo(0, 0); }
  }
  function closeDoc() {
    $('document-modal').hidden = true; currentDoc = null;
    const url = new URL(location.href); url.searchParams.delete('acte'); history.replaceState({}, '', url);
    if ($('person-drawer').hidden) document.body.style.overflow = '';
    if (docFocus?.isConnected) docFocus.focus();
  }
  function search() {
    const query = norm($('search').value.trim());
    if (!query) { hideSearch(); return; }
    const own = allIds(families[family].root);
    const tokens = query.split(/\s+/);
    const found = Object.values(P).filter(p => { const hay = norm([p.name, p.dates, p.birthPlace, p.deathPlace].join(' ')); return tokens.every(t => hay.includes(t)); }).sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)) || a.name.localeCompare(b.name, 'fr'));
    $('search-results').innerHTML = `<p class="search-summary">${found.length} résultat${found.length > 1 ? 's' : ''} dans les ${Object.keys(P).length} fiches du dossier</p>` + (found.length ? found.map(p => `<button class="search-result" data-person="${esc(p.id)}">${esc(p.name)}<small>${esc(p.dates || 'Dates à retrouver')} · ${esc(LABEL[statusCode(p.status)])}</small>${p.researchGroup ? '<span class="research-badge">Mention de recherche</span>' : ''}</button>`).join('') : '<p class="search-empty">Aucune personne trouvée. Essayez un nom ou une autre orthographe.</p>');
    $('search-results').hidden = false; $('search').setAttribute('aria-expanded', 'true');
  }
  function preparePrint() {
    const ids = allIds(root);
    $('print-content').innerHTML = `<h1>${esc(families[family].label)}</h1><p>Ascendance de ${esc(P[root].name)} — mise à jour le 10 novembre 2026.</p><p>Chaque filiation conserve son niveau de preuve. Les transcriptions, relevés et pistes sont distincts des actes originaux lus.</p>` + [...ids].map(id => {
      const p = P[id];
      return `<article><h3>${esc(p.name)}</h3><small>${esc(LABEL[statusCode(p.status)])} · ${esc(p.dates)}</small><p>Naissance : ${esc(p.birthPlace || 'À retrouver')}<br>Décès : ${esc(p.deathPlace || 'À retrouver')}<br>Métier : ${esc(p.occupation || 'À retrouver')}</p><p>${esc(p.notes)}</p>${parents(id).map(r => `<p>Parent : <b>${esc(P[r.id].name)}</b> — ${esc(LABEL[statusCode(r.status)])}. ${esc(r.reason)}</p>`).join('')}${list(p.docs).filter(d => D[d]).map(d => `<p><b>${esc(D[d].title)}</b> — ${esc(D[d].source)}<br>${esc(D[d].reading)}</p>`).join('')}</article>`;
    }).join('');
    window.print();
  }

  document.addEventListener('click', ev => {
    const target = ev.target.closest('button'); if (!target) return;
    if (target.dataset.family) { switchFamily(target.dataset.family); return; }
    if (target.dataset.person) { hideSearch(); openPerson(target.dataset.person); return; }
    if (target.dataset.toggle) {
      const id = target.dataset.toggle, key = target.closest('.node').dataset.nodeKey, opening = !expanded.has(id);
      if (opening) expanded.add(id); else expanded.delete(id);
      $('generations').value = 'custom'; renderTree();
      requestAnimationFrame(() => scrollToNode(opening ? `${key}-0` : key)); return;
    }
    if (target.dataset.doc) { openDoc(target.dataset.doc); return; }
    if (target.id === 'focus-person') focusPerson(currentPerson);
  });
  $('close-person').onclick = closePerson; $('drawer-backdrop').onclick = closePerson; $('close-document').onclick = closeDoc;
  $('show-tree').onclick = () => showView('tree');
  $('show-docs').onclick = () => { renderDocs(); showView('docs'); };
  $('show-historic').onclick = () => showView('historic');
  $('reset-root').onclick = returnToIsabelle;
  $('generations').onchange = () => { const value = $('generations').value; if (value === 'all') expandEverything(); else setExpanded(Number(value)); renderTree(); requestAnimationFrame(() => scrollToNode('root', false)); };
  $('expand-all').onclick = () => { expandEverything(); $('generations').value = 'all'; renderTree(); requestAnimationFrame(goOldest); };
  $('oldest').onclick = goOldest; $('zoom-in').onclick = () => changeZoom(.1); $('zoom-out').onclick = () => changeZoom(-.1); $('print').onclick = preparePrint;
  $('search').oninput = search;
  $('search').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('search-results').querySelector('button')?.click(); } if (ev.key === 'ArrowDown') { ev.preventDefault(); $('search-results').querySelector('button')?.focus(); } };
  $('scan-previous').onclick = () => { if (currentDoc && scanIndex > 0) { scanIndex--; scanScale = 1; updateScan(); } };
  $('scan-next').onclick = () => { if (currentDoc && scanIndex < list(currentDoc.images).length - 1) { scanIndex++; scanScale = 1; updateScan(); } };
  $('scan-minus').onclick = () => { scanScale = Math.max(.4, scanScale - .25); $('scan-image').style.width = `${scanScale * 100}%`; };
  $('scan-plus').onclick = () => { scanScale = Math.min(4, scanScale + .25); $('scan-image').style.width = `${scanScale * 100}%`; };
  $('scan-fit').onclick = () => { scanScale = 1; updateScan(); };
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { if (!$('document-modal').hidden) closeDoc(); else if (!$('person-drawer').hidden) closePerson(); else hideSearch(); }
    if (ev.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { ev.preventDefault(); $('search').focus(); }
    if (ev.key === 'Tab') {
      const container = !$('document-modal').hidden ? $('document-modal') : !$('person-drawer').hidden ? $('person-drawer') : null;
      if (container) {
        const focusable = [...container.querySelectorAll('button:not([disabled]),a[href],input,select')].filter(e => e.getClientRects().length);
        if (focusable.length && ev.shiftKey && document.activeElement === focusable[0]) { ev.preventDefault(); focusable.at(-1).focus(); }
        else if (focusable.length && !ev.shiftKey && document.activeElement === focusable.at(-1)) { ev.preventDefault(); focusable[0].focus(); }
      }
    }
  });
  document.addEventListener('click', ev => { if (!ev.target.closest('.search-box') && !ev.target.closest('#search-results')) hideSearch(); });
  let drag = null;
  const scroller = $('tree-scroll');
  scroller.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0 || ev.target.closest('.node')) return;
    drag = { x: ev.clientX, y: ev.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.setPointerCapture(ev.pointerId); scroller.classList.add('panning');
  });
  scroller.addEventListener('pointermove', ev => { if (drag) { scroller.scrollLeft = drag.left - (ev.clientX - drag.x); scroller.scrollTop = drag.top - (ev.clientY - drag.y); } });
  const stopDrag = () => { drag = null; scroller.classList.remove('panning'); };
  scroller.addEventListener('pointerup', stopDrag); scroller.addEventListener('pointercancel', stopDrag);
  const initial = new URLSearchParams(location.search);
  if (initial.get('racine') && P[initial.get('racine')]) root = initial.get('racine');
  setExpanded(4); renderShell(); renderTree(); renderDocs(); renderHistoric();
  if (initial.get('vue') === 'moyen-age') showView('historic');
  if (initial.get('vue') === 'actes') showView('docs');
  requestAnimationFrame(() => scrollToNode('root', false));
  if (P[initial.get('personne')]) openPerson(initial.get('personne'));
  if (D[initial.get('acte')]) openDoc(initial.get('acte'));
})();
