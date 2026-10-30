/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — capacites.js
   « Vérifier ma tablette » : au démarrage, Omni-Vidéo regarde ce que la
   tablette sait faire (lire les vidéos, fabriquer un MP4, garder les
   projets, empêcher la mise en veille…). Au lieu de planter plus tard,
   l'application prévient tout de suite, avec des mots simples.

   Chaque vérification donne un « niveau » :
   - ok        : tout va bien
   - info      : bon à savoir, rien à faire
   - attention : ça marche, mais avec une limite (expliquée)
   - bloquant  : une fonction ne pourra pas marcher sur cette tablette
   ============================================================ */
'use strict';

/* Débit moyen de la vidéo finale, pour estimer la place nécessaire
   (image + son, en octets par seconde). Les mêmes valeurs serviront à
   l'export : 8 Mbit/s en 1080p, 5 Mbit/s en 720p, son à 128 kbit/s. */
const DEBIT_EXPORT = {
  '1080p': (8000000 + 128000) / 8,
  '720p':  (5000000 + 128000) / 8
};

const Capacites = {
  resultat: null,   // le dernier test : { tests, peutFonctionner, peutExporter, ... }

  /* Lance toutes les vérifications. Prend moins d'une seconde. */
  async tester() {
    const tests = [];
    const ajouter = (id, niveau, titre, explication) => tests.push({ id, niveau, titre, explication });
    const r = {
      tests,
      peutFonctionner: true,   // peut-on au moins ouvrir et monter un projet ?
      peutExporter: true,      // peut-on fabriquer le MP4 final ?
      export1080: true,        // la qualité 1080p est-elle possible ?
      aacDirect: true,         // le son AAC est-il fabriqué directement par la tablette ?
      espaceLibre: null,       // place disponible pour l'application, en octets
      memoire: null            // mémoire de la tablette, en Go (approximatif)
    };

    // 1. Adresse sûre (https) : sans elle, le navigateur coupe presque tout
    if (!window.isSecureContext) {
      ajouter('adresse', 'bloquant', 'Adresse du site',
        "Omni-Vidéo doit être ouverte depuis son adresse internet (qui commence par https://), " +
        "et pas comme un simple fichier. Ouvre le lien de l'application dans Chrome.");
      r.peutFonctionner = false;
      r.peutExporter = false;
    }

    // 2. La bibliothèque vidéo est-elle bien chargée ?
    if (typeof Mediabunny === 'undefined') {
      ajouter('bibliotheque', 'bloquant', 'Outil de lecture des vidéos',
        "Une partie de l'application n'a pas pu se charger. Ferme Omni-Vidéo et rouvre-la. " +
        'Si le souci revient, mets Google Chrome à jour depuis le Play Store.');
      r.peutFonctionner = false;
      r.peutExporter = false;
    }

    // 3. Les projets peuvent-ils être enregistrés ?
    try {
      await avecDelai(Base.ouvrir(), 5000);
      ajouter('base', 'ok', 'Enregistrement des projets',
        'Tes projets sont enregistrés automatiquement sur la tablette.');
    } catch (e) {
      ajouter('base', 'bloquant', 'Enregistrement des projets',
        "La tablette refuse qu'Omni-Vidéo enregistre tes projets. Vérifie que tu n'es pas en " +
        'navigation privée, puis rouvre l\'application.');
      r.peutFonctionner = false;
    }

    // 4. WebCodecs : la boîte à outils vidéo moderne du navigateur
    const webcodecs = typeof VideoDecoder === 'function' && typeof VideoEncoder === 'function' &&
                      typeof AudioDecoder === 'function' && typeof AudioEncoder === 'function' &&
                      typeof VideoFrame === 'function';
    if (!webcodecs) {
      ajouter('webcodecs', 'bloquant', 'Outils vidéo du navigateur',
        'Ce navigateur ne sait pas traiter la vidéo image par image. Utilise Google Chrome, ' +
        'mis à jour depuis le Play Store (version 107 ou plus récente).');
      r.peutFonctionner = false;
      r.peutExporter = false;
    } else {
      // 4a. Lire les vidéos H.264 (le format habituel des téléphones)
      const lectureH264 = await soutenu(() => VideoDecoder.isConfigSupported({ codec: 'avc1.640028' }));
      if (lectureH264) {
        ajouter('lecture', 'ok', 'Lecture des vidéos', 'Ta tablette lit les vidéos filmées au téléphone (format H.264).');
      } else {
        ajouter('lecture', 'bloquant', 'Lecture des vidéos',
          'Ta tablette ne sait pas lire les vidéos au format H.264 dans Omni-Vidéo. Mets Google Chrome à jour.');
        r.peutFonctionner = false;
      }

      // 4b. Vidéos « haute efficacité » (HEVC / H.265), choisies par certains téléphones
      const lectureHevc = await soutenu(() => VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L120.90' }));
      if (lectureHevc) {
        ajouter('hevc', 'ok', 'Vidéos « haute efficacité » (HEVC)', 'Elles sont lisibles aussi.');
      } else {
        ajouter('hevc', 'info', 'Vidéos « haute efficacité » (HEVC)',
          'Ta tablette ne les lit pas. Si une vidéo est refusée, règle l\'appareil photo du téléphone ' +
          'sur le format « H.264 » ou « Le plus compatible » pour les prochaines vidéos.');
      }

      // 4c. Fabriquer la vidéo finale en H.264 (ce que demande YouTube)
      const encode720 = await soutenu(() => VideoEncoder.isConfigSupported(configEncodage(1280, 720, 5000000)));
      const encode1080 = await soutenu(() => VideoEncoder.isConfigSupported(configEncodage(1920, 1080, 8000000)));
      const materiel = await soutenu(() => VideoEncoder.isConfigSupported(
        Object.assign(configEncodage(1280, 720, 5000000), { hardwareAcceleration: 'prefer-hardware' })));
      if (encode1080) {
        ajouter('encodage', 'ok', 'Fabrication de la vidéo finale',
          'Ta tablette sait fabriquer le fichier MP4 pour YouTube, en 720p et en 1080p.');
      } else if (encode720) {
        r.export1080 = false;
        ajouter('encodage', 'attention', 'Fabrication de la vidéo finale',
          'Ta tablette sait fabriquer le fichier MP4 en 720p, mais pas en 1080p. Le 720p reste ' +
          'une bonne qualité pour YouTube.');
      } else {
        r.peutExporter = false;
        r.export1080 = false;
        ajouter('encodage', 'bloquant', 'Fabrication de la vidéo finale',
          'Ta tablette ne sait pas fabriquer de vidéo H.264. Tu peux préparer ton montage, mais pas ' +
          'créer le fichier final. Mettre Google Chrome à jour peut régler le souci.');
      }
      if (encode720 || encode1080) {
        ajouter('materiel', materiel ? 'ok' : 'info', 'Accélération de la vidéo',
          materiel
            ? 'La puce vidéo de la tablette aide à fabriquer la vidéo : c\'est plus rapide.'
            : 'La vidéo sera fabriquée par le processeur seul : ça marche, mais c\'est plus lent.');
      }

      // 4d. Le son : lire (AAC, MP3) et fabriquer (AAC, demandé par YouTube)
      const lireAac = await soutenu(() => AudioDecoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 }));
      const lireMp3 = await soutenu(() => AudioDecoder.isConfigSupported({ codec: 'mp3', sampleRate: 44100, numberOfChannels: 2 }));
      r.aacDirect = await soutenu(() => AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }));
      if (lireAac && lireMp3) {
        ajouter('son', 'ok', 'Lecture du son', 'Le son des vidéos et les musiques MP3 sont lisibles.');
      } else {
        ajouter('son', 'attention', 'Lecture du son',
          'Certains sons ne pourront pas être lus' + (lireAac ? ' (musiques MP3).' : ' (son des vidéos).') +
          ' Mettre Google Chrome à jour peut régler le souci.');
      }
      if (r.aacDirect) {
        ajouter('aac', 'ok', 'Fabrication du son', 'Ta tablette fabrique le son de la vidéo finale (format AAC).');
      } else {
        ajouter('aac', 'attention', 'Fabrication du son',
          'Ta tablette ne fabrique pas elle-même le son au format AAC demandé par YouTube. ' +
          'Omni-Vidéo utilisera sa propre méthode de secours, un peu plus lente.');
      }
    }

    // 5. Le « disque privé » où la vidéo finale est écrite petit à petit
    const disque = await testerDisquePrive();
    if (disque) {
      ajouter('disque', 'ok', 'Écriture de la vidéo finale',
        'La vidéo finale est écrite petit à petit sur la tablette : même une vidéo de 30 minutes ne remplit pas la mémoire vive.');
    } else {
      ajouter('disque', 'attention', 'Écriture de la vidéo finale',
        'La vidéo finale devra être gardée en mémoire vive pendant sa fabrication : seules les vidéos ' +
        'courtes (quelques minutes) pourront être exportées. Mettre Chrome à jour peut régler le souci.');
    }

    // 6. Place disponible
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimation = await avecDelai(navigator.storage.estimate(), 5000);
        if (Number.isFinite(estimation.quota)) {
          r.espaceLibre = Math.max(0, estimation.quota - (estimation.usage || 0));
          const minutes = Math.floor(r.espaceLibre / DEBIT_EXPORT['1080p'] / 60);
          const texte = 'Environ ' + tailleEnTexte(r.espaceLibre) + ' disponibles pour Omni-Vidéo, soit ' +
            (minutes >= 120 ? 'plus de 2 heures' : 'environ ' + minutes + ' minutes') + ' de vidéo finale en 1080p.';
          if (minutes < 10) {
            ajouter('espace', 'attention', 'Place disponible',
              texte + ' Libère de la place sur la tablette avant de fabriquer une longue vidéo.');
          } else {
            ajouter('espace', minutes < 40 ? 'info' : 'ok', 'Place disponible', texte);
          }
        }
      }
    } catch (e) { /* on ne sait pas : on n'affiche rien */ }

    // 7. Mémoire vive (Chrome donne une valeur arrondie : 0,5 / 1 / 2 / 4 / 8)
    if (Number.isFinite(navigator.deviceMemory)) {
      r.memoire = navigator.deviceMemory;
      const go = String(navigator.deviceMemory).replace('.', ',') + (navigator.deviceMemory >= 8 ? ' Go ou plus' : ' Go');
      if (navigator.deviceMemory <= 2) {
        ajouter('memoire', 'attention', 'Mémoire vive',
          'Environ ' + go + ' : c\'est peu. Préfère la qualité 720p à l\'export, et ferme les autres applications avant.');
      } else {
        ajouter('memoire', 'ok', 'Mémoire vive', 'Environ ' + go + ' : suffisant pour le montage et l\'export.');
      }
    } else {
      ajouter('memoire', 'info', 'Mémoire vive', 'La tablette ne dit pas combien elle en a. Omni-Vidéo fera attention de toute façon.');
    }

    // 8. Empêcher la mise en veille pendant l'export
    if ('wakeLock' in navigator) {
      ajouter('veille', 'ok', 'Écran allumé pendant l\'export', 'Omni-Vidéo empêchera l\'écran de s\'éteindre pendant la fabrication de la vidéo.');
    } else {
      ajouter('veille', 'attention', 'Écran allumé pendant l\'export',
        'Omni-Vidéo ne peut pas empêcher la mise en veille. Avant un export, règle la mise en veille ' +
        'de l\'écran sur 30 minutes dans les paramètres de la tablette (Affichage).');
    }

    // 9. Micro, pour la voix off
    const micro = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder === 'function';
    ajouter('micro', micro ? 'ok' : 'attention', 'Micro (voix off)',
      micro ? 'Tu pourras enregistrer ta voix. La tablette te demandera la permission la première fois.'
            : 'L\'enregistrement de la voix off ne sera pas possible sur ce navigateur.');

    // 10. Fonctionnement hors ligne (voir sw.js)
    const horsLigne = await etatHorsLigne();
    if (horsLigne === 'pret') {
      ajouter('horsligne', 'ok', 'Sans connexion', 'Omni-Vidéo est rangée dans ta tablette : elle fonctionne sans Internet.');
    } else if (horsLigne === 'premiere-visite') {
      ajouter('horsligne', 'info', 'Sans connexion',
        'Omni-Vidéo se range dans ta tablette pendant cette première visite. À la prochaine ouverture, elle fonctionnera sans Internet.');
    } else if (horsLigne === 'incomplet') {
      ajouter('horsligne', 'attention', 'Sans connexion',
        'Il manque des fichiers pour fonctionner sans Internet. Ouvre Omni-Vidéo une fois avec une connexion pour les récupérer.');
    } else {
      ajouter('horsligne', 'attention', 'Sans connexion', 'Ce navigateur ne permet pas d\'utiliser Omni-Vidéo sans Internet.');
    }

    this.resultat = r;
    return r;
  },

  /* Le résumé en une phrase, pour l'accueil et l'écran de test */
  resume(r) {
    const bloquants = r.tests.filter((t) => t.niveau === 'bloquant');
    const attentions = r.tests.filter((t) => t.niveau === 'attention');
    if (!r.peutFonctionner) {
      return { niveau: 'probleme', titre: 'Omni-Vidéo ne peut pas fonctionner ici',
        texte: bloquants[0] ? bloquants[0].explication : '' };
    }
    if (!r.peutExporter) {
      return { niveau: 'probleme', titre: 'Le montage est possible, mais pas la vidéo finale',
        texte: 'Touche « Voir le détail » pour savoir pourquoi et comment régler le souci.' };
    }
    if (attentions.length) {
      return { niveau: 'attention', titre: 'Ta tablette est prête, avec ' + (attentions.length > 1 ? attentions.length + ' remarques' : 'une remarque'),
        texte: attentions.map((t) => t.titre).join(', ') + '. Touche « Voir le détail » pour en savoir plus.' };
    }
    return { niveau: 'ok', titre: 'Ta tablette est prête ✓', texte: 'Tout ce dont Omni-Vidéo a besoin fonctionne.' };
  },

  /* Remplit l'écran « Vérifier ma tablette » */
  afficher() {
    const r = this.resultat;
    const liste = $('#liste-tests');
    if (!r) { liste.innerHTML = '<li class="vide">Test en cours…</li>'; return; }
    const symboles = { ok: '✓', info: 'i', attention: '!', bloquant: '✕' };
    liste.innerHTML = r.tests.map((t) =>
      '<li class="test" data-niveau="' + t.niveau + '">' +
        '<span class="test-symbole" aria-hidden="true">' + symboles[t.niveau] + '</span>' +
        '<div><p class="test-titre">' + proteger(t.titre) + '</p>' +
        '<p class="test-explication">' + proteger(t.explication) + '</p></div>' +
      '</li>').join('');
    const resume = this.resume(r);
    const bloc = $('#tablette-resume');
    bloc.hidden = false;
    bloc.classList.toggle('attention', resume.niveau === 'attention');
    bloc.classList.toggle('probleme', resume.niveau === 'probleme');
    ecrireTexte($('#tablette-resume-titre'), resume.titre);
    ecrireTexte($('#tablette-resume-texte'), resume.niveau === 'ok' ? resume.texte : (resume.niveau === 'probleme' && !r.peutFonctionner ? resume.texte : 'Les détails sont ci-dessous.'));
    const chrome = navigator.userAgent.match(/Chrome\/(\d+)/);
    ecrireTexte($('#tablette-navigateur'), 'Navigateur : ' + (chrome ? 'Chrome ' + chrome[1] : navigator.userAgent) +
      ' · Processeur : ' + (navigator.hardwareConcurrency || '?') + ' cœurs');
  },

  /* Le bandeau de l'accueil : affiché seulement s'il y a quelque chose à dire */
  afficherBandeau() {
    const r = this.resultat;
    const bloc = $('#bandeau-tablette');
    if (!r) { bloc.hidden = true; return; }
    const resume = this.resume(r);
    bloc.hidden = resume.niveau === 'ok';
    bloc.classList.toggle('attention', resume.niveau === 'attention');
    bloc.classList.toggle('probleme', resume.niveau === 'probleme');
    ecrireTexte($('#bandeau-tablette-titre'), resume.titre);
    ecrireTexte($('#bandeau-tablette-texte'), resume.texte);
  }
};


