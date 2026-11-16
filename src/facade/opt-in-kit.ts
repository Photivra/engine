// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22.0 (#594): the opt-in features' code, one module that the capture loads on demand (`loadOptInKit`, src/facade/on-demand-kits.ts)
 * when a request uses one of them, so a bundler that splits dynamic imports keeps it off the default path. Only re-exports:
 * `sensor.profile` (#554: the profile parser and body builder; the catalogue itself is never imported), `illumination` (#550, with
 * #597's lighting over a print), `motion.subject` (#551), the catalogue lens's opt-in optics' reports (#632) and (#628) the display view's
 * `output.lensCorrections` and `output.sharpening`, and (#641) `motion.handheld`.
 */

export { parseSensorProfile, sensorProfileBody, sensorProfileSaturationIso } from "../equipment/sensor-profile-body.js";
export { flashAloneShutter, meterFlash, rebindFlashAssumptions, requireFlashRows, resolveMixedIllumination, solveFlashShutter } from "./mixed-illumination.js";
export { createSubjectMotionProvider, subjectTravelM } from "../motion/subject-motion.js";
export { resolveLensFilter } from "./lens-filter.js";
export { catalogueOpticsAssumptions } from "./catalogue-lens-optics.js";
export { renderDisplayViewDetail } from "./display-view-detail.js";
export { handShakeAssumption, handShakeQuadruples, resolveHandShake } from "../motion/hand-shake.js";
