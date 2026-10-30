# Omni-Vidéo — notes pour Claude

PWA de montage vidéo pour YouTube, pour une utilisatrice débutante, sur
tablette Android milieu de gamme, en **HTML/CSS/JS pur, sans compilation**.
Application de l'Omni-système, sœur de L'Atelier, Omni-Time, Refuge et Cap.
L'auteur est novice en programmation : garder les commentaires en français
simple, sans jargon, et lui répondre en français.

Écrans : Accueil (liste des projets), Projet (aperçu + « Mes fichiers »),
Vérifier ma tablette, À propos.

## Construction par étapes

0 fondations ✅ · a import et lecture ✅ · b chronologie ✅ · c texte et images ✅ ·
d audio ✅ · e transitions ✅ · f sous-titres ✅ · g export MP4 ✅ · h hors ligne et
installation ✅. Après chaque étape : expliquer comment tester sur la tablette.
À la fin : ajouter Omni-Vidéo au portfolio (`omni-systeme/index.html` et son
README), dans le groupe « Création de contenu ».

## ⚠️ Contraintes à préserver

- **Le vrai nom de l'auteur n'apparaît nulle part.** Seul le pseudonyme
  **Ferrus Dantioch** est utilisé.
- **Licence : Creative Commons BY-NC-ND 4.0**, la même que L'Atelier.
  `LICENSE` est une copie exacte de celui de L'Atelier. Chaque fichier de code
  (HTML, CSS, JS) commence par la même mention de trois lignes ; tout nouveau
  fichier de code la reçoit aussi. `mediabunny.min.js` garde SA mention
  (MPL-2.0) et n'est **jamais modifié** (copie de
  `dist/bundles/mediabunny.min.cjs` du paquet npm). Toute nouvelle
  bibliothèque doit avoir une licence compatible et être ajoutée à
  `CREDITS.md` et au bloc « Crédits » de la page À propos.
- **Thème Omni-système : valeurs du portfolio, à l'identique** (celles de
  `css/theme.css` de L'Atelier, mêmes noms de variables que le thème « omni »
  d'Omni-Time). Ne pas « améliorer » ces couleurs. Aucun blanc pur ni noir pur
  dans l'interface (le noir du cadre d'aperçu est le fond de la VIDÉO).
- **Tutoiement** dans l'application ; vouvoiement dans le README.
- **Zones tactiles larges** (56 px au minimum), toujours une icône ET un
  texte, `prefers-reduced-motion` respecté, transitions lentes (400 ms),
  aucun clignotement.
- **Actions qui font perdre quelque chose = deux appuis** (`armerBouton()`).
  Jamais de `confirm()` natif.
- **Aucun compte, aucun appel réseau, aucun traceur, aucune bibliothèque
  chargée depuis Internet.**
- Garder tous les fichiers **à la racine** : l'envoi depuis un téléphone ne
  sait pas créer de dossier.

## ⚠️ Mémoire : ne jamais charger une vidéo entière

- Les vidéos sont lues par Mediabunny avec `BlobSource` (lecture par
  morceaux) ; chaque `Input` est fermé par `dispose()` après usage.
- Les `VideoFrame` / `VideoSample` doivent toujours être fermés (`close()`).
- L'aperçu du montage (`lecteur.js`) utilise deux `<video>` qui se relaient
  (adresses `blob:`, lecture en flux par le navigateur) : l'un joue, l'autre
  prépare le clip suivant. Le lecteur caché reste transparent (classe
  `montre`), pas `display:none`, pour que son image soit prête. `Lecteur.vider()`
  et `Visionneuse.arreter()` lâchent les fichiers.
- La chronologie (`chronologie.js`) : marge d'une demi-largeur au début et à
  la fin, donc `scrollLeft = t × pps`. ⚠️ `.chronologie` garde
  `grid-template-columns: minmax(0, 1fr)` et `min-width: 0`, sinon la bande
  élargit la page sans fin (boucle avec le ResizeObserver).
