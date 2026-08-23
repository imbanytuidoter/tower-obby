/**
 * Colour, as pure numbers.
 *
 * Split out of build.ts for the same reason the backdrop ring was: the brief's
 * load-bearing rule - "a pad is always lighter than what is behind it" - is
 * arithmetic, and arithmetic can be asserted. It was false for the lowest band
 * for two commits and the only witness was a screenshot.
 *
 * Nothing here may import the SDK.
 */
import { BANDS, PAD_EMISSIVE, TOWER_ZONES } from './config'

export const SAFE_HUE = 185
export const SAFE_HUE_SWING = 26
const ZONE_STEPS = 10

/**
 * How hard the backdrop panels light themselves.
 *
 * A panel facing inward catches no sky, so at 0 it renders black and the band
 * reads as a hole rather than as distance. But at 0.85 - where it shipped -
 * the understory band came out at luminance 0.85 against pads at 0.63: the
 * backdrop was brighter than the climb, which is the one thing the style
 * cannot afford. Measured in tools/verify-layout.mjs; see valueSeparation().
 */
export const BACKDROP_EMISSIVE = 0.12

/**
 * How much of a pad's albedo the slab texture lets through on its FACE.
 *
 * The texture is greyscale and multiplies albedoColor, so a face painted at
 * 135/255 halves the colour that actually reaches the eye. Without this the
 * value check compared the colour in the source against a wall that has no
 * texture at all, passed, and said nothing about what renders.
 *
 * Measured from images/textures/slab.png, which tools/make-textures.py writes.
 */
export const SLAB_FACE_ALBEDO = 135 / 255

/** 0 at the gate, 1 at the crown, quantised to bound the material count. */
export function zoneRamp(section: number): number {
  const t = Math.min(1, Math.max(0, (section - 1) / (TOWER_ZONES - 1)))
  return Math.round(t * (ZONE_STEPS - 1)) / (ZONE_STEPS - 1)
}

/** Minimal HSL. Returns plain rgb in 0..1 so this file stays SDK-free. */
export function hsl(h: number, sat: number, light: number): [number, number, number] {
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = light - c / 2
  const seg = Math.floor(h / 60) % 6
  const rgb =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
    : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x]
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m]
}

export function bodyRgb(section: number): [number, number, number] {
  const t = zoneRamp(section)
  // Azure at the base through green-cyan at the crown. Still unmistakably
  // "safe" at both ends.
  return hsl(SAFE_HUE + SAFE_HUE_SWING - t * (SAFE_HUE_SWING * 2), 0.8, 0.5 - t * 0.05)
}

export function accentRgb(section: number): [number, number, number] {
  const t = zoneRamp(section)
  return hsl(SAFE_HUE + SAFE_HUE_SWING - t * (SAFE_HUE_SWING * 2), 0.9, 0.74)
}

function hexRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.substr(1, 2), 16) / 255,
    parseInt(hex.substr(3, 2), 16) / 255,
    parseInt(hex.substr(5, 2), 16) / 255
  ]
}

/** What the eye actually receives: albedo lit by sky, plus self-lighting. */
function apparent(rgb: [number, number, number], emissive: number): number {
  const [r, g, b] = rgb.map((v) => Math.min(1, v * (1 + emissive)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export type BandContrast = {
  band: string
  backdrop: number
  pad: number
  margin: number
}

/**
 * Per band: how much lighter the pads are than the wall behind them.
 * Negative means the backdrop wins and the climb reads as a silhouette hole.
 */
export function valueSeparation(): BandContrast[] {
  return BANDS.map((band) => {
    const mid = Math.round((band.from + band.to) / 2)
    // The wall is untextured, so all of its albedo arrives. The pad's does not:
    // the slab texture darkens the face, while the emissive is not textured
    // and comes through whole. Hence face * albedo + emissive, not 1 + emissive.
    const backdrop = apparent(hexRgb(band.backdrop), BACKDROP_EMISSIVE)
    const pad = apparent(bodyRgb(mid), PAD_EMISSIVE.safe - (1 - SLAB_FACE_ALBEDO))
    return { band: band.name, backdrop, pad, margin: pad - backdrop }
  })
}


/**
 * What each colour in the tower MEANS, as hex.
 *
 * Here rather than in build.ts so the one rule the whole readability of the
 * scene rests on can be checked by arithmetic: a colour may not mean two
 * things. It did. Unstable ground was #FF9D2E and a checkpoint was #FFD23F -
 * fourteen degrees of hue and 0.15 of luminance apart, which is one colour on
 * a phone at twenty metres.
 */
export const MEANING = {
  safe: '#4EE3F2',
  hurts: '#FF3B4D',
  unstable: '#D2651A',
  goal: '#FFD23F'
} as const

function hueOf(rgb: [number, number, number]): number {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const span = max - min
  if (span === 0) return 0
  const h = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4
  return (h * 60 + 360) % 360
}

export type ColourGap = { a: string; b: string; hue: number; luminance: number }

/**
 * How far apart every pair of meanings is.
 *
 * Two ways to be distinguishable and either will do: a different hue, or a
 * different brightness. Requiring both would rule out palettes that read
 * perfectly well, and requiring neither is what produced the collision above.
 */
export function colourGaps(): ColourGap[] {
  const names = Object.keys(MEANING) as (keyof typeof MEANING)[]
  const gaps: ColourGap[] = []

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const one = hexRgb(MEANING[names[i]])
      const two = hexRgb(MEANING[names[j]])
      const raw = Math.abs(hueOf(one) - hueOf(two))
      gaps.push({
        a: names[i],
        b: names[j],
        hue: Math.min(raw, 360 - raw),
        luminance: Math.abs(
          0.2126 * one[0] + 0.7152 * one[1] + 0.0722 * one[2] -
          (0.2126 * two[0] + 0.7152 * two[1] + 0.0722 * two[2])
        )
      })
    }
  }
  return gaps
}
