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

    Persistance.demander();
    await Projets.afficherListe();
    const videos = projet.medias.filter((m) => m.type === 'video').length;
    Message.montrer('Projet « ' + projet.nom + ' » importé ✓' +
      (videos ? ' En l\'ouvrant, touche « Retrouver mes vidéos » pour lui redonner ses vidéos.' : ''));
  }
};