- Mesuré : import d'une vidéo de 30 min (915 Mo) en 0,4 s, 18 Mo de mémoire JS.
- La vidéo finale est écrite petit à petit dans le disque privé du
  navigateur (OPFS, fichier `omnivideo-export.mp4`) avec `StreamTarget`,
  `fastStart: false`, par `DisquePrive.ouvrirFichier()` : `createWritable()`
  si la page l'a, SINON le travailleur `disque-prive.js`
  (`createSyncAccessHandle()`, ce que Chrome Android sait faire ;
  `fluxParTravailleur()` attend chaque morceau de 8 Mo). ⚠️ Sans ce
  travailleur, Android retombait sur la mémoire vive et refusait toute
  vidéo de plus de ~5 min (« vidéos courtes », signalé en 1.0.1).
  `BufferTarget` seulement si aucune des deux ne marche, et pour moins de
  300 Mo (`TAILLE_MAX_EN_MEMOIRE`). `DisquePrive.peutEcrire()` (essai réel,
  une fois par visite) sert à l'export ET à « Vérifier ma tablette ».

## Export (fabrication.js, export.js)

- `fabriquerVideo()` avance **seconde par seconde** : d'abord le son de la
  seconde (mélangé en Float32, 48 kHz stéréo, puis `AudioSampleSource`),
  ensuite ses 30 images (`CanvasSource` sur une toile 1280×720 ou
  1920×1080). Son et image avancent ensemble : le muxeur ne garde presque
  rien en mémoire.
