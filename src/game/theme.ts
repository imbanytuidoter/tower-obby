import { Color3, Color4 } from '@dcl/sdk/math'

export type Theme = {
  name: string
  /** Cool, desaturated body colour: the built world recedes. */
  pad: Color4
  /** The round's accent, used only for pad underglow and the spine. */
  accent: Color3
}

/**
 * A deliberately narrow palette. Every theme is a cool constructed tone with a
 * single accent, so the fixed gameplay colours - cyan for safe, red for danger,
 * gold for the goal - always read as the loudest things on screen.
 */
export const THEMES: Theme[] = [
  { name: 'AZURE', pad: Color4.create(0.34, 0.4, 0.52, 1), accent: Color3.create(0.25, 0.6, 0.95) },
  { name: 'MINT', pad: Color4.create(0.3, 0.44, 0.44, 1), accent: Color3.create(0.2, 0.85, 0.7) },
  { name: 'INDIGO', pad: Color4.create(0.3, 0.32, 0.5, 1), accent: Color3.create(0.4, 0.35, 0.95) },
  { name: 'VIOLET', pad: Color4.create(0.38, 0.32, 0.5, 1), accent: Color3.create(0.65, 0.3, 0.95) },
  { name: 'SLATE', pad: Color4.create(0.34, 0.37, 0.42, 1), accent: Color3.create(0.55, 0.7, 0.85) },
  { name: 'TEAL', pad: Color4.create(0.26, 0.42, 0.48, 1), accent: Color3.create(0.15, 0.75, 0.9) },
  { name: 'PLUM', pad: Color4.create(0.4, 0.3, 0.42, 1), accent: Color3.create(0.85, 0.35, 0.8) },
  { name: 'MOSS', pad: Color4.create(0.32, 0.42, 0.34, 1), accent: Color3.create(0.45, 0.85, 0.4) },
  { name: 'STEEL', pad: Color4.create(0.36, 0.39, 0.45, 1), accent: Color3.create(0.7, 0.8, 0.95) },
  { name: 'OBSIDIAN', pad: Color4.create(0.24, 0.25, 0.32, 1), accent: Color3.create(0.95, 0.55, 0.25) }
]

export function themeFor(round: number): Theme {
  return THEMES[(round - 1) % THEMES.length]
}
