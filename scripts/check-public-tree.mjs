#!/usr/bin/env node

import {lstat, readFile, readdir} from "node:fs/promises";
import {basename, dirname, extname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const MAX_FILE_BYTES = 512 * 1024;
const ALLOWED_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".svg", ".yaml", ".yml"]);
const ALLOWED_EXTENSIONLESS = new Set([".gitignore", ".nojekyll", ".nvmrc", "LICENSE", "NOTICE"]);
const FORBIDDEN_PATH_PARTS = new Set([".aws", ".codex", ".git", ".ssh", "coverage", "customer-data", "node_modules", "tenant-data"]);
const FORBIDDEN_CONTENT = [
  ["AWS account identifier", /(?<![0-9a-f])\d{12}(?![0-9a-f])/giu],
  ["AWS resource ARN", /\barn:(?:aws|aws-us-gov|aws-cn):/giu],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ["GitHub access token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/gu],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu],
  ["Slack access token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu],
  ["private key material", /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/gu],
  ["production categori.se endpoint", /(?:https?:\/\/|[a-z0-9-]+\.)categori\.se\b/giu],
  ["CloudFront endpoint", /\b[a-z0-9-]+\.cloudfront\.net\b/giu],
  ["private deployment data bucket", /\bai\.studio\.data\b/giu],
  ["Cognito pool identifier", /\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+\b/gu],
  ["operator filesystem path", /\/(?:home|Users)\/[^/\s]+(?:\/|\b)/gu],
  ["private backend import", /(?:from|import)\s+["']?(?:\.\.\/)*backend(?:\/|\b)/giu],
  ["private infrastructure import", /(?:from|import)\s+["']?(?:\.\.\/)*infra(?:\/|\b)/giu],
  ["private browser auth import", /components\/(?:auth|config)\.js/giu],
  ["private runner import", /studio_runner\.py/giu]
];

const decoder = new TextDecoder("utf-8", {fatal: true});

function posixPath(value) {
  return value.split(sep).join("/");
}

function pathParts(value) {
  return value.toLowerCase().split("/");
}

async function collectFiles(root, directory, findings, files) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const absolute = join(directory, entry.name);
    const path = posixPath(relative(root, absolute));
    if (path === ".git") continue;

    const metadata = await lstat(absolute);
    const forbiddenPart = pathParts(path).find((part) => FORBIDDEN_PATH_PARTS.has(part));
    if (forbiddenPart) findings.push(`${path}: forbidden private or generated path segment ${forbiddenPart}`);
    if (metadata.isSymbolicLink()) {
      findings.push(`${path}: symbolic links are not publishable`);
      continue;
    }
    if (metadata.isDirectory()) {
      if (!forbiddenPart) await collectFiles(root, absolute, findings, files);
      continue;
    }
    if (!metadata.isFile()) {
      findings.push(`${path}: non-regular file`);
      continue;
    }

    files.push(path);
    const name = basename(path);
    if (name === ".env" || name.startsWith(".env.")) {
      findings.push(`${path}: environment files are not publishable`);
    }
    if (!ALLOWED_EXTENSIONS.has(extname(name).toLowerCase()) && !ALLOWED_EXTENSIONLESS.has(name)) {
      findings.push(`${path}: file type is outside the public text allowlist`);
    }
    if (metadata.size > MAX_FILE_BYTES) {
      findings.push(`${path}: file exceeds the ${MAX_FILE_BYTES}-byte public limit`);
      continue;
    }

    let content;
    try {
      content = decoder.decode(await readFile(absolute));
    } catch {
      findings.push(`${path}: file is not strict UTF-8 text`);
      continue;
    }
    for (const [label, pattern] of FORBIDDEN_CONTENT) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) findings.push(`${path}: ${label}`);
    }
  }
}

export async function scanPublicTree(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const findings = [];
  let manifest;
  let packageMetadata;
  try {
    manifest = JSON.parse(decoder.decode(await readFile(join(root, "public-tree.json"))));
    packageMetadata = JSON.parse(decoder.decode(await readFile(join(root, "package.json"))));
  } catch {
    return ["public-tree.json and package.json must be strict UTF-8 JSON objects"];
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      !packageMetadata || typeof packageMetadata !== "object" || Array.isArray(packageMetadata)) {
    return ["public-tree.json and package.json must contain JSON objects"];
  }

  const manifestKeys = Object.keys(manifest).sort();
  if (manifestKeys.join("\n") !== ["files", "repository", "schema_version"].join("\n")) {
    findings.push("public-tree.json: fields do not match the reviewed schema");
  }
  const packageMatch = /^@categori\/(studio-(?:contracts|core|examples))$/.exec(packageMetadata.name || "");
  const expectedRepository = packageMatch ? `categori-se/${packageMatch[1]}` : "";
  if (manifest.schema_version !== 1) findings.push("public-tree.json: schema_version must equal 1");
  if (manifest.repository !== expectedRepository) findings.push(`public-tree.json: repository must equal ${expectedRepository}`);
  if (!packageMatch) findings.push("package.json: package name is outside the reviewed categori public set");

  const expectedFiles = Array.isArray(manifest.files) && manifest.files.every((path) => typeof path === "string")
    ? [...manifest.files]
    : [];
  if (!Array.isArray(manifest.files) || expectedFiles.length !== manifest.files.length) {
    findings.push("public-tree.json: files must be an array of strings");
  }
  const sortedExpected = [...new Set(expectedFiles)].sort();
  if (expectedFiles.join("\n") !== sortedExpected.join("\n")) {
    findings.push("public-tree.json: files must be sorted and unique");
  }
  for (const required of ["public-tree.json", "scripts/check-public-tree.mjs"]) {
    if (!expectedFiles.includes(required)) findings.push(`public-tree.json: files must include ${required}`);
  }

  const actualFiles = [];
  await collectFiles(root, root, findings, actualFiles);
  const actual = new Set(actualFiles);
  const expected = new Set(expectedFiles);
  for (const path of sortedExpected) {
    if (!actual.has(path)) findings.push(`${path}: reviewed public file is missing`);
  }
  for (const path of actualFiles.sort()) {
    if (!expected.has(path)) findings.push(`${path}: file is not in public-tree.json`);
  }
  return [...new Set(findings)].sort();
}

async function main() {
  const findings = await scanPublicTree();
  if (findings.length) {
    for (const finding of findings) console.error(`public-tree violation: ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log("Public-tree scan passed: every file is reviewed, bounded, and free of known private material.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
