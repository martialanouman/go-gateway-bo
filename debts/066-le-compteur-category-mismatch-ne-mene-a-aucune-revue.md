# 066 — Le compteur de signalements `category_mismatch` d'un nom d'expéditeur ne mène à aucune revue

> **Porteur :** step-146

## Ce qu'elle coûte si elle dure

La spec §6.19 veut, pour chaque nom d'expéditeur, le compteur de signalements `category_mismatch` des
24 dernières heures **avec un lien vers la file de revue** (§6.6). Depuis step-067 (06/10/2026), la
fiche client affiche le compteur, mais sans lien : la file de revue n'existe pas encore, elle arrive
avec step-146. Un opérateur qui voit « 3 » sait qu'un client envoie du trafic qui ne correspond pas à
sa catégorie déclarée, mais il ne peut pas voir lesquels de ses messages l'ont déclenché. Le remède :
quand step-146 livre la file, faire du compteur un lien vers la file filtrée sur ce nom.
