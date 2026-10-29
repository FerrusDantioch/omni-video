# Omni-Vidéo — notes pour Claude

PWA de montage vidéo pour YouTube, pour une utilisatrice débutante, sur
tablette Android milieu de gamme, en **HTML/CSS/JS pur, sans compilation**.
Application de l'Omni-système, sœur de L'Atelier, Omni-Time, Refuge et Cap.
L'auteur est novice en programmation : garder les commentaires en français
simple, sans jargon, et lui répondre en français.

Écrans : Accueil (liste des projets), Projet (aperçu + « Mes fichiers »),
Vérifier ma tablette, À propos.

## Construction par étapes

0 fondations ✅ · a import et lecture ✅ · b chronologie ✅ · c texte et images ·
d audio · e transitions · f sous-titres · g export MP4 · h hors ligne et
installation. Après chaque étape : expliquer comment tester sur la tablette.
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
- La vidéo finale (étape g) sera écrite petit à petit dans le disque privé du
  navigateur (OPFS) avec `StreamTarget`, jamais dans un `BufferTarget`.

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
  Annuler / Rétablir garde des copies JSON de `clips` (60 au plus).
- ⚠️ `nettoyerProjet()` et `nettoyerMedia()` ne gardent **que** les champs
  qu'elles connaissent : tout nouveau champ doit y être ajouté.
- Positions des éléments (textes, images…) : en fractions de l'image (0 à 1),
  pour qu'un changement de format 16:9 ↔ 9:16 reste correct.

## Même adresse de site que les autres applications

Toutes les applications sont servies depuis `ferrusdantioch.github.io` : elles
partagent le même `localStorage`, le même IndexedDB et le même espace de
caches. Tous les noms commencent par `omnivideo` (base, clés) ; le service
worker (étape h) ne devra supprimer que les caches qui commencent par
`omni-video-`, et vérifier à chaque ouverture que son cache est complet.
Pas de `skipWaiting()` automatique : une mise à jour attend un appui sur
« Mettre à jour », et jamais pendant un export.

## Numéro de version

`VERSION` en haut d'`app.js` (affiché dans À propos), à augmenter à chaque
version publiée. À partir de l'étape h, augmenter aussi `CACHE` dans `sw.js`
et y inscrire tout nouveau fichier.

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
