# Omni-Vidéo

Le montage vidéo tout simple, pour YouTube, sur tablette Android. Application
web installable (PWA) de l'Omni-système, **gratuite**, qui fonctionnera
**hors ligne**, **sans compte** et **sans traceur**. Les vidéos et les projets
restent sur la tablette : rien n'est envoyé sur Internet.

**Ouvrir l'application :** https://ferrusdantioch.github.io/omni-video/
(une fois GitHub Pages activé, voir plus bas)

---

## Ce que fait l'application

Omni-Vidéo est construite par étapes. Chaque étape est testable sur la tablette.

| Étape | Contenu | État |
|---|---|---|
| 0. Fondations | Thème Omni-système, test de la tablette au démarrage, page À propos, licence, crédits | ✅ |
| a. Import et lecture | Ajouter des vidéos, images et musiques ; miniatures ; lecture ; vidéos retrouvées à la réouverture | ✅ |
| b. Chronologie | Couper, enlever le début ou la fin, déplacer, supprimer, assembler les clips ; Annuler / Rétablir ; aperçu du montage | ✅ |
| c. Texte et images | Textes (police, taille, couleur, style, position, durée, fondu), images incrustées ; déplacement au doigt dans l'aperçu | ✅ |
| d. Audio | Musique de fond (fondus automatiques, répétée si trop courte), voix off enregistrée au micro pendant que la vidéo défile, volume de chaque musique, voix et clip | ✅ |
| e. Transitions | Fondu au noir, fondu enchaîné, glissement (0,5 / 1 / 2 s), entre deux clips ou partout ; fondu au début et à la fin de la vidéo | ✅ |
| f. Sous-titres | Saisie à la main, import .srt / .vtt (accents compris), apparence (taille, place, fond, couleur), décalage de tous les sous-titres, enregistrement en .srt ; incrustés dans l'image | ✅ |
| g. Export MP4 | H.264 + AAC, 16:9 ou 9:16, 720p ou 1080p, 30 images par seconde ; progression, temps restant, arrêt ; écran gardé allumé ; enregistrement dans la tablette ou partage | ✅ |
| h. Hors ligne | Fonctionne sans Internet après la première visite, installation sur l'écran d'accueil, mise à jour au choix (« Mettre à jour »), sauvegarde et import de projet (fichier .omnivideo) | ✅ |

### Bon à savoir

