// Les assertions sur le DOM (`toBeInTheDocument`, `toBeVisible`…) viennent de jest-dom ; sans cet
// import, elles échouent en « not a function » plutôt qu'en assertion rouge.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library n'installe son nettoyage automatique que lorsque les globales de test existent, et
// la configuration les refuse (`globals: false`, pour que chaque fichier déclare ce qu'il utilise).
// Sans cette ligne, chaque rendu s'ajoute au précédent : un `getByText` finit par trouver deux
// éléments, et le test accuse le composant d'un défaut qui appartient au harnais.
afterEach(cleanup)
