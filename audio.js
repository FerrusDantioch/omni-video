/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — audio.js
   Le son, en plus de celui des vidéos :
   - la MUSIQUE DE FOND et les VOIX OFF (les « pistes audio »), jouées en
     même temps que l'aperçu du montage ;
   - l'ENREGISTREMENT de la voix au micro, pendant que la vidéo défile ;
   - l'onglet « Son » du panneau de droite.

   Pour l'aperçu, chaque piste a son petit lecteur audio du navigateur
   (<audio>), qui lit le fichier sans le charger en entier. À chaque
   instant, on vérifie qu'il est au bon endroit (sinon on le recale) et
   au bon volume (avec les fondus). La vidéo finale, elle, mélangera tous
   les sons avec précision à l'étape « Export ».
   ============================================================ */
'use strict';

/* Fondus automatiques, en secondes : une musique arrive et part en
   douceur ; une voix démarre presque tout de suite (juste assez pour
   éviter un petit « clic »). */
const FONDUS_PISTE = {
  musique: { entree: 1, sortie: 2 },
  voix:    { entree: 0.05, sortie: 0.05 }
};
const ECART_MAX_AUDIO = 0.25;   // au-delà de ce décalage (secondes), on recale le lecteur audio


const PistesAudio = {
  _lecteurs: new Map(),   // numéro de piste → lecteur <audio>
  muet: false,            // vrai pendant l'enregistrement d'une voix off
  _volumeEnCours: false,  // un curseur de volume est en train de glisser (une seule étape « Annuler »)

  initialiser() {
    Lecteur.surChangement(() => {
      this.synchroniser();
      // La vidéo est arrivée au bout pendant un enregistrement : on l'arrête
      if (Enregistreur.enCours && !Lecteur.enLecture && Lecteur.duree() > 0 && Lecteur.t >= Lecteur.duree() - 0.05) {
        Enregistreur.arreter();
      }
    });
    // Omni-Vidéo passe en arrière-plan : l'enregistrement s'arrête proprement
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && Enregistreur.enCours) Enregistreur.arreter();
    });

    // Les curseurs et cases de l'onglet « Son » (fabriqués à la volée)
    const zone = $('.onglet-contenu[data-onglet="son"]');
    zone.addEventListener('input', (e) => {
      const id = e.target.dataset.pisteVolume;
      if (!id) return;
      this._avantVolume();
      this.changer(id, 'volume', Number(e.target.value) / 100, false);
      ecrireTexte(e.target.closest('label').querySelector('.mono'), e.target.value + ' %');
    });
    zone.addEventListener('change', (e) => {
      if (e.target.dataset.pisteVolume) { this._volumeEnCours = false; return; }
      const id = e.target.dataset.pisteFin;
      if (!id) return;
      Chronologie._memoriser();
      const piste = this.piste(id);
      if (!piste) return;
      if (!e.target.checked) piste.duree = this.duree(piste);   // on garde la durée actuelle
      this.changer(id, 'jusquALaFin', e.target.checked, true);
    });
  },

  piste(id) {
    const projet = Projets.courant;
    return projet ? projet.pistes.find((p) => p.id === id) || null : null;
  },

  /* Combien de temps une piste joue (elle peut aller jusqu'à la fin de la vidéo) */
  duree(piste, dureeMontage) {
    const total = dureeMontage === undefined ? Lecteur.duree() : dureeMontage;
    if (piste.jusquALaFin) return Math.max(0, total - piste.debut);
    return piste.duree;
  },

  /* Le volume d'une piste à l'instant t, fondus compris (0 à 1) */
  volumeA(piste, t, dureeMontage) {
    const duree = this.duree(piste, dureeMontage);
    const f = FONDUS_PISTE[piste.type];
    const depuis = t - piste.debut;
    const reste = piste.debut + duree - t;
    let v = piste.volume;
    if (depuis < f.entree) v *= borner(depuis / f.entree, 0, 1);
    if (reste < f.sortie) v *= borner(reste / f.sortie, 0, 1);
    return v;
  },

  /* L'endroit à lire DANS le fichier à l'instant t (une musique plus
     courte que sa place recommence au début) */
  positionA(piste, media, t) {
    const p = t - piste.debut;
    if (piste.type === 'musique' && media.duree > 0) return p % media.duree;
    return p;
  },

  /* ---------- L'aperçu : chaque piste suit le montage ---------- */
  synchroniser() {
    const projet = Projets.courant;
    if (!projet) return;
    const t = Lecteur.t;
    const enLecture = Lecteur.enLecture;
    for (const piste of projet.pistes) {
      const media = projet.medias.find((m) => m.id === piste.mediaId);
      const lecteur = this._lecteur(piste, media);
      if (!lecteur) continue;
      const actif = enLecture && !this.muet && t >= piste.debut && t < piste.debut + this.duree(piste);
      if (!actif) {
        if (!lecteur.paused) lecteur.pause();
        continue;
      }
      const cible = this.positionA(piste, media, t);
      // Une voix déjà finie (fichier plus court que prévu) : on n'insiste pas
      if (piste.type === 'voix' && media.duree > 0 && cible >= media.duree) { lecteur.pause(); continue; }
      lecteur.volume = borner(this.volumeA(piste, t), 0, 1);
      if (lecteur.paused) {
        lecteur.currentTime = cible;
        lecteur.play().catch(() => {});
      } else if (Math.abs(lecteur.currentTime - cible) > ECART_MAX_AUDIO) {
        lecteur.currentTime = cible;
      }
    }
    // Les lecteurs des pistes supprimées s'arrêtent et sont oubliés
    for (const [id, lecteur] of this._lecteurs) {
      if (!projet.pistes.some((p) => p.id === id)) { this._lacher(lecteur); this._lecteurs.delete(id); }
    }
  },

  _lecteur(piste, media) {
    if (!media || !Medias.disponible(media)) return null;
    let lecteur = this._lecteurs.get(piste.id);
    if (!lecteur) {
      lecteur = new Audio();
      lecteur.preload = 'auto';
      lecteur.src = Medias.adresse(media);
      lecteur.loop = piste.type === 'musique';
      this._lecteurs.set(piste.id, lecteur);
    }
    return lecteur;
  },

  _lacher(lecteur) {
    lecteur.pause();
    lecteur.removeAttribute('src');
    lecteur.load();
  },

  /* Projet fermé : on lâche tous les fichiers */
  vider() {
    this._lecteurs.forEach((l) => this._lacher(l));
    this._lecteurs.clear();
  },

  /* ---------- Ajouter une musique de fond ----------
     Par défaut : du début à la fin de la vidéo, volume discret (30 %). */
  ajouterMusique(mediaId) {
    const projet = Projets.courant;
    const media = projet && projet.medias.find((m) => m.id === mediaId);
    if (!media || media.type !== 'audio' || media.probleme) return;
    Lecteur.pause();
    Chronologie._memoriser();
    projet.pistes.push(nettoyerPiste({
      id: nouvelId(), type: 'musique', mediaId, debut: 0, duree: media.duree, jusquALaFin: true
    }, projet.medias));
    this._apresModification();
    $('#choix-musique').hidden = true;
    Onglets.ouvrir('son');
    Message.montrer('Musique ajoutée sur toute la vidéo ✓ Règle son volume dans l\'onglet « Son ».');
  },

  /* Change un réglage d'une piste */
  changer(id, propriete, valeur, redessinerListe) {
    const projet = Projets.courant;
    const piste = this.piste(id);
    if (!projet || !piste) return;
    piste[propriete] = valeur;
    Object.assign(piste, nettoyerPiste(piste, projet.medias));
    Projets.modifie();
    this.synchroniser();
    Chronologie.dessinerPistes();
    if (redessinerListe) this.afficherListes();
  },

  _avantVolume() {
    if (this._volumeEnCours) return;
    Chronologie._memoriser();
    this._volumeEnCours = true;
  },

  /* « Commence à la ligne » : la piste est déplacée (même durée) */
  commencerALaLigne(id) {
    if (!this.piste(id)) return;
    Chronologie._memoriser();
    this.changer(id, 'debut', Lecteur.t, true);
  },

  /* « Finit à la ligne » : la fin est posée sur la ligne */
  finirALaLigne(id) {
    const piste = this.piste(id);
    if (!piste) return;
    if (Lecteur.t <= piste.debut + DUREE_CALQUE_MIN) {
      Message.probleme('Place d\'abord la ligne violette APRÈS le début, puis touche à nouveau « Finit à la ligne ».');
      return;
    }
    Chronologie._memoriser();
    piste.jusquALaFin = false;
    this.changer(id, 'duree', Lecteur.t - piste.debut, true);
  },

  supprimer(id, bouton) {
    armerBouton(bouton, 'Supprimer ? Touche encore', () => {
      const projet = Projets.courant;
      const piste = this.piste(id);
      if (!projet || !piste) return;
      Chronologie._memoriser();
      projet.pistes = projet.pistes.filter((p) => p.id !== id);
      this._apresModification();
      Message.montrer((piste.type === 'musique' ? 'Musique retirée.' : 'Voix off supprimée.') + ' « Annuler » la fait revenir.');
    });
  },

  _apresModification() {
    Projets.modifie();
    this.synchroniser();
    this.afficherListes();
    Chronologie.dessinerPistes();
    Projets.afficherMedias();
  },

  /* ---------- L'onglet « Son » ---------- */
  afficherListes() {
    const projet = Projets.courant;
    if (!projet) return;
    const carte = (p) => {
      const media = projet.medias.find((m) => m.id === p.mediaId);
      const fin = p.jusquALaFin ? 'la fin de la vidéo' : formaterDuree(p.debut + p.duree);
      const id = proteger(p.id);
      const volume = Math.round(p.volume * 100);
      return '<li class="carte-piste carte-piste-' + p.type + '">' +
        '<p class="media-nom">' + proteger(media ? media.nom : 'Son') + '</p>' +
        '<p class="aide">De ' + formaterDuree(p.debut) + ' à ' + fin +
          (media && !Medias.disponible(media) ? ' — fichier introuvable' : '') + '</p>' +
        '<label class="champ-curseur">Volume : <span class="mono">' + volume + ' %</span>' +
          '<input type="range" min="0" max="100" step="5" value="' + volume + '" data-piste-volume="' + id + '"></label>' +
        (p.type === 'musique'
          ? '<label class="interrupteur"><input type="checkbox" data-piste-fin="' + id + '"' + (p.jusquALaFin ? ' checked' : '') + '> Jusqu\'à la fin de la vidéo</label>'
          : '') +
        '<div class="rangee-2">' +
          '<button type="button" class="bouton" data-action="piste-debut" data-id="' + id + '">Commence à la ligne</button>' +
          '<button type="button" class="bouton" data-action="piste-fin" data-id="' + id + '">Finit à la ligne</button>' +
        '</div>' +
        '<button type="button" class="bouton large" data-action="supprimer-piste" data-id="' + id + '">' +
          '<svg class="icone" aria-hidden="true"><use href="#i-poubelle"/></svg>' + (p.type === 'musique' ? 'Retirer cette musique' : 'Supprimer cette voix') + '</button>' +
      '</li>';
    };
    const parDebut = (a, b) => a.debut - b.debut;
    const musiques = projet.pistes.filter((p) => p.type === 'musique').sort(parDebut);
    const voix = projet.pistes.filter((p) => p.type === 'voix').sort(parDebut);
    $('#liste-musiques').innerHTML = musiques.map(carte).join('');
    $('#liste-voix').innerHTML = voix.map(carte).join('');
    $('#musiques-vide').hidden = musiques.length > 0;
    $('#voix-vide').hidden = voix.length > 0;
  },

  /* « Ajouter une musique de fond » : on choisit parmi les musiques de « Mes fichiers » */
  montrerChoixMusiques(garderOuvert) {
    const projet = Projets.courant;
    if (!projet) return;
    const musiques = projet.medias.filter((m) => m.type === 'audio' && !m.voix && !m.probleme && Medias.disponible(m));
    const zone = $('#choix-musique');
    zone.hidden = garderOuvert ? false : !zone.hidden;
    if (zone.hidden) return;
    $('#choix-musique-liste').innerHTML = musiques.map((m) =>
      '<button type="button" class="bouton large choix-musique" data-action="ajouter-musique" data-id="' + proteger(m.id) + '">' +
        '<svg class="icone" aria-hidden="true"><use href="#i-musique"/></svg>' + proteger(m.nom) +
        ' <span class="mono">' + formaterDuree(m.duree) + '</span></button>').join('');
    $('#choix-musique-vide').hidden = musiques.length > 0;
  }
};


