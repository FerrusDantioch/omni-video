/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — sauvegarde.js
   Sauvegarder un projet dans un fichier, et le réimporter : pour garder
   une copie de sécurité, ou pour passer d'une tablette à une autre.

   Le fichier « .omnivideo » contient :
   - le montage (clips, textes, sous-titres, musiques, voix, réglages) ;
   - les fichiers légers qu'Omni-Vidéo garde lui-même : images, musiques,
     voix off.
   Les VIDÉOS n'y sont pas (trop lourdes, et elles restent dans la
   tablette) : après un import, on les retrouve avec « Retrouver mes
   vidéos », comme à chaque réouverture.

   Forme du fichier, pour les curieux :
   1. le mot « OMNIVIDEO-PROJET-1 » et un retour à la ligne ;
   2. la longueur de la description (4 octets) ;
   3. la description du projet, en texte (JSON) ;
   4. les fichiers légers, collés les uns après les autres.
   Le navigateur assemble et relit ce fichier morceau par morceau : rien
   n'est chargé en entier en mémoire.
   ============================================================ */
'use strict';

const MAGIE_SAUVEGARDE = 'OMNIVIDEO-PROJET-1\n';
const EXTENSION_SAUVEGARDE = '.omnivideo';

const Sauvegarde = {
  /* ---------- Sauvegarder un projet dans un fichier ---------- */
  async exporter(id) {
    let projet;
    try { projet = await Base.lireProjet(id); } catch (e) { projet = null; }
    if (!projet) { Message.probleme('Ce projet est introuvable.'); return; }

    // Les fichiers légers (images, musiques, voix), lus dans la tablette
    const fichiers = [];
    const contenus = [];
    for (const media of projet.medias) {
      if (media.type === 'video') continue;
      const contenu = await Base.lireFichier(media.id).catch(() => null);
      if (!contenu) continue;
      fichiers.push({ id: media.id, taille: contenu.size, type: contenu.type || '' });
      contenus.push(contenu);
    }

    const description = new TextEncoder().encode(JSON.stringify({
      format: 'omnivideo-projet',
      version: 1,
      application: VERSION,
      date: Date.now(),
      projet,
      fichiers
    }));
    const longueur = new Uint8Array(4);
    new DataView(longueur.buffer).setUint32(0, description.length, true);
    const sauvegarde = new Blob([MAGIE_SAUVEGARDE, longueur, description, ...contenus], { type: 'application/octet-stream' });
    telechargerFichier(sauvegarde, nomDeFichier(projet.nom) + EXTENSION_SAUVEGARDE);
    RappelSauvegarde.noter(projet.id);
    if (vueActive === 'accueil') Projets.afficherListe();

    const videos = projet.medias.filter((m) => m.type === 'video').length;
    Message.montrer('Sauvegarde enregistrée dans « Téléchargements » ✓ (' + tailleEnTexte(sauvegarde.size) + ')' +
      (videos ? '. Tes vidéos n\'y sont pas : garde-les dans la tablette.' : '.'));
  },

  /* ---------- Importer un projet depuis un fichier ---------- */
  choisirFichier() {
    const champ = $('#choisir-sauvegarde');
    champ.value = '';
    champ.onchange = () => { if (champ.files[0]) this.importer(champ.files[0]).catch(signalerErreur); };
    champ.click();
  },

  async importer(fichier) {
    const pasUneSauvegarde = () => Message.probleme('« ' + fichier.name + ' » n\'est pas une sauvegarde d\'Omni-Vidéo. ' +
      'Choisis un fichier qui se termine par « ' + EXTENSION_SAUVEGARDE + ' ».');

    // 1. Le début du fichier : le mot magique, puis la description
    const debut = MAGIE_SAUVEGARDE.length;
    if (fichier.size < debut + 4) { pasUneSauvegarde(); return; }
    const entete = new Uint8Array(await fichier.slice(0, debut + 4).arrayBuffer());
    if (new TextDecoder().decode(entete.subarray(0, debut)) !== MAGIE_SAUVEGARDE) { pasUneSauvegarde(); return; }
    const longueur = new DataView(entete.buffer).getUint32(debut, true);
    let donnees;
    try {
      donnees = JSON.parse(await fichier.slice(debut + 4, debut + 4 + longueur).text());
    } catch (e) {
      donnees = null;
    }
    if (!donnees || donnees.format !== 'omnivideo-projet' || !donnees.projet || !Array.isArray(donnees.fichiers)) {
      pasUneSauvegarde();
      return;
    }

    // 2. Nouveaux numéros pour le projet et ses fichiers : ainsi, importer
    //    deux fois la même sauvegarde donne deux projets bien séparés
    const brut = donnees.projet;
    const correspondance = new Map();
    (Array.isArray(brut.medias) ? brut.medias : []).forEach((m) => {
      if (m && typeof m.id === 'string') { const nouveau = nouvelId(); correspondance.set(m.id, nouveau); m.id = nouveau; }
    });
    const renommer = (liste) => (Array.isArray(liste) ? liste : []).forEach((x) => {
      if (x && correspondance.has(x.mediaId)) x.mediaId = correspondance.get(x.mediaId);
    });
    renommer(brut.clips);
    renommer(brut.calques);
    renommer(brut.pistes);
    brut.id = nouvelId();
    brut.modifie = Date.now();
    const projet = nettoyerProjet(brut);
    if (!projet) { pasUneSauvegarde(); return; }

    // 3. Les fichiers légers, rangés dans la tablette un par un
    try {
      let position = debut + 4 + longueur;
      for (const f of donnees.fichiers) {
        const taille = Number(f && f.taille) || 0;
        const nouveau = correspondance.get(f && f.id);
        if (nouveau && position + taille <= fichier.size) {
          await Base.enregistrerFichier(nouveau, fichier.slice(position, position + taille, String(f.type || '')));
        }
        position += taille;
      }
      await Base.enregistrerProjet(projet);
    } catch (e) {
      Message.probleme(messageErreurStockage(e));
      return;
    }
    // Ce projet vient d'une sauvegarde : il en a donc déjà une
    RappelSauvegarde.noter(projet.id);

    Persistance.demander();
    await Projets.afficherListe();
    const videos = projet.medias.filter((m) => m.type === 'video').length;
    Message.montrer('Projet « ' + projet.nom + ' » importé ✓' +
      (videos ? ' En l\'ouvrant, touche « Retrouver mes vidéos » pour lui redonner ses vidéos.' : ''));
  }
};


