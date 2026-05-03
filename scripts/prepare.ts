import { execa } from "execa";
import chalk from "chalk";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Repos {
  services: Record<string, string>;
  packages: Record<string, string>;
}

const rootDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const repos = pkg.repos as Repos;

function ensureServiceEnvFilesFromExamples(): void {
  const nestServices = Object.keys(repos.services ?? {}).filter(
    (name) => name !== "app",
  );
  const created: string[] = [];

  for (const name of nestServices) {
    const serviceDir = join(rootDir, "services", name);
    if (!existsSync(serviceDir)) continue;

    const serviceEnvExamplePath = join(serviceDir, ".env.example");
    const serviceEnvPath = join(serviceDir, ".env");

    if (!existsSync(serviceEnvExamplePath) || existsSync(serviceEnvPath)) {
      continue;
    }

    copyFileSync(serviceEnvExamplePath, serviceEnvPath);
    created.push(`services/${name}/.env`);
  }

  if (created.length > 0) {
    console.log(
      `  ${chalk.green("✓")}  ${chalk.bold("env")} — created ${created.length} service .env file(s) from .env.example`,
    );
  }
}

async function npmInstall(label: string, dir: string): Promise<void> {
  if (!existsSync(dir)) {
    console.log(
      `  ${chalk.yellow("⚠")}  ${chalk.bold(label)} — not found (run ${chalk.cyan("npm run pull")} first)`,
    );
    return;
  }
  console.log(`  ${chalk.blue("↓")}  ${chalk.bold(label)} — installing…`);
  try {
    await execa("npm", ["install"], { cwd: dir, stdio: "pipe" });
    console.log(`  ${chalk.green("✓")}  ${chalk.bold(label)} — ready`);
  } catch (err: any) {
    console.error(
      `  ${chalk.red("✗")}  ${chalk.bold(label)} — install failed:\n     ${err.stderr ?? err.message}`,
    );
    process.exitCode = 1;
  }
}

async function npmBuild(label: string, dir: string): Promise<void> {
  if (!existsSync(dir)) {
    console.log(
      `  ${chalk.yellow("⚠")}  ${chalk.bold(label)} — not found (run ${chalk.cyan("npm run pull")} first)`,
    );
    return;
  }

  console.log(`  ${chalk.blue("⚙")}  ${chalk.bold(label)} — building…`);
  try {
    await execa("npm", ["run", "build"], { cwd: dir, stdio: "pipe" });
    console.log(`  ${chalk.green("✓")}  ${chalk.bold(label)} — built`);
  } catch (err: any) {
    console.error(
      `  ${chalk.red("✗")}  ${chalk.bold(label)} — build failed:\n     ${err.stderr ?? err.message}`,
    );
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — Install Dependencies\n"));

  ensureServiceEnvFilesFromExamples();

  for (const name of Object.keys(repos.packages ?? {})) {
    await npmInstall(`packages/${name}`, join(rootDir, "packages", name));
  }

  // @idemos/common exposes declarations from dist/, so it must be built
  // before services install it as a local file dependency.
  await npmBuild("packages/common", join(rootDir, "packages", "common"));

  await npmInstall(
    "packages/migrations",
    join(rootDir, "packages", "migrations"),
  );

  const nestServices = Object.keys(repos.services ?? {}).filter(
    (n) => n !== "app",
  );
  await Promise.all(
    nestServices.map((name) =>
      npmInstall(name, join(rootDir, "services", name)),
    ),
  );

  const appDir = join(rootDir, "services", "app");
  if (existsSync(appDir)) {
    await npmInstall("app (Expo)", appDir);
  }

  if (process.exitCode === 1) {
    console.log(chalk.yellow("\n  Completed with errors.\n"));
  } else {
    console.log(chalk.green.bold("\n  All dependencies installed.\n"));
  }
}

try {
  await main();
} catch (err) {
  console.error(chalk.red("\n  Fatal:"), (err as Error).message);
  process.exit(1);
}
