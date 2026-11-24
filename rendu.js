/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — rendu.js
   Le dessin des « calques » (textes et images posés par-dessus la
   vidéo) et des sous-titres sur une toile (canvas).

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

/* Les sous-titres : taille (en % du côté le plus court), place (0 = en
   haut, 1 = en bas) et marge plus large que celle des textes, pour rester
   loin des bords de l'écran. */
const TAILLE_SOUS_TITRES = { petite: 4, normale: 5, grande: 6.5 };
const Y_SOUS_TITRES = { bas: 1, releve: 0.74, haut: 0 };
const MARGE_SOUS_TITRES = 0.07;
const CACHE_TEXTES_MAX = 24;   // nombre de textes/sous-titres déjà dessinés gardés en mémoire

const Rendu = {
  /* Images incrustées déjà prêtes à dessiner (numéro du média → image) */
  _images: new Map(),
  _enChargement: new Set(),
  _generation: 0,
  /* Textes et sous-titres déjà dessinés sur une petite toile : évite de
     recalculer les lignes et les ombres 30 fois par seconde pour un texte
     qui ne change pas. */
  _cacheTextes: new Map(),

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
    // Une police vient peut-être d'arriver : on redessinera les textes en cache avec la bonne police
    this._viderCacheTextes();
  },

  /* L'image d'un média, prête à dessiner. Si elle n'est pas encore
     prête, on la prépare et on appelle « quandPrete » ensuite. */
  image(media, quandPrete) {
    if (this._images.has(media.id)) return this._images.get(media.id);
    if (!this._enChargement.has(media.id)) {
      const fichier = Medias.fichiers.get(media.id);
      if (fichier) {
        const gen = this._generation;
        this._enChargement.add(media.id);
        createImageBitmap(fichier)
          .then((img) => {
            if (gen !== this._generation || !this._enChargement.has(media.id) || this._images.has(media.id)) {
              if (img && img.close) img.close();
              return;
            }
            this._images.set(media.id, img);
            if (quandPrete) quandPrete();
          })
          .catch(() => {})
          .finally(() => {
            if (gen === this._generation) this._enChargement.delete(media.id);
          });
      }
    }
    return null;
  },

  /* Prépare TOUTES les images du projet (incrustées et clips) avant
     l'export : chaque image de la vidéo finale doit être complète dès la
     première fois, sans attendre. */
  async preparerImages(projet) {
    const gen = this._generation;
    const ids = new Set();
    projet.calques.forEach((c) => { if (c.type === 'image') ids.add(c.mediaId); });
    projet.clips.forEach((c) => {
      const media = projet.medias.find((m) => m.id === c.mediaId);
      if (media && media.type === 'image') ids.add(media.id);
    });
    await Promise.all(Array.from(ids).map(async (id) => {
      const fichier = Medias.fichiers.get(id);
      if (this._images.has(id) || !fichier) return;
      try {
        const img = await createImageBitmap(fichier);
        if (gen !== this._generation || this._images.has(id)) {
          if (img && img.close) img.close();
          return;
        }
        this._images.set(id, img);
      } catch (e) { /* image illisible : ignorée */ }
    }));
  },

  /* Libère une seule image en mémoire (quand on retire un fichier du projet) */
  oublierImage(id) {
    this._enChargement.delete(id);
    const img = this._images.get(id);
    if (img && img.close) img.close();
    this._images.delete(id);
  },

  /* Vide le cache des textes déjà dessinés (libère les petites toiles) */
  _viderCacheTextes() {
    this._cacheTextes.forEach((e) => libererToile(e.toile));
    this._cacheTextes.clear();
  },

  /* Libère la mémoire des images et des textes en cache (projet fermé) */
  oublierImages() {
    this._generation++;
    this._enChargement.clear();
    this._images.forEach((img) => { if (img.close) img.close(); });
    this._images.clear();
    this._viderCacheTextes();
  },

  /* Les calques visibles à l'instant t */
  actifs(projet, t) {
    if (!projet.calques.length) return [];
    const resultat = [];
    for (let i = 0; i < projet.calques.length; i++) {
      const c = projet.calques[i];
      if (t >= c.debut && t < c.debut + c.duree) resultat.push(c);
    }
    return resultat;
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
     options.mediasParId : table rapide numéro → média (export).
     Renvoie la place de chaque calque dessiné, pour savoir lequel on
     touche du doigt dans l'aperçu. */
  dessiner(ctx, largeur, hauteur, projet, t, options) {
    const opts = options || {};
    const places = [];
    const actifs = this.actifs(projet, t);
    if (actifs.length) {
      // Les images d'abord, les textes par-dessus (toujours lisibles)
      const ordre = actifs.length === 1
        ? actifs
        : actifs.filter((c) => c.type === 'image').concat(actifs.filter((c) => c.type === 'texte'));
      for (const calque of ordre) {
        const alpha = this.opacite(calque, t);
        if (alpha <= 0) continue;
        ctx.save();
        ctx.globalAlpha = alpha;
        let place = null;
        if (calque.type === 'texte') {
          place = this.dessinerTexte(ctx, largeur, hauteur, calque);
        } else {
          const media = opts.mediasParId
            ? opts.mediasParId.get(calque.mediaId)
            : projet.medias.find((m) => m.id === calque.mediaId);
          const img = media ? this.image(media, opts.quandPret) : null;
          if (img) place = this.dessinerImage(ctx, largeur, hauteur, calque, img);
        }
        ctx.restore();
        if (place) {
          places.push(Object.assign({ id: calque.id }, place));
          if (opts.selection === calque.id) this._cadreSelection(ctx, place, hauteur);
        }
      }
    }
    // Les sous-titres en dernier : toujours par-dessus tout le reste
    const sousTitre = this.dessinerSousTitres(ctx, largeur, hauteur, projet, t, opts.selection);
    if (sousTitre) {
      places.push(sousTitre);
      if (opts.selection === sousTitre.id) this._cadreSelection(ctx, sousTitre, hauteur);
    }
    return places;
  },

  /* ---------- Les sous-titres ---------- */

  /* Les sous-titres à l'écran à l'instant t (aucun s'ils sont cachés).
     La liste étant toujours triée par « debut » (et un sous-titre durant
     60 s au plus), une recherche rapide saute tout de suite près de t. */
  sousTitresActifs(projet, t) {
    const liste = projet.sousTitres;
    if (!liste || !liste.length || !projet.styleSousTitres.visibles) return [];
    const limite = t - 60;
    let a = 0, b = liste.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (liste[m].debut <= limite) a = m + 1;
      else b = m;
    }
    const resultat = [];
    for (let i = a; i < liste.length; i++) {
      const s = liste[i];
      if (s.debut > t) break;
      if (t < s.debut + s.duree && s.texte.trim()) resultat.push(s);
    }
    return resultat;
  },

  /* Dessine les sous-titres de l'instant t (s'il y en a deux en même
     temps, l'un au-dessus de l'autre). Ils sont dessinés comme un texte,
     avec une police simple et très lisible, centrés. */
  dessinerSousTitres(ctx, largeur, hauteur, projet, t, selection) {
    const actifs = this.sousTitresActifs(projet, t);
    if (!actifs.length) return null;
    const style = projet.styleSousTitres;
    ctx.save();
    const place = this.dessinerTexte(ctx, largeur, hauteur, {
      texte: actifs.length === 1 ? actifs[0].texte.trim() : actifs.map((s) => s.texte.trim()).join('\n'),
      police: 'simple',
      taille: TAILLE_SOUS_TITRES[style.taille],
      couleur: style.couleur,
      style: style.fond,
      gras: style.fond === 'contour',
      x: 0.5,
      y: Y_SOUS_TITRES[style.place],
      marge: MARGE_SOUS_TITRES
    });
    ctx.restore();
    if (!place) return null;
    const id = actifs.some((s) => s.id === selection) ? selection : actifs[0].id;
    return Object.assign({ id, sousTitre: true }, place);
  },

  /* Place un rectangle centré sur (x, y), sans sortir du cadre */
  _placer(calque, largeur, hauteur, l, h) {
    const marge = calque.marge || MARGE_CALQUE;
    const mx = largeur * marge;
    const my = hauteur * marge;
    const x = borner(calque.x * largeur - l / 2, mx, Math.max(mx, largeur - mx - l));
    const y = borner(calque.y * hauteur - h / 2, my, Math.max(my, hauteur - my - h));
    return { x, y, l, h };
  },

  /* Prépare une petite toile avec le texte déjà dessiné (lignes, bandeau,
     ombre ou contour). Réutilisée à l'identique tant que le texte et son
     style ne changent pas : un simple drawImage suffit ensuite. */
  _preparerTexte(largeur, hauteur, calque, texte) {
    const marge = calque.marge || MARGE_CALQUE;
    const cle = largeur + 'x' + hauteur + '|' + calque.police + '|' + calque.taille + '|' +
      calque.couleur + '|' + calque.style + '|' + (calque.gras ? 1 : 0) + '|' + marge + '|' + texte;
    const existant = this._cacheTextes.get(cle);
    if (existant) {
      // Marque cette entrée comme la plus récente
      this._cacheTextes.delete(cle);
      this._cacheTextes.set(cle, existant);
      return existant;
    }

    // Une petite toile 1×1 réutilisée pour mesurer les mots avant de créer la toile finale
    if (!this._ctxMesure) {
      const m = document.createElement('canvas');
      m.width = 1; m.height = 1;
      this._ctxMesure = m.getContext('2d');
    }
    const mesure = this._ctxMesure;

    // La taille est un pourcentage du CÔTÉ LE PLUS COURT de l'image : un
    // texte garde le même air en horizontal (16:9) et en vertical (9:16).
    let taille = Math.max(6, Math.round(Math.min(largeur, hauteur) * calque.taille / 100));
    const police = POLICES[calque.police] || POLICES.oxanium;
    const graisse = calque.gras ? '700 ' : '400 ';
    mesure.font = graisse + taille + 'px ' + police.famille;

    // Coupe le texte en lignes qui tiennent dans la largeur de l'image
    const largeurMax = () => largeur * (1 - 2 * marge) - taille * 0.8;
    let lignes = this._lignes(mesure, texte, largeurMax());
    let largeurTexte = Math.max(...lignes.map((l) => mesure.measureText(l).width));
    // Un mot à lui seul plus large que l'image : on réduit le texte pour qu'il tienne
    if (largeurTexte > largeurMax()) {
      taille = Math.max(6, Math.floor(taille * largeurMax() / largeurTexte));
      mesure.font = graisse + taille + 'px ' + police.famille;
      lignes = this._lignes(mesure, texte, largeurMax());
      largeurTexte = Math.max(...lignes.map((l) => mesure.measureText(l).width));
    }
    const interligne = taille * 1.25;
    const bord = calque.style === 'bandeau' ? taille * 0.35 : taille * 0.12;
    const l = largeurTexte + 2 * bord;
    const h = lignes.length * interligne + 2 * bord - (interligne - taille);
    // Petite marge autour de la toile pour ne jamais couper l'ombre ni le contour
    const pad = Math.ceil(taille * 0.65) + 4;
    const toile = document.createElement('canvas');
    toile.width = Math.max(1, Math.ceil(l + 2 * pad));
    toile.height = Math.max(1, Math.ceil(h + 2 * pad));
    const c = toile.getContext('2d');

    c.font = graisse + taille + 'px ' + police.famille;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const cx = pad + l / 2;
    const premier = pad + bord + taille / 2;
    const clair = luminosite(calque.couleur) > 0.45;
    if (calque.style === 'bandeau') {
      c.fillStyle = clair ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.75)';
      c.beginPath();
      c.roundRect(pad, pad, l, h, taille * 0.25);
      c.fill();
    }
    if (calque.style === 'ombre') {
      c.shadowColor = clair ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.7)';
      c.shadowBlur = taille * 0.18;
      c.shadowOffsetY = taille * 0.05;
    }
    if (calque.style === 'contour') {
      c.lineJoin = 'round';
      c.lineWidth = Math.max(2, taille * 0.14);
      c.strokeStyle = clair ? '#000000' : '#ffffff';
      lignes.forEach((ligne, i) => c.strokeText(ligne, cx, premier + i * interligne));
    }
    c.fillStyle = calque.couleur;
    lignes.forEach((ligne, i) => c.fillText(ligne, cx, premier + i * interligne));

    const entree = { toile, l, h, pad };
    this._cacheTextes.set(cle, entree);
    if (this._cacheTextes.size > CACHE_TEXTES_MAX) {
      const plusAncienne = this._cacheTextes.keys().next().value;
      const vieille = this._cacheTextes.get(plusAncienne);
      if (vieille) libererToile(vieille.toile);
      this._cacheTextes.delete(plusAncienne);
    }
    return entree;
  },

  /* ---------- Un texte ---------- */
  dessinerTexte(ctx, largeur, hauteur, calque) {
    const texte = calque.texte.trim();
    if (!texte) return null;
    const entree = this._preparerTexte(largeur, hauteur, calque, texte);
    const place = this._placer(calque, largeur, hauteur, entree.l, entree.h);
    ctx.drawImage(entree.toile, place.x - entree.pad, place.y - entree.pad);
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
