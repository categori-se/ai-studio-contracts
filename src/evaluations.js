import {deepFreeze, PROJECT_ID} from "./projects.js";

const RUBRIC_KEYS = new Set([
  "schemaVersion",
  "id",
  "name",
  "version",
  "description",
  "criteria",
  "passingScore",
  "humanReviewRequired"
]);
const CRITERION_KEYS = new Set(["id", "label", "description", "weight", "minScore", "maxScore"]);

function objectValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function unexpectedKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({path: `${path}.${key}`, message: "property is not supported"});
  }
}

export function validateEvaluationRubric(rubric) {
  const errors = [];
  if (!objectValue(rubric)) return [{path: "$", message: "evaluation rubric must be an object"}];
  unexpectedKeys(rubric, RUBRIC_KEYS, "$", errors);
  if (rubric.schemaVersion !== 1) errors.push({path: "$.schemaVersion", message: "schemaVersion must be 1"});
  if (!PROJECT_ID.test(rubric.id || "")) errors.push({path: "$.id", message: "id must be a readable slug"});
  if (!nonempty(rubric.name) || rubric.name.length > 100) {
    errors.push({path: "$.name", message: "name must be a non-empty string of at most 100 characters"});
  }
  if (!nonempty(rubric.version) || rubric.version.length > 100) {
    errors.push({path: "$.version", message: "version must be a non-empty string of at most 100 characters"});
  }
  if (rubric.description !== undefined && (!nonempty(rubric.description) || rubric.description.length > 2000)) {
    errors.push({path: "$.description", message: "description must be a non-empty string of at most 2000 characters"});
  }
  if (!Array.isArray(rubric.criteria) || !rubric.criteria.length || rubric.criteria.length > 25) {
    errors.push({path: "$.criteria", message: "criteria must contain 1-25 records"});
  } else {
    const ids = new Set();
    rubric.criteria.forEach((criterion, index) => {
      const path = `$.criteria[${index}]`;
      if (!objectValue(criterion)) {
        errors.push({path, message: "criterion must be an object"});
        return;
      }
      unexpectedKeys(criterion, CRITERION_KEYS, path, errors);
      if (!PROJECT_ID.test(criterion.id || "")) errors.push({path: `${path}.id`, message: "id must be a readable slug"});
      if (ids.has(criterion.id)) errors.push({path: `${path}.id`, message: "id must be unique"});
      ids.add(criterion.id);
      if (!nonempty(criterion.label) || criterion.label.length > 100) {
        errors.push({path: `${path}.label`, message: "label must be a non-empty string of at most 100 characters"});
      }
      if (!nonempty(criterion.description) || criterion.description.length > 1000) {
        errors.push({path: `${path}.description`, message: "description must be a non-empty string of at most 1000 characters"});
      }
      if (!finite(criterion.weight) || criterion.weight <= 0) errors.push({path: `${path}.weight`, message: "weight must be greater than zero"});
      if (!finite(criterion.minScore)) errors.push({path: `${path}.minScore`, message: "minScore must be a finite number"});
      if (!finite(criterion.maxScore)) errors.push({path: `${path}.maxScore`, message: "maxScore must be a finite number"});
      if (finite(criterion.minScore) && finite(criterion.maxScore) && criterion.maxScore <= criterion.minScore) {
        errors.push({path: `${path}.maxScore`, message: "maxScore must be greater than minScore"});
      }
    });
  }
  if (!finite(rubric.passingScore)) errors.push({path: "$.passingScore", message: "passingScore must be a finite number"});
  if (typeof rubric.humanReviewRequired !== "boolean") {
    errors.push({path: "$.humanReviewRequired", message: "humanReviewRequired must be a boolean"});
  }
  return errors;
}

export function assertEvaluationRubric(rubric) {
  const errors = validateEvaluationRubric(rubric);
  if (errors.length) throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  return deepFreeze(structuredClone(rubric));
}
