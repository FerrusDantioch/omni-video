/* Omni-Vidéo — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* Passerelle entre JavaScript et l'encodeur AAC de VisualOn (vo-aacenc,
   licence Apache 2.0, voir CREDITS.md). Compilée en WebAssembly avec le
   code de vo-aacenc pour donner encodeur-aac.wasm.

   Utilisation, depuis encodeur-aac.js :
   1. va_ouvrir(fréquence, canaux, débit) prépare l'encodeur ;
   2. on écrit 1024 échantillons par canal (nombres entiers sur 16 bits,
      canaux entrelacés) à l'adresse donnée par va_entree() ;
   3. va_encoder() fabrique une trame AAC à l'adresse va_sortie() et
      renvoie sa taille en octets (ou -1 en cas de souci).

   Pour recompiler encodeur-aac.wasm (inutile pour utiliser l'application) :
   1. récupérer vo-aacenc : git clone https://github.com/mstorsjo/vo-aacenc
      (version utilisée : 0.1.3, dernière modification de 2017) ;
   2. créer un dossier « mini » avec trois tout petits fichiers :
      stdlib.h  (size_t, NULL, malloc, free),
      string.h  (size_t, NULL, memset, memcpy, memmove, memcmp),
      assert.h  (#define assert(x) ((void)0)) ;
   3. compiler chaque fichier .c de vo-aacenc listé dans son Makefile.am
      (common/cmnMemory.c, aacenc/basic_op/*.c, aacenc/src/*.c) et ce
      fichier-ci avec :
        clang --target=wasm32 -O2 -nostdlib -ffreestanding -fno-builtin
              -Imini -Ivo-aacenc/aacenc/inc -Ivo-aacenc/aacenc/basic_op
              -Ivo-aacenc/common/include -Ivo-aacenc -D__unused= -c x.c
   4. assembler :
        wasm-ld --no-entry --export=va_ouvrir --export=va_entree
                --export=va_sortie --export=va_encoder -O2 --gc-sections
                --strip-all *.o -o encodeur-aac.wasm
   Aucune ligne de vo-aacenc n'est modifiée. */
#include <stdlib.h>
#include "voAAC.h"
#include "cmnMemory.h"
#include <string.h>

/* ---------- Le strict minimum de la bibliothèque C ----------
   Mémoire (malloc / free) et copies (memset, memcpy…). La mémoire n'est
   jamais rendue (free ne fait rien) : l'encodeur réserve tout au départ,
   et un nouvel encodeur est créé à chaque fabrication de vidéo. */extern unsigned char __heap_base;
static unsigned long sommet = 0;
void *malloc(size_t n) {
  if (!sommet) sommet = (unsigned long)&__heap_base;
  unsigned long debut = (sommet + 15) & ~15UL;
  unsigned long fin = debut + n;
  unsigned long dispo = __builtin_wasm_memory_size(0) * 65536UL;
  if (fin > dispo) {
    unsigned long pages = (fin - dispo + 65535) / 65536;
    if (__builtin_wasm_memory_grow(0, pages) == (unsigned long)-1) return NULL;
  }
  sommet = fin;
  return (void *)debut;
}
void free(void *p) { (void)p; }
void *memset(void *d, int c, size_t n) { unsigned char *p = d; while (n--) *p++ = (unsigned char)c; return d; }
void *memcpy(void *d, const void *s, size_t n) { unsigned char *a = d; const unsigned char *b = s; while (n--) *a++ = *b++; return d; }
void *memmove(void *d, const void *s, size_t n) {
  unsigned char *a = d; const unsigned char *b = s;
  if (a < b) { while (n--) *a++ = *b++; } else { a += n; b += n; while (n--) *--a = *--b; }
  return d;
}
int memcmp(const void *x, const void *y, size_t n) {
  const unsigned char *a = x, *b = y;
  for (; n; n--, a++, b++) if (*a != *b) return *a - *b;
  return 0;
}

/* ---------- La passerelle ---------- */

#define ECHANTILLONS_PAR_TRAME 1024
#define TAILLE_SORTIE 8192

static VO_AUDIO_CODECAPI api;
static VO_HANDLE poignee = 0;
static VO_MEM_OPERATOR memoire;
static short *entree = 0;
static unsigned char *sortie = 0;
static int nbCanaux = 0;

int va_ouvrir(int frequence, int canaux, int debit) {
  VO_CODEC_INIT_USERDATA donnees;
  AACENC_PARAM reglages = { 0 };
  nbCanaux = canaux;
  entree = malloc(ECHANTILLONS_PAR_TRAME * canaux * sizeof(short));
  sortie = malloc(TAILLE_SORTIE);
  if (!entree || !sortie) return -1;
  voGetAACEncAPI(&api);
  memoire.Alloc = cmnMemAlloc;
  memoire.Copy = cmnMemCopy;
  memoire.Free = cmnMemFree;
  memoire.Set = cmnMemSet;
  memoire.Check = cmnMemCheck;
  donnees.memflag = VO_IMF_USERMEMOPERATOR;
  donnees.memData = &memoire;
  if (api.Init(&poignee, VO_AUDIO_CodingAAC, &donnees) != VO_ERR_NONE) return -2;
  reglages.sampleRate = frequence;
  reglages.bitRate = debit;
  reglages.nChannels = canaux;
  reglages.adtsUsed = 0;   /* trames « brutes » : le fichier MP4 n'a pas besoin d'en-têtes ADTS */
  if (api.SetParam(poignee, VO_PID_AAC_ENCPARAM, &reglages) != VO_ERR_NONE) return -3;
  return 0;
}

short *va_entree(void) { return entree; }
unsigned char *va_sortie(void) { return sortie; }

int va_encoder(void) {
  VO_CODECBUFFER donnees = { 0 }, resultat = { 0 };
  VO_AUDIO_OUTPUTINFO infos = { 0 };
  donnees.Buffer = (unsigned char *)entree;
  donnees.Length = ECHANTILLONS_PAR_TRAME * nbCanaux * sizeof(short);
  api.SetInputData(poignee, &donnees);
  resultat.Buffer = sortie;
  resultat.Length = TAILLE_SORTIE;
  if (api.GetOutputData(poignee, &resultat, &infos) != VO_ERR_NONE) return -1;
  return (int)resultat.Length;
}
