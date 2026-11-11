// SPDX-License-Identifier: Apache-2.0

/**
 * #590 (2.22.0): how much a light's spectrum can defeat the facade's spectral midpoint quadrature. The composite midpoint rule
 * over [a, b] with step h has the error (b − a)·h²·f″(ξ)/24 (DLMF §3.5(i)); normalized by the integral it gives the relative
 * error indicator R(h) = h²·κ/24 with κ = Σ_λ |S(λ + 1) − 2S(λ) + S(λ − 1)| / Σ_λ S(λ) on a 1 nm grid over 380–780 nm (nm⁻²),
 * from the illuminant's spectral power distribution alone (no sensor channel). A light is "spiky at h" when R(h) exceeds
 * {@link SPECTRAL_SPIKINESS_THRESHOLD} (a design choice: the bound allows more than 1 % error).
 */

/** R(h) above this marks a spiky light (owner decision 2026-11-10: the fluorescent and LED representative sources count). */
export const SPECTRAL_SPIKINESS_THRESHOLD = 0.01;

/** κ, nm⁻², of a spectral power distribution evaluated at 380, 381, …, 780 nm (0 for a zero spectrum). */
export function spectralSpikiness(evaluate: (wavelengthNanometers: number) => number): number {
  let a = evaluate(380), b = evaluate(381), sum = a + b, second = 0;
  for (let nm = 382; nm <= 780; nm++) { const c = evaluate(nm); second += Math.abs(c - 2 * b + a); sum += c; a = b; b = c; }
  return sum > 0 ? second / sum : 0;
}
