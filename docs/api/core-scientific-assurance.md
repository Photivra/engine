# core/scientific-assurance.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ComposedScientificAssurance

Combined status and kept evidence for one declared scientific result across stages.

- A required input that is incomplete or approximate limits the combined status.
- Deterministic processing cannot turn an approximation into a calibration.
- Uncertainty components stay separate unless an explicit mathematical propagation
  model justifies combining them.
- A count of successful stages is not an accuracy bound.

```ts
export interface ComposedScientificAssurance {
  version:
    typeof SCIENTIFIC_ASSURANCE_CONTRACT_VERSION;
  scientificStatus:
    ScientificAssuranceStatus;
  weakestRequiredComponentIds:
    readonly string[];
  evidenceStatus:
    | "complete"
    | "missing-required-evidence";
  missingRequiredEvidenceComponentIds:
    readonly string[];
  uncertainty:
    ComposedScientificUncertaintyStatus;
  components:
    readonly ScientificAssuranceComponent[];
  componentEvidencePreserved: true;
  componentUncertaintyPreserved: true;
  aggregateNumericUncertaintyFabricated:
    false;
  downstreamStatusPromotedAboveInputs:
    false;
}
```

## ComposedScientificUncertaintyStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ComposedScientificUncertaintyStatus =
  | {
      kind: "unknown";
      componentIds:
        readonly string[];
      limitation: string;
    }
  | {
      kind: "not-quantified";
      componentIds:
        readonly string[];
      limitation: string;
    }
  | {
      kind: "not-propagated";
      componentIds:
        readonly string[];
      limitation: string;
    }
  | {
      kind: "not-applicable";
      componentIds:
        readonly string[];
      limitation: string;
    };
```

## composeScientificAssurance

Combines the scientific status, evidence and uncertainty of several inputs into one
record, without inventing a single numeric uncertainty.

The combined status can be no better than the weakest required input. Each component's
evidence and uncertainty is kept exactly as given, after validation.

```ts
export function composeScientificAssurance(
  input:
    ComposeScientificAssuranceInput
): ComposedScientificAssurance;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ComposeScientificAssuranceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ComposeScientificAssuranceInput {
  components:
    readonly ScientificAssuranceComponent[];
}
```

## SCIENTIFIC_ASSURANCE_CONTRACT_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SCIENTIFIC_ASSURANCE_CONTRACT_VERSION =
  "0.1.0" as const
```

## ScientificAssuranceBasisKind

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ScientificAssuranceBasisKind =
  | "evidence-backed-fact"
  | "photivra-model-assumption"
  | "not-applicable";
```

## ScientificAssuranceComponent

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ScientificAssuranceComponent {
  componentId: string;
  role: string;
  required: boolean;
  sourceIdentity:
    ScientificAssuranceSourceIdentity;
  basisKind:
    ScientificAssuranceBasisKind;
  scientificStatus:
    ScientificAssuranceStatus;
  evidenceRequirement:
    | "required"
    | "not-required";
  evidence:
    readonly EvidenceProvenance[];
  uncertainty:
    ScientificAssuranceComponentUncertainty;
  limitations:
    readonly string[];
}
```

## ScientificAssuranceComponentUncertainty

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ScientificAssuranceComponentUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "absolute";
      plusMinus: number;
      unit: string;
      basis?: string;
    }
  | {
      kind: "calculation-quality";
      quality: CalculationQuality;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    }
  | {
      kind: "unknown";
      limitation: string;
    }
  | {
      kind: "not-applicable";
      reason: string;
    };
```

## ScientificAssuranceSourceIdentity

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ScientificAssuranceSourceIdentity {
  kind: ScientificAssuranceSourceKind;
  id: string;
  version?: string;
}
```

## ScientificAssuranceSourceKind

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ScientificAssuranceSourceKind =
  | "profile"
  | "result"
  | "model"
  | "fixture";
```

## ScientificAssuranceStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ScientificAssuranceStatus =
  | "calibrated"
  | "approximation"
  | "unknown";
```
