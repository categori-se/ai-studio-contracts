import test from "node:test";
import assert from "node:assert/strict";
import {applicationSourcePosture, assertProject, normalizeGatewayRequest, validateProject} from "../src/index.js";

const project = {
  id: "demo-project",
  name: "Demo project",
  repository: "example/demo-project",
  defaultBranch: "main",
  commands: {checks: ["npm test"]},
  modelPolicy: {mode: "local_only"}
};

test("project contracts are provider-neutral and immutable", () => {
  assert.deepEqual(validateProject(project), []);
  assert.equal(assertProject(project).id, "demo-project");
  assert.throws(() => assertProject({...project, id: "Unsafe ID"}), /readable slug/);
});

test("gateway request normalizes the shared request envelope", () => {
  const request = normalizeGatewayRequest({
    capability: "plan",
    projectId: "demo-project",
    modelPolicy: {mode: "local_only"},
    sensitivity: "internal",
    tools: ["read_file"]
  });
  assert.equal(request.schemaVersion, 1);
  assert.deepEqual(request.tools, ["read_file"]);
});

test("application posture remains a pure shared helper", () => {
  assert.equal(applicationSourcePosture({source_status: "AWAITING_SOURCE"}).runReady, false);
  assert.equal(applicationSourcePosture({
    source_status: "SOURCE_READY",
    source_uri: "https://example.invalid/source",
    head_source_uri: "https://example.invalid/source",
    source_revision: 0
  }).runReady, true);
});
