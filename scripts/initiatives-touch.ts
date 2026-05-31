import { execa } from "execa";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = process.cwd();
const COMPOSE_INFRA = "docker/docker-compose.infra.yml";

function loadEnv(): void {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key && !(key in process.env)) process.env[key] = val;
  }
}

async function waitForPostgres(
  maxTries = 30,
  intervalMs = 2_000,
): Promise<void> {
  process.stdout.write(chalk.blue("  Waiting for PostgreSQL"));

  for (let i = 0; i < maxTries; i++) {
    try {
      await execa(
        "docker",
        [
          "compose",
          "-f",
          COMPOSE_INFRA,
          "exec",
          "-T",
          "postgres",
          "pg_isready",
          "-U",
          process.env.DB_USER ?? "postgres",
          "-d",
          process.env.DB_NAME ?? "idemos",
        ],
        { stdio: "pipe", cwd: rootDir },
      );
      process.stdout.write(chalk.green(" ready\n"));
      return;
    } catch {
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error(
    "PostgreSQL did not become ready — check the container logs.",
  );
}

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — Touch Initiatives\n"));

  loadEnv();
  const shouldRestore = process.argv.includes("--restore");
  const marker = `test-change-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}`;

  if (!existsSync(join(rootDir, COMPOSE_INFRA))) {
    console.error(chalk.red(`  ✗  ${COMPOSE_INFRA} not found.`));
    process.exit(1);
  }

  console.log(chalk.blue("  Starting PostgreSQL container…"));
  await execa(
    "docker",
    ["compose", "-f", COMPOSE_INFRA, "up", "-d", "postgres"],
    { stdio: "inherit", cwd: rootDir },
  );
  await waitForPostgres();

  const sql = shouldRestore
    ? `
WITH updated AS (
  UPDATE initiatives
  SET
    current_status = regexp_replace(current_status, ' \\[test-change-[^\\]]+\\]$', ''),
    updated_at = now()
  WHERE current_status ~ ' \\[test-change-[^\\]]+\\]$'
  RETURNING id
)
SELECT count(*)::int AS touched FROM updated;
`.trim()
    : `
WITH updated AS (
  UPDATE initiatives
  SET
    current_status = regexp_replace(current_status, ' \\[test-change-[^\\]]+\\]$', '') || ' [${marker}]',
    updated_at = now()
  RETURNING id
)
SELECT count(*)::int AS touched FROM updated;
`.trim();

  const result = await execa(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_INFRA,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.DB_USER ?? "postgres",
      "-d",
      process.env.DB_NAME ?? "idemos",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { stdio: "pipe", cwd: rootDir },
  );

  const touched = result.stdout.trim();
  const action = shouldRestore ? "Restored" : "Touched";
  const hint = shouldRestore
    ? ""
    : " Bring the app to foreground to trigger the follow notification check.";
  console.log(chalk.green.bold(`\n  ${action} ${touched || "0"} initiative(s).${hint}\n`));
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
