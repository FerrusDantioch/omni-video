/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Service Worker d'Omni-Vidéo.
   Rôle : rendre l'application utilisable SANS connexion internet.
   À la première visite, tous les fichiers de l'application sont rangés
   dans la tablette (le « cache »), puis servis depuis là, même hors ligne.
   (Les vidéos, elles, ne passent jamais par ici : elles sont lues
   directement dans la tablette.) */

/* ⚠️ À augmenter d'un cran (v1 → v2…) à CHAQUE modification d'un fichier
   de la liste FICHIERS ci-dessous. Sinon, les tablettes qui ont déjà
   ouvert l'application gardent l'ancienne version. */
const CACHE = 'omni-video-v5';

/* Le début du nom de cache propre à Omni-Vidéo. Toutes les applications
   de ferrusdantioch.github.io partagent la même adresse de site, donc le
   même espace de caches : on ne touche JAMAIS aux caches des autres
   applications (L'Atelier, Omni-Time, Refuge, Cap…), seulement aux
   anciennes versions d'Omni-Vidéo. */
const PREFIXE = 'omni-video-';

/* La liste des fichiers indispensables au fonctionnement hors ligne.
   Si on ajoute un fichier au projet, il faut aussi l'ajouter ici. */
const FICHIERS = [
  './',
  './index.html',
  './styles.css',
  './mediabunny.min.js',
  './encodeur-aac.js',
  './encodeur-aac.wasm',
  './outils.js',
  './stockage.js',
  './capacites.js',
  './medias.js',
  './visionneuse.js',
  './transitions.js',
  './lecteur.js',
  './rendu.js',
  './chronologie.js',
  './incrustations.js',
  './audio.js',
  './sous-titres.js',
  './fabrication.js',
  './reprise.js',
  './disque-prive.js',
  './export.js',
  './sauvegarde.js',
  './youtube.js',
  './guide.js',
  './intro.js',
  './blancs.js',
  './projets.js',
  './app.js',
  './manifest.json',
  './logo.svg',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
  './oxanium.woff2',
  './literata.woff2',
  './jetbrains-mono.woff2'
];

/* Télécharge tous les fichiers et les range dans le cache.
   { cache: 'reload' } oblige à reprendre chaque fichier sur le serveur,
   sans passer par la mémoire temporaire du navigateur (GitHub Pages la
   garde 10 minutes) : sinon, deux mises à jour publiées coup sur coup
   pourraient ranger d'anciens fichiers sous le nouveau numéro de version. */
function remplirCache() {
  return caches.open(CACHE)
    .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))));
}

/* Vérifie que tous les fichiers sont bien dans le cache, et le remplit à
   nouveau s'il en manque. Pourquoi ? Les anciennes versions d'autres
   applications du même site effacent tous les caches qui ne sont pas les
   leurs quand elles se mettent à jour. Sans cette vérification,
   Omni-Vidéo ne marcherait plus hors ligne jusqu'à la visite suivante.
   Renvoie vrai si le cache est complet à la fin. */
function verifierCache() {
  return caches.open(CACHE)
    .then((c) => Promise.all(FICHIERS.map((f) => c.match(f))))
    .then((trouves) => (trouves.some((r) => !r) ? remplirCache() : null))
    .then(() => true)
    .catch(() => false);   // hors ligne : on réessaiera à la prochaine ouverture
}

/* 1. Installation : on range tout dans le cache.
      Volontairement, PAS de self.skipWaiting() ici : une nouvelle version
      attend que la personne touche « Mettre à jour » sur l'accueil (jamais
      pendant la fabrication d'une vidéo). Rien ne change par surprise.
      Seule exception, fixée par le navigateur : si Omni-Vidéo est
      complètement fermée, la nouvelle version est là à la prochaine
      ouverture. */
self.addEventListener('install', (e) => {
  e.waitUntil(remplirCache());
});

/* 2. Activation : on supprime les anciennes versions d'Omni-Vidéo,
      et uniquement elles (voir PREFIXE plus haut). */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(
        cles.filter((k) => k.startsWith(PREFIXE) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* 3. Les messages de la page :
      - « activer » : la personne a touché « Mettre à jour », cette version
        prend le relais (la page le remarque et se recharge) ;
      - « verifier » : la page demande si tout est bien rangé pour
        fonctionner sans Internet (écran « Vérifier ma tablette »). */
self.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'activer') self.skipWaiting();
  if (e.data.type === 'verifier' && e.ports[0]) {
    const reponse = e.ports[0];
    e.waitUntil(verifierCache().then((complet) => reponse.postMessage({ complet, version: CACHE })));
  }
});

/* 4. Interception des requêtes : on sert la copie rangée dans la
      tablette (instantané, hors ligne). On ne va sur internet que pour
      un fichier absent de la copie.
      On ne remplace JAMAIS en arrière-plan un fichier déjà rangé : sinon
      l'application changerait en douce, sans passer par « Mettre à jour ».
      ignoreSearch : une adresse avec un « ? » trouve quand même sa page. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Seulement les fichiers d'Omni-Vidéo (pas les liens vers d'autres sites)
  if (!e.request.url.startsWith(self.registration.scope)) return;

  // À chaque ouverture de l'application, on vérifie que le cache est complet
  if (e.request.mode === 'navigate') e.waitUntil(verifierCache());

  e.respondWith(
    caches.open(CACHE).then((c) => c.match(e.request, { ignoreSearch: true }).then((enCache) => {
      if (enCache) return enCache;
      return fetch(e.request).then((rep) => {
        if (rep && rep.status === 200 && rep.type === 'basic') c.put(e.request, rep.clone());
        return rep;
      });
    }))
  );
});
