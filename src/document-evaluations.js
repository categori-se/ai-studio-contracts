import {deepFreeze, PROJECT_ID} from "./projects.js";

export const DOCUMENT_MEDIA_TYPES = Object.freeze([
  "text/plain",
  "text/markdown",
  "text/html",
  "application/json",
  "application/pdf"
]);

export const DOCUMENT_REVIEW_OUTCOMES = Object.freeze([
  "approved",
  "changes_requested",
  "rejected"
]);

const SHA256 = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DOCUMENT_SET_KEYS = new Set(["schema_version", "project_id", "documents"]);
const DOCUMENT_KEYS = new Set(["id", "uri", "media_type", "version_id", "etag", "sha256"]);
const EVALUATION_KEYS = new Set([
  "schema_version",
  "evaluation_id",
  "project_id",
  "question",
  "document_manifest_sha256",
  "rubric",
  "provider",
  "summary",
  "criteria",
  "score",
  "passing_score",
  "machine_outcome",
  "human_review",
  "completed_at"
]);
const RUBRIC_IDENTITY_KEYS = new Set(["id", "version", "sha256"]);
const PROVIDER_KEYS = new Set(["id", "model_id"]);
const CRITERION_RESULT_KEYS = new Set([
  "criterion_id", "score", "confidence", "rationale", "citations"
]);
const CITATION_KEYS = new Set([
  "document_id", "chunk_id", "locator", "chunk_sha256", "excerpt"
]);
const PENDING_REVIEW_KEYS = new Set(["required", "status"]);
const REVIEW_KEYS = new Set([
  "schema_version",
  "id",
  "job_id",
  "evaluation_id",
  "project_id",
  "outcome",
  "summary",
  "result_uri",
  "result_sha256",
  "result_version_id",
  "result_etag",
  "machine_outcome",
  "actor",
  "actor_subject",
  "actor_label",
  "actor_groups",
  "created_at",
  "effect",
  "deploy_authorized",
  "trading_authorized",
  "production_deployed",
  "source_mutated"
]);

function objectValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedText(value, maximum) {
  return typeof value === "string"
    && Boolean(value.trim())
    && value.length <= maximum
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function boundedIdentity(value, maximum) {
  return typeof value === "string"
    && Boolean(value)
    && value === value.trim()
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function safeAbsoluteUri(value) {
  if (!boundedIdentity(value, 2_000) || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) return false;
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function unexpectedKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({path: `${path}.${key}`, message: "property is not supported"});
  }
}

function validateExactObject(value, allowed, path, label, errors) {
  if (!objectValue(value)) {
    errors.push({path, message: `${label} must be an object`});
    return false;
  }
  unexpectedKeys(value, allowed, path, errors);
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) errors.push({path: `${path}.${key}`, message: "property is required"});
  }
  return true;
}

function validateDigest(value, path, errors) {
  if (!SHA256.test(value || "")) errors.push({path, message: "must be a lowercase SHA-256 digest"});
}

export function validateDocumentSetManifest(manifest) {
  const errors = [];
  if (!validateExactObject(manifest, DOCUMENT_SET_KEYS, "$", "document-set manifest", errors)) return errors;
  if (manifest.schema_version !== 1) errors.push({path: "$.schema_version", message: "schema_version must be 1"});
  if (!PROJECT_ID.test(manifest.project_id || "")) {
    errors.push({path: "$.project_id", message: "project_id must be a readable slug"});
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length < 1 || manifest.documents.length > 25) {
    errors.push({path: "$.documents", message: "documents must contain 1-25 records"});
    return errors;
  }
  const identifiers = new Set();
  manifest.documents.forEach((document, index) => {
    const path = `$.documents[${index}]`;
    if (!validateExactObject(document, DOCUMENT_KEYS, path, "document", errors)) return;
    if (!PROJECT_ID.test(document.id || "")) {
      errors.push({path: `${path}.id`, message: "id must be a readable slug"});
    } else if (identifiers.has(document.id)) {
      errors.push({path: `${path}.id`, message: "id must be unique within the document set"});
    }
    identifiers.add(document.id);
    if (!safeAbsoluteUri(document.uri)) {
      errors.push({path: `${path}.uri`, message: "uri must be an absolute, credential-free URI without query or fragment"});
    }
    if (!DOCUMENT_MEDIA_TYPES.includes(document.media_type)) {
      errors.push({path: `${path}.media_type`, message: "media_type is not supported"});
    }
    if (!boundedIdentity(document.version_id, 256) || document.version_id === "null") {
      errors.push({path: `${path}.version_id`, message: "version_id must identify one exact stored version"});
    }
    if (!boundedIdentity(document.etag, 200)) {
      errors.push({path: `${path}.etag`, message: "etag must be a non-empty storage identity"});
    }
    validateDigest(document.sha256, `${path}.sha256`, errors);
  });
  return errors;
}

