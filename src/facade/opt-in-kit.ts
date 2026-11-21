// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22.0 (#594): the opt-in features' code, one module that the capture loads on demand (`loadOptInKit`, src/facade/on-demand-kits.ts)
 * when a request uses one of them, so a bundler that splits dynamic imports keeps it off the default path. Only re-exports:
 * `sensor.profile` (#554: the profile parser and body builder; the catalogue itself is never imported), `illumination` (#550, with
 * #597's lighting over a print), `motion.subject` (#551), the catalogue lens's opt-in optics' reports (#632) and (#628) the display view's
 * `output.lensCorrections` and `output.sharpening`, and (#641) `motion.handheld`.
 */

import { parseSensorProfile, sensorProfileBody, sensorProfileSaturationIso } from "../equipment/sensor-profile-body.js";
import { flashAloneShutter, meterFlash, rebindFlashAssumptions, requireFlashRows, resolveMixedIllumination, solveFlashShutter } from "./mixed-illumination.js";
import { createSubjectMotionProvider, subjectTravelM } from "../motion/subject-motion.js";
import { resolveLensFilter } from "./lens-filter.js";
import { catalogueOpticsAssumptions } from "./catalogue-lens-optics.js";
import { renderDisplayViewDetail } from "./display-view-detail.js";
import { handShakeAssumption, handShakeQuadruples, resolveHandShake } from "../motion/hand-shake.js";

/**
 * #658: the kit is one exported tuple, read by position (the `OK_*` constants of src/facade/on-demand-kits.ts, which a bundler
 * inlines), so neither this chunk's export list nor the code that calls it carries the long export names.
 */
export const OPT_IN_KIT = [
  parseSensorProfile,
  sensorProfileBody,
  sensorProfileSaturationIso,
  flashAloneShutter,
  meterFlash,
  rebindFlashAssumptions,
  requireFlashRows,
  resolveMixedIllumination,
  solveFlashShutter,
  createSubjectMotionProvider,
  subjectTravelM,
  resolveLensFilter,
  catalogueOpticsAssumptions,
  renderDisplayViewDetail,
  handShakeAssumption,
  handShakeQuadruples,
  resolveHandShake
] as const;
