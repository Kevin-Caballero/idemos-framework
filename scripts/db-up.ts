import { execa } from "execa";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = process.cwd();
const COMPOSE_DEV = "docker/docker-compose.dev.yml";

function loadEnv(): void {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) {
    console.log(
      chalk.yellow(
        "  ⚠  .env not found — using defaults. Copy .env.example → .env\n",
      ),
    );
    return;
  }
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
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
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
          COMPOSE_DEV,
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
  console.log(chalk.bold.blue("\n  IDemos — DB Up\n"));

  loadEnv();

  console.log(chalk.blue("  Starting PostgreSQL container…"));
  await execa(
    "docker",
    ["compose", "-f", COMPOSE_DEV, "up", "-d", "postgres"],
    { stdio: "inherit", cwd: rootDir },
  );

  await waitForPostgres();

  const migrationsDir = join(rootDir, "packages", "migrations");
  if (!existsSync(migrationsDir)) {
    console.error(
      chalk.red(
        "\n  ✗  packages/migrations not found. Run npm run db:prepare first.\n",
      ),
    );
    process.exit(1);
  }

  console.log(chalk.blue("\n  Running migrations…\n"));
  await execa("npm", ["run", "migration:run"], {
    cwd: migrationsDir,
    stdio: "inherit",
    env: {
      ...process.env,
      DB_HOST: process.env.DB_HOST ?? "localhost",
      DB_PORT: process.env.DB_PORT ?? "5432",
      DB_NAME: process.env.DB_NAME ?? "idemos",
      DB_USER: process.env.DB_USER ?? "postgres",
      DB_PASSWORD: process.env.DB_PASSWORD ?? "postgres",
    },
  });

  console.log(chalk.green.bold("\n  Database is ready.\n"));
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
