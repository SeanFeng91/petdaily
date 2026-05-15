import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
const schemaPath = resolve(root, "prisma/schema.prisma");
const schemaDir = dirname(schemaPath);
const envPath = resolve(root, ".env");
const reset = process.argv.includes("--reset");

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const match = env.match(/^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|(.+))$/m);
  return match?.[1] || match?.[2] || match?.[3] || "file:../data/petdaily.db";
}

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Only SQLite file: DATABASE_URL is supported by this local helper.");
  }

  const filePath = databaseUrl.slice("file:".length);
  if (filePath.startsWith("//")) {
    return fileURLToPath(databaseUrl);
  }

  return resolve(schemaDir, filePath);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
    ...options
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }

  return result.stdout;
}

const databaseUrl = readDatabaseUrl();
const dbPath = resolveSqlitePath(databaseUrl);
const absoluteDatabaseUrl = pathToFileURL(dbPath).href;
mkdirSync(dirname(dbPath), { recursive: true });

if (reset && existsSync(dbPath)) {
  unlinkSync(dbPath);
}

const prismaBin = resolve(root, "node_modules/.bin/prisma");
const diffArgs = existsSync(dbPath)
  ? ["migrate", "diff", "--from-url", absoluteDatabaseUrl, "--to-schema-datamodel", schemaPath, "--script"]
  : ["migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPath, "--script"];

const sql = run(prismaBin, diffArgs);

function generatePrismaClient() {
  run(prismaBin, ["generate", "--schema", schemaPath]);
  console.log("Generated Prisma Client for the current schema.");
}

if (!sql.trim() || sql.includes("This is an empty migration")) {
  console.log("Database schema is already up to date.");
  generatePrismaClient();
  process.exit(0);
}

run("sqlite3", [dbPath], { input: sql });
console.log(`Applied schema to ${dbPath}`);
generatePrismaClient();
