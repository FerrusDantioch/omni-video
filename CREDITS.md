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
| **Encodeur AAC de secours** : l'encodeur AAC de VisualOn (vo-aacenc 0.1.3), compilé en WebAssembly avec une petite passerelle, qui fabrique le son AAC de la vidéo finale quand la tablette ne sait pas le faire elle-même. Chargé seulement dans ce cas. | `encodeur-aac.wasm` (compilé), `encodeur-aac.c` (passerelle et recette de compilation), `encodeur-aac.js` | VisualOn, publié par l'Android Open Source Project (Google) ; passerelle : Ferrus Dantioch | Apache License 2.0 — [LICENCE-APACHE-VO-AACENC.txt](LICENCE-APACHE-VO-AACENC.txt) (la passerelle et `encodeur-aac.js` sont sous la licence d'Omni-Vidéo) |
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
- **Apache License 2.0 (encodeur AAC de secours).** Une licence libre et
  permissive : on peut inclure le code dans une application sous une autre
  licence, à condition :
  1. de joindre le texte de la licence et le fichier NOTICE de vo-aacenc
     (tous deux dans `LICENCE-APACHE-VO-AACENC.txt`, avec l'avertissement
     sur les brevets fourni par le projet) ;
  2. de garder les mentions de droits d'auteur (le code de vo-aacenc est
     compilé **sans aucune modification**, à partir de
     https://github.com/mstorsjo/vo-aacenc, version 0.1.3) ;
  3. de signaler ce qui a été ajouté : la passerelle `encodeur-aac.c`,
     écrite pour Omni-Vidéo, qui explique aussi comment recompiler
     `encodeur-aac.wasm`.
  Aucun morceau de FFmpeg n'est utilisé.
- **SIL Open Font License 1.1 (polices).** Les polices peuvent être incluses
  dans n'importe quel logiciel, gratuit ou non, à condition de ne pas les
  vendre seules et de garder leur licence. Ce sont exactement les mêmes
  fichiers que dans L'Atelier et Omni-Time.

## Ce qui n'est PAS utilisé

- **ffmpeg.wasm** n'est pas utilisé (trop lourd en mémoire pour une tablette) :
  l'image est lue et fabriquée par la tablette elle-même (WebCodecs), avec
  Mediabunny. Aucun morceau de FFmpeg n'est inclus : l'encodeur AAC de
  secours est celui de VisualOn (ci-dessus).
- Aucune bibliothèque n'est chargée depuis Internet : tout est dans le dépôt,
  et l'application ne fait aucun appel réseau.
