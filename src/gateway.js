import {MODEL_POLICY_MODES, PROJECT_ID} from "./projects.js";

export const GATEWAY_CAPABILITIES = Object.freeze([
  "plan",
  "edit",
  "evaluate",
  "extract",
  "embed"
]);

export const DATA_SENSITIVITY = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted"
]);

export function normalizeGatewayRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("gateway request must be an object");
  }
  if (!GATEWAY_CAPABILITIES.includes(value.capability)) {
    throw new TypeError("gateway capability is not supported");
  }
  if (!PROJECT_ID.test(value.projectId || "")) {
    throw new TypeError("gateway projectId must be a readable slug");
  }
  const mode = value.modelPolicy?.mode || "project_default";
  if (!MODEL_POLICY_MODES.includes(mode)) {
    throw new TypeError("gateway model policy mode is not supported");
  }
  const sensitivity = value.sensitivity || "internal";
  if (!DATA_SENSITIVITY.includes(sensitivity)) {
    throw new TypeError("gateway sensitivity is not supported");
  }
  const tools = Array.isArray(value.tools) ? value.tools.filter((item) => typeof item === "string") : [];
  const context = Array.isArray(value.context) ? structuredClone(value.context) : [];
  const budget = value.budget && typeof value.budget === "object" ? structuredClone(value.budget) : {};
  return Object.freeze({
    schemaVersion: 1,
    capability: value.capability,
    projectId: value.projectId,
    modelPolicy: Object.freeze({mode}),
    context: Object.freeze(context),
    tools: Object.freeze(tools),
    responseSchema: value.responseSchema ? structuredClone(value.responseSchema) : null,
    budget: Object.freeze(budget),
    sensitivity
  });
}
