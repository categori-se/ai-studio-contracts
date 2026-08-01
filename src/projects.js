export const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const MODEL_POLICY_MODES = Object.freeze([
  "best_quality",
  "balanced_cost",
  "local_only",
  "no_external_data",
  "project_default"
]);

const RECORD_KINDS = Object.freeze([
  "Project",
  "Environment",
  "DeploymentTarget",
  "ModelPolicy",
  "AgentRun",
  "Release",
  "EvaluationSuite"
]);

export {RECORD_KINDS};

function nonempty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

export function validateProject(project) {
  const errors = [];
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return [{path: "$", message: "project must be an object"}];
  }
  if (!PROJECT_ID.test(project.id || "")) errors.push({path: "$.id", message: "id must be a readable slug"});
  if (!nonempty(project.name)) errors.push({path: "$.name", message: "name is required"});
  if (!nonempty(project.repository)) errors.push({path: "$.repository", message: "repository is required"});
  if (!nonempty(project.defaultBranch)) errors.push({path: "$.defaultBranch", message: "defaultBranch is required"});
  if (!Array.isArray(project.commands?.checks)) errors.push({path: "$.commands.checks", message: "checks must be an array"});
  if (!MODEL_POLICY_MODES.includes(project.modelPolicy?.mode)) {
    errors.push({path: "$.modelPolicy.mode", message: "model policy mode is not supported"});
  }
  return errors;
}

export function assertProject(project) {
  const errors = validateProject(project);
  if (errors.length) {
    throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  }
  return Object.freeze(structuredClone(project));
}
