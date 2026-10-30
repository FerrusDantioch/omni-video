# Omni-Vidéo — crédits et licences

Omni-Vidéo est sous licence **Creative Commons BY-NC-ND 4.0**
(© 2026 Ferrus Dantioch, texte complet dans [LICENSE](LICENSE)). Cette licence
couvre le code écrit pour Omni-Vidéo (HTML, CSS et JavaScript).

L'application inclut aussi des éléments créés par d'autres. Chacun garde **sa
propre licence**, rappelée ci-dessous. Toutes ces licences sont gratuites et
compatibles avec celle d'Omni-Vidéo.

| Élément | Fichier(s) | Auteur | Licence |
|---|---|---|---|
| **Mediabunny** 1.63.0, la bibliothèque qui lit et fabrique les fichiers vidéo (MP4, MOV, WebM, MP3…) | `mediabunny.min.js` | Vanilagy et ses contributeurs | Mozilla Public License 2.0 — [LICENCE-MEDIABUNNY.txt](LICENCE-MEDIABUNNY.txt) |
| **Encodeur AAC de secours** : l'extension @mediabunny/aac-encoder 1.63.0, qui fabrique le son AAC de la vidéo finale quand la tablette ne sait pas le faire elle-même. Chargée seulement dans ce cas. | `mediabunny-aac-encoder.min.js` | Vanilagy et ses contributeurs ; contient l'encodeur AAC de FFmpeg (les développeurs de FFmpeg) | Mozilla Public License 2.0 ([LICENCE-MEDIABUNNY.txt](LICENCE-MEDIABUNNY.txt)) pour l'extension ; GNU LGPL 2.1 ou ultérieure ([LICENCE-LGPL-FFMPEG.txt](LICENCE-LGPL-FFMPEG.txt)) pour la partie FFmpeg |
| **Oxanium** (police des titres) | `oxanium.woff2` | The Oxanium Project Authors | SIL Open Font License 1.1 — [POLICES-OFL.txt](POLICES-OFL.txt) |
| **Literata** (police du texte) | `literata.woff2` | The Literata Project Authors | SIL Open Font License 1.1 — [POLICES-OFL.txt](POLICES-OFL.txt) |
| **JetBrains Mono** (police des chiffres) | `jetbrains-mono.woff2` | The JetBrains Mono Project Authors | SIL Open Font License 1.1 — [POLICES-OFL.txt](POLICES-OFL.txt) |
| **Logo** : le dé à vingt faces de l'Omni-système, et les icônes tirées de lui | `logo.svg`, `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png` | Ferrus Dantioch | Tous droits réservés, comme les autres logos de l'Omni-système |

## Pourquoi ces licences sont compatibles

- **Mozilla Public License 2.0 (Mediabunny).** C'est une licence « par
  fichier » : elle s'applique uniquement au fichier `mediabunny.min.js`, et
  pas au reste de l'application. Elle demande trois choses, toutes
  respectées :
  1. garder le fichier sous sa licence MPL-2.0, avec le texte de cette
     licence (`LICENCE-MEDIABUNNY.txt`) ;
  2. ne pas retirer les mentions de droits d'auteur (le fichier est inclus
     **sans aucune modification**, tel que publié sur npm, sous le nom
     `dist/bundles/mediabunny.min.cjs`) ;
  3. dire où trouver son code source :
     https://github.com/Vanilagy/mediabunny (version 1.63.0, aussi sur
     https://www.npmjs.com/package/mediabunny).

  L'Atelier utilise déjà un élément sous MPL-2.0 (son dictionnaire) de la
  même façon.
- **Encodeur AAC de secours (MPL-2.0 + LGPL 2.1).** L'extension elle-même est
  sous MPL-2.0, comme Mediabunny (mêmes obligations, respectées de la même
  façon : fichier `dist/bundles/mediabunny-aac-encoder.min.js` du paquet npm
  `@mediabunny/aac-encoder` 1.63.0, inclus **sans modification**, source sur
  https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder).
  Elle contient, compilé en WebAssembly, le seul encodeur AAC de **FFmpeg**,
  sous **GNU LGPL 2.1 ou ultérieure**. La LGPL permet de l'utiliser dans une
  application sous une autre licence, à condition :
  1. de joindre le texte de la licence (`LICENCE-LGPL-FFMPEG.txt`) ;
  2. de dire où trouver le code source de FFmpeg
     (https://github.com/FFmpeg/FFmpeg) et la façon de le compiler (décrite
     dans le README de l'extension, même adresse que ci-dessus) ;
  3. de permettre de le remplacer par une autre version : c'est le cas, il
     est dans un fichier séparé, chargé seul, que l'on peut échanger.
  La licence CC BY-NC-ND d'Omni-Vidéo ne s'applique pas à ce fichier, qui
  garde sa propre licence.
- **SIL Open Font License 1.1 (polices).** Les polices peuvent être incluses
  dans n'importe quel logiciel, gratuit ou non, à condition de ne pas les
  vendre seules et de garder leur licence. Ce sont exactement les mêmes
  fichiers que dans L'Atelier et Omni-Time.

## Ce qui n'est PAS utilisé

- **ffmpeg.wasm** n'est pas utilisé (trop lourd en mémoire pour une tablette) :
  l'image est lue et fabriquée par la tablette elle-même (WebCodecs), avec
  Mediabunny. Seul le petit encodeur AAC de FFmpeg (ci-dessus) peut servir,
  et seulement pour le son, si la tablette ne sait pas fabriquer l'AAC.
- Aucune bibliothèque n'est chargée depuis Internet : tout est dans le dépôt,
  et l'application ne fait aucun appel réseau.
