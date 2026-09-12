import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dot, GLYPH_NAMES, Icon } from './icon'

/**
 * Le jeu de glyphes, et la règle qui le ferme.
 *
 * La charte §07 n'admet « ni pictogrammes décoratifs ni emoji » : le jeu dessiné ici **est** le jeu
 * complet. La conséquence est contre-intuitive et c'est elle qu'on vérifie — un nom hors du jeu ne
 * rend **rien**. Pas un carré de remplacement, pas une approximation : le libellé texte porte alors
 * seul le sens. Substituer une forme voisine ferait passer une icône décorative pour un glyphe
 * fonctionnel, ce que la règle interdit précisément.
 */
describe('Icon', () => {
  it('dessine le glyphe demandé, sans dépendance ni police d’icônes', () => {
    const { container } = render(<Icon name="search" />)

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    // Le cercle et la queue de la loupe : le glyphe est dessiné, pas chargé.
    expect(container.querySelectorAll('svg circle, svg path').length).toBeGreaterThan(0)
  })

  it('ne rend rien pour un nom hors du jeu, plutôt qu’une forme approchante', () => {
    // `key-round` est un nom Lucide : il n'appartient pas au jeu de la charte.
    const { container } = render(<Icon name="key-round" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('dessine chacun des glyphes du jeu', () => {
    // **Pas de nombre écrit ici.** La première rédaction annonçait « vingt-et-un » alors que la
    // charte en dessine vingt-deux : le compte du test et celui du composant venaient de la même
    // main, au même moment, et se confirmaient l'un l'autre. C'est
    // `test/glyphes-de-la-charte.test.ts` qui confronte le jeu à sa source ; ce test-ci vérifie
    // seulement que chaque nom déclaré rend bien quelque chose.
    expect(GLYPH_NAMES.length).toBeGreaterThan(0)

    for (const name of GLYPH_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg'), `${name} ne dessine rien`).not.toBeNull()
      unmount()
    }
  })

  it('reste hors de l’arbre d’accessibilité tant qu’il n’a pas de libellé', () => {
    // Un glyphe qui double un libellé texte l'annoncerait deux fois.
    const { container } = render(<Icon name="check" />)

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('s’annonce comme une image dès qu’il porte seul le sens', () => {
    render(<Icon name="ban" title="Action interdite" />)

    expect(screen.getByRole('img', { name: 'Action interdite' })).toBeInTheDocument()
  })
})

describe('Dot', () => {
  it('porte sa tonalité par une classe, jamais par une couleur écrite dans le style', () => {
    // Une couleur composée en JavaScript échappe au plugin de tokens : il ne voit que le CSS émis.
    const { container } = render(<Dot tone="down" />)

    const dot = container.querySelector('.ui-dot')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain('ui-dot--down')
    expect(dot?.getAttribute('style')).toBeNull()
  })

  it('ne bat que sur une valeur alimentée en direct', () => {
    // Le pouls est le seul signal de fraîcheur du produit : le poser sur un instantané le ferait
    // mentir. Le kit de la charte posait la classe sur le point alors que son CSS visait le parent,
    // si bien qu'un point isolé ne battait jamais — c'est ce défaut-là qui est fermé ici.
    const snapshot = render(<Dot tone="up" />)
    expect(snapshot.container.querySelector('.ui-dot--live')).toBeNull()
    snapshot.unmount()

    const live = render(<Dot tone="up" live />)
    expect(live.container.querySelector('.ui-dot--live')).not.toBeNull()
  })
})
