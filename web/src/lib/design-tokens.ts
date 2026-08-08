/**
 * Les tables que `/_design` rend, et que le contrôle de contraste vérifie.
 *
 * **Une seule liste, deux lecteurs.** La fiche de step-008 exige que chaque paire texte/fond
 * *utilisée par la page* atteigne AA. Énumérer les paires à la main dans le test les ferait diverger
 * de la page dès la première section ajoutée, et l'exigence deviendrait fausse sans que rien ne le
 * signale. Ici, « les paires que la page rend » est littéralement ce que le test lit.
 *
 * Ce module ne contient que des **données** : pas de JSX, pas de React. C'est ce qui permet à
 * `test/charte.test.ts` de tourner en `@vitest-environment node` sans charger le routeur.
 *
 * Les valeurs ne sont pas répétées ici — seulement les **noms de tokens**. Une valeur recopiée serait
 * une seconde source de vérité, et c'est exactement ce que la charte interdit.
 */

/** Un rôle typographique de la charte : six pour l'interface, trois pour les valeurs machine. */
export type TypeRole = { readonly token: string; readonly role: string; readonly sample: string }

export const TYPE_ROLES: readonly TypeRole[] = [
  { token: '--text-page-title', role: 'Titre de page · valeur KPI', sample: 'Trafic en direct' },
  { token: '--text-section-title', role: 'Titre de section', sample: 'Connecteurs' },
  { token: '--text-card-title', role: 'Titre de carte', sample: 'Débit sortant' },
  {
    token: '--text-body',
    role: 'Corps de texte',
    sample: 'Baisser ce quota ne coupe pas les binds vivants.',
  },
  { token: '--text-label', role: 'Libellé de champ', sample: 'Fenêtre de recherche' },
  { token: '--text-overline', role: 'Micro-libellé', sample: 'ÉTAT DU LIEN' },
  { token: '--text-metric', role: 'Métrique', sample: '1 284' },
  { token: '--text-data', role: 'Valeur machine', sample: 'link_status' },
  { token: '--text-pill', role: 'Pilule', sample: 'half_open' },
] as const

/** Les quatre surfaces de la charte. Il n'y a pas de thème clair. */
export const SURFACES: readonly { readonly token: string; readonly role: string }[] = [
  { token: '--surface-page', role: 'Canvas de la page' },
  { token: '--surface-chrome', role: 'Rail et barre supérieure' },
  { token: '--surface-card', role: 'Cartes et panneaux' },
  { token: '--surface-sunken', role: 'Creux : champs de saisie' },
] as const

/** L'accent unique, puis la sémantique de statut. */
export const ACCENT_COLORS: readonly { readonly token: string; readonly role: string }[] = [
  { token: '--teal-500', role: 'Accent primaire' },
  { token: '--green-500', role: 'Succès · lien établi' },
  { token: '--amber-500', role: 'Avertissement · dégradé' },
  { token: '--red-500', role: 'Erreur · lien rompu' },
  { token: '--blue-500', role: 'Information · flux MO' },
  { token: '--violet-500', role: 'Catégorie secondaire' },
] as const

/** Les six pas canoniques de l'échelle : 4 · 8 · 12 · 16 · 24 · 40. */
export const SPACINGS: readonly string[] = [
  '--sp-2',
  '--sp-4',
  '--sp-6',
  '--sp-7',
  '--sp-9',
  '--sp-11',
] as const

export const RADII: readonly { readonly token: string; readonly role: string }[] = [
  { token: '--r-field', role: 'Champs et boutons' },
  { token: '--r-card', role: 'Cartes et panneaux' },
  { token: '--r-pill', role: 'Pilules et jetons' },
] as const

/**
 * Une paire texte/fond que la page rend, et que le contraste doit tenir.
 *
 * `over` nomme la surface **porteuse** quand le fond est une teinte translucide : `color-mix(…,
 * transparent)` laisse voir ce qu'il y a dessous, donc le contraste réel dépend des deux. Sans elle,
 * un test composerait la teinte sur du noir et rendrait un ratio que personne ne voit à l'écran.
 */
export type ContrastPair = {
  readonly text: string
  readonly background: string
  readonly over?: string
  readonly usage: string
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { text: '--text-primary', background: '--surface-page', usage: 'Corps de texte sur le canvas' },
  { text: '--text-secondary', background: '--surface-card', usage: 'Texte secondaire en carte' },
  { text: '--text-muted', background: '--surface-page', usage: 'Légende, unité, horodatage' },
  { text: '--text-faint', background: '--surface-card', usage: 'Valeur machine en 11 px' },
  { text: '--text-link', background: '--surface-page', usage: 'Lien dans un paragraphe' },
  {
    text: '--green-500',
    background: '--tint-green',
    over: '--surface-card',
    usage: 'Pilule delivered',
  },
  {
    text: '--amber-500',
    background: '--tint-amber',
    over: '--surface-card',
    usage: 'Pilule degraded',
  },
  {
    text: '--text-danger-on-tint',
    background: '--tint-red',
    over: '--surface-card',
    usage: 'Pilule failed · sev-critical',
  },
  {
    text: '--blue-500',
    background: '--tint-blue',
    over: '--surface-card',
    usage: 'Pilule MO · information',
  },
  {
    text: '--text-primary',
    background: '--surface-selected',
    over: '--surface-page',
    usage: 'Ligne sélectionnée dans une table',
  },
] as const
