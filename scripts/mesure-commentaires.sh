#!/usr/bin/env bash
# Compte les lignes de commentaire et les lignes non vides du code écrit à la main.
# Les fichiers engendrés sont exclus : leur ratio ne dit rien de ce qu'on écrit.
set -euo pipefail

cd "$(dirname "$0")/.."

fichiers() {
  git ls-files '*.go' '*.ts' '*.tsx' '*.css' 'Makefile' \
    | grep -v '\.gen\.' \
    | grep -v '^web/src/routeTree' \
    | grep -v '/node_modules/'
}

total=0
commentaires=0

while IFS= read -r f; do
  n=$(grep -cve '^[[:space:]]*$' "$f" || true)
  # `//`, `#` et `/* … */` sur leur propre ligne ; une ligne de code suivie d'un commentaire compte
  # comme du code, ce qu'elle est.
  c=$(grep -cE '^[[:space:]]*(//|#|/\*|\*)' "$f" || true)
  total=$((total + n))
  commentaires=$((commentaires + c))
done < <(fichiers)

printf '%s : %d lignes de commentaire sur %d non vides — %.1f %%\n' \
  "${1:-mesure}" "$commentaires" "$total" \
  "$(echo "scale=4; 100 * $commentaires / $total" | bc)"
