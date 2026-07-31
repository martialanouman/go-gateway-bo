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
 */

import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/connexion')({
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <div className="ui-auth">
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

        <main className="ui-auth__card">
          <Outlet />
        </main>

        {/*
          Un fait, pas une promesse. La charte interdit « sécurisé » comme argument : on dit ce que
          la protection couvre — les identifiants ne quittent pas la couche serveur — et on s'arrête
          là, sans laisser entendre que tout le reste serait garanti.
        */}
        <p className="ui-auth__note">
          Les identifiants ne quittent pas la couche serveur : hachage, enrôlement TOTP et
          cérémonies WebAuthn sont traités par le BFF, qui émet sa propre session signée.
        </p>
      </div>
    </div>
  )
}
