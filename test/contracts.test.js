import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  applicationSourcePosture,
  assertEvaluationRubric,
  assertProject,
  assertReleaseRecord,
  assertReleaseRecordV2,
  assertWorkspace,
  GENAI_EVENT_NAMES,
  GENAI_METRIC_NAMES,
  normalizeGatewayRequest,
  normalizeGenAiEvaluationEvent,
  normalizeGenAiExceptionEvent,
  normalizeGenAiMetrics,
  normalizeGenAiOperationEvent,
  OTEL_GENAI_SCHEMA_URL,
  validateEvaluationRubric,
  validateProject,
  validateReleaseRecord,
  validateReleaseRecordV2,
  validateWorkspace
} from "../src/index.js";

const SCHEMA_FILES = Object.freeze({
  project: "project-manifest.schema.json",
  workspace: "workspace-manifest.schema.json",
  evaluation: "evaluation-rubric.schema.json",
  release: "release-record.schema.json",
  releaseV2: "release-record-v2.schema.json"
});

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function referencedSchema(root, reference) {
  if (!reference.startsWith("#/")) throw new TypeError(`unsupported schema reference: ${reference}`);
  return reference.slice(2).split("/").reduce(
    (value, part) => value?.[part.replaceAll("~1", "/").replaceAll("~0", "~")],
    root
  );
}

// Dependency-free evaluator for the validation vocabulary used by these four
// schemas. The fixture matrix below runs the same records through this and the
// public JavaScript validators, so a bound or shape change cannot drift silently.
function schemaErrors(value, schema, root = schema, path = "$") {
  if (schema.$ref) return schemaErrors(value, referencedSchema(root, schema.$ref), root, path);
  const errors = [];
  if (schema.allOf) {
    for (const nested of schema.allOf) errors.push(...schemaErrors(value, nested, root, path));
  }
  if (schema.if) {
    const matches = schemaErrors(value, schema.if, root, path).length === 0;
    if (matches && schema.then) errors.push(...schemaErrors(value, schema.then, root, path));
    if (!matches && schema.else) errors.push(...schemaErrors(value, schema.else, root, path));
  }
  if (schema.not && schemaErrors(value, schema.not, root, path).length === 0) errors.push(`${path}: not`);
  if (schema.const !== undefined && !sameJson(value, schema.const)) errors.push(`${path}: const`);
  if (schema.enum && !schema.enum.some((item) => sameJson(value, item))) errors.push(`${path}: enum`);

  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [...errors, `${path}: object`];
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}.${required}: required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${path}.${key}: additionalProperties`);
      }
    }
    for (const [key, nested] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], nested, root, `${path}.${key}`));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [...errors, `${path}: array`];
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: maxItems`);
    if (schema.uniqueItems) {
      value.forEach((item, index) => {
        if (value.slice(0, index).some((previous) => sameJson(previous, item))) errors.push(`${path}[${index}]: uniqueItems`);
      });
    }
    if (schema.items) value.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, root, `${path}[${index}]`)));
  } else if (schema.type === "string") {
    if (typeof value !== "string") return [...errors, `${path}: string`];
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: maxLength`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: pattern`);
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        errors.push(`${path}: format`);
      }
    }
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [...errors, `${path}: number`];
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: exclusiveMinimum`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path}: boolean`);
  }
  return errors;
}

function changed(value, update) {
  const selected = structuredClone(value);
  update(selected);
  return selected;
}

const project = {
  schemaVersion: 1,
  id: "demo-project",
  name: "Demo project",
  repository: "example/demo-project",
  defaultBranch: "main",
  commands: {checks: ["npm test"]},
  modelPolicy: {mode: "local_only"}
};

const governedProject = {
  ...project,
  summary: "A bounded evidence review.",
  dataSensitivity: "public",
  owners: [{id: "review-lead", role: "Reviewer"}],
  purpose: {
    problem: "Determine whether a claim is supported.",
    audiences: ["Reviewers"],
    permittedClaims: [{id: "supported-claim", statement: "The source supports the claim.", evidenceRefs: ["source-document"]}]
  },
  resources: [{id: "source-document", kind: "document", uri: "fixtures/source.md", sensitivity: "public"}],
  agentProfiles: [{id: "reviewer", instructionsPath: "instructions/reviewer.md", allowedTools: ["read_file"]}],
  evaluationSuites: [{id: "quality", rubricPath: "rubrics/quality.yaml", requiredFor: ["release"]}],
  approvalPolicy: {requiredFor: ["release"], roles: ["reviewer"]},
  deploymentTargets: [{id: "preview", kind: "static-site", environment: "local", releaseManifestUri: "releases/current.json"}],
  costCenter: "demo",
  riskLevel: "moderate"
};