export function assertDocumentSetManifest(manifest) {
  const errors = validateDocumentSetManifest(manifest);
  if (errors.length) throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  return deepFreeze(structuredClone(manifest));
}

export function validateDocumentEvaluationResult(result) {
  const errors = [];
  if (!validateExactObject(result, EVALUATION_KEYS, "$", "document-evaluation result", errors)) return errors;
  if (result.schema_version !== 1) errors.push({path: "$.schema_version", message: "schema_version must be 1"});
  if (!PROJECT_ID.test(result.evaluation_id || "")) {
    errors.push({path: "$.evaluation_id", message: "evaluation_id must be a readable slug"});
  }
  if (!PROJECT_ID.test(result.project_id || "")) {
    errors.push({path: "$.project_id", message: "project_id must be a readable slug"});
  }
  if (!boundedText(result.question, 4_000)) {
    errors.push({path: "$.question", message: "question must contain 1-4000 characters"});
  }
  validateDigest(result.document_manifest_sha256, "$.document_manifest_sha256", errors);

  if (validateExactObject(result.rubric, RUBRIC_IDENTITY_KEYS, "$.rubric", "rubric identity", errors)) {
    if (!PROJECT_ID.test(result.rubric.id || "")) errors.push({path: "$.rubric.id", message: "id must be a readable slug"});
    if (!boundedText(result.rubric.version, 100)) errors.push({path: "$.rubric.version", message: "version must contain 1-100 characters"});
    validateDigest(result.rubric.sha256, "$.rubric.sha256", errors);
  }
  if (validateExactObject(result.provider, PROVIDER_KEYS, "$.provider", "provider identity", errors)) {
    if (!boundedIdentity(result.provider.id, 100)) errors.push({path: "$.provider.id", message: "id must contain 1-100 identity characters"});
    if (!boundedIdentity(result.provider.model_id, 300)) errors.push({path: "$.provider.model_id", message: "model_id must contain 1-300 identity characters"});
  }
  if (!boundedText(result.summary, 4_000)) {
    errors.push({path: "$.summary", message: "summary must contain 1-4000 characters"});
  }

  if (!Array.isArray(result.criteria) || result.criteria.length < 1 || result.criteria.length > 25) {
    errors.push({path: "$.criteria", message: "criteria must contain 1-25 results"});
  } else {
    const identifiers = new Set();
    result.criteria.forEach((criterion, index) => {
      const path = `$.criteria[${index}]`;
      if (!validateExactObject(criterion, CRITERION_RESULT_KEYS, path, "criterion result", errors)) return;
      if (!PROJECT_ID.test(criterion.criterion_id || "")) {
        errors.push({path: `${path}.criterion_id`, message: "criterion_id must be a readable slug"});
      } else if (identifiers.has(criterion.criterion_id)) {
        errors.push({path: `${path}.criterion_id`, message: "criterion_id must be unique within the result"});
      }
      identifiers.add(criterion.criterion_id);
      if (!finite(criterion.score)) errors.push({path: `${path}.score`, message: "score must be a finite number"});
      if (!finite(criterion.confidence) || criterion.confidence < 0 || criterion.confidence > 1) {
        errors.push({path: `${path}.confidence`, message: "confidence must be between 0 and 1"});
      }
      if (!boundedText(criterion.rationale, 4_000)) {
        errors.push({path: `${path}.rationale`, message: "rationale must contain 1-4000 characters"});
      }
      if (!Array.isArray(criterion.citations) || criterion.citations.length < 1 || criterion.citations.length > 10) {
        errors.push({path: `${path}.citations`, message: "citations must contain 1-10 evidence references"});
      } else {
        criterion.citations.forEach((citation, citationIndex) => {
          const citationPath = `${path}.citations[${citationIndex}]`;
          if (!validateExactObject(citation, CITATION_KEYS, citationPath, "citation", errors)) return;
          if (!PROJECT_ID.test(citation.document_id || "")) errors.push({path: `${citationPath}.document_id`, message: "document_id must be a readable slug"});
          if (!boundedText(citation.chunk_id, 300)) errors.push({path: `${citationPath}.chunk_id`, message: "chunk_id must contain 1-300 characters"});
          if (!boundedText(citation.locator, 300)) errors.push({path: `${citationPath}.locator`, message: "locator must contain 1-300 characters"});
          validateDigest(citation.chunk_sha256, `${citationPath}.chunk_sha256`, errors);
          if (!boundedText(citation.excerpt, 300)) errors.push({path: `${citationPath}.excerpt`, message: "excerpt must contain 1-300 characters"});
        });
      }
    });
  }
  if (!finite(result.score)) errors.push({path: "$.score", message: "score must be a finite number"});
  if (!finite(result.passing_score)) errors.push({path: "$.passing_score", message: "passing_score must be a finite number"});
  if (!["passed", "failed"].includes(result.machine_outcome)) {
    errors.push({path: "$.machine_outcome", message: "machine_outcome must be passed or failed"});
  } else if (finite(result.score) && finite(result.passing_score)
    && (result.machine_outcome === "passed") !== (result.score >= result.passing_score)) {
    errors.push({path: "$.machine_outcome", message: "machine_outcome must agree with score and passing_score"});
  }
  if (validateExactObject(result.human_review, PENDING_REVIEW_KEYS, "$.human_review", "human-review state", errors)
    && (result.human_review.required !== true || result.human_review.status !== "pending")) {
    errors.push({path: "$.human_review", message: "a machine result must remain pending explicit human review"});
  }
  if (!RFC3339.test(result.completed_at || "")) {
    errors.push({path: "$.completed_at", message: "completed_at must be an RFC 3339 timestamp"});
  }
  return errors;
}

