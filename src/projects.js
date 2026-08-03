export const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const MODEL_POLICY_MODES = Object.freeze([
  "best_quality",
  "balanced_cost",
  "local_only",
  "no_external_data",
  "project_default"
]);
export const DATA_SENSITIVITY_LEVELS = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted"
]);

const RECORD_KINDS = Object.freeze([
  "Project",
  "Workspace",
  "Environment",
  "DeploymentTarget",
  "ModelPolicy",
  "Evidence",
  "Claim",
  "AgentRun",
  "Release",
  "EvaluationSuite",
  "Approval"
]);

export {RECORD_KINDS};

function nonempty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "id",
  "name",
  "summary",
  "repository",
  "defaultBranch",
  "dataSensitivity",
  "commands",
  "modelPolicy",
  "owners",
  "purpose",
  "resources",
  "agentProfiles",
  "evaluationSuites",
  "approvalPolicy",
  "deploymentTargets",
  "costCenter",
  "riskLevel"
]);
const SECRET_KEY = /(?:api.?key|access.?key|secret|password|token|credential|private.?key)/i;
const RESOURCE_KINDS = new Set([
  "repository",
  "document",
  "dataset",
  "object-store",
  "application",
  "model",
  "prompt",
  "agent",
  "integration"
]);
const DEPLOYMENT_KINDS = new Set(["static-site", "serverless", "container", "notebook", "other"]);
const APPROVAL_STAGES = new Set(["candidate", "release", "rollback"]);
const RISK_LEVELS = new Set(["low", "moderate", "high", "critical"]);

function objectValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unexpectedKeys(value, allowed, path, errors) {
  if (!objectValue(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({path: `${path}.${key}`, message: "property is not supported"});
  }
}

function validateString(value, path, errors, {required = false, maxLength = 500} = {}) {
  if (value === undefined && !required) return;
  if (!nonempty(value)) {
    errors.push({path, message: required ? "value is required" : "value must be a non-empty string"});
  } else if (value.length > maxLength) {
    errors.push({path, message: `value must not exceed ${maxLength} characters`});
  }
}

function validateSlug(value, path, errors) {
  if (!PROJECT_ID.test(value || "")) errors.push({path, message: "value must be a readable slug"});
}

function validateStringArray(value, path, errors, {required = false, minItems = 0, allowed = null} = {}) {
  if (value === undefined) {
    if (required) errors.push({path, message: "value is required"});
    return;
  }
  if (!Array.isArray(value)) {
    errors.push({path, message: "value must be an array"});
    return;
  }
  if (value.length < minItems) errors.push({path, message: `value must contain at least ${minItems} item${minItems === 1 ? "" : "s"}`});
  value.forEach((item, index) => {
    if (!nonempty(item)) errors.push({path: `${path}[${index}]`, message: "value must be a non-empty string"});
    else if (allowed && !allowed.has(item)) errors.push({path: `${path}[${index}]`, message: "value is not supported"});
  });
}

function sensitiveKeyPath(value, path = "$", seen = new WeakSet()) {
  if (!objectValue(value) && !Array.isArray(value)) return null;
  if (seen.has(value)) return null;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const next = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    if (!Array.isArray(value) && SECRET_KEY.test(key)) return next;
    const found = sensitiveKeyPath(nested, next, seen);
    if (found) return found;
  }
  return null;
}

