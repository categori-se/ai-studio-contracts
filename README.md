# Studio Contracts

Provider-neutral JavaScript assertions and JSON schemas for carrying evidence-sensitive expert work from a stated brief to a reviewed release and defensible handoff. Studio Contracts is useful without a hosted service: use it in CI, a local script, an editor extension, or another product whenever the project record should remain portable and inspectable.

The contracts intentionally do not encode a sector. Research synthesis, engineering assurance, policy review, due diligence, document evaluation, and regulated review can use the same structural boundary while keeping their own terminology, rubrics, qualifications, and decision authority in project-owned records.

The package answers a narrow set of questions:

- What is this project for, who owns it, and what data sensitivity applies?
- Which claims refer to which evidence resources?
- Which model and tool boundaries govern an agent run?
- Which versioned rubric evaluates a candidate?
- Which human roles must approve release or rollback?
- What immutable result was released, from which revision, and to which logical target?

It does not answer whether a claim is true, whether a professional standard is satisfied, or whether a system is safe. Validation proves that a record is well formed and internally consistent; domain evidence and qualified human judgment still matter.

## Public contract surface

| Contract | Use |
| --- | --- |
| Project manifest | Repository-owned purpose, sources, claims, policies, evaluation suites, approval roles, and logical targets |
| Workspace manifest | A safe relative-path index of one or more project manifests |
| Evaluation rubric | Versioned criteria, weights, passing score, and explicit human-review requirement |
| Document-set manifest | Exact URI, storage version, ETag, media type, and SHA-256 identity for every evaluated document |
| Document-evaluation result | Provider-neutral rubric output with bounded confidence, evidence locators, excerpts, and chunk digests for every criterion |
| Document-review decision | Create-only human judgment bound to one exact stored result version and digest; it never authorizes deployment or trading |
| Release record | Portable deployment evidence; v2 adds repository/environment identity, artifact URI, endpoint verification, and explicit rollback lineage, but grants no deployment authority |
| Gateway request | Bounded provider-neutral request shared by local providers and adapters |
| GenAI signal normalizer | Privacy-conscious OpenTelemetry event attributes with content disabled by default |

```js
import {
  assertDocumentEvaluationResult,
  assertDocumentReviewDecision,
  assertDocumentSetManifest,
  assertProject,
  assertWorkspace,
  normalizeGatewayRequest,
  normalizeGenAiOperationEvent
} from "@categori/studio-contracts";
```

Version 0.4 adds portable project and workspace manifests, evaluation rubrics, document-evaluation evidence contracts, release-record contracts designed for versioned evidence storage, and privacy-safe OpenTelemetry GenAI signal normalization. The document contracts use the same provider-neutral records from ingestion through human review: a manifest pins each input version and digest, the result carries per-criterion citations and confidence, and the decision pins the exact result URI, version, ETag, and SHA-256. A valid machine result remains explicitly pending human review. An approved review is a judgment about that result—not release, source-mutation, trading, or deployment authority.

The contract does not claim that a storage system is append-only. `assertDocumentReviewDecision` returns a recursively frozen clone and verifies its evidence binding, actor identity, outcome, and fail-closed effects, but durable immutability still requires a create-only write and retained object version in the storage system. The JSON Schema covers the portable record shape; the JavaScript validator also enforces relational invariants such as matching job/evaluation and actor/subject identities. Deployments must enforce their own conditional writes, version retention, and—where required—Object Lock. The project contract remains backward compatible with version 0.3: the original required fields are unchanged, while optional purpose, claim/evidence, owner, agent, evaluation, approval, risk, cost-center, and logical deployment metadata make the research-to-release relationship inspectable.

`release-record.schema.json` and the version-dispatching `assertReleaseRecord` preserve the
compact v1 shape. `release-record-v2.schema.json` and `assertReleaseRecordV2` describe
verified deployment evidence: exact repository and environment, an artifact URI and digest,
the deployed URL, verification facts, and `DEPLOY` or `ROLLBACK` semantics. A rollback must
name distinct replaced and restored release references, including each exact record URI,
storage VersionId, and record-body SHA-256; a normal deployment must not carry
rollback lineage. The optional `deploymentAuthorization` object can retain the exact
credential-free S3 authorization URI, VersionId, record-body SHA-256, and content-derived
identifier; older v2 records remain valid without it. This reference carries no token or
credential and does not itself grant deployment authority. The JavaScript assertion also
binds the URI path suffix to `projectId` and the authorization `id`, a relational check that
portable JSON Schema cannot express. URI validation rejects credentials, queries, and
fragments without prescribing a private deployment bucket. Storage-specific
verification—such as fetching that exact version and binding its facts before mutation—belongs
to the system that owns the registry and workflow.

Assertions return recursively frozen clones and reject unknown properties, duplicate record identifiers, dangling evidence references, unsafe paths, and secret-bearing fields. Schemas are exported alongside the JavaScript API so non-JavaScript tools can implement the same boundary.

## A practical standalone workflow

1. Keep `.ai-studio/project.yaml` with the project it describes.
2. Validate it during code review and CI with `assertProject` or the JSON Schema.
3. Version evaluation rubrics beside the code and evidence they govern.
4. Pin every evaluated input with `assertDocumentSetManifest`, then validate the cited machine output with `assertDocumentEvaluationResult`.
5. Authenticate the reviewer and store `assertDocumentReviewDecision` with a create-only write bound to the exact result version and digest.
6. Write a v2 release record only after target verification, using create-only or otherwise
   immutable storage. Preserve older v1 records as historical evidence without inventing
   facts they did not capture.

See [`studio-examples`](https://github.com/categori-se/ai-studio-examples) for the general workflow and synthetic cross-domain reference projects. [`studio-core`](https://github.com/categori-se/ai-studio-core) provides a read-only CLI and local loader for these records.

## OpenTelemetry GenAI

The package maps provider-neutral run information to the [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) and records `https://opentelemetry.io/schemas/gen-ai/1.42.0` as its schema identifier. The identifier is telemetry metadata, not a documentation URL. Those conventions are still Development, so a schema upgrade requires an explicit package release. Prompt messages, output messages, system instructions, prompt variables, and tool definitions are omitted by default. A caller must explicitly pass `{includeContent: true}` to include them and remains responsible for consent, redaction, access, and retention.

The normalizers produce signal data only. They do not configure a collector, export customer content, or introduce a proprietary trace backend.

## Public library and managed control plane

Studio Contracts stays public because portability is most valuable at the boundary between tools. You can use it in a local workflow, CI pipeline, self-managed service, or unrelated product without AI Studio. The private hosted AI Studio uses pinned releases of the same contracts and adds tenant identity, encrypted connections, shared approvals, audit history, managed release controls, and support. None of those hosted capabilities is required to validate or retain your own records, and the hosted service is not an incompatible fork.

## Status and contributing

`package.json` identifies this source line as version 0.5.0. A checkout is the published v0.5.0 source release only when the repository's `v0.5.0` tag resolves to that exact commit; otherwise treat `main` as development. Earlier tags remain available for comparison and compatibility testing. The package has not been published to npm, so pin an exact Git tag or commit when consuming it.

For a contract change, [open an issue](https://github.com/categori-se/ai-studio-contracts/issues) with the concrete workflow, compatibility effect, and a minimal example before opening a pull request. Contributions must remain provider-neutral, include tests, and follow [`CONTRIBUTING.md`](./CONTRIBUTING.md). The repository is licensed under the Apache License, Version 2.0.
