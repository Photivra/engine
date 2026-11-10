// SPDX-License-Identifier: Apache-2.0

/**
 * Subject motion (#551, 2.22.0): the whole scene, or one declared rectangle of it, moving on the scene plane during the
 * exposure, over a still background. Translation in m/s on the plane and, optionally, a constant rotation about an axis
 * parallel to the optical axis (through the plane's origin for the whole scene, through the rectangle's centre for a
 * region). Times are seconds from the first opening reference, the camera rotation's time reference, so each site's own
 * exposure window (shifted by its rolling-shutter offset) sees the subject where it is during that window.
 *
 * The scene at plane point p and time t: a point of the subject at rest point q is at R(θ)(q − c) + c + d at time t
 * (d = v·t, θ = ω·t, c the centre), so p shows the subject's q = R(−θ)(p − c − d) + c when q lies in the subject; else
 * a region's rest rectangle shows a neutral 18 % background (what the subject revealed), and anywhere else the still scene at p. Exact for this
 * model (rigid motion of a planar layer); the blur is the capture's temporal midpoint quadrature.
 * @see docs/QUICK_START.md, "Subject motion".
 */

import type { PlanarSceneRadianceProvider } from "../facade/scene-radiance.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../schema/scene-radiance.js";

/** `motion.subject` of `simulateCapture`: a moving subject on the scene plane (#551). */
export interface SimulateCaptureSubjectMotion {
  /** Velocity on the scene plane, m/s: +x right, +y up as seen from the camera. Missing components are 0. */
  velocityMPerSec?: { x?: number; y?: number };
  /** Rotation about the optical axis direction, rad/s, counter-clockwise as seen from the camera (+x toward +y). Default 0. */
  angularVelocityRadPerSec?: number;
  /**
   * The moving part: a rectangle on the scene plane at rest (at the first opening reference), its centre and size in metres
   * (+x right, +y up from the optical axis). Omitted: the whole scene moves.
   */
  region?: { centerXM: number; centerYM: number; widthM: number; heightM: number };
  /** Exact or fast (2.20.0 convention): fast takes fewer temporal midpoints when the subject's streak is short (see the docs). */
  fast?: boolean;
}

/** Internal: a validated subject motion (simulate-capture.ts parses it). */
export interface SubjectMotion {
  vx: number; vy: number; omega: number;
  /** The region's centre and half sizes in metres, or undefined for the whole scene. */
  region: { cx: number; cy: number; hw: number; hh: number } | undefined;
}

/**
 * The farthest any subject point travels on the plane during `seconds`, in metres (translation plus rotation at the subject's
 * farthest point from its centre; `reachM` is the whole scene's reach from the axis when no region is declared).
 */
export function subjectTravelM(motion: SubjectMotion, seconds: number, reachM: number): number {
  const r = motion.region, arm = r ? Math.hypot(r.hw, r.hh) : reachM;
  return (Math.hypot(motion.vx, motion.vy) + Math.abs(motion.omega) * arm) * seconds;
}

/**
 * The plane point that shows at (x, y) at time t (in the motion's length unit), written to out[0], out[1]; returns false where a region's rest
 * rectangle shows the revealed background. Without motion at t (d = 0, θ = 0) the point is (x, y) unchanged, bit for bit.
 */
export function subjectSourcePoint(motion: SubjectMotion, x: number, y: number, t: number, out: Float64Array): boolean {
  const r = motion.region, th = motion.omega * t;
  let qx = x - motion.vx * t, qy = y - motion.vy * t;
  if (th !== 0) {
    const cx = r ? r.cx : 0, cy = r ? r.cy : 0, c = Math.cos(th), s = Math.sin(th), dx = qx - cx, dy = qy - cy;
    qx = c * dx + s * dy + cx; qy = c * dy - s * dx + cy;
  }
  if (r && !(Math.abs(qx - r.cx) <= r.hw && Math.abs(qy - r.cy) <= r.hh)) {
    out[0] = x; out[1] = y;
    return !(Math.abs(x - r.cx) <= r.hw && Math.abs(y - r.cy) <= r.hh);
  }
  out[0] = qx; out[1] = qy;
  return true;
}

/**
 * The scene of `base` with the subject moving: `evaluateRadiance` reads each query at its request time (the base result, with the
 * radiance read where the subject shows), and `radianceAt` takes the time as a fourth argument (default 0) for the image-space
 * lattices and the display view. It has no chart material access, so renderers read radiance. `revealedRadiance` is the revealed
 * background's spectral radiance (an 18 % neutral reflectance).
 */
export function createSubjectMotionProvider(base: PlanarSceneRadianceProvider, motion: SubjectMotion, distanceM: number, scale: number,
  revealedRadiance: (nm: number) => number): PlanarSceneRadianceProvider {
  // The motion in frame units, so a still instant reads the base at the queried point itself.
  const r = motion.region, framed: SubjectMotion = { vx: motion.vx / scale, vy: motion.vy / scale, omega: motion.omega,
    region: r && { cx: r.cx / scale, cy: r.cy / scale, hw: r.hw / scale, hh: r.hh / scale } }, point = new Float64Array(2);
  const radianceAt = (u: number, v: number, nm: number, t = 0): number =>
    subjectSourcePoint(framed, u, v, t, point) ? base.radianceAt(point[0]!, point[1]!, nm) : revealedRadiance(nm);
  return { sceneId: base.sceneId, providerProfileId: base.providerProfileId, radianceAt, evaluateApertureRadiance: base.evaluateApertureRadiance,
    evaluateRadiance(request: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult {
      const result = base.evaluateRadiance(request), o = (request.target as { outgoingDirectionUnitVector: { x: number; y: number; z: number } }).outgoingDirectionUnitVector;
      if (!(o.z < 0)) return result;
      // The base provider's own plane-point arithmetic for this direction.
      const t = distanceM / -o.z;
      return { ...result, spectralRadianceWattsPerSquareMeterSteradianNanometer: radianceAt(-o.x * t / scale, -o.y * t / scale, request.wavelengthNanometers, request.timeSecondsFromExposureStart) };
    } };
}