function validateIdentifiedCollection(value, path, errors, validateItem) {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) {
    errors.push({path, message: "value must be an array"});
    return new Set();
  }
  const ids = new Set();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!objectValue(item)) {
      errors.push({path: itemPath, message: "value must be an object"});
      return;
    }
    validateSlug(item.id, `${itemPath}.id`, errors);
    if (ids.has(item.id)) errors.push({path: `${itemPath}.id`, message: "id must be unique within the collection"});
    ids.add(item.id);
    validateItem(item, itemPath, errors);
  });
  return ids;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function hasEmbeddedUrlCredentials(value) {
  if (!nonempty(value) || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return false;
  try {
    const target = new URL(value);
    return Boolean(target.username || target.password);
  } catch {
    return false;
  }
}

export function validateProject(project) {
  const errors = [];
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return [{path: "$", message: "project must be an object"}];
  }
  unexpectedKeys(project, TOP_LEVEL_KEYS, "$", errors);
  const sensitivePath = sensitiveKeyPath(project);
  if (sensitivePath) errors.push({path: sensitivePath, message: "credentials and secret-bearing fields are not permitted"});
  if (project.schemaVersion !== 1) errors.push({path: "$.schemaVersion", message: "schemaVersion must be 1"});
  if (!PROJECT_ID.test(project.id || "")) errors.push({path: "$.id", message: "id must be a readable slug"});
  validateString(project.name, "$.name", errors, {required: true, maxLength: 100});
  validateString(project.summary, "$.summary", errors, {maxLength: 500});
  validateString(project.repository, "$.repository", errors, {required: true, maxLength: 500});
  if (hasEmbeddedUrlCredentials(project.repository)) errors.push({path: "$.repository", message: "repository URL must not embed credentials"});
  validateString(project.defaultBranch, "$.defaultBranch", errors, {required: true, maxLength: 100});
  if (!objectValue(project.commands)) {
    errors.push({path: "$.commands", message: "commands must be an object"});
  } else {
    unexpectedKeys(project.commands, new Set(["install", "checks", "build"]), "$.commands", errors);
    validateString(project.commands.install, "$.commands.install", errors);
    validateStringArray(project.commands.checks, "$.commands.checks", errors, {required: true});
    validateString(project.commands.build, "$.commands.build", errors);
  }
  if (!objectValue(project.modelPolicy)) {
    errors.push({path: "$.modelPolicy", message: "modelPolicy must be an object"});
  } else {
    unexpectedKeys(project.modelPolicy, new Set(["mode"]), "$.modelPolicy", errors);
  }
  if (!MODEL_POLICY_MODES.includes(project.modelPolicy?.mode)) {
    errors.push({path: "$.modelPolicy.mode", message: "model policy mode is not supported"});
  }
  if (project.dataSensitivity !== undefined && !DATA_SENSITIVITY_LEVELS.includes(project.dataSensitivity)) {
    errors.push({path: "$.dataSensitivity", message: "data sensitivity is not supported"});
  }
  validateString(project.costCenter, "$.costCenter", errors, {maxLength: 100});
  if (project.riskLevel !== undefined && !RISK_LEVELS.has(project.riskLevel)) {
    errors.push({path: "$.riskLevel", message: "risk level is not supported"});
  }

  validateIdentifiedCollection(project.owners, "$.owners", errors, (owner, path, nestedErrors) => {
    unexpectedKeys(owner, new Set(["id", "role"]), path, nestedErrors);
    validateString(owner.role, `${path}.role`, nestedErrors, {required: true, maxLength: 100});
  });

  const resourceIds = validateIdentifiedCollection(project.resources, "$.resources", errors, (resource, path, nestedErrors) => {
    unexpectedKeys(resource, new Set(["id", "kind", "uri", "role", "sensitivity"]), path, nestedErrors);
    if (!RESOURCE_KINDS.has(resource.kind)) nestedErrors.push({path: `${path}.kind`, message: "resource kind is not supported"});
    validateString(resource.uri, `${path}.uri`, nestedErrors, {required: true, maxLength: 2000});
    if (hasEmbeddedUrlCredentials(resource.uri)) nestedErrors.push({path: `${path}.uri`, message: "resource URI must not embed credentials"});
    validateString(resource.role, `${path}.role`, nestedErrors, {maxLength: 100});
    if (resource.sensitivity !== undefined && !DATA_SENSITIVITY_LEVELS.includes(resource.sensitivity)) {
      nestedErrors.push({path: `${path}.sensitivity`, message: "data sensitivity is not supported"});
    }
  });

  if (project.purpose !== undefined) {
    if (!objectValue(project.purpose)) {
      errors.push({path: "$.purpose", message: "purpose must be an object"});
    } else {
      unexpectedKeys(project.purpose, new Set(["problem", "audiences", "permittedClaims"]), "$.purpose", errors);
      validateString(project.purpose.problem, "$.purpose.problem", errors, {required: true, maxLength: 2000});
      validateStringArray(project.purpose.audiences, "$.purpose.audiences", errors);
      validateIdentifiedCollection(project.purpose.permittedClaims, "$.purpose.permittedClaims", errors, (claim, path, nestedErrors) => {
        unexpectedKeys(claim, new Set(["id", "statement", "evidenceRefs"]), path, nestedErrors);
        validateString(claim.statement, `${path}.statement`, nestedErrors, {required: true, maxLength: 2000});
        validateStringArray(claim.evidenceRefs, `${path}.evidenceRefs`, nestedErrors, {required: true, minItems: 1});
        if (Array.isArray(claim.evidenceRefs)) {
          claim.evidenceRefs.forEach((reference, index) => {
            if (nonempty(reference) && !resourceIds.has(reference)) {
              nestedErrors.push({path: `${path}.evidenceRefs[${index}]`, message: "evidence reference does not identify a declared resource"});
            }
          });
        }
      });
    }
  }

  validateIdentifiedCollection(project.agentProfiles, "$.agentProfiles", errors, (profile, path, nestedErrors) => {
    unexpectedKeys(profile, new Set(["id", "instructionsPath", "allowedTools", "acceptanceCriteria"]), path, nestedErrors);
    validateString(profile.instructionsPath, `${path}.instructionsPath`, nestedErrors, {required: true, maxLength: 500});
    if (nonempty(profile.instructionsPath) && !isSafeRelativeProjectPath(profile.instructionsPath)) {
      nestedErrors.push({path: `${path}.instructionsPath`, message: "path must be a safe relative project path"});
    }
    validateStringArray(profile.allowedTools, `${path}.allowedTools`, nestedErrors);
    validateStringArray(profile.acceptanceCriteria, `${path}.acceptanceCriteria`, nestedErrors);
  });

  validateIdentifiedCollection(project.evaluationSuites, "$.evaluationSuites", errors, (suite, path, nestedErrors) => {
    unexpectedKeys(suite, new Set(["id", "rubricPath", "requiredFor"]), path, nestedErrors);
    validateString(suite.rubricPath, `${path}.rubricPath`, nestedErrors, {required: true, maxLength: 500});
    if (nonempty(suite.rubricPath) && !isSafeRelativeProjectPath(suite.rubricPath)) {
      nestedErrors.push({path: `${path}.rubricPath`, message: "path must be a safe relative project path"});
    }
    validateStringArray(suite.requiredFor, `${path}.requiredFor`, nestedErrors, {allowed: APPROVAL_STAGES});
  });

  if (project.approvalPolicy !== undefined) {
    if (!objectValue(project.approvalPolicy)) errors.push({path: "$.approvalPolicy", message: "approvalPolicy must be an object"});
    else {
      unexpectedKeys(project.approvalPolicy, new Set(["requiredFor", "roles"]), "$.approvalPolicy", errors);
      validateStringArray(project.approvalPolicy.requiredFor, "$.approvalPolicy.requiredFor", errors, {required: true, minItems: 1, allowed: APPROVAL_STAGES});
      validateStringArray(project.approvalPolicy.roles, "$.approvalPolicy.roles", errors, {required: true, minItems: 1});
    }
  }

  validateIdentifiedCollection(project.deploymentTargets, "$.deploymentTargets", errors, (target, path, nestedErrors) => {
    unexpectedKeys(target, new Set(["id", "kind", "environment", "releaseManifestUri"]), path, nestedErrors);
    if (!DEPLOYMENT_KINDS.has(target.kind)) nestedErrors.push({path: `${path}.kind`, message: "deployment kind is not supported"});
    validateString(target.environment, `${path}.environment`, nestedErrors, {required: true, maxLength: 100});
    validateString(target.releaseManifestUri, `${path}.releaseManifestUri`, nestedErrors, {maxLength: 2000});
    if (hasEmbeddedUrlCredentials(target.releaseManifestUri)) {
      nestedErrors.push({path: `${path}.releaseManifestUri`, message: "release manifest URI must not embed credentials"});
    }
  });
  return errors;
}

export function assertProject(project) {
  const errors = validateProject(project);
  if (errors.length) {
    throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  }
  return deepFreeze(structuredClone(project));
}

export const validateProjectManifest = validateProject;
export const assertProjectManifest = assertProject;

function isSafeRelativeProjectPath(value) {
  if (!nonempty(value) || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}
