# 050 — Deux dettes de forme relevées en revue de step-008 : le plugin accepte un token déclaré dans une portée qui ne s'applique pas, et `design-reference.css` atterrit dans la feuille d'entrée

> **Porteur :** **sans porteur** — deux déclencheurs mesurables : pour le plugin, un token déclaré hors portée qui cause un défaut réel (jamais observé à ce jour) ; pour la feuille, la borne gzip de `chargement-a-froid.test.ts` approchée à moins de 2 Ko — au 15/09/2026, 5,89 Ko sur 14,34.

## Ce qu'elle coûte si elle dure

**Toujours ouvertes, et le coût rechiffré sur le livré de step-042 : 2,21 Ko bruts / 0,38 Ko gzip**, mesurés en vidant la feuille et en comparant les deux constructions — elle a grossi depuis les ~1,9 Ko de step-041, et grossira encore à chaque section ajoutée à `/_design`. **Aucune des deux n'est du ressort d'une step de primitives**, et c'est ce que le passage de porteur de step-041 à step-042 n'a pas changé : la première demande un analyseur CSS de portée là où le plugin fait 50 lignes, la seconde tient à `autoCodeSplitting`, qui scinde le composant et pas sa feuille. Les **re-attribuer une troisième fois à la step suivante** reproduirait un ajournement qui se relit comme de la prudence et ne repose sur rien.
