/**
 * La copie du cadre d'authentification, **figée**.
 *
 * Ce fichier existe pour une raison précise. La note sous le formulaire a porté deux affirmations
 * fausses de suite — « les identifiants ne quittent pas la couche serveur », puis « ni le secret
 * TOTP ni les clés d'appareil ne sont renvoyés au navigateur » — et la seconde a survécu à un
 * correctif qui n'avait réécrit que le commentaire au-dessus. Rien ne la gardait.
 *
 * Une promesse de sécurité est une affirmation sur le produit. Elle se teste comme telle.
 */

import { describe, expect, it } from 'vitest'
import { renderRoute } from '~/test/render-route'

describe('la note du cadre d’authentification', () => {
  it('ne promet rien sur ce que le serveur renvoie au navigateur', async () => {
    const screen = await renderRoute('/connexion')
    const note = screen.getByText(/n’est jamais conservé en clair/)

    // **Le secret TOTP sort bel et bien**, une fois, à l'enrôlement : c'est `mfaEnrollResponse` qui
    // le rend, et c'est ce que demande l'invariant (b) — montrer une fois, jamais plus. Les
    // identifiants d'authentificateurs voyagent eux aussi, dans `allowCredentials`. Toute phrase qui
    // prétend le contraire est fausse.
    expect(note.textContent).not.toMatch(/secret TOTP/)
    expect(note.textContent).not.toMatch(/clés d’appareil/)
  })

  it('dit ce qui est vrai, et où la protection s’arrête', async () => {
    const screen = await renderRoute('/connexion')
    const note = screen.getByText(/n’est jamais conservé en clair/)

    // Vrai : `password.ts` ne stocke qu'une empreinte PHC scrypt.
    expect(note.textContent).toContain('empreinte scrypt')
    // Et la frontière est nommée : la saisie traverse le réseau, protégée par le seul transport.
    expect(note.textContent).toMatch(/chiffrement du transport/)
  })

  it('ne dit jamais « sécurisé »', async () => {
    // La charte l'interdit comme argument : le mot ne couvre rien et se substitue à ce qu'il
    // faudrait dire.
    const screen = await renderRoute('/connexion')

    expect(screen.getByText(/n’est jamais conservé en clair/).textContent).not.toMatch(/sécuris/i)
  })
})