const releaseV2 = {
  schemaVersion: 2,
  projectId: "demo-project",
  repository: "example/demo-project",
  targetId: "preview",
  environment: "production",
  commitSha: "a".repeat(40),
  artifact: {
    uri: `s3://example-release-bucket/projects/demo-project/releases/${"a".repeat(40)}/123/`,
    digest: `sha256:${"b".repeat(64)}`
  },
  workflow: {provider: "github-actions", runId: "123:1", url: "https://example.invalid/actions/runs/123"},
  actor: "reviewer",
  operation: "DEPLOY",
  result: "SUCCEEDED",
  deployedAt: "2026-08-01T12:00:00Z",
  deployedUrl: "https://example.invalid/demo",
  verification: {
    method: "release-manifest",
    url: "https://example.invalid/demo/release-manifest.json",
    verifiedAt: "2026-08-01T12:00:00Z"
  }
};

function deploymentAuthorization(projectId = releaseV2.projectId, id = "f".repeat(64)) {
  return {
    uri: `s3://example-authorization-bucket/projects/${projectId}/deployment-authorizations/v1/${id}.json`,
    versionId: "version-1+safe/value",
    recordSha256: "c".repeat(64),
    id
  };
}

test("project contracts stay backward compatible and return a deep-frozen clone", () => {
  assert.deepEqual(validateProject(project), []);
  const checked = assertProject(governedProject);
  assert.equal(checked.id, "demo-project");
  assert.notEqual(checked, governedProject);
  assert.equal(Object.isFrozen(checked), true);
  assert.equal(Object.isFrozen(checked.purpose.permittedClaims[0].evidenceRefs), true);
  assert.throws(() => checked.purpose.problem = "changed", TypeError);
  assert.throws(() => assertProject({...project, id: "Unsafe ID"}), /readable slug/);
});

test("project governance rejects unknown, secret-bearing, duplicate, dangling, and unsafe records", () => {
  const unsafe = structuredClone(governedProject);
  unsafe.clientSecret = "do-not-store-this";
  unsafe.resources.push({...unsafe.resources[0]});
  unsafe.purpose.permittedClaims[0].evidenceRefs = ["missing-source"];
  unsafe.agentProfiles[0].instructionsPath = "../private.md";
  const errors = validateProject(unsafe);
  assert(errors.some((item) => item.message.includes("secret-bearing")));
  assert(errors.some((item) => item.message.includes("unique")));
  assert(errors.some((item) => item.message.includes("declared resource")));
  assert(errors.some((item) => item.message.includes("safe relative")));
});

test("workspace contracts permit only local relative manifest paths", () => {
  const workspace = {
    schemaVersion: 1,
    id: "demo-workspace",
    name: "Demo workspace",
    projects: [{id: "demo-project", path: "projects/demo/.ai-studio/project.yaml"}]
  };
  assert.deepEqual(validateWorkspace(workspace), []);
  assert.equal(Object.isFrozen(assertWorkspace(workspace).projects), true);
  assert.match(validateWorkspace({...workspace, projects: [{path: "../project.yaml"}]})[0].message, /safe relative/);
});

