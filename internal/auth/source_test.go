package auth_test

import (
	"net/netip"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
)

var lanOnly = []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}

// Le cœur de la garde : sans réseau de confiance déclaré, `X-Forwarded-For` est du texte écrit par le
// client. Le croire offrirait une évasion du compteur de source — une valeur différente à chaque
// tentative, et la seconde dimension du verrou ne compterait plus rien.
func TestUnEnTeteForgeEstIgnoreQuandAucunProxyNEstDeConfiance(t *testing.T) {
	t.Parallel()

	address, err := auth.ClientAddress("203.0.113.7:54321", []string{"1.2.3.4"}, nil)
	require.NoError(t, err)
	assert.Equal(t, "203.0.113.7", address,
		"l'en-tête a été cru sans réseau de confiance : le compteur de source se contourne en le forgeant")
}

// Le pendant : sans cette lecture, toutes les tentatives arrivant par le load balancer seraient
// comptées sur **son** adresse, et le verrouillage se refermerait sur tout le monde d'un coup.
func TestDerriereUnProxyDeConfianceCEstLAdresseDuClientQuiCompte(t *testing.T) {
	t.Parallel()

	address, err := auth.ClientAddress("10.0.0.5:443", []string{"203.0.113.7"}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "203.0.113.7", address)
}

// La remontée s'arrête au premier saut qu'on ne contrôle pas. Lire de gauche à droite prendrait la
// première valeur de la liste, qui est précisément celle que le client a pu écrire lui-même.
func TestLaChaineSeRemonteDeDroiteAGaucheEtSArreteAuPremierSautInconnu(t *testing.T) {
	t.Parallel()

	address, err := auth.ClientAddress("10.0.0.5:443", []string{"198.51.100.9, 203.0.113.7, 10.0.0.9"}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "203.0.113.7", address,
		"la remontée a pris le saut le plus à gauche, celui que le client écrit")
}

// Un client qui insère du bruit dans la chaîne ne doit pas pouvoir faire désigner le saut qui
// l'arrange : on cesse de croire l'en-tête entier.
func TestUneChaineIllisibleFaitRetomberSurLAdresseDePair(t *testing.T) {
	t.Parallel()

	address, err := auth.ClientAddress("10.0.0.5:443", []string{"203.0.113.7, pas-une-adresse, 10.0.0.9"}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "10.0.0.5", address)
}

// Une chaîne entièrement interne ne désigne aucun client : sonde de disponibilité, ou chaîne mal
// configurée. L'adresse de pair est ce qu'on sait de vrai.
func TestUneChaineEntierementInterneFaitRetomberSurLAdresseDePair(t *testing.T) {
	t.Parallel()

	address, err := auth.ClientAddress("10.0.0.5:443", []string{"10.0.0.8, 10.0.0.9"}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "10.0.0.5", address)
}

// Un pair hors des réseaux de confiance ne mérite pas qu'on lise son en-tête, même si des réseaux
// sont déclarés : c'est quelqu'un qui joint le BFF en direct.
func TestUnPairHorsDesReseauxDeConfianceNeFaitPasLireSonEnTete(t *testing.T) {
	t.Parallel()

	address, err := auth.ClientAddress("198.51.100.9:1234", []string{"1.2.3.4"}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "198.51.100.9", address)
}

// `netip.Prefix.Contains` compare les familles : une IPv4 arrivée en forme mappée ne serait contenue
// dans aucun préfixe IPv4, et un proxy déclaré cesserait d'être reconnu sans que rien ne le dise.
func TestUneAdresseIpv4MappeeEnIpv6EstReconnueDansUnPrefixeIpv4(t *testing.T) {
	t.Parallel()

	address, err := auth.ClientAddress("[::ffff:10.0.0.5]:443", []string{"203.0.113.7"}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "203.0.113.7", address,
		"le proxy déclaré n'a pas été reconnu sous sa forme mappée : son en-tête est ignoré")
}

// Au-delà de ce qu'on consent à lire, on ne croit plus l'en-tête : le test affirme donc l'adresse de
// pair, comme pour une chaîne illisible ou entièrement interne.
func TestUneChaineDeSautsPlusLongueQueLaBorneNEstPasRemontee(t *testing.T) {
	t.Parallel()

	const beyondTheBound = 17

	// Le saut du client, tout à gauche : c'est lui que la remontée atteindrait sans borne.
	hops := []string{"198.51.100.9"}

	for index := range beyondTheBound {
		hops = append(hops, "10.0.0."+strconv.Itoa(index+1))
	}

	address, err := auth.ClientAddress("10.0.0.5:443", []string{strings.Join(hops, ", ")}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "10.0.0.5", address,
		"la remontée a franchi %d sauts pour atteindre celui du client : la longueur de l'en-tête décide "+
			"du travail que le serveur accepte, et personne ne s'est authentifié pour l'exiger",
		beyondTheBound)
}

