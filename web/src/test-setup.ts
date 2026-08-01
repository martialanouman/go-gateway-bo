// Les assertions sur le DOM (`toBeInTheDocument`, `toBeVisible`…) viennent de jest-dom ; sans cet
// import, elles échouent en « not a function » plutôt qu'en assertion rouge.
import '@testing-library/jest-dom/vitest'
