/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — rendu.js
   Le dessin des « calques » (textes et images posés par-dessus la
   vidéo) sur une toile (canvas).

   ⚠️ Ce même dessin sert DEUX fois :
   - pour l'aperçu, pendant le montage ;
   - pour la vidéo finale, à l'export.
   Ce qu'on voit dans l'aperçu est donc exactement ce qui sortira dans
   le fichier MP4. Toutes les tailles sont des fractions de l'image :
   le résultat est le même en 720p, en 1080p, et dans l'aperçu.
   ============================================================ */
'use strict';

/* Les polices proposées. Les trois premières sont rangées dans
   l'application (elles marchent hors ligne) ; les deux dernières sont
   celles de la tablette. */
const POLICES = {
  oxanium:   { libelle: 'Moderne',          famille: '"Oxanium", "Trebuchet MS", sans-serif' },
  literata:  { libelle: 'Élégante',         famille: '"Literata", Georgia, serif' },
  mono:      { libelle: 'Machine à écrire', famille: '"JetBrains Mono", monospace' },
  simple:    { libelle: 'Simple',           famille: 'Roboto, "Noto Sans", system-ui, sans-serif' },
  classique: { libelle: 'Classique',        famille: '"Noto Serif", Georgia, "Times New Roman", serif' }
};

/* Les couleurs de texte proposées. Dans la VIDÉO, le blanc et le noir
   purs sont permis (c'est le contenu, pas l'interface). */
const COULEURS_TEXTE = [
  { valeur: '#ffffff', nom: 'Blanc' },
  { valeur: '#ffd84d', nom: 'Jaune' },
  { valeur: '#a777ff', nom: 'Violet' },
  { valeur: '#ff7eb6', nom: 'Rose' },
  { valeur: '#5fb4ff', nom: 'Bleu' },
  { valeur: '#6fdc8c', nom: 'Vert' },
  { valeur: '#ff5a4a', nom: 'Rouge' },
  { valeur: '#111111', nom: 'Noir' }
];

const NOMS_STYLES = { ombre: 'Ombre', contour: 'Contour', bandeau: 'Bandeau', aucun: 'Aucun' };

const DUREE_FONDU_CALQUE = 0.4;   // secondes d'apparition / disparition douce
const MARGE_CALQUE = 0.04;        // un calque ne sort jamais du cadre (4 % de marge)