/* ============================================================
   L'enregistrement de la voix off
   On place la ligne violette, on touche « Enregistrer » : la vidéo
   défile pendant qu'on parle. À l'arrêt, la voix est posée dans la
   chronologie à l'endroit où l'on a commencé.
   ============================================================ */

/* Les formats d'enregistrement possibles, du meilleur au moins bon */
const FORMATS_MICRO = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

const Enregistreur = {
  enCours: false,
  _flux: null,
  _enregistreur: null,
  _morceaux: [],
  _debutMontage: 0,     // position de la ligne au début de l'enregistrement
  _depart: 0,           // heure du début (pour le compteur)
  _minuteur: 0,

  async demarrer() {
    const projet = Projets.courant;
    if (!projet || this.enCours) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder !== 'function') {
      Message.probleme('Ce navigateur ne permet pas d\'enregistrer avec le micro. Utilise Google Chrome à jour.');
      return;
    }
    Lecteur.pause();
    // 1. Le micro (la tablette demande la permission la première fois)
    try {
      this._flux = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      Message.probleme(e && e.name === 'NotFoundError'
        ? 'Aucun micro n\'a été trouvé sur la tablette.'
        : 'Omni-Vidéo n\'a pas le droit d\'utiliser le micro. Touche le petit cadenas à gauche de l\'adresse, ' +
          'puis « Autorisations » → « Micro » → « Autoriser », et réessaie.');
      return;
    }
    // 2. L'enregistreur
    const format = FORMATS_MICRO.find((f) => MediaRecorder.isTypeSupported(f)) || '';
    try {
      this._enregistreur = new MediaRecorder(this._flux, format ? { mimeType: format, audioBitsPerSecond: 128000 } : undefined);
    } catch (e) {
      this._fermerMicro();
      Message.probleme('L\'enregistrement n\'a pas pu démarrer. Ferme Omni-Vidéo et rouvre-la, puis réessaie.');
      return;
    }
    this._morceaux = [];
    // Tout au bout de la vidéo : on enregistre depuis le début
    if (Lecteur.t >= Lecteur.duree() - 0.1) Lecteur.aller(0);
    this._enregistreur.ondataavailable = (e) => { if (e.data && e.data.size) this._morceaux.push(e.data); };
    this._enregistreur.onstart = () => {
      // La voix sera posée exactement là où la vidéo en est quand le micro démarre
      this._debutMontage = Lecteur.t;
      this._depart = Date.now();
      this._majAffichage();
      this._minuteur = setInterval(() => this._majAffichage(), 250);
    };
    this._enregistreur.onerror = () => {
      Message.probleme('L\'enregistrement s\'est arrêté à cause d\'un souci du micro.');
      this.arreter();
    };

    // 3. La vidéo démarre d'abord (le son coupé si demandé) ; le micro
    //    s'allume seulement quand elle tourne VRAIMENT, sinon la voix
    //    serait un peu en avance sur l'image.
    this.enCours = true;
    this._depart = Date.now();
    this._majAffichage();
    const couper = $('#couper-son-enregistrement').checked;
    Lecteur.muet = couper;
    PistesAudio.muet = couper;
    Lecteur.appliquerVolume();
    Veille.empecher();
    Lecteur.lire();
    await this._attendreLaVideo();
    if (!this._enregistreur) return;   // arrêté entre-temps
    this._enregistreur.start(1000);   // un morceau par seconde
  },

  /* Attend que la vidéo de l'aperçu avance vraiment (au plus 2 secondes) */
  _attendreLaVideo() {
    return new Promise((fin) => {
      const seg = Lecteur.segments[Lecteur.index];
      if (!seg || !Lecteur._estVideo(seg)) { fin(); return; }
      const el = Lecteur.elements[Lecteur.actif];
      const depart = el.currentTime;
      const debut = Date.now();
      const verifier = () => {
        if (el.currentTime > depart + 0.02 || Date.now() - debut > 2000 || !Lecteur.enLecture) fin();
        else requestAnimationFrame(verifier);
      };
      requestAnimationFrame(verifier);
    });
  },

  /* Arrêt (bouton, fin de la vidéo, ou Omni-Vidéo mise en arrière-plan) */
  arreter() {
    if (!this._enregistreur) return;
    const enregistreur = this._enregistreur;
    if (enregistreur.state === 'inactive' && !this._morceaux.length) {
      // Arrêté avant même que le micro ait démarré : on remet tout en ordre
      this._enregistreur = null;
      Lecteur.pause();
      Lecteur.muet = false;
      PistesAudio.muet = false;
      Lecteur.appliquerVolume();
      Veille.permettre();
      this._fermerMicro();
      this.enCours = false;
      this._majAffichage();
      return;
    }
    const duree = (Date.now() - this._depart) / 1000;
    this._enregistreur = null;
    clearInterval(this._minuteur);
    Lecteur.pause();
    Lecteur.muet = false;
    PistesAudio.muet = false;
    Lecteur.appliquerVolume();
    Veille.permettre();
    enregistreur.onstop = () => this._terminer(enregistreur.mimeType || 'audio/webm', duree);
    if (enregistreur.state !== 'inactive') enregistreur.stop();
    else this._terminer(enregistreur.mimeType || 'audio/webm', duree);
    this._fermerMicro();
  },

  _fermerMicro() {
    if (this._flux) this._flux.getTracks().forEach((piste) => piste.stop());
    this._flux = null;
  },

  /* La voix est enregistrée : on la range dans le projet */
  async _terminer(format, dureeMesuree) {
    this.enCours = false;
    this._majAffichage();
    const projet = Projets.courant;
    const blob = new Blob(this._morceaux, { type: format.split(';')[0] });
    this._morceaux = [];
    if (!projet) return;
    if (dureeMesuree < 0.5 || blob.size === 0) {
      Message.probleme('L\'enregistrement est trop court. Touche « Enregistrer », parle, puis touche « Arrêter ».');
      return;
    }
    // La durée exacte est lue dans le fichier ; à défaut, celle du compteur
    let duree = dureeMesuree;
    try {
      const infos = await analyserAudio(blob);
      if (Number.isFinite(infos.duree) && infos.duree > 0.3) duree = infos.duree;
    } catch (e) { /* on garde la durée du compteur */ }

    const numero = projet.medias.filter((m) => m.voix).length + 1;
    const media = nettoyerMedia({
      id: nouvelId(), type: 'audio', voix: true, nom: 'Voix off ' + numero,
      taille: blob.size, dateFichier: Date.now(), duree
    });
    try {
      await Base.enregistrerFichier(media.id, blob);
    } catch (e) {
      Message.probleme(messageErreurStockage(e));
      return;
    }
    Medias.fichiers.set(media.id, blob);
    Chronologie._memoriser();
    projet.medias.push(media);
    projet.pistes.push(nettoyerPiste({
      id: nouvelId(), type: 'voix', mediaId: media.id, debut: this._debutMontage, duree, volume: 1
    }, projet.medias));
    PistesAudio._apresModification();
    Lecteur.aller(this._debutMontage);
    Message.montrer('Voix enregistrée ✓ (' + dureeEnMots(duree) + '). Touche « Lecture » pour l\'écouter.');
  },

  /* Le bouton et le compteur */
  _majAffichage() {
    const bouton = $('#bouton-enregistrer');
    $('use', bouton).setAttribute('href', this.enCours ? '#i-stop' : '#i-micro');
    ecrireTexte($('span', bouton), this.enCours ? 'Arrêter l\'enregistrement' : 'Enregistrer ma voix à la ligne violette');
    bouton.classList.toggle('en-enregistrement', this.enCours);
    const etat = $('#etat-enregistrement');
    etat.hidden = !this.enCours;
    if (this.enCours) ecrireTexte(etat, '● Enregistrement en cours : ' + formaterDuree((Date.now() - this._depart) / 1000));
    // Pendant l'enregistrement, le montage est grisé : on ne peut rien y
    // toucher par erreur (seul le bouton « Arrêter » reste actif)
    document.body.classList.toggle('enregistrement-voix', this.enCours);
  },

  basculer() {
    if (this.enCours || this._enregistreur) this.arreter();
    else this.demarrer();
  }
};
