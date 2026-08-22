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
    const backdrop = apparent(hexRgb(band.backdrop), BACKDROP_EMISSIVE)
    const pad = apparent(bodyRgb(mid), PAD_EMISSIVE.safe)
    return { band: band.name, backdrop, pad, margin: pad - backdrop }
  })
}