test("evaluation rubric and release record contracts validate immutable governance evidence", () => {
  const rubric = assertEvaluationRubric({
    schemaVersion: 1,
    id: "evidence-quality",
    name: "Evidence quality",
    version: "1.0.0",
    criteria: [{id: "coverage", label: "Coverage", description: "Citations cover claims.", weight: 1, minScore: 0, maxScore: 5}],
    passingScore: 4,
    humanReviewRequired: true
  });
  assert.equal(Object.isFrozen(rubric.criteria[0]), true);
  const release = assertReleaseRecord({
    schemaVersion: 1,
    projectId: "demo-project",
    targetId: "preview",
    commitSha: "a".repeat(40),
    artifactDigest: `sha256:${"b".repeat(64)}`,
    workflow: {provider: "github-actions", runId: "123", url: "https://example.invalid/actions/runs/123"},
    actor: "reviewer",
    result: "SUCCEEDED",
    deployedAt: "2026-08-01T12:00:00Z"
  });
  assert.equal(release.commitSha, "a".repeat(40));
  assert.throws(() => assertReleaseRecord({...release, workflow: {...release.workflow, url: "https://user:password@example.invalid/run"}}), /embedded credentials/);

  const verified = assertReleaseRecordV2(releaseV2);
  assert.equal(verified.operation, "DEPLOY");
  assert.equal(Object.isFrozen(verified.artifact), true);
  assert.equal(verified.deploymentAuthorization, undefined);

  const authorized = assertReleaseRecordV2({
    ...releaseV2,
    deploymentAuthorization: deploymentAuthorization()
  });
  assert.equal(Object.isFrozen(authorized.deploymentAuthorization), true);
  assert.deepEqual(authorized.deploymentAuthorization, deploymentAuthorization());
  assert.throws(
    () => assertReleaseRecordV2({
      ...releaseV2,
      deploymentAuthorization: {
        ...deploymentAuthorization(),
        id: "e".repeat(64)
      }
    }),
    /path suffix matches projectId and the authorization id/
  );
  assert.throws(
    () => assertReleaseRecordV2({
      ...releaseV2,
      deploymentAuthorization: deploymentAuthorization("another-project")
    }),
    /path suffix matches projectId and the authorization id/
  );
  assert.throws(
    () => assertReleaseRecordV2({
      ...releaseV2,
      deploymentAuthorization: {
        ...deploymentAuthorization(),
        accessToken: "must-not-project"
      }
    }),
    /property is not supported/
  );
  assert.throws(
    () => assertReleaseRecordV2({...releaseV2, artifact: {...releaseV2.artifact, uri: "s3://user:secret@example.invalid/object"}}),
    /credential-free/
  );
  assert.throws(
    () => assertReleaseRecordV2({...releaseV2, workflow: {...releaseV2.workflow, url: "https://example.invalid/run?token=secret"}}),
    /without query or fragment/
  );
  assert.throws(
    () => assertReleaseRecordV2({...releaseV2, verification: {...releaseV2.verification, url: "https://example.invalid/check#fragment"}}),
    /without query or fragment/
  );
  const rollback = {
    ...releaseV2,
    operation: "ROLLBACK",
    result: "ROLLED_BACK",
    rollback: {
      replacedRelease: {
        uri: "s3://example-release-bucket/projects/demo-project/release-ledger/v2/preview/cccccccccccccccccccccccccccccccccccccccc/200-1.json",
        versionId: "replaced-version",
        recordSha256: "d".repeat(64)
      },
      restoredFromRelease: {
        uri: "s3://example-release-bucket/projects/demo-project/release-ledger/v2/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/100-1.json",
        versionId: "restored-version",
        recordSha256: "e".repeat(64)
      }
    }
  };
  assert.deepEqual(validateReleaseRecordV2(rollback), []);
  assert.match(
    validateReleaseRecordV2({
      ...rollback,
      rollback: {...rollback.rollback, restoredFromRelease: {...rollback.rollback.restoredFromRelease, versionId: ""}}
    })[0].path,
    /versionId/
  );
  assert.match(
    validateReleaseRecordV2({
      ...rollback,
      rollback: {...rollback.rollback, restoredFromRelease: {...rollback.rollback.restoredFromRelease, versionId: "null"}}
    })[0].path,
    /versionId/
  );
  assert.throws(() => assertReleaseRecordV2({...rollback, rollback: undefined}), /rollback lineage is required/);
});

test("gateway request normalizes the shared request envelope", () => {
  const request = normalizeGatewayRequest({
    capability: "plan",
    projectId: "demo-project",
    modelPolicy: {mode: "local_only"},
    sensitivity: "internal",
    tools: ["read_file"]
  });
  assert.equal(request.schemaVersion, 1);
  assert.deepEqual(request.tools, ["read_file"]);
});

