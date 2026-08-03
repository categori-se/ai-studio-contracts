import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  assertDocumentEvaluationResult,
  assertDocumentReviewDecision,
  assertDocumentSetManifest,
  DOCUMENT_MEDIA_TYPES,
  DOCUMENT_REVIEW_OUTCOMES,
  validateDocumentEvaluationResult,
  validateDocumentReviewDecision,
  validateDocumentSetManifest
} from "../src/index.js";

const CONTRACTS = Object.freeze({
  documentSet: {
    filename: "document-set-manifest.schema.json",
    validator: validateDocumentSetManifest
  },
  evaluationResult: {
    filename: "document-evaluation-result.schema.json",
    validator: validateDocumentEvaluationResult
  },
  reviewDecision: {
    filename: "document-review-decision.schema.json",
    validator: validateDocumentReviewDecision
  }
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

function schemaErrors(value, schema, root = schema, path = "$") {
  if (schema.$ref) return schemaErrors(value, referencedSchema(root, schema.$ref), root, path);
  const errors = [];
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
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum`);
  } else if (schema.type === "integer") {
    if (!Number.isInteger(value)) return [...errors, `${path}: integer`];
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
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

const jobId = "123e4567-e89b-42d3-a456-4266aa1740ef";

const documentSet = {
  schema_version: 1,
  project_id: "expert-review",
  documents: [{
    id: "source-record",
    uri: "https://evidence.example/projects/expert-review/source-record.md",
    media_type: "text/markdown",
    version_id: "git-0123456789abcdef",
    etag: "content-0123456789abcdef",
    sha256: "a".repeat(64)
  }]
};

const evaluationResult = {
  schema_version: 1,
  evaluation_id: jobId,
  project_id: "expert-review",
  question: "Does the declared evidence support the bounded finding?",
  document_manifest_sha256: "b".repeat(64),
  rubric: {
    id: "evidence-quality",
    version: "1.0.0",
    sha256: "c".repeat(64)
  },
  provider: {
    id: "local-evaluator",
    model_id: "evidence-model-v1"
  },
  summary: "The cited baseline supports the finding while preserving one unresolved gap.",
  criteria: [{
    criterion_id: "traceability",
    score: 4.1,
    confidence: 0.72,
    rationale: "The retrieved evidence contains both the finding and its limitation.",
    citations: [{
      document_id: "source-record",
      chunk_id: "source-record:section-1:1-3",
      locator: "section-1:lines-1-3",
      chunk_sha256: "d".repeat(64),
      excerpt: "The baseline is documented; seasonal evidence remains incomplete."
    }]
  }],
  score: 4.1,
  passing_score: 4,
  machine_outcome: "passed",
  human_review: {required: true, status: "pending"},
  completed_at: "2026-08-01T18:00:00Z"
};

const reviewDecision = {
  schema_version: 1,
  id: "223e4567-e89b-42d3-a456-4266bb1740ef",
  job_id: jobId,
  evaluation_id: jobId,
  project_id: "expert-review",
  outcome: "approved",
  summary: "A qualified reviewer checked the cited source and retained limitation.",
  result_uri: "https://evidence.example/projects/expert-review/results/evaluation.json",
  result_sha256: "e".repeat(64),
  result_version_id: "result-version-1",
  result_etag: "result-etag-1",
  machine_outcome: "passed",
  actor: "reviewer-subject-1",
  actor_subject: "reviewer-subject-1",
  actor_label: "Qualified reviewer",
  actor_groups: ["ProjectReviewer"],
  created_at: 1785607200,
  effect: "human_evaluation_review",
  deploy_authorized: false,
  trading_authorized: false,
  production_deployed: false,
  source_mutated: false
};

test("document-evaluation contracts expose the exact portable pipeline records", () => {
  assert.deepEqual(validateDocumentSetManifest(documentSet), []);
  assert.deepEqual(validateDocumentEvaluationResult(evaluationResult), []);
  assert.deepEqual(validateDocumentReviewDecision(reviewDecision), []);
  assert.deepEqual(DOCUMENT_MEDIA_TYPES, [
    "text/plain", "text/markdown", "text/html", "application/json", "application/pdf"
  ]);
  assert.deepEqual(DOCUMENT_REVIEW_OUTCOMES, ["approved", "changes_requested", "rejected"]);

  const manifest = assertDocumentSetManifest(documentSet);
  const result = assertDocumentEvaluationResult(evaluationResult);
  const review = assertDocumentReviewDecision(reviewDecision);
  assert.equal(Object.isFrozen(manifest.documents[0]), true);
  assert.equal(Object.isFrozen(result.criteria[0].citations[0]), true);
  assert.equal(Object.isFrozen(review.actor_groups), true);
  assert.throws(() => result.criteria[0].confidence = 0, TypeError);
});

test("machine results require bounded, cited criteria and pending human review", () => {
  assert.match(
    validateDocumentEvaluationResult(changed(evaluationResult, (item) => { item.criteria[0].confidence = 1.1; }))[0].path,
    /confidence/
  );
  assert.throws(
    () => assertDocumentEvaluationResult(changed(evaluationResult, (item) => { item.criteria[0].citations = []; })),
    /citations/
  );
  assert.throws(
    () => assertDocumentEvaluationResult(changed(evaluationResult, (item) => { item.machine_outcome = "failed"; })),
    /must agree/
  );
  assert.throws(
    () => assertDocumentEvaluationResult(changed(evaluationResult, (item) => { item.human_review.status = "approved"; })),
    /pending explicit human review/
  );
});

test("document identities and review decisions fail closed", () => {
  assert.throws(
    () => assertDocumentSetManifest(changed(documentSet, (item) => { delete item.documents[0].version_id; })),
    /version_id/
  );
  assert.throws(
    () => assertDocumentSetManifest(changed(documentSet, (item) => { item.documents[0].uri = "https://user:secret@evidence.example/source"; })),
    /credential-free/
  );
  assert.throws(
    () => assertDocumentReviewDecision(changed(reviewDecision, (item) => { item.evaluation_id = "323e4567-e89b-42d3-a456-4266cc1740ef"; })),
    /reviewed job/
  );
  assert.throws(
    () => assertDocumentReviewDecision(changed(reviewDecision, (item) => { item.deploy_authorized = true; })),
    /must remain false/
  );
  assert.throws(
    () => assertDocumentReviewDecision(changed(reviewDecision, (item) => { item.result_uri += "?token=secret"; })),
    /without query or fragment/
  );
});

test("published schemas agree with JavaScript validators on portable record shapes", async () => {
  const schemas = Object.fromEntries(await Promise.all(
    Object.entries(CONTRACTS).map(async ([kind, contract]) => [
      kind,
      JSON.parse(await readFile(new URL(`../schemas/${contract.filename}`, import.meta.url), "utf8"))
    ])
  ));
  for (const schema of Object.values(schemas)) assert.match(schema.$id, /^urn:categori:studio:/);

  const matrix = [
    {kind: "documentSet", value: documentSet, valid: true},
    {kind: "documentSet", value: changed(documentSet, (item) => { delete item.documents[0].version_id; }), valid: false},
    {kind: "documentSet", value: changed(documentSet, (item) => { item.documents[0].uri += "#mutable"; }), valid: false},
    {kind: "evaluationResult", value: evaluationResult, valid: true},
    {kind: "evaluationResult", value: changed(evaluationResult, (item) => { item.criteria[0].confidence = -0.01; }), valid: false},
    {kind: "evaluationResult", value: changed(evaluationResult, (item) => { item.criteria[0].citations = []; }), valid: false},
    {kind: "evaluationResult", value: changed(evaluationResult, (item) => { item.human_review.status = "approved"; }), valid: false},
    {kind: "reviewDecision", value: reviewDecision, valid: true},
    {kind: "reviewDecision", value: changed(reviewDecision, (item) => { item.result_sha256 = "not-a-digest"; }), valid: false},
    {kind: "reviewDecision", value: changed(reviewDecision, (item) => { item.result_uri += "?token=secret"; }), valid: false},
    {kind: "reviewDecision", value: changed(reviewDecision, (item) => { item.deploy_authorized = true; }), valid: false}
  ];

  for (const fixture of matrix) {
    const runtimeValid = CONTRACTS[fixture.kind].validator(fixture.value).length === 0;
    const publishedSchemaErrors = schemaErrors(fixture.value, schemas[fixture.kind]);
    assert.equal(runtimeValid, fixture.valid, `${fixture.kind}: JavaScript validator`);
    assert.equal(
      publishedSchemaErrors.length === 0,
      fixture.valid,
      `${fixture.kind}: schema (${publishedSchemaErrors.join(", ")})`
    );
  }
});