// Le pendant, sans lequel le test ci-dessus serait vrai d'une remontée qui n'irait jamais nulle part.
func TestUneChaineJusteSousLaBorneSeRemonteEntierement(t *testing.T) {
	t.Parallel()

	const withinTheBound = 15

	hops := []string{"198.51.100.9"}

	for index := range withinTheBound {
		hops = append(hops, "10.0.0."+strconv.Itoa(index+1))
	}

	address, err := auth.ClientAddress("10.0.0.5:443", []string{strings.Join(hops, ", ")}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "198.51.100.9", address,
		"la remontée s'est arrêtée avant le saut du client alors que la chaîne tient sous la borne")
}

// Les lignes répétées comptent dans la **même** remontée : un proxy qui ajoute la sienne ne rouvre
// pas le budget que la ligne du client a consommé.
func TestLaBornePorteSurLesLignesReuniesEtNonSurChacune(t *testing.T) {
	t.Parallel()

	nine := make([]string, 0, 9)
	for index := range 9 {
		nine = append(nine, "10.0.0."+strconv.Itoa(index+1))
	}

	joined := strings.Join(nine, ", ")

	address, err := auth.ClientAddress("10.0.0.5:443",
		[]string{"198.51.100.9, " + joined, joined}, lanOnly)
	require.NoError(t, err)
	assert.Equal(t, "10.0.0.5", address,
		"chaque ligne a eu sa propre borne : un proxy qui ajoute la sienne rouvrirait le budget que la "+
			"ligne du client a déjà consommé")
}

// Une requête sans adresse de pair est une erreur et **non** une chaîne vide : compter sur `""`
// ferait un compteur global que rien ne signalerait — le verrou marcherait, et il verrouillerait
// tout le monde.
func TestUneRequeteSansAdresseDePairEstUneErreur(t *testing.T) {
	t.Parallel()

	_, err := auth.ClientAddress("", nil, nil)
	require.Error(t, err)
}

func TestLaCleDeSourceNeLaisseParaitreAucuneAdresse(t *testing.T) {
	t.Parallel()

	const address = "203.0.113.7"

	key := auth.SourceKey([]byte("un sel de test assez long pour la borne"), address)

	assert.NotContains(t, key, address, "la clé recopie l'adresse qu'elle est censée masquer")
	assert.Len(t, key, 64, "une empreinte SHA-256 en hexadécimal fait 64 caractères")
}

// Deux sels différents rendent deux registres qu'on ne peut pas rapprocher. Sans clé — un SHA-256 nu
// — l'espace des IPv4 s'épuise en quelques secondes et la table redevient lisible.
func TestDeuxSelsDifferentsRendentDesClesDifferentes(t *testing.T) {
	t.Parallel()

	first := auth.SourceKey([]byte("le premier sel, assez long pour la borne"), "203.0.113.7")
	second := auth.SourceKey([]byte("le second sel, assez long pour la borne"), "203.0.113.7")

	assert.NotEqual(t, first, second)
	assert.Equal(t, strings.ToLower(first), first, "la clé doit être stable en casse : elle sert d'index")
}

// Deux adresses du même /64 doivent partager leur compteur. Sans cette normalisation, un attaquant
// change d'adresse à chaque requête à l'intérieur de son propre bloc — sans la coopération de
// personne, c'est un `bind()` local — et la dimension « source » ne verrouille jamais.
func TestDeuxAdressesDuMemeReseauIpv6PartagentLeurCompteur(t *testing.T) {
	t.Parallel()

	salt := []byte("un sel de test assez long pour la borne")

	first := auth.SourceKey(salt, "2001:db8:abcd:1234::1")
	second := auth.SourceKey(salt, "2001:db8:abcd:1234:ffff:ffff:ffff:ffff")

	assert.Equal(t, first, second,
		"deux adresses du même /64 sont comptées séparément : un client IPv6 dispose de 2^64 compteurs")
}

// Le pendant : deux réseaux distincts ne doivent pas se punir l'un l'autre.
func TestDeuxReseauxIpv6DistinctsGardentDesCompteursDistincts(t *testing.T) {
	t.Parallel()

	salt := []byte("un sel de test assez long pour la borne")

	assert.NotEqual(t,
		auth.SourceKey(salt, "2001:db8:abcd:1234::1"),
		auth.SourceKey(salt, "2001:db8:abcd:5678::1"))
}

// En IPv4 la clé reste l'adresse : un /32 est déjà une machine, et élargir punirait un voisinage.
func TestDeuxAdressesIpv4VoisinesGardentDesCompteursDistincts(t *testing.T) {
	t.Parallel()

	salt := []byte("un sel de test assez long pour la borne")

	assert.NotEqual(t, auth.SourceKey(salt, "203.0.113.7"), auth.SourceKey(salt, "203.0.113.8"))
}