- Images : `SourceImages` (une par segment, `VideoSampleSink.samples()`,
  lecture dans l'ordre, deux `VideoSample` au plus, toujours `close()`),
  `drawWithFit` (contain / cover = « contenir » / « remplir »), opacité et
  décalage de `Montage.etat()`, puis `Rendu.dessiner()` (calques et
  sous-titres). `Rendu.preparerImages()` avant de commencer.
- Son : `SourceSon` (une par segment ou par piste, `AudioBufferSink.buffers()`,
  ré-échantillonnage linéaire, volume recalculé tous les 128 échantillons
  avec `Montage.etat().son × clip.volume` et `PistesAudio.volumeA()`,
  `positionA()` pour les musiques qui recommencent). Plan B pour une musique
  que Mediabunny ne décode pas : `decodeAudioData` (fichier < 150 Mo).
- AAC : `canEncodeAudio('aac')` ; sinon chargement à la demande
  d'`encodeur-aac.js` (ne jamais le charger d'office), qui s'enregistre
  (`Mediabunny.registerEncoder`) comme `CustomAudioEncoder` et utilise
  `encodeur-aac.wasm` : vo-aacenc 0.1.3 (VisualOn, Apache 2.0, AUCUN
  morceau de FFmpeg, choix de l'utilisatrice) compilé par clang/wasm-ld
  avec la passerelle `encodeur-aac.c` (recette dans son en-tête). Trames
  AAC brutes de 1024 échantillons, horodatées avec −1600 échantillons
  (`AVANCE_AAC`, retard mesuré de l'encodeur) : son et image calés au
  millième de seconde (vérifié avec un clic et un flash à 2,000 s).
- Pendant l'export (`Export.enCours`) : `Veille`, fenêtre impossible à
  fermer (cancel/close), retour arrière bloqué (popstate dans app.js),
  `beforeunload`, et l'aperçu lâche ses vidéos (`Lecteur.vider()`), car une
  tablette n'a que quelques décodeurs vidéo. La future bannière « Mettre à
  jour » (étape h) ne doit jamais s'afficher pendant un export.
- Vitesse mémorisée par qualité (`omnivideo-vitesse-720p/1080p`, secondes de
  fabrication par seconde de vidéo) pour annoncer le temps avant de lancer.

## Données

- IndexedDB `omnivideo` (voir `stockage.js`) : tiroir `projets` (clé `id`) et
  tiroir `fichiers` (Blob des images, musiques et voix, clé = id du média).
- **Les vidéos ne sont jamais copiées** (choix de l'utilisatrice, « option
  A ») : le média retient `nom`, `taille`, `dateFichier`, `miniature`. À la
  réouverture, `Medias.retrouver()` reconnaît les fichiers resélectionnés par
  nom + taille (ou taille seule si elle est unique).
- `Medias.fichiers` (Map id → File/Blob) n'existe que pendant la visite.
- `projet.clips` : `[{ id, mediaId, debut, fin, volume }]`, joués dans l'ordre ;
  `debut`/`fin` sont des secondes DANS le fichier d'origine (image : 0 → durée).
  Annuler / Rétablir garde des copies JSON de `clips`, `calques`, `pistes`,
  transitions et sous-titres (60 au plus) ;
  une seule étape par séance de modification d'un calque (`_avantChangement`).
- `projet.calques` : textes et images incrustées, `debut`/`duree` en secondes
  du MONTAGE (pas d'un clip : ils ne suivent pas les clips déplacés), `x`/`y`
  = centre en fractions 0–1 (le calque est ensuite gardé dans le cadre, marge
  4 %). Texte : `taille` en % du CÔTÉ LE PLUS COURT de l'image (même aspect
  en 16:9 et 9:16), réduit tout seul si un mot dépasse. Image : `largeur` en %
  de la largeur.
- `projet.pistes` : `[{ id, type: 'musique'|'voix', mediaId, debut, duree,
  jusquALaFin, volume }]`, `debut` en secondes du MONTAGE. `PistesAudio.duree()`
  donne la vraie durée (`jusquALaFin` = jusqu'au bout du montage, musique
  répétée si plus courte ; une voix ne se répète jamais). Fondus fixes
  (`FONDUS_PISTE`) : musique 1 s / 2 s, voix 0,05 s. L'export devra utiliser
  `PistesAudio.volumeA()` et `positionA()` pour sonner comme l'aperçu.
- Transitions : `clip.transition = { type, duree }` = la transition qui MÈNE à
  ce clip (ignorée pour le premier) ; `projet.transitionDebut` / `transitionFin`
  (aucune ou fondu). `Montage.segments()` (transitions.js) place les clips :
  enchaîné et glissement les font se chevaucher (durée ≤ moitié de chaque
  clip, donc jamais plus de deux clips à la fois). `Montage.etat()` donne
  opacité, décalage du glissement et volume : à réutiliser tel quel à l'export.
- `lecteur.js` : 2 `<video>` + 2 `<img>` superposés ; `_attribuer()` donne un
  élément à chacun des (au plus) deux segments utiles, `_composer()` applique
  opacité / translateX / volume à chaque image ; le clip suivant démarre
  pendant un chevauchement. `Lecteur.elementPrincipal()` = la vidéo en cours.
- Les voix off sont des médias `type: 'audio', voix: true` (Blob WebM/Opus du
  MediaRecorder, dans le tiroir `fichiers`), cachés de « Mes fichiers ». Une
  voix qui n'est plus utilisée par aucune piste est effacée à la réouverture
  du projet (pas avant, pour qu'« Annuler » puisse la faire revenir).
- Enregistrement : la vidéo démarre d'abord (son coupé si la case est cochée),
  le micro s'allume quand elle avance vraiment, et la voix est posée à
  `Lecteur.t` au démarrage du micro (`onstart`). Écran gardé allumé (`Veille`
  dans outils.js), arrêt automatique en fin de vidéo ou en arrière-plan.
- Aperçu du son : un `<audio>` par piste, recalé s'il s'écarte de plus de
  0,25 s ; volume du clip par `el.volume` (0 à 1) ; `Lecteur.muet` pendant
  l'enregistrement.
- `projet.sousTitres` : `[{ id, debut, duree, texte }]`, temps du MONTAGE,
  toujours triés par `debut` (5000 au plus) ; `projet.styleSousTitres` =
  `{ taille, place, fond, couleur, visibles }`, le même pour tous.
  `Rendu.dessiner()` les dessine EN DERNIER (par-dessus les calques), police
  « simple », via `dessinerTexte()` avec une marge de 7 % (`calque.marge`).
  Dans l'aperçu, toucher un sous-titre ouvre son éditeur (pas de déplacement
  au doigt). Un sous-titre laissé vide disparaît en fermant l'éditeur.
  Import (`sous-titres.js`) : `lireSousTitres()` comprend .srt et .vtt, enlève
  les balises ; `lireFichierTexte()` essaie UTF-8 puis Windows-1252 (vieux
  .srt français). Pas de filtre `accept` sur le sélecteur : Android ne
  reconnaît pas toujours les .srt. Annuler / Rétablir les garde aussi.
- ⚠️ `rendu.js` dessine les calques pour l'aperçu ET pour l'export : ne jamais
  dessiner un calque autrement à l'export, sinon l'aperçu mentirait.
- ⚠️ `nettoyerProjet()` et `nettoyerMedia()` ne gardent **que** les champs
  qu'elles connaissent : tout nouveau champ doit y être ajouté.
- Positions des éléments (textes, images…) : en fractions de l'image (0 à 1),
  pour qu'un changement de format 16:9 ↔ 9:16 reste correct.

## Même adresse de site que les autres applications

Toutes les applications sont servies depuis `ferrusdantioch.github.io` : elles
partagent le même `localStorage`, le même IndexedDB et le même espace de
caches. Tous les noms commencent par `omnivideo` (base, clés) ; le service
worker (`sw.js`) ne supprime que les caches qui commencent par
`omni-video-`, et vérifie à chaque ouverture que son cache est complet.
Pas de `skipWaiting()` automatique : une mise à jour attend un appui sur
« Mettre à jour », et jamais pendant un export.

## Hors ligne, installation, sauvegardes (étape h)

- `sw.js` : modèle d'Omni-Time. Cache `omni-video-vN`, ne supprime que les
  caches `omni-video-*`, vérifie à chaque navigation que le cache est complet
  (sinon le remplit), `{ cache: 'reload' }`, jamais de remplacement en
  arrière-plan. `skipWaiting()` seulement au message `{ type: 'activer' }`.
  Message `{ type: 'verifier' }` + MessageChannel → `{ complet, version }`
  (utilisé par `etatHorsLigne()` d'app.js pour « Vérifier ma tablette »).
- `MiseAJour` (app.js) : `#bandeau-mise-a-jour` sur l'accueil, « Plus
  tard », caché pendant `Export.enCours` (et `Export` le rappelle à la fin).
  Rechargement sur `controllerchange` seulement après « Mettre à jour ».
- `Installation` (app.js) : `beforeinstallprompt` → `#bandeau-installer`.
- Icônes tirées de `logo.svg` (fond `#14111d`, coins arrondis pour « any »,
  logo à 76 % pour le « maskable »).
- `sauvegarde.js` : fichier `.omnivideo` = `OMNIVIDEO-PROJET-1\n` + longueur
  (uint32 LE) + JSON `{ format, version, application, date, projet,
  fichiers: [{ id, taille, type }] }` + Blobs collés à la suite. Assemblé et
  relu par `Blob`/`slice` (rien d'entier en mémoire). À l'import : NOUVEAUX
  numéros pour le projet et ses médias (clips, calques, pistes renommés),
  pour qu'une double importation ne partage jamais un fichier. Les vidéos ne
  sont pas dans la sauvegarde (« Retrouver mes vidéos »).
- `nomDeFichier()` enlève les accents : Chromium remplace sinon le nom d'un
  téléchargement par « download ».

## Numéro de version

`VERSION` en haut d'`app.js` (affiché dans À propos) ET `CACHE` en haut de
`sw.js` (`omni-video-vN` → `vN+1`), à augmenter à chaque version publiée qui
modifie un fichier mis en cache (tout sauf README, CLAUDE.md, CREDITS.md,
LICENSE et les fichiers de licence). Tout nouveau fichier va dans
`FICHIERS` de `sw.js`.

## Tester en local

WebCodecs et le service worker ne fonctionnent que sur `https://` ou
`http://localhost`, jamais en `file://`. Servir le dossier parent pour
reproduire l'adresse de GitHub Pages, par exemple `python3 -m http.server`
depuis le dossier qui contient `omni-video`, puis ouvrir
`http://localhost:8000/omni-video/`.

Le Chromium de test sous Linux sait encoder/décoder le H.264 mais **pas
encoder l'AAC** (Android le sait en général) : prévoir l'encodeur de secours
à l'étape g et le tester.

Déploiement : GitHub Pages, racine → https://ferrusdantioch.github.io/omni-video/