- **Les vidéos ne sont jamais copiées** dans l'application (une vidéo de
  30 minutes pèse 1 à 3 Go). Omni-Vidéo retient leur nom et leur taille. Quand
  on rouvre un projet, l'application demande de **resélectionner les vidéos**
  (toutes d'un coup) et les reconnaît toute seule. Les images et les musiques,
  plus légères, sont gardées par l'application.
- **La chronologie** : la ligne violette reste au milieu, c'est la bande qui
  glisse sous le doigt. Les outils (« Couper ici », « Enlever avant la
  ligne », « Enlever après la ligne », « Plus tôt », « Plus tard »,
  « Supprimer le clip ») s'appliquent au clip encadré en violet, celui qui est
  sous la ligne. Toute modification peut être annulée.
- **Textes et images incrustées** (onglets « Textes » et « Images ») : ils
  s'affichent par-dessus la vidéo, à partir de la ligne violette. On peut les
  faire glisser du doigt dans l'aperçu, ou les toucher pour les modifier.
  Ils restent à leur moment dans la vidéo : si l'on supprime ou déplace un
  clip, il faut parfois les replacer.
- **Les transitions** : touchez une pastille ronde entre deux clips dans la
  chronologie (ou « Transition avant ce clip »). Le fondu enchaîné et le
  glissement font se chevaucher les deux clips : la vidéo raccourcit un peu.
- **Le son** (onglet « Son ») : une musique de fond se met sur toute la vidéo,
  à 30 % du volume, avec un fondu au début et à la fin. Pour la voix off, on
  place la ligne violette, on touche « Enregistrer » et on parle pendant que
  la vidéo défile. Le son de chaque clip se règle sous la chronologie.
- **Les sous-titres** (onglet « Sous-titres ») : placez la ligne violette là
  où quelqu'un parle, touchez « Ajouter un sous-titre » et écrivez ; « Ajouter
  le sous-titre d'après » enchaîne le suivant. On peut aussi importer un
  fichier .srt ou .vtt (celui que YouTube propose de télécharger, par
  exemple). Les sous-titres sont incrustés dans l'image de la vidéo finale ;
  « Enregistrer en fichier .srt » donne en plus un fichier à envoyer sur
  YouTube, si vous préférez des sous-titres que le spectateur peut masquer.
- **Fabriquer la vidéo** (bouton violet en haut de l'écran du projet) :
  choisissez la forme et la qualité (1080p conseillée pour YouTube, 720p plus
  rapide), puis « Fabriquer ». Gardez Omni-Vidéo ouverte au premier plan
  pendant la fabrication : l'écran reste allumé tout seul. À la fin,
  « Enregistrer dans la tablette » met la vidéo dans « Téléchargements » ;
  il ne reste qu'à l'envoyer depuis l'application YouTube. La vidéo est
  d'abord écrite dans un espace privé du navigateur : prévoyez **deux fois
  sa taille** en place libre (une fois pour la fabrication, une fois pour
  l'enregistrement), puis touchez « Libérer la place ».
- **Sans Internet** : après la première visite, toute l'application est
  rangée dans la tablette et s'ouvre même hors connexion. Le bandeau
  « Installer » de l'accueil ajoute son icône sur l'écran d'accueil.
  Quand une nouvelle version est publiée, un bandeau propose « Mettre à
  jour » : rien ne change sans votre accord (et jamais pendant la
  fabrication d'une vidéo).
- **Sauvegarder un projet** (bouton « Sauvegarder » sur l'accueil) : un
  fichier .omnivideo avec le montage, les images, les musiques et les voix
  off. Les vidéos n'y sont pas (trop lourdes) : après « Importer une
  sauvegarde de projet », on les redonne avec « Retrouver mes vidéos ».
- **Le test de la tablette** (bouton « Vérifier ma tablette ») indique ce qui
  fonctionne : lecture des vidéos, fabrication du MP4, place disponible,
  mémoire, micro…
- **Navigateur conseillé** : Google Chrome à jour (version 107 ou plus).

## Essais de l'export (limites mesurées)

Essais faits sur un ordinateur de test (Chromium sous Linux, 4 cœurs, **sans
puce vidéo** : tout est calculé par le processeur). Montage : une vidéo
1080p, un titre affiché tout le long, un sous-titre toutes les 6 secondes,
une musique de fond répétée, fondus au début et à la fin.

| Durée | Qualité | Temps de fabrication | Poids du fichier | Mémoire du navigateur |
|---|---|---|---|---|
| 1 min | 1080p | 35 s | 58 Mo | 1,4 Go |
| 5 min | 1080p | 2 min 56 s | 290 Mo | 1,4 à 1,7 Go |
| 15 min | 1080p | 8 min 36 s | 869 Mo | stable |
| 30 min | 1080p | 16 min 39 s | 1,7 Go | 1,4 Go, stable |
| 30 min | 720p | 15 min 9 s | 1,1 Go | 1,3 Go, stable |

Ce que montrent ces essais :

- **La mémoire ne grossit pas avec la durée** : la vidéo est écrite petit à
  petit sur le disque. La mémoire JavaScript reste sous 31 Mo. Une vidéo de
  30 minutes ne prend pas plus de mémoire qu'une vidéo de 1 minute.
- **La vraie limite est la place libre** : il faut environ 60 Mo par minute
  en 1080p (37 Mo en 720p), et **deux fois** ce poids pendant
  l'enregistrement dans la tablette. Omni-Vidéo vérifie la place avant de
  commencer et explique le souci s'il en manque. En navigation privée,
  Chrome limite fortement cette place : l'essai de 30 minutes s'y est arrêté
  vers 1,1 Go, avec le message prévu.
- **Fichiers vérifiés** : bonne durée (au centième de seconde), 30 images
  par seconde sans image perdue (54 000 images pour 30 minutes), son AAC
  48 kHz stéréo, image fidèle à l'originale jusqu'à la dernière minute.
- **Sur la tablette**, la vitesse dépendra de sa puce vidéo : avec elle,
  c'est souvent plus rapide que ci-dessus ; sans elle, plus lent. Omni-Vidéo
  retient la vitesse de la dernière fabrication et annonce ensuite le temps
  avant de commencer.

## Les fichiers

Tous les fichiers sont à la racine du dépôt (pas de sous-dossier), pour
pouvoir les envoyer depuis un téléphone ou une tablette.

| Fichier | Rôle |
|---|---|
| `index.html` | Les écrans et **tous les textes affichés** |
| `styles.css` | Couleurs du thème Omni-système (tout en haut), tailles, mise en page |
| `app.js` | Le chef d'orchestre : navigation, boutons, démarrage, numéro de version |
| `outils.js` | Petits outils : mise en forme des durées et des tailles, boutons « deux appuis », messages |
| `stockage.js` | L'enregistrement des projets dans la tablette (IndexedDB) |
| `capacites.js` | Le test de la tablette (« Vérifier ma tablette ») |
| `medias.js` | L'import et l'analyse des vidéos, images et musiques |
| `visionneuse.js` | La fenêtre « Voir un fichier » (lecture d'une vidéo, d'une image ou d'une musique) |
| `transitions.js` | Le calcul du montage : place de chaque clip, transitions (le même pour l'aperçu et la vidéo finale) |
| `lecteur.js` | L'aperçu du montage : joue les clips les uns après les autres, avec les transitions |
| `chronologie.js` | La chronologie : la bande des clips, la ligne violette, les outils, Annuler / Rétablir |
| `rendu.js` | Le dessin des textes, des images incrustées et des sous-titres (le même pour l'aperçu et pour la vidéo finale) ; polices et couleurs proposées |
| `incrustations.js` | Les onglets du panneau, la liste et l'éditeur des textes et images incrustées, le déplacement au doigt |
| `audio.js` | La musique de fond et les voix off (lecture avec l'aperçu, enregistrement au micro, onglet « Son ») |
| `sous-titres.js` | Les sous-titres : lecture des fichiers .srt / .vtt, éditeur, liste, apparence, enregistrement en .srt |
| `fabrication.js` | La fabrication de la vidéo finale : mélange du son, dessin de chaque image, écriture du MP4 |
| `disque-prive.js` | Un petit « travailleur » qui écrit la vidéo finale sur la tablette, morceau par morceau (indispensable sur Android pour les vidéos longues) |
| `export.js` | La fenêtre « Fabriquer la vidéo » : réglages, progression, vidéo prête |
| `encodeur-aac.js` `encodeur-aac.wasm` | L'encodeur AAC de secours, celui de VisualOn (seulement si la tablette ne sait pas fabriquer le son AAC ; ne pas modifier le .wasm) |
| `encodeur-aac.c` | La passerelle de l'encodeur AAC, et la recette pour recompiler `encodeur-aac.wasm` |
| `sauvegarde.js` | Sauvegarder un projet dans un fichier .omnivideo, et l'importer |
| `sw.js` | Le « service worker » : range l'application dans la tablette pour qu'elle marche sans Internet |
| `manifest.json` | La carte d'identité de l'application installée (nom, icônes, couleurs) |
| `icon-192.png` `icon-512.png` `maskable-512.png` `apple-touch-icon.png` | Les icônes de l'application installée, tirées du logo |
| `projets.js` | La liste des projets, la sauvegarde automatique, l'écran du projet |
| `mediabunny.min.js` | La bibliothèque vidéo Mediabunny (ne pas modifier) |
| `logo.svg` | Le logo : le dé à vingt faces de l'Omni-système |
| `oxanium.woff2` `literata.woff2` `jetbrains-mono.woff2` | Les polices du thème Omni-système |
| `LICENSE` | La licence du code |
| `CREDITS.md` | Les éléments créés par d'autres, et leur licence |
| `LICENCE-MEDIABUNNY.txt` | La licence de Mediabunny (MPL-2.0) |
| `POLICES-OFL.txt` | La licence des polices |
| `LICENCE-APACHE-VO-AACENC.txt` | La licence de l'encodeur AAC de VisualOn (Apache 2.0) |

---

## Publier sur GitHub (GitHub Pages)

GitHub Pages met gratuitement le site en ligne, à partir des fichiers du dépôt.
Tout se fait depuis le navigateur, même sur une tablette ou un téléphone.

### 1. Renommer le dépôt en minuscules (une seule fois, facultatif)

1. Ouvrez **github.com/FerrusDantioch/Omni-video** dans Chrome.
   *Si l'affichage est trop simplifié : menu ⋮ de Chrome → cochez
   « Version pour ordinateur ».*
2. Onglet **Settings** (roue dentée), tout en haut de la page.
3. Champ **Repository name** : écrivez `omni-video`, puis **Rename**.

GitHub redirige automatiquement l'ancienne adresse vers la nouvelle.

### 2. Activer GitHub Pages (une seule fois)

1. Toujours dans **Settings**, menu de gauche → **Pages**.
2. **Source** : `Deploy from a branch`.
3. **Branch** : choisissez `main` (après avoir fusionné la branche de
   travail `ccr-a42e77ca-u3d99b` dans `main`, voir plus bas), ou directement
   la branche de travail pour l'essayer, dossier `/ (root)`. Touchez
   **Save**.
4. Patientez 1 à 2 minutes, puis rechargez la page : l'adresse apparaît en
   haut. Ce sera : `https://ferrusdantioch.github.io/omni-video/`

> ⚠️ GitHub Pages n'est gratuit que sur les dépôts **publics**.

### 3. Fusionner la branche de travail dans `main` (une fois l'application terminée)

1. Sur la page du dépôt, un bandeau jaune propose **Compare & pull request**
   pour la branche `ccr-a42e77ca-u3d99b` (sinon : onglet **Pull requests** →
   **New pull request**, base `main`, compare `ccr-a42e77ca-u3d99b`).
2. Touchez **Create pull request**, puis **Merge pull request** et
   **Confirm merge**.
3. Dans **Settings → Pages**, choisissez la branche `main`.

### 4. Ouvrir et installer l'application sur la tablette

1. Ouvrez l'adresse dans **Chrome**, avec une connexion Internet.
2. Touchez **Vérifier ma tablette** pour voir ce que la tablette sait faire.
3. Touchez **Installer** sur l'accueil (ou menu ⋮ de Chrome → **Ajouter à
   l'écran d'accueil**). Si Chrome affiche « Cette appli est déjà
   installée » alors qu'elle ne l'est pas, c'est une limite de Chrome quand
   une autre application de `ferrusdantioch.github.io` est déjà installée :
   choisissez alors « Créer un raccourci » (explication aussi dans À propos).
4. Rouvrez-la une fois : « Vérifier ma tablette » doit dire « elle
   fonctionne sans Internet ».

### Publier une modification

⚠️ **À chaque modification d'un fichier de l'application**, augmentez d'un
cran le numéro en haut de `sw.js` :

```js
const CACHE = 'omni-video-v1';   // → 'omni-video-v2', puis v3…
```

et le numéro `VERSION` en haut d'`app.js` (affiché dans À propos). Si vous
ajoutez un fichier, inscrivez-le aussi dans la liste `FICHIERS` de `sw.js`.
Sans cela, les tablettes garderaient l'ancienne version.

GitHub Pages se met à jour 1 à 2 minutes après chaque envoi. Sur la
tablette, rouvrez Omni-Vidéo : un bandeau « Une nouvelle version est
prête » apparaît sur l'accueil, touchez **Mettre à jour**. S'il n'apparaît
pas encore, attendez quelques minutes (GitHub garde les fichiers en mémoire
jusqu'à 10 minutes) et rouvrez l'application.

---

## Conception

Application développée par **Ferrus Dantioch**, avec l'aide de **Claude**, une
intelligence artificielle développée par Anthropic. Ferrus Dantioch, créateur
de l'Omni-système, en a imaginé l'idée, les fonctions et l'apparence ; Claude
en a écrit le code. (C'est aussi indiqué dans la page « À propos » de
l'application.) L'application elle-même n'utilise aucune intelligence
artificielle.

Pour découvrir l'Omni-système : **le portfolio**,
https://ferrusdantioch.github.io/omni-systeme/ (lien aussi dans « À propos »).

## Licence

**© 2026 Ferrus Dantioch — Creative Commons BY-NC-ND 4.0**
([résumé de la licence en français](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.fr))

En clair : le partage est autorisé, à l'identique et en citant l'auteur ;
l'usage commercial est interdit ; la modification et les œuvres dérivées
sont interdites. Le logiciel est fourni « en l'état », sans aucune garantie.

Texte complet dans le fichier [LICENSE](LICENSE) : le texte officiel en
anglais, suivi de la traduction française officielle publiée par Creative
Commons.

Les éléments créés par d'autres (la bibliothèque Mediabunny, sous Mozilla
Public License 2.0, et les polices, sous SIL Open Font License 1.1) gardent
leur propre licence : voir [CREDITS.md](CREDITS.md).

---
*Réalisé par Ferrus Dantioch*
