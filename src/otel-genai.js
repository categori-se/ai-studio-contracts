import {deepFreeze, PROJECT_ID} from "./projects.js";

// GenAI semantic conventions are still Development. Upgrading this URL is an
// explicit public-contract decision rather than an automatic dependency bump.
export const OTEL_GENAI_SCHEMA_URL = "https://opentelemetry.io/schemas/gen-ai/1.42.0";

export const GENAI_EVENT_NAMES = Object.freeze({
  OPERATION_DETAILS: "gen_ai.client.inference.operation.details",
  EVALUATION_RESULT: "gen_ai.evaluation.result",
  OPERATION_EXCEPTION: "gen_ai.client.operation.exception"
});

export const GENAI_METRIC_NAMES = Object.freeze({
  TOKEN_USAGE: "gen_ai.client.token.usage",
  OPERATION_DURATION: "gen_ai.client.operation.duration"
});

export const GENAI_OPERATION_NAMES = Object.freeze([
  "chat",
  "create_agent",
  "embeddings",
  "execute_tool",
  "generate_content",
  "invoke_agent",
  "invoke_workflow",
  "retrieval",
  "text_completion"
]);

const CONTENT_FIELDS = Object.freeze({
  inputMessages: "gen_ai.input.messages",
  outputMessages: "gen_ai.output.messages",
  systemInstructions: "gen_ai.system_instructions",
  toolDefinitions: "gen_ai.tool.definitions"
});

function nonempty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function nonnegativeInteger(value, label) {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}

function positiveNumber(value, label) {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function optionalString(attributes, key, value) {
  if (value === undefined) return;
  if (!nonempty(value)) throw new TypeError(`${key} must be a non-empty string`);
  attributes[key] = value.trim();
}

function correlationAttributes(value) {
  const attributes = {};
  if (value.projectId !== undefined) {
    if (!PROJECT_ID.test(value.projectId || "")) throw new TypeError("projectId must be a readable slug");
    attributes["studio.project.id"] = value.projectId;
  }
  optionalString(attributes, "studio.run.id", value.runId);
  optionalString(attributes, "studio.release.id", value.releaseId);
  return attributes;
}

function baseOperationAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("GenAI operation must be an object");
  }
  if (!nonempty(value.operationName)) throw new TypeError("operationName is required");
  if (!nonempty(value.providerName)) throw new TypeError("providerName is required");
  const attributes = {
    "gen_ai.operation.name": value.operationName.trim(),
    "gen_ai.provider.name": value.providerName.trim(),
    ...correlationAttributes(value)
  };
  optionalString(attributes, "gen_ai.request.model", value.requestModel);
  optionalString(attributes, "gen_ai.response.model", value.responseModel);
  optionalString(attributes, "gen_ai.response.id", value.responseId);
  optionalString(attributes, "gen_ai.workflow.name", value.workflowName);
  optionalString(attributes, "gen_ai.agent.id", value.agent?.id);
  optionalString(attributes, "gen_ai.agent.name", value.agent?.name);
  optionalString(attributes, "gen_ai.agent.version", value.agent?.version);
  optionalString(attributes, "gen_ai.prompt.name", value.prompt?.name);
  optionalString(attributes, "gen_ai.prompt.version", value.prompt?.version);
  if (value.finishReasons !== undefined) {
    if (!Array.isArray(value.finishReasons) || value.finishReasons.some((item) => !nonempty(item))) {
      throw new TypeError("finishReasons must be an array of non-empty strings");
    }
    attributes["gen_ai.response.finish_reasons"] = [...value.finishReasons];
  }
  const usage = value.usage || {};
  if (value.usage !== undefined && (!value.usage || typeof value.usage !== "object" || Array.isArray(value.usage))) {
    throw new TypeError("usage must be an object");
  }
  const tokenAttributes = [
    ["inputTokens", "gen_ai.usage.input_tokens"],
    ["outputTokens", "gen_ai.usage.output_tokens"],
    ["reasoningOutputTokens", "gen_ai.usage.reasoning.output_tokens"],
    ["cacheReadInputTokens", "gen_ai.usage.cache_read.input_tokens"],
    ["cacheCreationInputTokens", "gen_ai.usage.cache_creation.input_tokens"]
  ];
  for (const [source, target] of tokenAttributes) {
    const count = nonnegativeInteger(usage[source], source);
    if (count !== null) attributes[target] = count;
  }
  return attributes;
}

