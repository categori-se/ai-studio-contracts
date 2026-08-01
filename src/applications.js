const DISCOVERED_STATES = new Set(["DISCOVERED", "AWAITING_SOURCE"]);
const READY_STATES = new Set(["SOURCE_READY", "READY"]);

export function strictRevision(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function sourceReference(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const reference = value.trim();
  if (/^s3:\/\/[^/]+\/.+/.test(reference)) return reference;
  try {
    const target = new URL(reference);
    return target.protocol === "https:" ? target.href : "";
  } catch {
    return "";
  }
}

export function applicationSourcePosture(application) {
  const revision = strictRevision(application?.source_revision);
  const sourceUri = sourceReference(application?.source_uri);
  const headSourceUri = sourceReference(application?.head_source_uri);
  const stateValues = [application?.source_state, application?.source_status, application?.status]
    .filter((value) => typeof value === "string")
    .map((value) => value.toUpperCase());
  const explicitlyDiscovered = stateValues.some((value) => DISCOVERED_STATES.has(value));
  const explicitlyReady = stateValues.some((value) => READY_STATES.has(value));
  const hasSourceState = typeof application?.source_state === "string"
    || typeof application?.source_status === "string"
    || stateValues.some((value) => DISCOVERED_STATES.has(value) || READY_STATES.has(value));
  const hasLineage = revision !== null && Boolean(sourceUri) && Boolean(headSourceUri);
  const hasConnectedSource = Boolean(sourceUri) && explicitlyReady;

  if (explicitlyDiscovered) {
    return {state: "DISCOVERED", label: "Discovered · source required", runReady: false, revision, sourceUri, headSourceUri};
  }
  if (hasConnectedSource || (hasLineage && !hasSourceState)) {
    return {state: "READY", label: "Run-ready", runReady: true, revision, sourceUri, headSourceUri};
  }
  return {state: "UNKNOWN", label: "Source state unknown", runReady: false, revision, sourceUri, headSourceUri};
}
