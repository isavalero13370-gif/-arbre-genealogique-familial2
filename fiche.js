(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('acte');
  const d = window.GENEALOGY.documents[id];
  if (!d) {
    $('titre').textContent = 'Fiche introuvable';
    $('lecture').textContent = 'Revenez à l’arbre et choisissez une pièce dans « Actes & explications ».';
    return;
  }
  document.title = d.title + ' — L’arbre d’Isabelle';
  $('titre').textContent = d.title;
  $('preuve').textContent = d.kind;
  $('lecture').textContent = d.reading;
  $('reference').textContent = d.source;
  $('retour').href = './?famille=' + (d.family === 'maggiore' ? 'maggiore' : 'bonnefond') + '&acte=' + encodeURIComponent(d.id);
  $('actions').hidden = false;
  $('imprimer').onclick = () => window.print();
  if (d.pdf) {
    $('pdf').href = d.pdf;
    $('pdf-open').href = d.pdf;
    $('pdf').download = d.id + '.pdf';
    $('pdf-note').hidden = false;
    $('pdf-note').textContent = d.id.includes('_pdf_') || (d.pdf || '').includes('_pdf_')
      ? 'Ce PDF conserve la page correspondante du dossier, avec sa lecture, ses références et les reproductions qui y figurent.'
      : 'Ce PDF reprend la lecture et les références de cette pièce. Les reproductions disponibles sont présentées ci-dessous.';
  } else {
    $('pdf').hidden = true;
    $('pdf-open').hidden = true;
  }
  if (d.url) {
    $('source').href = d.url;
    $('adresse-source').value = d.url;
    $('source-fallback').hidden = false;
  } else $('source').hidden = true;
  if (d.page) $('repere').textContent = 'Repère dans le dossier complet : page ' + d.page + '.';
  if (d.images?.length) {
    const h = document.createElement('h2');
    h.textContent = 'Reproductions disponibles';
    $('images').append(h);
    d.images.forEach((src, i) => {
      const figure = document.createElement('figure');
      const link = document.createElement('a');
      link.href = src; link.target = '_blank'; link.rel = 'noopener';
      const img = document.createElement('img');
      img.src = src; img.alt = d.title + ' — reproduction ' + (i + 1); img.loading = 'lazy';
      link.append(img);
      const caption = document.createElement('figcaption');
      caption.textContent = 'Image ' + (i + 1) + ' / ' + d.images.length + ' — touchez l’image pour l’ouvrir. Reproduction du dossier, sans reconstitution d’écriture.';
      figure.append(link, caption); $('images').append(figure);
    });
  } else {
    $('images').textContent = d.pdf
      ? 'Consultez le PDF et la source pour les pièces disponibles.'
      : 'Cette référence ne comporte pas encore de reproduction jointe.';
  }
  $('copier-source').onclick = async () => {
    try {
      await navigator.clipboard.writeText(d.url);
      $('copie-status').textContent = 'Adresse copiée.';
    } catch {
      $('adresse-source').focus(); $('adresse-source').select();
      $('copie-status').textContent = 'Sélectionnez puis copiez l’adresse affichée ci-dessus.';
    }
  };
})();
