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
          Un fait, et il a fallu s'y reprendre deux fois. La première version annonçait que « les
          identifiants ne quittent pas la couche serveur » — sous un formulaire où l'opérateur tape
          justement son mot de passe, d'où il part en clair vers le BFF. La deuxième ajoutait que
          « ni le secret TOTP ni les clés d'appareil ne sont renvoyés au navigateur » : faux aussi,
          `POST /api/auth/mfa/enroll` rend le secret et son URI, une fois, à l'enrôlement — c'est
          même ce que fait l'invariant (b), montrer une fois et jamais plus.

          Ce qui reste ne parle que de ce que cet écran-ci fait, et dit où la protection s'arrête.
          Une promesse de sécurité se vérifie avant d'être écrite — et le correctif se vérifie sur le
          texte livré : la deuxième tentative n'a réécrit que ce commentaire, laissant la phrase
          fausse dix lignes plus bas. D'où le test qui **fige cette copie** ; rien ne la gardait, et
          c'est exactement pour cela qu'elle a survécu à deux revues.
        */}
        <p className="ui-auth__note">
          Le mot de passe n’est jamais conservé en clair : le serveur n’en garde qu’une empreinte
          scrypt. La saisie, elle, voyage jusqu’au serveur — elle n’est protégée que par le
          chiffrement du transport.
        </p>
      </div>
    </main>
  )
}
