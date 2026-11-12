# composition/plan-consumer.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createProductionPlanConsumerManifest

Creates a deterministic view of one finished production plan, for a renderer
or a reference consumer.

The consumer role only changes who is responsible for executing. It does not
change the scientific stages or effects, the number of time samples, the
seeds or any physical result.

```ts
export function createProductionPlanConsumerManifest(
  input:
    CreateProductionPlanConsumerManifestInput
): ProductionPlanConsumerManifest;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateProductionPlanConsumerManifestInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateProductionPlanConsumerManifestInput {
  plan: ProductionImageFormationPlan;
  consumerKind: RendererConsumerKind;
}
```

## PRODUCTION_PLAN_CONSUMER_MANIFEST_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PRODUCTION_PLAN_CONSUMER_MANIFEST_VERSION =
  "0.2.0" as const
```

## ProductionPlanConsumerManifest

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProductionPlanConsumerManifest {
  version:
    typeof PRODUCTION_PLAN_CONSUMER_MANIFEST_VERSION;
  consumerKind: RendererConsumerKind;
  planVersion:
    typeof PRODUCTION_IMAGE_FORMATION_PLAN_VERSION;
  planFingerprint: string;
  planStatus:
    ProductionImageFormationPlan["status"];
  activeOrModeledStages:
    readonly {
      stageId: ImageFormationStageId;
      state: "active" | "modeled-zero";
      modelId?: string;
      modelVersion?: string;
      resultIdentity?: string;
    }[];
  activeOrModeledEffects:
    readonly {
      effectId: ImageFormationEffectId;
      state: "active" | "modeled-zero";
      modelId?: string;
      modelVersion?: string;
    }[];
  blockers:
    readonly ProductionImageFormationBlocker[];
  /** The same immutable RAW and output results that ran. A consumer cannot re-render from a different source. */
  environmentCaptureResult?: ProductionImageFormationPlan["environmentCaptureResult"];
  processedOutputResult?: ProductionImageFormationPlan["processedOutputResult"];
  physicalSceneToSensorResult:
    ProductionImageFormationPlan["physicalSceneToSensorResult"];
  temporalCaptureResult:
    ProductionImageFormationPlan["temporalCaptureResult"];
  scientificAssurance:
    ProductionImageFormationPlan["scientificAssurance"];
  stochastic: {
    captureSeedUint32: number;
    consumerMayReplaceSeed: false;
    backendRandomnessMayRedefineScientificResult:
      false;
  };
  scientificSemanticsSharedAcrossConsumerKinds:
    true;
  consumerMayChangeScientificInputs:
    false;
  consumerMayReorderImageFormationStages:
    false;
  consumerMayReduceCommittedTemporalSampleCount:
    false;
}
```