/* ============================================================
   « Place utilisée » (bas de l'écran « Vérifier ma tablette »)
   Ce qu'Omni-Vidéo range dans la tablette, et des boutons pour effacer
   ce qui ne sert plus. Les projets eux-mêmes ne sont jamais effacés ici :
   on les supprime depuis l'accueil, après les avoir sauvegardés.
   ⚠️ Le disque privé est partagé avec les autres applications du site :
   on ne touche qu'aux fichiers dont le nom commence par « omnivideo- ».
   ============================================================ */

const Place = {
  _tour: 0,   // pour ignorer un calcul dépassé par un plus récent

  /* Mesure tout (quelques dixièmes de seconde : seules les tailles sont lues) */
  async mesurer() {
    const projets = await Base.lireProjets().catch(() => []);
    const tailles = await Base.taillesFichiers().catch(() => new Map());
    const utilises = new Set();
    const parProjet = projets.map((p) => {
      let octets = 0;
      p.medias.forEach((m) => { utilises.add(m.id); octets += tailles.get(m.id) || 0; });
      return { nom: p.nom, octets };
    }).sort((a, b) => b.octets - a.octets);
    // Fichiers rangés qui n'appartiennent plus à aucun projet
    const oublies = [...tailles.keys()].filter((id) => !utilises.has(id));
    const octetsOublies = oublies.reduce((somme, id) => somme + tailles.get(id), 0);

    // Le disque privé : la copie de la dernière vidéo, et les morceaux
    // d'une fabrication interrompue (ou d'anciens fichiers de travail)
    let copie = 0, morceaux = 0;
    const dossier = await DisquePrive.dossier();
    if (dossier) {
      try {
        for await (const [nom, poignee] of dossier.entries()) {
          if (poignee.kind !== 'file' || !nom.startsWith('omnivideo-')) continue;
          const taille = (await poignee.getFile()).size;
          if (nom === NOM_FICHIER_EXPORT) copie = taille; else morceaux += taille;
        }
      } catch (e) { /* on montre ce qu'on a pu mesurer */ }
    }

    let libre = null;
    try {
      const estimation = await avecDelai(navigator.storage.estimate(), 5000);
      if (Number.isFinite(estimation.quota)) libre = Math.max(0, estimation.quota - (estimation.usage || 0));
    } catch (e) { /* inconnu */ }
    return { parProjet, oublies, octetsOublies, copie, morceaux, reprise: Reprise.lire(), libre };
  },

  async afficher() {
    const tour = ++this._tour;
    const liste = $('#place-liste');
    if (!liste.children.length) liste.innerHTML = '<li class="vide">Calcul en cours…</li>';
    const m = await this.mesurer();
    if (tour !== this._tour) return;

    const ligne = (titre, octets, explication, quoi) =>
      '<li class="place-ligne">' +
        '<div class="place-entete"><span class="test-titre">' + proteger(titre) + '</span>' +
        '<span class="mono">' + proteger(tailleEnTexte(octets)) + '</span></div>' +
        '<p class="test-explication">' + proteger(explication) + '</p>' +
        (quoi ? '<button type="button" class="bouton" data-action="place-effacer" data-quoi="' + quoi + '">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-poubelle"/></svg>Effacer</button>' : '') +
      '</li>';

    const lignes = [];
    const totalProjets = m.parProjet.reduce((s, p) => s + p.octets, 0);
    const details = m.parProjet.filter((p) => p.octets > 0).slice(0, 5)
      .map((p) => '« ' + p.nom + ' » : ' + tailleEnTexte(p.octets)).join(' · ');
    lignes.push(ligne('Tes projets', totalProjets,
      'Les images, musiques et voix off gardées par Omni-Vidéo' + (details ? ' (' + details + ')' : '') +
      '. Tes vidéos, elles, restent dans la galerie et ne comptent pas ici. Pour libérer cette place, ' +
      'sauvegarde puis supprime les projets terminés, depuis l\'accueil.'));
    if (m.copie) {
      lignes.push(ligne('Dernière vidéo fabriquée', m.copie,
        'Une copie est gardée pour pouvoir l\'enregistrer ou la partager plus tard. Si elle est déjà dans ' +
        '« Téléchargements » ou sur YouTube, tu peux l\'effacer.', 'copie'));
    }
    if (m.morceaux) {
      const r = m.reprise;
      lignes.push(ligne(r ? 'Fabrication interrompue' : 'Fichiers de travail', m.morceaux,
        r ? 'Les morceaux déjà faits de « ' + r.nom + ' » (' + Math.round(Reprise.avancement(r) * 100) +
            ' % fait). Si tu les effaces, la prochaine fabrication repartira du début.'
          : 'Des restes d\'une ancienne fabrication, qui ne servent plus.', 'morceaux'));
    }
    if (m.oublies.length) {
      lignes.push(ligne('Fichiers oubliés', m.octetsOublies,
        'Des images ou des sons qui n\'appartiennent plus à aucun projet (après un souci pendant un import, par exemple).',
        'oublies'));
    }
    liste.innerHTML = lignes.join('');
    ecrireTexte($('#place-libre'), m.libre === null ? '' : 'Place encore libre pour Omni-Vidéo : environ ' + tailleEnTexte(m.libre) + '.');
  },

  effacer(quoi, bouton) {
    armerBouton(bouton, 'Effacer ? Touche encore', async () => {
      if (Export.enCours) { Message.montrer('Patiente : une vidéo est en cours de fabrication.'); return; }
      const avant = await this.mesurer();
      if (quoi === 'copie') {
        await DisquePrive.effacer();
        Export._fichier = null;
      } else if (quoi === 'morceaux') {
        await Reprise.effacer();
        // Les autres fichiers de travail d'Omni-Vidéo (jamais ceux des autres applications)
        const dossier = await DisquePrive.dossier();
        if (dossier) {
          const noms = [];
          try {
            for await (const [nom, poignee] of dossier.entries()) {
              if (poignee.kind === 'file' && nom.startsWith('omnivideo-') && nom !== NOM_FICHIER_EXPORT) noms.push(nom);
            }
          } catch (e) { /* tant pis */ }
          for (const nom of noms) await dossier.removeEntry(nom).catch(() => {});
        }
      } else if (quoi === 'oublies') {
        // Mesure refaite juste avant d'effacer, projet fermé : un fichier
        // tout juste ajouté à un projet n'est jamais pris pour un oublié
        if (Projets.courant) return;
        for (const id of avant.oublies) await Base.supprimerFichier(id).catch(() => {});
      }
      await this.afficher();
      const apres = await this.mesurer();
      const gagne = (avant.copie + avant.morceaux + avant.octetsOublies) - (apres.copie + apres.morceaux + apres.octetsOublies);
      Message.montrer('Place libérée ✓' + (gagne > 0 ? ' (' + tailleEnTexte(gagne) + ')' : ''));
    });
  }
};


