package config_test

import (
	"crypto/rand"
	"encoding/base64"
	"net/netip"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

// Le sel n'a **aucun repli**, et c'est ce que ce test tient : un défaut codé en dur serait public,
// donc le HMAC des adresses sources serait devinable et la table des compteurs redeviendrait un
// registre lisible de qui a tapé à la porte.
func TestLeSelDAntiBruteForceEstObligatoire(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	delete(env, config.EnvBruteForceSalt)

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvBruteForceSalt,
		"le refus ne nomme pas la variable manquante : l'exploitant ne sait pas quoi poser")
}

// Ce que la borne empêche vraiment est un sel posé « pour faire démarrer ».
func TestUnSelTropCourtEstRefuseSansEtreCite(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	env[config.EnvBruteForceSalt] = "changeme"

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvBruteForceSalt)
	assert.NotContains(t, err.Error(), "changeme", "le refus recopie le secret qu'il refuse")
}

// Sans repli : une clé par défaut serait publique, donc n'importe qui signerait une session et
// entrerait sous n'importe quelle identité sans jamais présenter de mot de passe.
func TestLaCleDeSignatureDeSessionEstObligatoire(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	delete(env, config.EnvSessionSecret)

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvSessionSecret,
		"le refus ne nomme pas la variable manquante : l'exploitant ne sait pas quoi poser")
}

func TestUneCleDeSessionTropCourteEstRefuseeSansEtreCitee(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	env[config.EnvSessionSecret] = "changeme"

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvSessionSecret)
	assert.NotContains(t, err.Error(), "changeme", "le refus recopie le secret qu'il refuse")
}

// Sans repli non plus, et la conséquence est la plus lourde des trois : une clé publique rendrait
// déchiffrable tout secret TOTP de la base, donc permettrait de produire les codes de n'importe quel
// opérateur.
func TestLaCleDeChiffrementTotpEstObligatoire(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	delete(env, config.EnvTOTPEncryptionKey)

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvTOTPEncryptionKey,
		"le refus ne nomme pas la variable manquante : l'exploitant ne sait pas quoi poser")
}

func TestUneCleDeChiffrementTropCourteEstRefuseeSansEtreCitee(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	env[config.EnvTOTPEncryptionKey] = "changeme"

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvTOTPEncryptionKey)
	assert.NotContains(t, err.Error(), "changeme", "le refus recopie le secret qu'il refuse")
}

// La borne se teste par ses deux côtés, sans quoi elle refuse tout ou n'importe quoi. Trente-deux
// `a` font la longueur exigée sans avoir rien d'un secret — c'est ce que la borne de longueur
// laissait passer, et ce que celle de variété ferme.
func TestUnSecretSansVarieteEstRefuseSansEtreCite(t *testing.T) {
	t.Parallel()

	uniform := strings.Repeat("a", 32)

	env := minimalEnv()
	env[config.EnvTOTPEncryptionKey] = uniform

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvTOTPEncryptionKey)
	assert.NotContains(t, err.Error(), uniform, "le refus recopie le secret qu'il refuse")
}

// L'autre côté : une valeur réellement tirée passe. Le tirage est fait ici plutôt qu'écrit en dur —
// une constante choisie à la main prouverait que cette constante passe, pas que la recette du README
// passe.
func TestUnSecretTireDUnCSPRNGPasse(t *testing.T) {
	t.Parallel()

	material := make([]byte, 48)
	_, err := rand.Read(material)
	require.NoError(t, err)

	env := minimalEnv()
	env[config.EnvTOTPEncryptionKey] = base64.StdEncoding.EncodeToString(material)

	cfg, err := config.Load(lookupFrom(env))
	require.NoError(t, err)
	assert.Equal(t, env[config.EnvTOTPEncryptionKey], string(cfg.Auth.TOTPEncryptionKey))
}

// Les trois secrets sont distincts et le restent. Réutiliser l'un pour l'autre ferait qu'une fuite de
// la table des compteurs — qui ne porte que des HMAC — livrerait de quoi signer des sessions, ou
// qu'un secret de signature volé livrerait avec lui tous les seconds facteurs.
func TestLesTroisSecretsNeSeConfondentPas(t *testing.T) {
	t.Parallel()

	cfg, err := config.Load(lookupFrom(minimalEnv()))
	require.NoError(t, err)

	assert.Equal(t, []byte(testBruteForceSalt), cfg.Auth.BruteForceSalt)
	assert.Equal(t, []byte(testSessionSecret), cfg.Auth.SessionSecret)
	assert.Equal(t, []byte(testTOTPEncryptionKey), cfg.Auth.TOTPEncryptionKey)
}