function event(name, attributes) {
  return deepFreeze({schemaUrl: OTEL_GENAI_SCHEMA_URL, name, attributes});
}

export function normalizeGenAiOperationEvent(value, {includeContent = false} = {}) {
  const attributes = baseOperationAttributes(value);
  if (includeContent) {
    for (const [source, target] of Object.entries(CONTENT_FIELDS)) {
      if (value[source] !== undefined) attributes[target] = structuredClone(value[source]);
    }
    if (value.promptVariables !== undefined) {
      if (!value.promptVariables || typeof value.promptVariables !== "object" || Array.isArray(value.promptVariables)) {
        throw new TypeError("promptVariables must be an object");
      }
      for (const [key, item] of Object.entries(value.promptVariables)) {
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key) || typeof item !== "string") {
          throw new TypeError("promptVariables must use safe attribute names and string values");
        }
        attributes[`gen_ai.prompt.variable.${key}`] = item;
      }
    }
  }
  return event(GENAI_EVENT_NAMES.OPERATION_DETAILS, attributes);
}

export function normalizeGenAiEvaluationEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("evaluation must be an object");
  if (!nonempty(value.name)) throw new TypeError("evaluation name is required");
  const attributes = {
    "gen_ai.evaluation.name": value.name.trim(),
    ...correlationAttributes(value)
  };
  if (value.scoreValue !== undefined) {
    if (typeof value.scoreValue !== "number" || !Number.isFinite(value.scoreValue)) throw new TypeError("scoreValue must be finite");
    attributes["gen_ai.evaluation.score.value"] = value.scoreValue;
  }
  optionalString(attributes, "gen_ai.evaluation.score.label", value.scoreLabel);
  optionalString(attributes, "gen_ai.evaluation.explanation", value.explanation);
  optionalString(attributes, "gen_ai.response.id", value.responseId);
  return event(GENAI_EVENT_NAMES.EVALUATION_RESULT, attributes);
}

export function normalizeGenAiExceptionEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("exception must be an object");
  if (!nonempty(value.type) && !nonempty(value.message)) throw new TypeError("exception type or message is required");
  const attributes = correlationAttributes(value);
  optionalString(attributes, "exception.type", value.type);
  optionalString(attributes, "exception.message", value.message);
  optionalString(attributes, "exception.stacktrace", value.stacktrace);
  return event(GENAI_EVENT_NAMES.OPERATION_EXCEPTION, attributes);
}

export function normalizeGenAiMetrics(value) {
  const operation = baseOperationAttributes(value);
  const shared = {
    "gen_ai.operation.name": operation["gen_ai.operation.name"],
    "gen_ai.provider.name": operation["gen_ai.provider.name"]
  };
  if (operation["gen_ai.request.model"]) shared["gen_ai.request.model"] = operation["gen_ai.request.model"];
  if (operation["gen_ai.response.model"]) shared["gen_ai.response.model"] = operation["gen_ai.response.model"];
  if (operation["studio.project.id"]) shared["studio.project.id"] = operation["studio.project.id"];
  const metrics = [];
  const duration = positiveNumber(value.durationSeconds, "durationSeconds");
  if (duration !== null) {
    metrics.push({name: GENAI_METRIC_NAMES.OPERATION_DURATION, unit: "s", value: duration, attributes: {...shared}});
  }
  for (const [tokenType, key] of [["input", "gen_ai.usage.input_tokens"], ["output", "gen_ai.usage.output_tokens"]]) {
    if (operation[key] !== undefined) {
      metrics.push({
        name: GENAI_METRIC_NAMES.TOKEN_USAGE,
        unit: "{token}",
        value: operation[key],
        attributes: {...shared, "gen_ai.token.type": tokenType}
      });
    }
  }
  return deepFreeze(metrics);
}
