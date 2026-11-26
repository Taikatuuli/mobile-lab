import type { ComponentType } from 'react'
import Spin from './spin/Spin'

export type Prototype = { slug: string; title: string; component: ComponentType }

// Add a new prototype: create src/prototypes/<name>/, then register it here.
export const prototypes: Prototype[] = [
  { slug: 'spin', title: 'Spin: calm fidget spinner with soft notes', component: Spin },
]
