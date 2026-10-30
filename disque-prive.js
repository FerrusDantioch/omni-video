/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — disque-prive.js
   Un petit « travailleur » (Web Worker) qui écrit la vidéo finale dans le
   disque privé du navigateur (OPFS), morceau par morceau.

   Pourquoi ? Sur Android, Chrome ne sait pas toujours écrire dans le
   disque privé depuis la page elle-même (createWritable). Il le sait en
   revanche depuis un travailleur, avec createSyncAccessHandle. Sans ce
   fichier, la vidéo restait en mémoire vive et seules les vidéos courtes
   pouvaient être fabriquées.

   Il est lancé par fluxParTravailleur() (fabrication.js), qui lui envoie :
   - { type: 'ouvrir', nom }             : crée le fichier (vide) ;
   - { type: 'ecrire', position, donnees }: écrit un morceau à sa place ;
   - { type: 'fermer' }                  : termine le fichier.
   Chaque message reçoit une réponse { n, ok } (ou { n, ok: false, nom, message }).
   ============================================================ */
'use strict';

let poignee = null;   // l'accès au fichier, tant qu'il est ouvert

self.onmessage = async (evenement) => {
  const m = evenement.data;
  try {
    if (m.type === 'ouvrir') {
      const dossier = await navigator.storage.getDirectory();
      const fichier = await dossier.getFileHandle(m.nom, { create: true });
      poignee = await fichier.createSyncAccessHandle();
      // « await » : les premières versions de Chrome répondaient plus tard
      await poignee.truncate(0);
    } else if (m.type === 'ecrire') {
      await poignee.write(m.donnees, { at: m.position });
    } else if (m.type === 'fermer') {
      if (poignee) {
        const p = poignee;
        poignee = null;
        await p.flush();
        await p.close();
      }
    }
    self.postMessage({ n: m.n, ok: true });
  } catch (erreur) {
    self.postMessage({ n: m.n, ok: false, nom: erreur.name, message: erreur.message });
  }
};
