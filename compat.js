/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Si l'application n'a pas démarré au bout de 8 secondes, c'est que le
   navigateur est trop ancien pour elle : on l'explique gentiment au lieu
   de laisser un écran vide. (Ce petit script est écrit à l'ancienne
   exprès, pour fonctionner même sur un très vieux navigateur.) */
setTimeout(function () {
  if (document.body.getAttribute('data-pret') === 'oui') return;
  var p = document.getElementById('chargement');
  if (!p) return;
  while (p.firstChild) p.removeChild(p.firstChild);
  p.appendChild(document.createTextNode('Omni-Vidéo n\'arrive pas à démarrer sur ce navigateur.'));
  p.appendChild(document.createElement('br'));
  p.appendChild(document.createTextNode('Ouvre-la avec '));
  var fort = document.createElement('strong');
  fort.textContent = 'Google Chrome';
  p.appendChild(fort);
  p.appendChild(document.createTextNode(', mis à jour depuis le Play Store.'));
}, 8000);
