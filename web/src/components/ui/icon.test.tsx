import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dot, GLYPH_NAMES, type GlyphName, Icon } from './icon'

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
  it('draws the requested glyph, with no dependency or icon font', () => {
    const { container } = render(<Icon name="search" />)

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    // Le cercle et la queue de la loupe : le glyphe est dessiné, pas chargé.
    expect(container.querySelectorAll('svg circle, svg path').length).toBeGreaterThan(0)
  })

  it('renders nothing for a name outside the set, rather than a lookalike shape', () => {
    // `key-round` est un nom Lucide : il n'appartient pas au jeu de la charte.
    //
    // **Le `as` est la démonstration, pas un contournement.** `name` est typé sur le jeu : ce test
    // ne compile qu'en forçant, c'est-à-dire par le seul chemin qui reste à une valeur venue d'une
    // charge utile. C'est exactement ce que le repli `null` du composant couvre. Tant que `IconProps`
    // acceptait `string & {}`, cette ligne compilait toute seule — et la promesse « un nom absent se
    // voit au typecheck » était fausse sans que rien ne rougisse.
    const { container } = render(<Icon name={'key-round' as GlyphName} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('draws every glyph in the set', () => {
    // **Pas de nombre écrit ici** : un compte recopié dans le test et dans le composant vient de la
    // même main et ne fait que se confirmer lui-même. C'est `test/glyphes-de-la-charte.test.ts` qui
    // confronte le jeu à sa source ; ce test-ci vérifie seulement que chaque nom déclaré rend bien
    // quelque chose.
    expect(GLYPH_NAMES.length).toBeGreaterThan(0)

    for (const name of GLYPH_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg'), `${name} ne dessine rien`).not.toBeNull()
      unmount()
    }
  })

  it('stays out of the accessibility tree as long as it has no label', () => {
    // Un glyphe qui double un libellé texte l'annoncerait deux fois.
    const { container } = render(<Icon name="check" />)

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('announces itself as an image as soon as it alone carries the meaning', () => {
    render(<Icon name="ban" title="Action interdite" />)

    expect(screen.getByRole('img', { name: 'Action interdite' })).toBeInTheDocument()
  })
})

describe('Dot', () => {
  it('carries its tone through a class, never through a color written in the style', () => {
    // Une couleur composée en JavaScript échappe au plugin de tokens : il ne voit que le CSS émis.
    const { container } = render(<Dot tone="down" />)

    const dot = container.querySelector('.ui-dot')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain('ui-dot--down')
    expect(dot?.getAttribute('style')).toBeNull()
  })

  it('pulses only on a live-fed value', () => {
    // Le pouls est le seul signal de fraîcheur du produit : le poser sur un instantané le ferait
    // mentir. Le kit de la charte posait la classe sur le point alors que son CSS visait le parent,
    // si bien qu'un point isolé ne battait jamais — c'est ce défaut-là qui est fermé ici.
    // **Sur le point lui-même**, et non « quelque part dans l'arbre » : `.ui-dot--live` porte
    // l'animation, et un `querySelector` large laissait passer exactement le défaut que ce test
    // raconte fermer — mesuré en déplaçant la classe sur une enveloppe, 19 tests verts et le pouls
    // disparu.
    const snapshot = render(<Dot tone="up" />)
    expect(snapshot.container.querySelector('.ui-dot')).not.toHaveClass('ui-dot--live')
    snapshot.unmount()

    const live = render(<Dot tone="up" live />)
    expect(live.container.querySelector('.ui-dot')).toHaveClass('ui-dot--live')
  })
})
