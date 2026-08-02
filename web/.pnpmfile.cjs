// `openapi-typescript` engendre les types client du contrat du BFF en construisant un AST avec
// l'**API du compilateur** TypeScript, qu'il déclare en `peerDependencies: { typescript: "^5.x" }`.
// Or ce dépôt est en TypeScript 7, le portage natif, dont le point d'entrée npm n'expose plus cette
// API. Mesuré le 02/08/2026, sur l'arbre installé :
//
//   node -e "const ts=require('typescript'); console.log(ts.version, Object.keys(ts))"
//   → 7.0.2 [ 'version', 'versionMajorMinor' ]
//
//   web/node_modules/.bin/openapi-typescript --help
//   → TypeError: Cannot read properties of undefined (reading 'createKeywordTypeNode')
//
// Aucune version publiée ne lève la contrainte : `npm view openapi-typescript@latest
// peerDependencies` rend encore `^5.x` en 7.13.0, la dernière (11/02/2026).
//
// Le générateur reçoit donc **sa propre** copie de TypeScript 5.9.3, en dépendance et non en pair.
// C'est un `readPackage` et non une entrée `overrides` ou `packageExtensions` : les deux ont été
// essayées, et les deux sont inertes ici — une résolution de pair part du paquet importateur et ne
// consulte ni l'une ni l'autre. Vérifié à chaque fois sur le répertoire du store, qui restait
// `openapi-typescript@7.13.0_typescript@7.0.2` ; avec ce hook il devient `openapi-typescript@7.13.0`,
// dont le lien `typescript` pointe sur `typescript@5.9.3`.
//
// Portée : ce compilateur ne sert qu'à écrire `web/src/lib/api.gen.ts`. Rien du produit ne le
// traverse — `pnpm typecheck` reste `tsc` en 7.0.2, celui de `web/package.json`.
function readPackage(pkg) {
  if (pkg.name === 'openapi-typescript') {
    delete pkg.peerDependencies.typescript
    pkg.dependencies = { ...pkg.dependencies, typescript: '5.9.3' }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
