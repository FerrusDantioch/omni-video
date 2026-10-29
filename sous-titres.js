/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — sous-titres.js
   Les sous-titres : ce qui est dit, écrit en bas de l'image.
   - On les écrit à la main (un par un, à la ligne violette), ou on
     importe un fichier .srt ou .vtt (fait par YouTube, par un autre
     logiciel…).
   - Ils ont tous la même apparence (taille, place, fond, couleur).
   - Ils sont dessinés par rendu.js, comme les textes : l'aperçu montre
     exactement ce qui sera incrusté dans la vidéo finale.
   - On peut aussi les enregistrer en fichier .srt (pour YouTube).
   ============================================================ */
'use strict';

const DUREE_SOUS_TITRE_DEFAUT = 3;            // secondes
const TAILLE_FICHIER_SOUS_TITRES_MAX = 5 * 1024 * 1024;   // un fichier de sous-titres est tout petit


/* ---------- Lire un fichier .srt ou .vtt ----------
   Les deux formats se ressemblent : des blocs séparés par une ligne vide,
   chacun avec une ligne de temps « 00:00:01,000 --> 00:00:04,000 » suivie
   du texte. Le .vtt commence par « WEBVTT », a un point au lieu de la
   virgule, et les heures y sont facultatives. */

const MOTIF_TEMPS = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/;

/* « 01:02:03,500 » → 3723,5 secondes */
function lireTemps(texte) {
  return texte.replace(',', '.').split(':').reduce((total, morceau) => total * 60 + Number(morceau), 0);
}

/* Nettoie le texte d'un sous-titre : enlève les balises (<i>, <b>,
   <font>, <v Nom>, {\an8}…) et remet les caractères spéciaux (&amp;…). */
function nettoyerTexteSousTitre(lignes) {
  const entites = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
  return lignes
    .map((l) => l
      .replace(/\\N/g, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, nom) => {
        if (nom[0] === '#') {
          const code = nom[1] === 'x' || nom[1] === 'X' ? parseInt(nom.slice(2), 16) : parseInt(nom.slice(1), 10);
          return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
        }
        return entites[nom.toLowerCase()] !== undefined ? entites[nom.toLowerCase()] : tout;
      }))
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/* Lit le texte d'un fichier .srt ou .vtt. Renvoie la liste des sous-titres
   trouvés : [{ debut, duree, texte }]. Ce qui n'est pas compris est ignoré. */
function lireSousTitres(contenu) {
  const lignes = contenu.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const resultat = [];
  let i = 0;
  while (i < lignes.length) {
    const m = MOTIF_TEMPS.exec(lignes[i]);
    i++;
    if (!m) continue;
    const debut = lireTemps(m[1]);
    const fin = lireTemps(m[2]);
    const texte = [];
    while (i < lignes.length && lignes[i].trim() !== '' && !MOTIF_TEMPS.test(lignes[i])) {
      // Fichier mal rangé (pas de ligne vide) : le numéro du bloc suivant n'est pas du texte
      if (/^\d+$/.test(lignes[i].trim()) && MOTIF_TEMPS.test(lignes[i + 1] || '')) break;
      texte.push(lignes[i]);
      i++;
    }
    const propre = nettoyerTexteSousTitre(texte);
    if (!propre || !Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) continue;
    resultat.push({ debut, duree: fin - debut, texte: propre });
  }
  return resultat;
}

/* Lit un fichier texte, quelle que soit la façon dont il a été enregistré :
   UTF-8 (le plus courant), UTF-16, ou l'ancien format de Windows (souvent
   utilisé pour les sous-titres en français, avec les accents). */