/* ============================================================
   Le rappel de sauvegarde
   Les projets ne vivent que dans le navigateur de la tablette : si Chrome
   efface ses données, ou si la tablette tombe en panne, ils sont perdus.
   Un fichier « .omnivideo » rangé ailleurs (clé USB, ordinateur, Drive…)
   les protège. Omni-Vidéo retient donc la date de la dernière sauvegarde
   de chaque projet, et le rappelle sur l'accueil quand un projet a des
   changements qui ne sont dans aucune sauvegarde depuis plus d'une
   semaine.
   ============================================================ */

const CLE_DATES_SAUVEGARDE = 'omnivideo-sauvegardes';      // { numéro du projet: date }
const CLE_RAPPEL_REPOUSSE = 'omnivideo-rappel-repousse';   // date jusqu'à laquelle on se tait
const JOURS_AVANT_RAPPEL = 7;
const JOURS_REPORT_RAPPEL = 3;
const UN_JOUR = 24 * 3600 * 1000;

const RappelSauvegarde = {
  _lire() {
    try {
      const dates = JSON.parse(lireReglage(CLE_DATES_SAUVEGARDE) || '{}');
      return dates && typeof dates === 'object' ? dates : {};
    } catch (e) {
      return {};
    }
  },

  _ecrire(dates) {
    ecrireReglage(CLE_DATES_SAUVEGARDE, JSON.stringify(dates));
  },

  /* Date de la dernière sauvegarde d'un projet (0 = jamais) */
  date(id) {
    return Number(this._lire()[id]) || 0;
  },

  /* Appelé à chaque sauvegarde (et à l'import d'une sauvegarde) */
  noter(id) {
    const dates = this._lire();
    dates[id] = Date.now();
    this._ecrire(dates);
  },

  /* Le projet est supprimé : on oublie sa date */
  oublier(id) {
    const dates = this._lire();
    delete dates[id];
    this._ecrire(dates);
  },

  /* Ce projet a-t-il des changements à mettre à l'abri ? Un projet vide
     (sans aucun clip) ne compte pas. La « référence » est la dernière
     sauvegarde, ou la création du projet s'il n'en a jamais eu. */
  _enRetard(p) {
    if (!p.clips.length) return 0;
    const derniere = this.date(p.id);
    if (p.modifie <= derniere) return 0;
    const reference = derniere || p.cree;
    const jours = (Date.now() - reference) / UN_JOUR;
    return jours >= JOURS_AVANT_RAPPEL ? jours : 0;
  },

  /* Petit texte pour la carte du projet sur l'accueil */
  texteCarte(p) {
    const derniere = this.date(p.id);
    if (!derniere) return 'Jamais sauvegardé dans un fichier';
    return 'Dernière sauvegarde ' + dateEnMots(derniere) + (p.modifie > derniere ? ' (changé depuis)' : '');
  },

  /* Le bandeau de l'accueil, recalculé à chaque affichage de la liste */
  majBandeau(liste) {
    const bandeau = $('#bandeau-sauvegarde');
    const repousse = Number(lireReglage(CLE_RAPPEL_REPOUSSE)) || 0;
    const enRetard = liste
      .map((p) => ({ p, jours: this._enRetard(p) }))
      .filter((x) => x.jours > 0)
      .sort((a, b) => b.jours - a.jours);
    if (!enRetard.length || Date.now() < repousse) { bandeau.hidden = true; return; }

    const { p, jours } = enRetard[0];
    const nbJours = Math.floor(jours);
    ecrireTexte($('#rappel-sauvegarde-titre'), 'Pense à sauvegarder « ' + p.nom + ' »');
    ecrireTexte($('#rappel-sauvegarde-texte'),
      (this.date(p.id)
        ? 'Sa dernière sauvegarde date de ' + nbJours + ' jours, et tu l\'as changé depuis.'
        : 'Tu y travailles depuis ' + nbJours + ' jours et il n\'a jamais été sauvegardé.') +
      (enRetard.length > 1 ? ' ' + (enRetard.length - 1) + ' autre' + (enRetard.length > 2 ? 's projets aussi' : ' projet aussi') + '.' : '') +
      ' Tes projets ne sont gardés que dans cette tablette : range le fichier de sauvegarde ailleurs ' +
      '(ordinateur, clé USB, Drive…) pour ne jamais les perdre.');
    $('#rappel-sauvegarde-bouton').dataset.id = p.id;
    bandeau.hidden = false;
  },

  /* « Plus tard » : plus de rappel pendant trois jours */
  repousser() {
    ecrireReglage(CLE_RAPPEL_REPOUSSE, String(Date.now() + JOURS_REPORT_RAPPEL * UN_JOUR));
    $('#bandeau-sauvegarde').hidden = true;
    annoncer('D\'accord. Omni-Vidéo te le rappellera dans ' + JOURS_REPORT_RAPPEL + ' jours.');
  }
};