const Rendu = {
  /* Images incrustées déjà prêtes à dessiner (numéro du média → image) */
  _images: new Map(),
  _enChargement: new Set(),

  /* Les polices de l'application ne sont chargées par le navigateur que
     lorsqu'une page les utilise. La toile, elle, ne les attend pas : on
     les charge donc toutes dès le démarrage. */
  async chargerPolices() {
    if (!document.fonts || !document.fonts.load) return;
    const demandes = [];
    ['Oxanium', 'Literata', 'JetBrains Mono'].forEach((nom) => {
      ['400', '700'].forEach((graisse) => demandes.push(document.fonts.load(graisse + ' 32px "' + nom + '"')));
    });
    await Promise.all(demandes).catch(() => {});
  },

  /* L'image d'un média, prête à dessiner. Si elle n'est pas encore
     prête, on la prépare et on appelle « quandPrete » ensuite. */
  image(media, quandPrete) {
    if (this._images.has(media.id)) return this._images.get(media.id);
    if (!this._enChargement.has(media.id)) {
      const fichier = Medias.fichiers.get(media.id);
      if (fichier) {
        this._enChargement.add(media.id);
        createImageBitmap(fichier)
          .then((img) => { this._images.set(media.id, img); if (quandPrete) quandPrete(); })
          .catch(() => {})
          .finally(() => this._enChargement.delete(media.id));
      }
    }
    return null;
  },

  /* Libère la mémoire des images (projet fermé) */
  oublierImages() {
    this._images.forEach((img) => { if (img.close) img.close(); });
    this._images.clear();
  },

  /* Les calques visibles à l'instant t */
  actifs(projet, t) {
    return projet.calques.filter((c) => t >= c.debut && t < c.debut + c.duree);
  },

  /* Opacité d'un calque à l'instant t (fondu au début et à la fin) */
  opacite(calque, t) {
    if (!calque.fondu) return 1;
    const fondu = Math.min(DUREE_FONDU_CALQUE, calque.duree / 3);
    return borner(Math.min((t - calque.debut) / fondu, (calque.debut + calque.duree - t) / fondu), 0, 1);
  },

  /* ---------- Dessiner tous les calques de l'instant t ----------
     ctx : la toile ; largeur / hauteur : sa taille en pixels.
     options.selection : numéro d'un calque à entourer (aperçu seulement).
     options.quandPret : à appeler quand une image devient prête.
     Renvoie la place de chaque calque dessiné, pour savoir lequel on
     touche du doigt dans l'aperçu. */
  dessiner(ctx, largeur, hauteur, projet, t, options) {
    const opts = options || {};
    const places = [];
    const actifs = this.actifs(projet, t);
    // Les images d'abord, les textes par-dessus (toujours lisibles)
    const ordre = actifs.filter((c) => c.type === 'image').concat(actifs.filter((c) => c.type === 'texte'));
    for (const calque of ordre) {
      const alpha = this.opacite(calque, t);
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      let place = null;
      if (calque.type === 'texte') {
        place = this.dessinerTexte(ctx, largeur, hauteur, calque);
      } else {
        const media = projet.medias.find((m) => m.id === calque.mediaId);
        const img = media ? this.image(media, opts.quandPret) : null;
        if (img) place = this.dessinerImage(ctx, largeur, hauteur, calque, img);
      }
      ctx.restore();
      if (place) {
        places.push(Object.assign({ id: calque.id }, place));
        if (opts.selection === calque.id) this._cadreSelection(ctx, place, hauteur);
      }
    }
    return places;
  },

  /* Place un rectangle centré sur (x, y), sans sortir du cadre */
  _placer(calque, largeur, hauteur, l, h) {
    const mx = largeur * MARGE_CALQUE;
    const my = hauteur * MARGE_CALQUE;
    const x = borner(calque.x * largeur - l / 2, mx, Math.max(mx, largeur - mx - l));
    const y = borner(calque.y * hauteur - h / 2, my, Math.max(my, hauteur - my - h));
    return { x, y, l, h };
  },

  /* ---------- Un texte ---------- */
  dessinerTexte(ctx, largeur, hauteur, calque) {
    const texte = calque.texte.trim();
    if (!texte) return null;
    // La taille est un pourcentage du CÔTÉ LE PLUS COURT de l'image : un
    // texte garde le même air en horizontal (16:9) et en vertical (9:16).
    let taille = Math.max(6, Math.round(Math.min(largeur, hauteur) * calque.taille / 100));
    const police = POLICES[calque.police] || POLICES.oxanium;
    const graisse = calque.gras ? '700 ' : '400 ';
    ctx.font = graisse + taille + 'px ' + police.famille;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Coupe le texte en lignes qui tiennent dans la largeur de l'image
    const largeurMax = () => largeur * (1 - 2 * MARGE_CALQUE) - taille * 0.8;
    let lignes = this._lignes(ctx, texte, largeurMax());
    let largeurTexte = Math.max(...lignes.map((l) => ctx.measureText(l).width));
    // Un mot à lui seul plus large que l'image : on réduit le texte pour qu'il tienne
    if (largeurTexte > largeurMax()) {
      taille = Math.max(6, Math.floor(taille * largeurMax() / largeurTexte));
      ctx.font = graisse + taille + 'px ' + police.famille;
      lignes = this._lignes(ctx, texte, largeurMax());
      largeurTexte = Math.max(...lignes.map((l) => ctx.measureText(l).width));
    }
    const interligne = taille * 1.25;
    const bord = calque.style === 'bandeau' ? taille * 0.35 : taille * 0.12;
    const place = this._placer(calque, largeur, hauteur,
      largeurTexte + 2 * bord, lignes.length * interligne + 2 * bord - (interligne - taille));
    const cx = place.x + place.l / 2;
    const premier = place.y + bord + taille / 2;

    const clair = luminosite(calque.couleur) > 0.45;
    if (calque.style === 'bandeau') {
      ctx.fillStyle = clair ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.75)';
      ctx.beginPath();
      ctx.roundRect(place.x, place.y, place.l, place.h, taille * 0.25);
      ctx.fill();
    }
    if (calque.style === 'ombre') {
      ctx.shadowColor = clair ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.7)';
      ctx.shadowBlur = taille * 0.18;
      ctx.shadowOffsetY = taille * 0.05;
    }
    if (calque.style === 'contour') {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, taille * 0.14);
      ctx.strokeStyle = clair ? '#000000' : '#ffffff';
      lignes.forEach((l, i) => ctx.strokeText(l, cx, premier + i * interligne));
    }
    ctx.fillStyle = calque.couleur;
    lignes.forEach((l, i) => ctx.fillText(l, cx, premier + i * interligne));
    return place;
  },

  /* Coupe un texte en lignes : on respecte les retours à la ligne tapés,
     et on coupe entre deux mots quand une ligne est trop longue. */
  _lignes(ctx, texte, largeurMax) {
    const resultat = [];
    // Typographie française : « ! ? : ; » et les guillemets ne se
    // retrouvent jamais seuls en début de ligne (espace insécable)
    const francais = texte.replace(/ +([!?:;»])/g, ' $1').replace(/« +/g, '« ');
    francais.split('\n').forEach((paragraphe) => {
      const mots = paragraphe.split(/[ \t]+/).filter(Boolean);
      if (!mots.length) { resultat.push(''); return; }
      let ligne = mots[0];
      for (let i = 1; i < mots.length; i++) {
        const essai = ligne + ' ' + mots[i];
        if (ctx.measureText(essai).width <= largeurMax) ligne = essai;
        else { resultat.push(ligne); ligne = mots[i]; }
      }
      resultat.push(ligne);
    });
    return resultat;
  },

  /* ---------- Une image ---------- */
  dessinerImage(ctx, largeur, hauteur, calque, img) {
    const l = largeur * calque.largeur / 100;
    const h = l * img.height / img.width;
    const place = this._placer(calque, largeur, hauteur, l, h);
    ctx.drawImage(img, place.x, place.y, place.l, place.h);
    return place;
  },

  /* Cadre pointillé autour du calque qu'on modifie (aperçu seulement,
     jamais dans la vidéo finale) */
  _cadreSelection(ctx, place, hauteur) {
    ctx.save();
    const e = Math.max(2, hauteur / 200);
    ctx.lineWidth = e;
    ctx.setLineDash([e * 4, e * 3]);
    ctx.strokeStyle = '#d6c2ff';
    ctx.shadowColor = '#a777ff';
    ctx.shadowBlur = e * 4;
    ctx.strokeRect(place.x - e * 2, place.y - e * 2, place.l + e * 4, place.h + e * 4);
    ctx.restore();
  }
};

/* Clarté d'une couleur (0 = noir, 1 = blanc), pour choisir une ombre ou
   un contour qui ressort : sombre sous un texte clair, et inversement. */
function luminosite(couleur) {
  const n = parseInt(couleur.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
