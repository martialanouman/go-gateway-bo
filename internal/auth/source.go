package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/netip"
	"strings"
)

// sourceKeyDomain isole cet usage du sel des suivants. Le même secret resservi ailleurs sans
// séparation permettrait de rapprocher deux registres construits avec lui.
const sourceKeyDomain = "source:"

// SourceKey rend la clé sous laquelle une adresse source est comptée : le HMAC-SHA256 de l'adresse,
// en hexadécimal.
//
// **HMAC et non SHA-256 nu.** Une IPv4 vit dans un espace de 2³² valeurs, qu'un SHA-256 sans clé
// épuise en quelques secondes sur du matériel ordinaire : la table redeviendrait un registre lisible
// de qui a tapé à la porte. Le sel est ce qui la rend inexploitable pour qui ne l'a pas.
//
// La raison de masquer, et elle est plus étroite qu'un principe : `login_attempt_counters` est la
// **seule** table du schéma qu'une requête non authentifiée fait écrire, par n'importe qui, sans
// audit. `audit_log.ip_address` garde bien des adresses en clair — mais lui n'est écrit que par des
// actions authentifiées. Une surface d'écriture libre ne se transforme pas en journal de connexion.
func SourceKey(salt []byte, address string) string {
	mac := hmac.New(sha256.New, salt)
	_, _ = mac.Write([]byte(sourceKeyDomain + sourceScope(address)))

	return hex.EncodeToString(mac.Sum(nil))
}

// ipv6SourcePrefix est la taille du bloc sous lequel une source IPv6 est comptée.
//
// **Compter une IPv6 à l'adresse près ne compte rien.** Le plus petit bloc qu'un fournisseur
// résidentiel délègue est un /64, et un serveur loué en obtient couramment un /48 : l'attaquant
// change d'adresse à chaque requête à l'intérieur de son propre bloc, sans la coopération de
// personne — c'est un `bind()` local. La dimension « source » ne verrouillerait jamais, et la table
// des compteurs grossirait sans plafond, ce que le commentaire de la migration 00004 tient pour
// impossible.
//
// /64 et non /48 : c'est la frontière que la RFC 4291 §2.5.4 pose entre le réseau et l'interface,
// donc la plus petite unité qu'on puisse attribuer à « quelqu'un » plutôt qu'à « une machine ».
// Plus large punirait des voisins qui ne partagent qu'un fournisseur.
const ipv6SourcePrefix = 64

// sourceScope rend le réseau sous lequel une adresse est comptée : elle-même en IPv4, son /64 en
// IPv6. La forme rendue est textuelle et stable — c'est elle qui entre dans le HMAC.
func sourceScope(address string) string {
	parsed, err := netip.ParseAddr(address)
	if err != nil {
		// Une adresse illisible n'arrive pas par `ClientAddress`, qui ne rend que des adresses
		// analysées. Si elle arrivait, la compter telle quelle vaut mieux que de ne pas la compter.
		return address
	}

	if parsed.Is4() || parsed.Is4In6() {
		return parsed.Unmap().String()
	}

	return netip.PrefixFrom(parsed, ipv6SourcePrefix).Masked().String()
}

// ClientAddress dérive l'adresse à compter à partir de l'adresse de pair et de `X-Forwarded-For`.
//
// **Sans réseau de confiance, l'en-tête est ignoré**, et c'est la moitié qui compte : `X-Forwarded-For`
// est écrit par le client, donc le croire sans condition offrirait à quiconque une évasion du
// compteur de source — une valeur différente à chaque tentative, et la seconde dimension ne compte
// plus rien.
//
// Avec des réseaux de confiance, la lecture se fait **de droite à gauche** : on remonte la chaîne en
// écartant les sauts qu'on a nous-même déployés, et on s'arrête au premier qu'on ne contrôle pas.
// Lire de gauche à droite prendrait la première valeur de la liste, qui est précisément celle que le
// client a pu écrire.
func ClientAddress(remoteAddr, forwardedFor string, trusted []netip.Prefix) (string, error) {
	peer, err := peerAddress(remoteAddr)
	if err != nil {
		return "", err
	}

	if len(trusted) == 0 || forwardedFor == "" || !isTrusted(peer, trusted) {
		return peer.String(), nil
	}

	if client, found := firstUntrustedHop(strings.Split(forwardedFor, ","), trusted); found {
		return client.String(), nil
	}

	// Aucun saut à désigner : ou bien ils sont tous à nous — sonde interne, chaîne mal configurée — ou
	// bien la chaîne est illisible. L'adresse de pair est alors ce qu'on sait de vrai.
	return peer.String(), nil
}

// firstUntrustedHop remonte la chaîne **de droite à gauche** et rend le premier saut qui n'est pas
// l'un des nôtres. Il ne rend pas d'erreur : une chaîne illisible n'est pas une panne, c'est un
// en-tête auquel on cesse de croire, et l'appelant retombe sur l'adresse de pair.
func firstUntrustedHop(hops []string, trusted []netip.Prefix) (netip.Addr, bool) {
	for index := len(hops) - 1; index >= 0; index-- {
		hop, err := netip.ParseAddr(strings.TrimSpace(hops[index]))
		if err != nil {
			// On s'arrête plutôt que de sauter la valeur : continuer laisserait un client insérer du
			// bruit pour faire désigner le saut qui l'arrange.
			return netip.Addr{}, false
		}

		if !isTrusted(hop, trusted) {
			return hop, true
		}
	}

	return netip.Addr{}, false
}

// peerAddress extrait l'adresse de `RemoteAddr`, qui a la forme `host:port`. La zone d'une IPv6 de
// lien local est retirée : elle est locale à la machine, donc deux instances la nommeraient
// différemment et compteraient sous deux clés distinctes.
func peerAddress(remoteAddr string) (netip.Addr, error) {
	if remoteAddr == "" {
		return netip.Addr{}, errors.New("aucune adresse de pair sur la requête")
	}

	if hostPort, err := netip.ParseAddrPort(remoteAddr); err == nil {
		return hostPort.Addr().WithZone(""), nil
	}

	// `httptest` et quelques proxys posent une adresse sans port.
	address, err := netip.ParseAddr(remoteAddr)
	if err != nil {
		return netip.Addr{}, errors.New("adresse de pair illisible sur la requête")
	}

	return address.WithZone(""), nil
}

func isTrusted(address netip.Addr, trusted []netip.Prefix) bool {
	// Une adresse IPv4 arrivée en forme mappée IPv6 (`::ffff:10.0.0.1`) ne serait pas contenue dans un
	// préfixe IPv4 : `netip.Prefix.Contains` compare les familles. On la ramène à sa forme IPv4.
	address = address.Unmap()

	for _, prefix := range trusted {
		if prefix.Contains(address) {
			return true
		}
	}

	return false
}
