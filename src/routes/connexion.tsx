/**
 * Le cadre des écrans d'authentification — hors de la coquille, et c'est le point.
 *
 * ## Pourquoi une mise en page à part
 *
 * `_shell` affiche le nom de l'opérateur connecté et un rail filtré par ses permissions. Ici, il n'y
 * a ni l'un ni l'autre : la session n'existe pas encore, ou n'est que partielle. Rendre ces écrans
 * sous la coquille afficherait une barre vide au-dessus d'un rail vide, et ferait croire à une
 * console cassée plutôt qu'à une porte d'entrée.
 *
 * ## Deux écrans, un seul cadre
 *
 * `/connexion` et `/connexion/verification` partagent la marque, la largeur et le bandeau du bas.
 * Les dupliquer aurait fait diverger les deux moitiés d'un même geste — et le second écran, moins
 * regardé, aurait pris du retard.
 *
 * Le `<main>` enveloppe **tout le panneau**, marque et note comprises. Une première version ne
 * l'enroulait qu'autour de la carte, ce qui laissait ces deux blocs hors de tout repère : un
 * opérateur qui navigue par landmarks ne les atteignait jamais.
 */

import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/connexion')({
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <main className="ui-auth">
      <div className="ui-auth__panel">
        <div className="ui-auth__brand">
          <span aria-hidden="true" className="ui-auth__mark">
            SG
          </span>
          <span className="ui-auth__wordmark">
            <span className="ui-auth__product">SMS Gateway</span>
            <span className="ui-auth__tagline">admin &amp; exploitation</span>
          </span>
        </div>

        <div className="ui-auth__card">
          <Outlet />
        </div>

        {/*
          Un fait, et il a fallu s'y reprendre. La première version annonçait que « les identifiants
          ne quittent pas la couche serveur » — sous un formulaire où l'opérateur tape justement son
          mot de passe dans son navigateur, d'où il part en clair vers le BFF. La phrase promettait
          une frontière que le geste en cours traverse. La charte demande de dire ce que la
          protection couvre **et où elle s'arrête** ; c'est ce que dit celle-ci.
        */}
        <p className="ui-auth__note">
          Le mot de passe n’est jamais conservé en clair, et ni le secret TOTP ni les clés
          d’appareil ne sont renvoyés au navigateur. La saisie, elle, voyage jusqu’au serveur : elle
          n’est protégée que par le chiffrement du transport.
        </p>
      </div>
    </main>
  )
}
