// SPDX-License-Identifier: Apache-2.0
// #604 research only: runs capture-setups.research.ts, which `npm test` never includes.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["scripts/research/ahd-bias/*.research.ts"], testTimeout: 600_000 } });