export function assertDocumentEvaluationResult(result) {
  const errors = validateDocumentEvaluationResult(result);
  if (errors.length) throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  return deepFreeze(structuredClone(result));
}

export function validateDocumentReviewDecision(decision) {
  const errors = [];
  if (!validateExactObject(decision, REVIEW_KEYS, "$", "document-review decision", errors)) return errors;
  if (decision.schema_version !== 1) errors.push({path: "$.schema_version", message: "schema_version must be 1"});
  for (const field of ["id", "job_id", "evaluation_id"]) {
    if (!UUID_V4.test(decision[field] || "")) errors.push({path: `$.${field}`, message: `${field} must be a UUID v4`});
  }
  if (decision.job_id !== decision.evaluation_id) {
    errors.push({path: "$.evaluation_id", message: "evaluation_id must identify the reviewed job"});
  }
  if (!PROJECT_ID.test(decision.project_id || "")) errors.push({path: "$.project_id", message: "project_id must be a readable slug"});
  if (!DOCUMENT_REVIEW_OUTCOMES.includes(decision.outcome)) {
    errors.push({path: "$.outcome", message: "outcome must be approved, changes_requested, or rejected"});
  }
  if (!boundedText(decision.summary, 2_000)) errors.push({path: "$.summary", message: "summary must contain 1-2000 characters"});
  if (!safeAbsoluteUri(decision.result_uri)) {
    errors.push({path: "$.result_uri", message: "result_uri must be an absolute, credential-free URI without query or fragment"});
  }
  validateDigest(decision.result_sha256, "$.result_sha256", errors);
  if (!boundedIdentity(decision.result_version_id, 256) || decision.result_version_id === "null") {
    errors.push({path: "$.result_version_id", message: "result_version_id must identify one exact stored result"});
  }
  if (!boundedIdentity(decision.result_etag, 200)) errors.push({path: "$.result_etag", message: "result_etag must be a non-empty storage identity"});
  if (!["passed", "failed"].includes(decision.machine_outcome)) errors.push({path: "$.machine_outcome", message: "machine_outcome must be passed or failed"});
  if (!boundedIdentity(decision.actor, 300)) errors.push({path: "$.actor", message: "actor must contain 1-300 identity characters"});
  if (!boundedIdentity(decision.actor_subject, 300)) errors.push({path: "$.actor_subject", message: "actor_subject must contain 1-300 identity characters"});
  if (decision.actor !== decision.actor_subject) errors.push({path: "$.actor", message: "actor must equal actor_subject"});
  if (!boundedText(decision.actor_label, 200)) errors.push({path: "$.actor_label", message: "actor_label must contain 1-200 characters"});
  if (!Array.isArray(decision.actor_groups)) {
    errors.push({path: "$.actor_groups", message: "actor_groups must be an array"});
  } else {
    decision.actor_groups.forEach((group, index) => {
      if (!boundedText(group, 100)) errors.push({path: `$.actor_groups[${index}]`, message: "group must contain 1-100 characters"});
    });
  }
  if (!Number.isInteger(decision.created_at) || decision.created_at < 0) {
    errors.push({path: "$.created_at", message: "created_at must be a non-negative integer timestamp"});
  }
  if (decision.effect !== "human_evaluation_review") errors.push({path: "$.effect", message: "effect must be human_evaluation_review"});
  for (const field of ["deploy_authorized", "trading_authorized", "production_deployed", "source_mutated"]) {
    if (decision[field] !== false) errors.push({path: `$.${field}`, message: `${field} must remain false`});
  }
  return errors;
}

export function assertDocumentReviewDecision(decision) {
  const errors = validateDocumentReviewDecision(decision);
  if (errors.length) throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  return deepFreeze(structuredClone(decision));
}
