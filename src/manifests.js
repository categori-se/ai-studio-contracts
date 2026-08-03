import {deepFreeze, PROJECT_ID} from "./projects.js";

export const WORKSPACE_PROJECT_FILE = ".ai-studio/project.yaml";

const WORKSPACE_KEYS = new Set(["schemaVersion", "id", "name", "summary", "projects"]);
const PROJECT_REFERENCE_KEYS = new Set(["id", "path"]);

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

export function isSafeRelativePath(value) {
  if (!nonempty(value) || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

export function validateWorkspace(workspace) {
  const errors = [];
  if (!objectValue(workspace)) return [{path: "$", message: "workspace must be an object"}];
  unexpectedKeys(workspace, WORKSPACE_KEYS, "$", errors);
  if (workspace.schemaVersion !== 1) errors.push({path: "$.schemaVersion", message: "schemaVersion must be 1"});
  if (!PROJECT_ID.test(workspace.id || "")) errors.push({path: "$.id", message: "id must be a readable slug"});
  if (!nonempty(workspace.name) || workspace.name.length > 100) {
    errors.push({path: "$.name", message: "name must be a non-empty string of at most 100 characters"});
  }
  if (workspace.summary !== undefined && (!nonempty(workspace.summary) || workspace.summary.length > 500)) {
    errors.push({path: "$.summary", message: "summary must be a non-empty string of at most 500 characters"});
  }
  if (!Array.isArray(workspace.projects) || !workspace.projects.length) {
    errors.push({path: "$.projects", message: "projects must be a non-empty array"});
    return errors;
  }
  const ids = new Set();
  const paths = new Set();
  workspace.projects.forEach((project, index) => {
    const path = `$.projects[${index}]`;
    if (!objectValue(project)) {
      errors.push({path, message: "project reference must be an object"});
      return;
    }
    unexpectedKeys(project, PROJECT_REFERENCE_KEYS, path, errors);
    if (project.id !== undefined && !PROJECT_ID.test(project.id || "")) {
      errors.push({path: `${path}.id`, message: "id must be a readable slug"});
    }
    if (project.id && ids.has(project.id)) errors.push({path: `${path}.id`, message: "id must be unique"});
    if (project.id) ids.add(project.id);
    if (!isSafeRelativePath(project.path) || project.path.length > 500) {
      errors.push({path: `${path}.path`, message: "path must be a safe relative path"});
    } else if (!/\.(?:json|ya?ml)$/i.test(project.path)) {
      errors.push({path: `${path}.path`, message: "path must identify a JSON or YAML manifest"});
    }
    if (paths.has(project.path)) errors.push({path: `${path}.path`, message: "path must be unique"});
    paths.add(project.path);
  });
  return errors;
}

export function assertWorkspace(workspace) {
  const errors = validateWorkspace(workspace);
  if (errors.length) throw new TypeError(errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  return deepFreeze(structuredClone(workspace));
}