test("OpenTelemetry GenAI normalization omits content by default", () => {
  const input = {
    operationName: "invoke_agent",
    providerName: "openai",
    requestModel: "model-requested",
    responseModel: "model-observed",
    responseId: "response-1",
    projectId: "demo-project",
    runId: "run-1",
    inputMessages: [{role: "user", parts: [{type: "text", content: "private input"}]}],
    outputMessages: [{role: "assistant", parts: [{type: "text", content: "private output"}]}],
    systemInstructions: [{type: "text", content: "private instructions"}],
    toolDefinitions: [{type: "function", name: "private_tool"}],
    promptVariables: {private_value: "secret content"},
    usage: {inputTokens: 10, outputTokens: 4},
    durationSeconds: 0.5
  };
  const event = normalizeGenAiOperationEvent(input);
  assert.equal(event.schemaUrl, OTEL_GENAI_SCHEMA_URL);
  assert.equal(event.name, GENAI_EVENT_NAMES.OPERATION_DETAILS);
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /private input|private output|private instructions|private_tool|secret content/);
  assert.equal(event.attributes["gen_ai.usage.input_tokens"], 10);

  const optedIn = normalizeGenAiOperationEvent(input, {includeContent: true});
  assert.equal(optedIn.attributes["gen_ai.input.messages"][0].role, "user");
  assert.equal(optedIn.attributes["gen_ai.prompt.variable.private_value"], "secret content");

  const metrics = normalizeGenAiMetrics(input);
  assert.deepEqual(metrics.map((item) => item.name), [
    GENAI_METRIC_NAMES.OPERATION_DURATION,
    GENAI_METRIC_NAMES.TOKEN_USAGE,
    GENAI_METRIC_NAMES.TOKEN_USAGE
  ]);
  assert.equal(metrics.some((item) => "studio.run.id" in item.attributes), false);
});

test("OpenTelemetry evaluation and exception events use official event names", () => {
  const evaluation = normalizeGenAiEvaluationEvent({name: "groundedness", scoreValue: 0.9, scoreLabel: "pass", responseId: "response-1"});
  assert.equal(evaluation.name, GENAI_EVENT_NAMES.EVALUATION_RESULT);
  const exception = normalizeGenAiExceptionEvent({type: "timeout", message: "Provider timed out"});
  assert.equal(exception.name, GENAI_EVENT_NAMES.OPERATION_EXCEPTION);
});

test("published JSON schemas are valid and use stable URN identifiers", async () => {
  for (const filename of Object.values(SCHEMA_FILES)) {
    const schema = JSON.parse(await readFile(new URL(`../schemas/${filename}`, import.meta.url), "utf8"));
    assert.match(schema.$id, /^urn:categori:studio:/);
  }
});

