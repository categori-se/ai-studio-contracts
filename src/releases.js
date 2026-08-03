import {deepFreeze, PROJECT_ID} from "./projects.js";

const RELEASE_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "targetId",
  "commitSha",
  "artifactDigest",
  "workflow",
  "actor",
  "result",
  "deployedAt",
  "rollbackOf"
]);
const RELEASE_V2_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "repository",
  "targetId",
  "environment",
  "commitSha",
  "artifact",
  "workflow",
  "actor",
  "operation",
  "result",
  "deployedAt",
  "deployedUrl",
  "verification",
  "deploymentAuthorization",
  "rollback"
]);
const WORKFLOW_KEYS = new Set(["provider", "runId", "url"]);
const ARTIFACT_KEYS = new Set(["uri", "digest"]);
const VERIFICATION_KEYS = new Set(["method", "url", "verifiedAt"]);
const ROLLBACK_KEYS = new Set(["replacedRelease", "restoredFromRelease"]);
const RELEASE_REFERENCE_KEYS = new Set(["uri", "versionId", "recordSha256"]);
const DEPLOYMENT_AUTHORIZATION_KEYS = new Set(["uri", "versionId", "recordSha256", "id"]);
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const S3_VERSION_ID = /^[A-Za-z0-9._+=:@\/-]{1,1024}$/;
const S3_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const RESULTS = new Set(["SUCCEEDED", "FAILED", "ROLLED_BACK"]);
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const V2_OPERATIONS = new Set(["DEPLOY", "ROLLBACK"]);

function objectValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function unexpectedKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({path: `${path}.${key}`, message: "property is not supported"});
  }
}

function httpsUrl(value) {
  if (!nonempty(value) || value.length > 2000) return false;
  try {
    const target = new URL(value);
    return target.protocol === "https:" && !target.username && !target.password;
  } catch {
    return false;
  }
}

function safeUri(value, protocols) {
  if (!nonempty(value) || value.length > 2000) return false;
  try {
    const target = new URL(value);
    if (!protocols.has(target.protocol) || target.username || target.password || target.search || target.hash) return false;
    if (target.protocol === "s3:" && (!target.hostname || !target.pathname.slice(1) || target.pathname.includes("//"))) return false;
    return Boolean(target.hostname);
  } catch {
    return false;
  }
}

