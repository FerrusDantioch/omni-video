/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   OMNI-VIDÉO — encodeur-aac.js
   L'encodeur AAC de secours : il fabrique le son de la vidéo finale
   quand la tablette ne sait pas le faire elle-même.

   Le travail est fait par encodeur-aac.wasm : l'encodeur AAC de VisualOn
   (vo-aacenc, licence Apache 2.0, voir CREDITS.md), compilé en
   WebAssembly avec une petite passerelle (encodeur-aac.c). Ce fichier-ci
   le présente à Mediabunny comme un encodeur « maison ».

   Il n'est chargé que si besoin (voir preparerAac() dans fabrication.js).
   ============================================================ */
'use strict';

const ECHANTILLONS_PAR_TRAME_AAC = 1024;
/* L'encodeur a toujours un petit retard : le son décodé arrive 1600
   échantillons après le début (0,033 s à 48 kHz). Mesuré, et compensé
   dans l'horodatage des trames : le son reste exactement calé sur l'image. */
const AVANCE_AAC = 1600;
const FREQUENCES_AAC = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

let moduleAac = null;   // le WebAssembly compilé (une seule fois par visite)

async function chargerModuleAac() {
  if (!moduleAac) {
    const reponse = await fetch('./encodeur-aac.wasm');
    if (!reponse.ok) throw new Error('Encodeur AAC de secours introuvable');
    moduleAac = await WebAssembly.compile(await reponse.arrayBuffer());
  }
  return moduleAac;
}

class EncodeurAacDeSecours extends Mediabunny.CustomAudioEncoder {
  static supports(codec, config) {
    return codec === 'aac' &&
      (config.numberOfChannels === 1 || config.numberOfChannels === 2) &&
      FREQUENCES_AAC.includes(config.sampleRate);
  }

  async init() {
    const instance = await WebAssembly.instantiate(await chargerModuleAac(), {});
    this.wasm = instance.exports;
    this.frequence = this.config.sampleRate;
    this.canaux = this.config.numberOfChannels;
    const debit = typeof this.config.bitrate === 'number' ? this.config.bitrate : 128000;
    if (this.wasm.va_ouvrir(this.frequence, this.canaux, debit) !== 0) {
      throw new Error('L\'encodeur AAC de secours n\'a pas pu démarrer');
    }
    // La « carte d'identité » du son pour le fichier MP4 (AudioSpecificConfig) :
    // AAC-LC (type 2), fréquence et nombre de canaux, sur 2 octets
    const f = FREQUENCES_AAC.indexOf(this.frequence);
    this.description = new Uint8Array([(2 << 3) | (f >> 1), ((f & 1) << 7) | (this.canaux << 3)]);
    this._recommencer();
  }

  _recommencer() {
    this.attente = new Float32Array(ECHANTILLONS_PAR_TRAME_AAC * this.canaux * 4);
    this.nbAttente = 0;          // échantillons (par canal) en attente d'une trame complète
    this.depart = null;          // le moment du premier échantillon, en échantillons
    this.trame = 0;
    this.infos = {
      decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: this.canaux, sampleRate: this.frequence, description: this.description }
    };
  }

  encode(morceau) {
    if (this.depart === null) this.depart = Math.round(morceau.timestamp * this.frequence);
    // Les échantillons du morceau, canaux entrelacés (gauche, droite, gauche…)
    const octets = new Uint8Array(morceau.allocationSize({ format: 'f32', planeIndex: 0 }));
    morceau.copyTo(octets, { format: 'f32', planeIndex: 0 });
    const donnees = new Float32Array(octets.buffer);
    const besoin = this.nbAttente * this.canaux + donnees.length;
    if (besoin > this.attente.length) {
      const plusGrand = new Float32Array(besoin * 2);
      plusGrand.set(this.attente.subarray(0, this.nbAttente * this.canaux));
      this.attente = plusGrand;
    }
    this.attente.set(donnees, this.nbAttente * this.canaux);
    this.nbAttente += donnees.length / this.canaux;
    while (this.nbAttente >= ECHANTILLONS_PAR_TRAME_AAC) this._encoderTrame();
  }

  flush() {
    // La fin : on complète la dernière trame par du silence, puis on
    // pousse encore deux trames de silence pour vider l'avance de l'encodeur
    if (this.depart !== null) {
      const fin = Math.ceil(this.nbAttente / ECHANTILLONS_PAR_TRAME_AAC) + 2;
      for (let i = 0; i < fin; i++) {
        this.attente.fill(0, this.nbAttente * this.canaux, ECHANTILLONS_PAR_TRAME_AAC * this.canaux);
        this.nbAttente = ECHANTILLONS_PAR_TRAME_AAC;
        this._encoderTrame();
      }
    }
    this._recommencer();
  }

  close() {
    this.wasm = null;   // la mémoire de l'encodeur est rendue avec lui
  }

  _encoderTrame() {
    const n = ECHANTILLONS_PAR_TRAME_AAC * this.canaux;
    // Nombres à virgule (-1 à 1) → entiers sur 16 bits, dans la mémoire de l'encodeur
    const entree = new Int16Array(this.wasm.memory.buffer, this.wasm.va_entree(), n);
    for (let i = 0; i < n; i++) {
      const v = this.attente[i];
      entree[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
    }
    this.nbAttente -= ECHANTILLONS_PAR_TRAME_AAC;
    this.attente.copyWithin(0, n, n + this.nbAttente * this.canaux);

    const taille = this.wasm.va_encoder();
    if (taille < 0) throw new Error('L\'encodeur AAC de secours a rencontré un souci');
    const donnees = new Uint8Array(this.wasm.memory.buffer, this.wasm.va_sortie(), taille).slice();
    const debut = this.depart + this.trame * ECHANTILLONS_PAR_TRAME_AAC - AVANCE_AAC;
    this.trame++;
    if (!taille) return;
    this.onPacket(
      new Mediabunny.EncodedPacket(donnees, 'key', debut / this.frequence, ECHANTILLONS_PAR_TRAME_AAC / this.frequence),
      this.infos
    );
    this.infos = undefined;   // la carte d'identité n'accompagne que la première trame
  }
}

Mediabunny.registerEncoder(EncodeurAacDeSecours);