test("JavaScript validators and published schemas agree on the v1 conformance matrix", async () => {
  const schemas = Object.fromEntries(await Promise.all(
    Object.entries(SCHEMA_FILES).map(async ([kind, filename]) => [
      kind,
      JSON.parse(await readFile(new URL(`../schemas/${filename}`, import.meta.url), "utf8"))
    ])
  ));
  const workspace = {
    schemaVersion: 1,
    id: "demo-workspace",
    name: "Demo workspace",
    projects: [{id: "demo-project", path: "projects/demo/.ai-studio/project.yaml"}]
  };
  const rubric = {
    schemaVersion: 1,
    id: "evidence-quality",
    name: "Evidence quality",
    version: "1.0.0",
    criteria: [{id: "coverage", label: "Coverage", description: "Citations cover claims.", weight: 1, minScore: 0, maxScore: 5}],
    passingScore: 4,
    humanReviewRequired: true
  };
  const release = {
    schemaVersion: 1,
    projectId: "demo-project",
    targetId: "preview",
    commitSha: "a".repeat(40),
    artifactDigest: `sha256:${"b".repeat(64)}`,
    workflow: {provider: "github-actions", runId: "123", url: "https://example.invalid/actions/runs/123"},
    actor: "reviewer",
    result: "SUCCEEDED",
    deployedAt: "2026-08-01T12:00:00Z"
  };
  const matrix = [
    {label: "project baseline", kind: "project", validator: validateProject, value: governedProject, valid: true},
    {label: "project name bound", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.name = "x".repeat(101); }), valid: false},
    {label: "project whitespace command", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.commands.checks = ["   "]; }), valid: false},
    {label: "project unbounded command item", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.commands.checks = ["x".repeat(501)]; }), valid: true},
    {label: "project unbounded audience item", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.purpose.audiences = ["x".repeat(201)]; }), valid: true},
    {label: "project duplicate evidence reference", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.purpose.permittedClaims[0].evidenceRefs = ["source-document", "source-document"]; }), valid: true},
    {label: "project duplicate allowed tool", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.agentProfiles[0].allowedTools = ["read_file", "read_file"]; }), valid: true},
    {label: "project duplicate resource", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.resources.push(structuredClone(item.resources[0])); }), valid: false},
    {label: "project unsafe relative path", kind: "project", validator: validateProject, value: changed(governedProject, (item) => { item.agentProfiles[0].instructionsPath = "../private.md"; }), valid: false},
    {label: "workspace baseline", kind: "workspace", validator: validateWorkspace, value: workspace, valid: true},
    {label: "workspace whitespace name", kind: "workspace", validator: validateWorkspace, value: changed(workspace, (item) => { item.name = "   "; }), valid: false},
    {label: "workspace name bound", kind: "workspace", validator: validateWorkspace, value: changed(workspace, (item) => { item.name = "x".repeat(101); }), valid: false},
    {label: "workspace summary bound", kind: "workspace", validator: validateWorkspace, value: changed(workspace, (item) => { item.summary = "x".repeat(501); }), valid: false},
    {label: "workspace path bound", kind: "workspace", validator: validateWorkspace, value: changed(workspace, (item) => { item.projects[0].path = `${"x".repeat(496)}.yaml`; }), valid: false},
    {label: "workspace duplicate reference", kind: "workspace", validator: validateWorkspace, value: changed(workspace, (item) => { item.projects.push(structuredClone(item.projects[0])); }), valid: false},
    {label: "workspace uppercase manifest extension", kind: "workspace", validator: validateWorkspace, value: changed(workspace, (item) => { item.projects[0].path = "projects/demo/PROJECT.YAML"; }), valid: true},
    {label: "workspace unsafe path", kind: "workspace", validator: validateWorkspace, value: changed(workspace, (item) => { item.projects[0].path = "../project.yaml"; }), valid: false},
    {label: "rubric baseline", kind: "evaluation", validator: validateEvaluationRubric, value: rubric, valid: true},
    {label: "rubric name bound", kind: "evaluation", validator: validateEvaluationRubric, value: changed(rubric, (item) => { item.name = "x".repeat(101); }), valid: false},
    {label: "rubric version bound", kind: "evaluation", validator: validateEvaluationRubric, value: changed(rubric, (item) => { item.version = "x".repeat(101); }), valid: false},
    {label: "rubric criterion label bound", kind: "evaluation", validator: validateEvaluationRubric, value: changed(rubric, (item) => { item.criteria[0].label = "x".repeat(101); }), valid: false},
    {label: "rubric criterion description bound", kind: "evaluation", validator: validateEvaluationRubric, value: changed(rubric, (item) => { item.criteria[0].description = "x".repeat(1001); }), valid: false},
    {label: "rubric duplicate criterion", kind: "evaluation", validator: validateEvaluationRubric, value: changed(rubric, (item) => { item.criteria.push(structuredClone(item.criteria[0])); }), valid: false},
    {label: "rubric criterion count bound", kind: "evaluation", validator: validateEvaluationRubric, value: changed(rubric, (item) => { item.criteria = Array.from({length: 26}, (_, index) => ({...item.criteria[0], id: `coverage-${index}`})); }), valid: false},
    {label: "release baseline", kind: "release", validator: validateReleaseRecord, value: release, valid: true},
    {label: "release actor bound", kind: "release", validator: validateReleaseRecord, value: changed(release, (item) => { item.actor = "x".repeat(201); }), valid: false},
    {label: "release run id bound", kind: "release", validator: validateReleaseRecord, value: changed(release, (item) => { item.workflow.runId = "x".repeat(201); }), valid: false},
    {label: "release URL bound", kind: "release", validator: validateReleaseRecord, value: changed(release, (item) => { item.workflow.url = `https://example.invalid/${"x".repeat(2000)}`; }), valid: false},
    {label: "release embedded credentials", kind: "release", validator: validateReleaseRecord, value: changed(release, (item) => { item.workflow.url = "https://user:password@example.invalid/run"; }), valid: false},
    {label: "release invalid HTTPS URL", kind: "release", validator: validateReleaseRecord, value: changed(release, (item) => { item.workflow.url = "https://?missing-host"; }), valid: false},
    {label: "release whitespace actor", kind: "release", validator: validateReleaseRecord, value: changed(release, (item) => { item.actor = "   "; }), valid: false},
    {label: "release v2 baseline", kind: "releaseV2", validator: validateReleaseRecordV2, value: releaseV2, valid: true},
    {label: "release v2 repository bound", kind: "releaseV2", validator: validateReleaseRecordV2, value: changed(releaseV2, (item) => { item.repository = `example/${"x".repeat(500)}`; }), valid: false},
    {label: "release v2 missing digest", kind: "releaseV2", validator: validateReleaseRecordV2, value: changed(releaseV2, (item) => { delete item.artifact.digest; }), valid: false},
    {label: "release v2 unsafe artifact URI", kind: "releaseV2", validator: validateReleaseRecordV2, value: changed(releaseV2, (item) => { item.artifact.uri = "s3://user:secret@example.invalid/object"; }), valid: false},
    {label: "release v2 deploy cannot claim rollback", kind: "releaseV2", validator: validateReleaseRecordV2, value: changed(releaseV2, (item) => { item.rollback = {replacedRelease: "s3://example-release-bucket/one", restoredFromRelease: "s3://example-release-bucket/two"}; }), valid: false},
    {label: "release v2 rollback requires lineage", kind: "releaseV2", validator: validateReleaseRecordV2, value: changed(releaseV2, (item) => { item.operation = "ROLLBACK"; item.result = "ROLLED_BACK"; }), valid: false},
    {label: "release v2 exact authorization evidence", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: deploymentAuthorization()}, valid: true},
    {label: "release v2 authorization portable bucket", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: {...deploymentAuthorization(), uri: `s3://other-bucket/tenant-a/projects/demo-project/deployment-authorizations/v1/${"f".repeat(64)}.json`}}, valid: true},
    {label: "release v2 authorization embedded credentials", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: {...deploymentAuthorization(), uri: `s3://user:secret@example-authorization-bucket/projects/demo-project/deployment-authorizations/v1/${"f".repeat(64)}.json`}}, valid: false},
    {label: "release v2 authorization query", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: {...deploymentAuthorization(), uri: `${deploymentAuthorization().uri}?token=secret`}}, valid: false},
    {label: "release v2 authorization version identifier", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: {...deploymentAuthorization(), versionId: "unsafe version"}}, valid: false},
    {label: "release v2 authorization requires immutable version", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: {...deploymentAuthorization(), versionId: "null"}}, valid: false},
    {label: "release v2 authorization lowercase id", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: {...deploymentAuthorization(), id: "F".repeat(64), uri: `s3://example-authorization-bucket/projects/demo-project/deployment-authorizations/v1/${"F".repeat(64)}.json`}}, valid: false},
    {label: "release v2 authorization exact fields", kind: "releaseV2", validator: validateReleaseRecordV2, value: {...releaseV2, deploymentAuthorization: {...deploymentAuthorization(), token: "must-not-project"}}, valid: false}
  ];

  for (const fixture of matrix) {
    const runtimeValid = fixture.validator(fixture.value).length === 0;
    const publishedSchemaErrors = schemaErrors(fixture.value, schemas[fixture.kind]);
    const schemaValid = publishedSchemaErrors.length === 0;
    assert.equal(runtimeValid, fixture.valid, `${fixture.label}: JavaScript validator`);
    assert.equal(schemaValid, fixture.valid, `${fixture.label}: schema (${publishedSchemaErrors.join(", ")})`);
  }
});

test("application posture remains a pure shared helper", () => {
  assert.equal(applicationSourcePosture({source_status: "AWAITING_SOURCE"}).runReady, false);
  assert.equal(applicationSourcePosture({
    source_status: "SOURCE_READY",
    source_uri: "https://example.invalid/source",
    head_source_uri: "https://example.invalid/source",
    source_revision: 0
  }).runReady, true);
});

test("public CI scans the complete repository before installing dependencies", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("npm run check:public-tree"));
  assert.ok(workflow.indexOf("npm run check:public-tree") < workflow.indexOf("npm install"));
});