/* Réglages d'encodage H.264 utilisés pour le test (profil « High »,
   celui que YouTube recommande). */
function configEncodage(largeur, hauteur, debit) {
  return {
    codec: largeur * hauteur > 1280 * 720 ? 'avc1.640028' : 'avc1.64001f',
    width: largeur,
    height: hauteur,
    bitrate: debit,
    framerate: 30
  };
}

/* Pose une question « est-ce pris en charge ? » au navigateur, sans
   jamais planter : une erreur ou une réponse trop lente = « non ». */
async function soutenu(question) {
  try {
    const reponse = await avecDelai(question(), 5000);
    return !!(reponse && reponse.supported);
  } catch (e) {
    return false;
  }
}

/* Abandonne une attente trop longue (certains navigateurs ne répondent jamais). */
function avecDelai(promesse, ms) {
  return Promise.race([
    promesse,
    new Promise((_, echouer) => setTimeout(() => echouer(new Error('Délai dépassé')), ms))
  ]);
}

/* Essaie d'écrire un tout petit fichier dans le « disque privé » du
   navigateur (OPFS), puis l'efface. C'est là que la vidéo finale sera
   écrite petit à petit, sans passer par la mémoire vive. */
async function testerDisquePrive() {
  try {
    // Le même essai que celui de l'export (fabrication.js)
    return await avecDelai(DisquePrive.peutEcrire(), 10000);
  } catch (e) {
    return false;
  }
}
