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
| e. Transitions | Fondu, fondu enchaîné, glissement | à venir |
| f. Sous-titres | Saisie, import .srt / .vtt, incrustation | à venir |
| g. Export MP4 | H.264 + AAC, 16:9 ou 9:16, 720p ou 1080p, progression, annulation | à venir |
| h. Hors ligne | Service worker, installation sur l'écran d'accueil, export / import de projet | à venir |

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
- **Le son** (onglet « Son ») : une musique de fond se met sur toute la vidéo,
  à 30 % du volume, avec un fondu au début et à la fin. Pour la voix off, on
  place la ligne violette, on touche « Enregistrer » et on parle pendant que
  la vidéo défile. Le son de chaque clip se règle sous la chronologie.
- **Le test de la tablette** (bouton « Vérifier ma tablette ») indique ce qui
  fonctionne : lecture des vidéos, fabrication du MP4, place disponible,
  mémoire, micro…
- **Navigateur conseillé** : Google Chrome à jour (version 107 ou plus).

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
| `lecteur.js` | L'aperçu du montage : joue les clips les uns après les autres |
| `chronologie.js` | La chronologie : la bande des clips, la ligne violette, les outils, Annuler / Rétablir |
| `rendu.js` | Le dessin des textes et images incrustées (le même pour l'aperçu et pour la vidéo finale) ; polices et couleurs proposées |
| `incrustations.js` | Les onglets, la liste et l'éditeur des textes et images incrustées, le déplacement au doigt |
| `audio.js` | La musique de fond et les voix off (lecture avec l'aperçu, enregistrement au micro, onglet « Son ») |
| `projets.js` | La liste des projets, la sauvegarde automatique, l'écran du projet |
| `mediabunny.min.js` | La bibliothèque vidéo Mediabunny (ne pas modifier) |
| `logo.svg` | Le logo : le dé à vingt faces de l'Omni-système |
| `oxanium.woff2` `literata.woff2` `jetbrains-mono.woff2` | Les polices du thème Omni-système |
| `LICENSE` | La licence du code |
| `CREDITS.md` | Les éléments créés par d'autres, et leur licence |
| `LICENCE-MEDIABUNNY.txt` | La licence de Mediabunny (MPL-2.0) |
| `POLICES-OFL.txt` | La licence des polices |

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
3. **Branch** : choisissez la branche qui contient l'application (pendant la
   construction, c'est la branche de travail `ccr-a42e77ca-u3d99b` ; une fois
   l'application terminée, ce sera `main`), dossier `/ (root)`. Touchez
   **Save**.
4. Patientez 1 à 2 minutes, puis rechargez la page : l'adresse apparaît en
   haut. Ce sera : `https://ferrusdantioch.github.io/omni-video/`

> ⚠️ GitHub Pages n'est gratuit que sur les dépôts **publics**.

### 3. Ouvrir l'application sur la tablette

1. Ouvrez l'adresse dans **Chrome**.
2. Touchez **Vérifier ma tablette** pour voir ce que la tablette sait faire.

L'installation sur l'écran d'accueil et le fonctionnement sans connexion
arriveront à l'étape (h).

### Après une modification

GitHub Pages se met à jour 1 à 2 minutes après chaque envoi. Sur la tablette,
rechargez la page (tirez l'écran vers le bas dans Chrome). Si l'ancienne
version reste affichée, attendez encore quelques minutes : GitHub garde les
fichiers en mémoire jusqu'à 10 minutes.

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
