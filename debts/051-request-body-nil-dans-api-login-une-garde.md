# 051 — `request.Body == nil` dans `API.Login` : une garde **inatteignable par le routeur**, conservée

> **Porteur :** **sans porteur** — c'est une décision consignée, pas une dette à payer. La seule action possible serait de retirer la garde.

## Ce qu'elle coûte si elle dure

Lui écrire un test demanderait de l'appeler hors de son routeur : il prouverait la garde et rien du produit. Le constat est écrit au-dessus de la ligne.