function utcTimestamp(value) {
  return nonempty(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validateWorkflow(workflow, errors, strictUri = false) {
  if (!objectValue(workflow)) {
    errors.push({path: "$.workflow", message: "workflow must be an object"});
    return;
  }
  unexpectedKeys(workflow, WORKFLOW_KEYS, "$.workflow", errors);
  if (!PROJECT_ID.test(workflow.provider || "")) errors.push({path: "$.workflow.provider", message: "provider must be a readable slug"});
  if (!nonempty(workflow.runId) || workflow.runId.length > 200) {
    errors.push({path: "$.workflow.runId", message: "runId must be a non-empty string of at most 200 characters"});
  }
  const validUrl = strictUri
    ? safeUri(workflow.url, new Set(["https:"]))
    : httpsUrl(workflow.url);
  if (!validUrl) errors.push({
    path: "$.workflow.url",
    message: strictUri
      ? "url must be a credential-free HTTPS URL without query or fragment"
      : "url must be an HTTPS URL without embedded credentials"
  });
}

function validateDeploymentAuthorization(record, errors) {
  const authorization = record.deploymentAuthorization;
  if (authorization === undefined) return;
  if (!objectValue(authorization)) {
    errors.push({path: "$.deploymentAuthorization", message: "deploymentAuthorization must be an object"});
    return;
  }
  unexpectedKeys(
    authorization,
    DEPLOYMENT_AUTHORIZATION_KEYS,
    "$.deploymentAuthorization",
    errors
  );
  if (!SHA256.test(authorization.id || "")) {
    errors.push({
      path: "$.deploymentAuthorization.id",
      message: "id must be a lowercase sha256 identifier"
    });
  }
  const expectedPathSuffix = (
    `/projects/${record.projectId}/deployment-authorizations/v1/${authorization.id}.json`
  );
  let uriMatches = false;
  if (safeUri(authorization.uri, new Set(["s3:"]))) {
    const target = new URL(authorization.uri);
    uriMatches = S3_BUCKET.test(target.hostname)
      && target.pathname.endsWith(expectedPathSuffix);
  }
  if (!uriMatches) {
    errors.push({
      path: "$.deploymentAuthorization.uri",
      message: "uri must be a safe S3 URI whose path suffix matches projectId and the authorization id"
    });
  }
  if (
    authorization.versionId === "null"
    || !S3_VERSION_ID.test(authorization.versionId || "")
  ) {
    errors.push({
      path: "$.deploymentAuthorization.versionId",
      message: "versionId must be a bounded S3 version identifier"
    });
  }
  if (!SHA256.test(authorization.recordSha256 || "")) {
    errors.push({
      path: "$.deploymentAuthorization.recordSha256",
      message: "recordSha256 must be a lowercase sha256 digest"
    });
  }
}

function validateReleaseRecordV1(record) {
  const errors = [];
  unexpectedKeys(record, RELEASE_KEYS, "$", errors);
  if (record.schemaVersion !== 1) errors.push({path: "$.schemaVersion", message: "schemaVersion must be 1"});
  if (!PROJECT_ID.test(record.projectId || "")) errors.push({path: "$.projectId", message: "projectId must be a readable slug"});
  if (!PROJECT_ID.test(record.targetId || "")) errors.push({path: "$.targetId", message: "targetId must be a readable slug"});
  if (!SHA.test(record.commitSha || "")) errors.push({path: "$.commitSha", message: "commitSha must be a lowercase Git SHA"});
  if (!DIGEST.test(record.artifactDigest || "")) errors.push({path: "$.artifactDigest", message: "artifactDigest must be a sha256 digest"});
  validateWorkflow(record.workflow, errors);
  if (!nonempty(record.actor) || record.actor.length > 200) {
    errors.push({path: "$.actor", message: "actor must be a non-empty string of at most 200 characters"});
  }
  if (!RESULTS.has(record.result)) errors.push({path: "$.result", message: "result is not supported"});
  if (!utcTimestamp(record.deployedAt)) {
    errors.push({path: "$.deployedAt", message: "deployedAt must be an RFC 3339 UTC timestamp"});
  }
  if (record.rollbackOf !== undefined && !SHA.test(record.rollbackOf)) {
    errors.push({path: "$.rollbackOf", message: "rollbackOf must be a lowercase Git SHA"});
  }
  return errors;
}

export function validateReleaseRecordV2(record) {
  const errors = [];
  if (!objectValue(record)) return [{path: "$", message: "release record must be an object"}];
  unexpectedKeys(record, RELEASE_V2_KEYS, "$", errors);
  if (record.schemaVersion !== 2) errors.push({path: "$.schemaVersion", message: "schemaVersion must be 2"});
  if (!PROJECT_ID.test(record.projectId || "")) errors.push({path: "$.projectId", message: "projectId must be a readable slug"});
  if (!REPOSITORY.test(record.repository || "") || record.repository.length > 500) {
    errors.push({path: "$.repository", message: "repository must be an owner/name identifier of at most 500 characters"});
  }
  if (!PROJECT_ID.test(record.targetId || "")) errors.push({path: "$.targetId", message: "targetId must be a readable slug"});
  if (!PROJECT_ID.test(record.environment || "")) errors.push({path: "$.environment", message: "environment must be a readable slug"});
  if (!SHA.test(record.commitSha || "")) errors.push({path: "$.commitSha", message: "commitSha must be a lowercase Git SHA"});

  if (!objectValue(record.artifact)) errors.push({path: "$.artifact", message: "artifact must be an object"});
  else {
    unexpectedKeys(record.artifact, ARTIFACT_KEYS, "$.artifact", errors);
    if (!safeUri(record.artifact.uri, new Set(["https:", "s3:"]))) {
      errors.push({path: "$.artifact.uri", message: "uri must be a credential-free HTTPS or S3 URI"});
    }
    if (!DIGEST.test(record.artifact.digest || "")) errors.push({path: "$.artifact.digest", message: "digest must be a sha256 digest"});
  }
  validateWorkflow(record.workflow, errors, true);
  if (!nonempty(record.actor) || record.actor.length > 200) {
    errors.push({path: "$.actor", message: "actor must be a non-empty string of at most 200 characters"});
  }
  if (!V2_OPERATIONS.has(record.operation)) errors.push({path: "$.operation", message: "operation is not supported"});
  if (record.operation === "DEPLOY" && record.result !== "SUCCEEDED") {
    errors.push({path: "$.result", message: "a deploy record must have result SUCCEEDED"});
  }
  if (record.operation === "ROLLBACK" && record.result !== "ROLLED_BACK") {
    errors.push({path: "$.result", message: "a rollback record must have result ROLLED_BACK"});
  }
  if (!utcTimestamp(record.deployedAt)) errors.push({path: "$.deployedAt", message: "deployedAt must be an RFC 3339 UTC timestamp"});
  if (!safeUri(record.deployedUrl, new Set(["https:"]))) errors.push({path: "$.deployedUrl", message: "deployedUrl must be a credential-free HTTPS URL without query or fragment"});
  validateDeploymentAuthorization(record, errors);

  if (!objectValue(record.verification)) errors.push({path: "$.verification", message: "verification must be an object"});
  else {
    unexpectedKeys(record.verification, VERIFICATION_KEYS, "$.verification", errors);
    if (!PROJECT_ID.test(record.verification.method || "")) errors.push({path: "$.verification.method", message: "method must be a readable slug"});
    if (!safeUri(record.verification.url, new Set(["https:"]))) errors.push({path: "$.verification.url", message: "url must be a credential-free HTTPS URL without query or fragment"});
    if (!utcTimestamp(record.verification.verifiedAt)) errors.push({path: "$.verification.verifiedAt", message: "verifiedAt must be an RFC 3339 UTC timestamp"});
  }

  if (record.operation === "ROLLBACK") {
    if (!objectValue(record.rollback)) errors.push({path: "$.rollback", message: "rollback lineage is required for a rollback"});
    else {
      unexpectedKeys(record.rollback, ROLLBACK_KEYS, "$.rollback", errors);
      for (const field of ROLLBACK_KEYS) {
        const reference = record.rollback[field];
        if (!objectValue(reference)) {
          errors.push({path: `$.rollback.${field}`, message: "release reference must be an object"});
          continue;
        }
        unexpectedKeys(reference, RELEASE_REFERENCE_KEYS, `$.rollback.${field}`, errors);
        if (!safeUri(reference.uri, new Set(["https:", "s3:"]))) {
          errors.push({path: `$.rollback.${field}.uri`, message: "uri must be a credential-free HTTPS or S3 URI"});
        }
        if (
          reference.versionId === "null"
          || !nonempty(reference.versionId)
          || reference.versionId.length > 1024
          || /[\u0000-\u001f\u007f]/.test(reference.versionId)
        ) {
          errors.push({path: `$.rollback.${field}.versionId`, message: "versionId must be a bounded printable string"});
        }
        if (!/^[0-9a-f]{64}$/.test(reference.recordSha256 || "")) {
          errors.push({path: `$.rollback.${field}.recordSha256`, message: "recordSha256 must be a sha256 digest"});
        }
      }
      if (
        objectValue(record.rollback.replacedRelease)
        && objectValue(record.rollback.restoredFromRelease)
        && record.rollback.replacedRelease.uri === record.rollback.restoredFromRelease.uri
      ) {
        errors.push({path: "$.rollback", message: "replaced and restored releases must be distinct"});
      }
    }
  } else if (record.rollback !== undefined) {
    errors.push({path: "$.rollback", message: "deploy records must not contain rollback lineage"});
  }
  return errors;
}

export function validateReleaseRecord(record) {
  if (!objectValue(record)) return [{path: "$", message: "release record must be an object"}];
  if (record.schemaVersion === 2) return validateReleaseRecordV2(record);
  return validateReleaseRecordV1(record);
}

export function assertReleaseRecord(record) {
  const errors = validateReleaseRecord(record);
  if (errors.length) throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  return deepFreeze(structuredClone(record));
}

export function assertReleaseRecordV2(record) {
  const errors = validateReleaseRecordV2(record);
  if (errors.length) throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  return deepFreeze(structuredClone(record));
}
