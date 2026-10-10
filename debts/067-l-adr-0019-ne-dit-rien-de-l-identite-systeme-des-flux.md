# 067 — L'ADR-0019 de la passerelle ne dit rien de l'identité système des flux

> **Porteur :** step-081 · le remède est ouvert, go-gateway#294 ; son merge paie la dette

## Ce qu'elle coûte si elle dure

L'ADR-0019 de `go-gateway` dit encore « pas de compte de service », alors que le BFF ouvre les trois
flux du hub sous l'UUID constant `gateway.SystemSubject`, avec le seul scope `admin:read`
(`internal/gateway/caller.go`). Un lecteur côté passerelle qui voit ce sujet dans un jeton ne peut
pas savoir que cette identité existe ni qu'elle est voulue : il la prendra pour une fuite ou un
compte oublié. Le remède : une PR d'une ligne dans `go-gateway`, `docs/adr/0019`, qui amende
l'ADR. Elle est ouverte (go-gateway#294) ; step-071 s'est achevée avant son merge, step-081 supprime
ce fichier s'il ne l'a pas été d'ici là.