func TestLesProxysDeConfianceSeLisentEnCidr(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	env[config.EnvTrustedProxies] = "10.0.0.0/8, 2001:db8::/32"

	cfg, err := config.Load(lookupFrom(env))
	require.NoError(t, err)
	assert.Equal(t, []netip.Prefix{
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("2001:db8::/32"),
	}, cfg.Auth.TrustedProxies)
}

// Une adresse nue est refusée plutôt que promue en /32 : `10.0.0.1` et `10.0.0.1/32` se lisent pareil
// pour un humain, et accepter les deux ferait passer `10.0.0.0` pour un hôte là où l'auteur pensait à
// un réseau.
func TestUneAdresseNueNEstPasUnReseauDeConfiance(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	env[config.EnvTrustedProxies] = "10.0.0.1"

	_, err := config.Load(lookupFrom(env))
	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvTrustedProxies)
}

// Vide est une valeur sûre : l'en-tête `X-Forwarded-For` est alors ignoré. Un défaut permissif ici
// laisserait n'importe qui s'évader du compteur de source en forgeant un en-tête.
func TestAucunProxyDeConfianceEstUneConfigurationValide(t *testing.T) {
	t.Parallel()

	cfg, err := config.Load(lookupFrom(minimalEnv()))
	require.NoError(t, err)
	assert.Empty(t, cfg.Auth.TrustedProxies)
}

// La raison d'être des deux chargeurs : un serveur qui tourne depuis six mois n'a plus les variables
// du premier opérateur, et les exiger le ferait refuser de démarrer à la première mise à jour.
func TestLeChargeurDuServeurNExigePasLesVariablesDuPremierOperateur(t *testing.T) {
	t.Parallel()

	_, err := config.Load(lookupFrom(minimalEnv()))
	require.NoError(t, err)
}

// Le pendant : la commande ne les exige pas non plus au chargement, parce qu'elle est rejouable.
// C'est `cmd/bootstrap` qui exige, et seulement quand la base ne porte aucun opérateur.
func TestLeChargeurDuBootstrapAccepteUnEnvironnementVide(t *testing.T) {
	t.Parallel()

	cfg, err := config.LoadBootstrap(lookupFrom(map[string]string{}))
	require.NoError(t, err)
	assert.False(t, cfg.Complete())
	assert.ElementsMatch(t, []string{
		config.EnvBootstrapOperatorEmail,
		config.EnvBootstrapOperatorName,
		config.EnvBootstrapOperatorPassword,
	}, cfg.MissingNames())
}

func TestLesValeursDuPremierOperateurSontValideesQuandElleSontLa(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		env     map[string]string
		mention string
	}{
		"une adresse sans arobase": {
			env: map[string]string{
				config.EnvBootstrapOperatorEmail:    "camille",
				config.EnvBootstrapOperatorName:     "Camille Durand",
				config.EnvBootstrapOperatorPassword: "un mot de passe assez long",
			},
			mention: config.EnvBootstrapOperatorEmail,
		},
		"un mot de passe trop court": {
			env: map[string]string{
				config.EnvBootstrapOperatorEmail:    "camille@exemple.test",
				config.EnvBootstrapOperatorName:     "Camille Durand",
				config.EnvBootstrapOperatorPassword: "court",
			},
			mention: config.EnvBootstrapOperatorPassword,
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, err := config.LoadBootstrap(lookupFrom(testCase.env))
			require.Error(t, err)
			assert.Contains(t, err.Error(), testCase.mention)
		})
	}
}

// Une espace de bord fait partie d'un mot de passe. La retirer en silence produirait un compte dont
// le mot de passe n'est pas celui qu'on croit avoir posé — et personne ne pourrait entrer.
func TestUneEspaceDeBordDuMotDePasseEstConservee(t *testing.T) {
	t.Parallel()

	const withSpace = " un mot de passe qui commence par une espace "

	cfg, err := config.LoadBootstrap(lookupFrom(map[string]string{
		config.EnvBootstrapOperatorEmail:    "camille@exemple.test",
		config.EnvBootstrapOperatorName:     "Camille Durand",
		config.EnvBootstrapOperatorPassword: withSpace,
	}))
	require.NoError(t, err)
	assert.Equal(t, withSpace, cfg.OperatorPassword)
}

// Le refus ne cite jamais l'adresse : c'est une donnée personnelle, et ce message part dans la sortie
// d'erreur d'un déploiement.
func TestLeRefusDUneAdresseNeLaRecopiePas(t *testing.T) {
	t.Parallel()

	const address = "camille.durand.chez.exemple"

	_, err := config.LoadBootstrap(lookupFrom(map[string]string{
		config.EnvBootstrapOperatorEmail: address,
	}))
	require.Error(t, err)
	assert.NotContains(t, err.Error(), address)
}