async function lireFichierTexte(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  if (octets[0] === 0xFF && octets[1] === 0xFE) return new TextDecoder('utf-16le').decode(octets);
  if (octets[0] === 0xFE && octets[1] === 0xFF) return new TextDecoder('utf-16be').decode(octets);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

/* 3723,5 → « 01:02:03,500 » (le format des fichiers .srt) */
function tempsSrt(secondes) {
  const ms = Math.max(0, Math.round(secondes * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return deuxChiffres(h) + ':' + deuxChiffres(m) + ':' + deuxChiffres(s) + ',' + String(ms % 1000).padStart(3, '0');
}


const SousTitres = {
  edite: null,           // numéro du sous-titre qu'on modifie (ou null)
  _dejaMemorise: false,  // une seule étape « Annuler » par séance de modification
  _arretA: null,         // « Écouter ce passage » : la lecture s'arrête à cet instant

  initialiser() {
    $('#st-texte').addEventListener('input', (e) => this.changer('texte', e.target.value, true));
    $('#st-visibles').addEventListener('change', (e) => this.changerStyle('visibles', e.target.checked));

    Lecteur.surChangement(() => {
      // Fin du passage écouté : pause
      if (this._arretA !== null) {
        if (!Lecteur.enLecture) this._arretA = null;
        else if (Lecteur.t >= this._arretA) { this._arretA = null; Lecteur.pause(); }
      }
      this._majEnCours();
    });
  },

  trouver(id) {
    const projet = Projets.courant;
    return projet && id ? projet.sousTitres.find((s) => s.id === id) || null : null;
  },

  /* Remet la liste dans l'ordre du temps */
  _trier() {
    Projets.courant.sousTitres.sort((a, b) => a.debut - b.debut);
  },

  /* Après chaque modification : enregistrer et redessiner */
  _apresModification(listeAussi) {
    Projets.modifie();
    Incrustations.redessiner(true);
    Chronologie.dessinerSousTitres();
    if (listeAussi) this.afficherListe();
    if (this.edite) this.majEditeur();
  },

  /* ---------- Ajouter ---------- */

  /* Un nouveau sous-titre commence à l'instant t. S'il y a déjà un
     sous-titre à cet endroit, il s'arrête là (on écrit la suite de ce qui
     est dit). Le nouveau dure 3 s, ou moins si le suivant arrive avant. */
  _creer(t) {
    const projet = Projets.courant;
    if (projet.sousTitres.length >= SOUS_TITRES_MAX) {
      Message.probleme('Il y a déjà ' + SOUS_TITRES_MAX + ' sous-titres : c\'est le maximum.');
      return null;
    }
    const enCours = projet.sousTitres.find((s) => t > s.debut && t < s.debut + s.duree);
    this._raccourci = null;
    if (enCours && t - enCours.debut >= DUREE_SOUS_TITRE_MIN) {
      this._raccourci = { st: enCours, duree: enCours.duree };   // pour le remettre si le nouveau reste vide
      enCours.duree = t - enCours.debut;
    }
    const suivant = projet.sousTitres.find((s) => s.debut > t + 0.01);
    let duree = DUREE_SOUS_TITRE_DEFAUT;
    if (suivant && suivant.debut - t >= 0.5) duree = Math.min(duree, suivant.debut - t);
    const st = nettoyerSousTitre({ id: nouvelId(), debut: t, duree, texte: '' });
    projet.sousTitres.push(st);
    this._trier();
    return st;
  },

  ajouter() {
    const projet = Projets.courant;
    if (!projet) return;
    Lecteur.pause();
    Chronologie._memoriser();
    const total = Lecteur.duree();
    const t = total > 0 && Lecteur.t > total - 0.5 ? Math.max(0, total - DUREE_SOUS_TITRE_DEFAUT) : Lecteur.t;
    const st = this._creer(t);
    if (!st) return;
    this._ouvrirNouveau(st);
  },

  /* « Ajouter le sous-titre d'après » : il commence à la fin de celui-ci */
  ajouterSuivant() {
    const actuel = this.trouver(this.edite);
    if (!actuel) return;
    Lecteur.pause();
    if (!actuel.texte.trim()) { $('#st-texte').focus(); Message.montrer('Écris d\'abord ce sous-titre-ci.'); return; }
    Chronologie._memoriser();
    const st = this._creer(actuel.debut + actuel.duree);
    if (!st) return;
    this._ouvrirNouveau(st);
  },

  _ouvrirNouveau(st) {
    // Retenu pour pouvoir tout remettre comme avant s'il reste vide
    this._nouveau = { id: st.id, etape: Chronologie._historique.length };
    Projets.modifie();
    Chronologie.dessinerSousTitres();
    this.ouvrirEditeur(st.id, true);
    $('#st-texte').focus();
  },

  /* ---------- L'éditeur ---------- */

  ouvrirEditeur(id, dejaMemorise) {
    if (this.edite && this.edite !== id) this.fermerEditeur();
    const st = this.trouver(id);
    if (!st) return;
    Lecteur.pause();
    Incrustations.fermerEditeur();
    if (Onglets.actif !== 'sous-titres') {
      Onglets.actif = 'sous-titres';
      $$('.onglet').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.onglet === 'sous-titres')));
    }
    this.edite = id;
    this._dejaMemorise = !!dejaMemorise;
    $$('.onglet-contenu').forEach((zone) => { zone.hidden = true; });
    $('#editeur-sous-titre').hidden = false;
    $('.panneau').scrollTop = 0;   // l'éditeur s'ouvre en haut, même après une longue liste
    // La ligne violette va sur le sous-titre, pour le voir dans l'aperçu
    if (Lecteur.t < st.debut || Lecteur.t >= st.debut + st.duree) Lecteur.aller(st.debut + Math.min(0.1, st.duree / 2));
    $('#st-texte').value = st.texte;
    this.majEditeur();
    Chronologie.dessinerSousTitres();
    Incrustations.redessiner(true);
  },

  fermerEditeur() {
    if (!this.edite) return;
    const st = this.trouver(this.edite);
    this.edite = null;
    this._arretA = null;
    // Un sous-titre resté vide ne sert à rien : il disparaît
    if (st && !st.texte.trim()) {
      Projets.courant.sousTitres = Projets.courant.sousTitres.filter((s) => s !== st);
      // Il venait d'être ajouté, sans rien d'autre depuis : tout redevient
      // comme avant (le sous-titre raccourci reprend sa durée, et « Annuler »
      // n'a pas d'étape inutile)
      const nouveau = this._nouveau;
      if (nouveau && nouveau.id === st.id && Chronologie._historique.length === nouveau.etape) {
        Chronologie._historique.pop();
        Chronologie.majBoutonsHistorique();
        if (this._raccourci && Projets.courant.sousTitres.includes(this._raccourci.st)) this._raccourci.st.duree = this._raccourci.duree;
      }
      Projets.modifie();
    }
    this._nouveau = null;
    this._raccourci = null;
    $('#editeur-sous-titre').hidden = true;
    $$('.onglet-contenu').forEach((zone) => { zone.hidden = zone.dataset.onglet !== Onglets.actif; });
    this.afficherListe();
    // On retrouve dans la liste le sous-titre qu'on vient de modifier
    const carte = st && $('#liste-sous-titres li[data-id="' + CSS.escape(st.id) + '"]');
    if (carte && Onglets.actif === 'sous-titres') carte.scrollIntoView({ block: 'nearest' });
    Chronologie.dessinerSousTitres();
    Incrustations.redessiner(true);
  },

  majEditeur() {
    const projet = Projets.courant;
    const st = this.trouver(this.edite);
    if (!st) { this.fermerEditeur(); return; }
    const i = projet.sousTitres.indexOf(st);
    const n = projet.sousTitres.length;
    ecrireTexte($('#st-titre'), 'Sous-titre ' + (i + 1) + ' sur ' + n);
    if ($('#st-texte').value !== st.texte) $('#st-texte').value = st.texte;
    ecrireTexte($('#st-moment'), 'De ' + formaterPosition(st.debut) + ' à ' + formaterPosition(st.debut + st.duree) +
      ' (' + String(Math.round(st.duree * 10) / 10).replace('.', ',') + ' s)');
    $('[data-action="sous-titre-voisin"][data-sens="-1"]').disabled = i <= 0;
    $('[data-action="sous-titre-voisin"][data-sens="1"]').disabled = i >= n - 1;
    $('[data-action="sous-titre-duree"][data-secondes="-0.5"]').disabled = st.duree <= DUREE_SOUS_TITRE_MIN + 0.05;
    const total = Lecteur.duree();
    $('#st-avertissement').hidden = !(total > 0 && st.debut >= total);
  },

  _avantChangement() {
    if (this._dejaMemorise) return;
    Chronologie._memoriser();
    this._dejaMemorise = true;
  },

  /* Change le texte, le début ou la durée du sous-titre modifié */
  changer(propriete, valeur, depuisLeChamp) {
    const st = this.trouver(this.edite);
    if (!st) return;
    this._avantChangement();
    st[propriete] = valeur;
    Object.assign(st, nettoyerSousTitre(st));
    if (propriete === 'debut') this._trier();
    Projets.modifie();
    Incrustations.redessiner(true);
    if (!depuisLeChamp || propriete !== 'texte') this.majEditeur();
    Chronologie.dessinerSousTitres();
  },

  commencerALaLigne() {
    if (!this.trouver(this.edite)) return;
    this.changer('debut', Lecteur.t);
  },

  finirALaLigne() {
    const st = this.trouver(this.edite);
    if (!st) return;
    if (Lecteur.t <= st.debut + DUREE_SOUS_TITRE_MIN) {
      Message.probleme('Place d\'abord la ligne violette APRÈS le début du sous-titre, puis touche à nouveau « Finit à la ligne ».');
      return;
    }
    this.changer('duree', Lecteur.t - st.debut);
    Lecteur.aller(Math.max(st.debut, st.debut + st.duree - 0.1));
  },

  changerDuree(secondes) {
    const st = this.trouver(this.edite);
    if (st) this.changer('duree', st.duree + secondes);
  },

  /* Passer au sous-titre précédent ou suivant */
  voisin(sens) {
    const projet = Projets.courant;
    const st = this.trouver(this.edite);
    if (!st) return;
    const autre = projet.sousTitres[projet.sousTitres.indexOf(st) + sens];
    if (!autre) return;
    this.fermerEditeur();
    this.ouvrirEditeur(autre.id);
  },

  /* « Écouter ce passage » : lit la vidéo du début à la fin du sous-titre */
  ecouter() {
    const st = this.trouver(this.edite);
    if (!st) return;
    Lecteur.pause();
    Lecteur.aller(Math.max(0, st.debut - 0.3));
    Lecteur.lire();
    this._arretA = st.debut + st.duree + 0.2;
  },

  supprimer(bouton) {
    const st = this.trouver(this.edite);
    if (!st) return;
    armerBouton(bouton, 'Supprimer ? Touche encore', () => {
      const projet = Projets.courant;
      if (st.texte.trim()) Chronologie._memoriser();
      projet.sousTitres = projet.sousTitres.filter((s) => s.id !== st.id);
      Projets.modifie();
      this.edite = null;
      $('#editeur-sous-titre').hidden = true;
      $$('.onglet-contenu').forEach((zone) => { zone.hidden = zone.dataset.onglet !== Onglets.actif; });
      this._apresModification(true);
      Message.montrer('Sous-titre supprimé. « Annuler » le fait revenir.');
    });
  },

  supprimerTous(bouton) {
    const projet = Projets.courant;
    if (!projet || !projet.sousTitres.length) return;
    armerBouton(bouton, 'Tout supprimer ? Touche encore', () => {
      Chronologie._memoriser();
      projet.sousTitres = [];
      this._apresModification(true);
      Message.montrer('Tous les sous-titres sont supprimés. « Annuler » les fait revenir.');
    });
  },

  /* ---------- L'apparence (la même pour tous) ---------- */

  changerStyle(reglage, valeur) {
    const projet = Projets.courant;
    if (!projet) return;
    Chronologie._memoriser();
    projet.styleSousTitres[reglage] = valeur;
    projet.styleSousTitres = nettoyerStyleSousTitres(projet.styleSousTitres);
    // On montre tout de suite le résultat sur un sous-titre
    const t = Lecteur.t;
    if (projet.styleSousTitres.visibles && !Rendu.sousTitresActifs(projet, t).length) {
      const proche = projet.sousTitres.find((s) => s.debut + s.duree > t && s.texte.trim()) ||
        projet.sousTitres.filter((s) => s.texte.trim()).pop();
      if (proche) Lecteur.aller(proche.debut + Math.min(0.1, proche.duree / 2));
    }
    this._apresModification(false);
    this._majApparence();
  },

  _majApparence() {
    const style = Projets.courant.styleSousTitres;
    $$('[data-action="style-sous-titres"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(style[b.dataset.reglage] === b.dataset.valeur)));
    $('#st-visibles').checked = style.visibles;
  },

  /* « Décaler tous les sous-titres » de quelques secondes */
  decaler(secondes) {
    const projet = Projets.courant;
    if (!projet || !projet.sousTitres.length) return;
    // Une suite d'appuis sur le même bouton = une seule étape « Annuler »
    const maintenant = Date.now();
    if (!this._dernierDecalage || maintenant - this._dernierDecalage > 4000) Chronologie._memoriser();
    this._dernierDecalage = maintenant;
    // Le premier sous-titre ne peut pas passer avant le tout début
    const decalage = Math.max(secondes, -projet.sousTitres[0].debut);
    if (Math.abs(decalage) < 0.001) { Message.montrer('Le premier sous-titre est déjà au tout début.'); return; }
    projet.sousTitres.forEach((s) => { s.debut = Math.max(0, s.debut + decalage); });
    this._apresModification(true);
    const sens = decalage < 0 ? 'plus tôt' : 'plus tard';
    Message.montrer('Sous-titres décalés de ' + String(Math.round(Math.abs(decalage) * 10) / 10).replace('.', ',') + ' s ' + sens + '.' +
      (decalage > secondes ? ' Le premier est maintenant au tout début : impossible d\'aller plus tôt.' : ''));
  },

  /* ---------- La liste (onglet Sous-titres) ---------- */

  afficherListe() {
    const projet = Projets.courant;
    if (!projet) return;
    const liste = projet.sousTitres;
    const n = liste.length;
    ecrireTexte($('#st-compte'), n === 1 ? '1 sous-titre' : n + ' sous-titres');
    $('#st-compte').hidden = n === 0;
    $('#sous-titres-vide').hidden = n > 0;
    $('#st-actions').hidden = n === 0;
    $('#st-aide-srt').hidden = n === 0;
    $('#liste-sous-titres').innerHTML = liste.map((s) =>
      '<li class="carte-calque carte-sous-titre" data-id="' + proteger(s.id) + '">' +
        '<p class="calque-apercu">' + proteger(s.texte.trim() || '(vide)') + '</p>' +
        '<p class="aide mono">' + formaterPosition(s.debut) + ' → ' + formaterPosition(s.debut + s.duree) + '</p>' +
        '<button type="button" class="bouton" data-action="editer-sous-titre" data-id="' + proteger(s.id) + '">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-crayon"/></svg>Modifier</button>' +
      '</li>').join('');
    this._enCoursAffiche = null;
    this._majEnCours();
    this._majApparence();
  },

  /* Pendant la lecture, le sous-titre à l'écran est mis en valeur dans la liste */
  _majEnCours() {
    const projet = Projets.courant;
    if (!projet || Onglets.actif !== 'sous-titres' || this.edite) return;
    const actif = projet.sousTitres.find((s) => Lecteur.t >= s.debut && Lecteur.t < s.debut + s.duree);
    const id = actif ? actif.id : null;
    if (id === this._enCoursAffiche) return;
    this._enCoursAffiche = id;
    $$('#liste-sous-titres .carte-sous-titre').forEach((li) => li.classList.toggle('en-cours', li.dataset.id === id));
  },

  /* ---------- Importer un fichier .srt ou .vtt ---------- */

  choisirFichier() {
    if (!Projets.courant) return;
    Lecteur.pause();
    const champ = $('#choisir-sous-titres');
    champ.value = '';
    champ.onchange = () => { if (champ.files[0]) this.importer(champ.files[0]).catch(signalerErreur); };
    champ.click();
  },

  async importer(fichier) {
    const projet = Projets.courant;
    if (!projet) return;
    if (fichier.size > TAILLE_FICHIER_SOUS_TITRES_MAX) {
      Message.probleme('« ' + fichier.name + ' » est trop gros pour être un fichier de sous-titres. Choisis un fichier .srt ou .vtt.');
      return;
    }
    let trouves;
    try {
      trouves = lireSousTitres(await lireFichierTexte(fichier));
    } catch (e) {
      trouves = [];
    }
    if (!trouves.length) {
      Message.probleme('Je n\'ai pas trouvé de sous-titres dans « ' + fichier.name + ' ». Choisis un fichier .srt ou .vtt ' +
        '(par exemple celui que YouTube propose de télécharger).');
      return;
    }
    if (projet !== Projets.courant) return;

    // Il y a déjà des sous-titres : les remplacer, ou ajouter les nouveaux ?
    let choix = 'remplacer';
    if (projet.sousTitres.length) {
      choix = await this._demanderRemplacer(projet.sousTitres.length, trouves.length);
      if (choix !== 'remplacer' && choix !== 'ajouter') return;
      if (projet !== Projets.courant) return;
    }

    const avant = choix === 'ajouter' ? projet.sousTitres.length : 0;
    Chronologie._memoriser();
    const nouveaux = trouves.map((s) => nettoyerSousTitre(Object.assign({ id: nouvelId() }, s))).filter(Boolean);
    projet.sousTitres = nettoyerSousTitres((choix === 'ajouter' ? projet.sousTitres : []).concat(nouveaux));
    this.fermerEditeur();
    this._apresModification(true);
    Lecteur.aller(nouveaux[0].debut + Math.min(0.1, nouveaux[0].duree / 2));

    // Le bilan, en mots simples
    const total = Lecteur.duree();
    const apresLaFin = total > 0 ? nouveaux.filter((s) => s.debut >= total).length : 0;
    let bilan = (nouveaux.length === 1 ? '1 sous-titre importé' : nouveaux.length + ' sous-titres importés') + ' ✓';
    if (projet.sousTitres.length < avant + nouveaux.length) bilan += ' (pas plus de ' + SOUS_TITRES_MAX + ' en tout)';
    if (apresLaFin) {
      Message.probleme(bilan + ' Attention : ' + (apresLaFin === 1
        ? 'l\'un d\'eux est placé après la fin de la vidéo, il ne se verra pas.'
        : apresLaFin + ' sont placés après la fin de la vidéo, ils ne se verront pas.') +
        ' Ce fichier va peut-être avec une autre vidéo.');
    } else {
      Message.montrer(bilan + ' Touche « Lecture » pour les voir.');
    }
  },

  _demanderRemplacer(actuels, nouveaux) {
    return new Promise((reponse) => {
      const fenetre = $('#fenetre-import-st');
      ecrireTexte($('#import-st-texte'), 'Ce fichier contient ' + nouveaux + ' sous-titre' + (nouveaux > 1 ? 's' : '') +
        '. Ton projet en a déjà ' + actuels + '. Que veux-tu faire ?');
      fenetre.returnValue = '';
      fenetre.onclose = () => reponse(fenetre.returnValue);
      fenetre.showModal();
    });
  },

  /* ---------- Enregistrer en fichier .srt ---------- */

  enregistrerSrt() {
    const projet = Projets.courant;
    if (!projet) return;
    const liste = projet.sousTitres.filter((s) => s.texte.trim());
    if (!liste.length) return;
    const contenu = liste.map((s, i) =>
      (i + 1) + '\n' + tempsSrt(s.debut) + ' --> ' + tempsSrt(s.debut + s.duree) + '\n' + s.texte.trim() + '\n').join('\n');
    // Le BOM au début aide certains logiciels à bien lire les accents
    telechargerFichier(new Blob(['﻿' + contenu], { type: 'application/x-subrip' }), nomDeFichier(projet.nom) + '.srt');
    Message.montrer('Fichier .srt enregistré ✓ Il est dans « Téléchargements ».');
  }
};
