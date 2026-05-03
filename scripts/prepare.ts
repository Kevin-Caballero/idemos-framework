import { execa } from "execa";
import chalk from "chalk";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

interface Repos {
  services: Record<string, string>;
  packages: Record<string, string>;
}

const rootDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const repos = pkg.repos as Repos;

const ENV_SAMPLE_SUFFIX = /\.(example|sample)$/i;
const SKIP_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".expo",
]);

function collectEnvSampleFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_SCAN_DIRS.has(entry.name)) continue;
      collectEnvSampleFiles(join(dir, entry.name), acc);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(".env")) continue;
    if (!ENV_SAMPLE_SUFFIX.test(entry.name)) continue;
    acc.push(join(dir, entry.name));
  }

  return acc;
}

function ensureEnvFilesFromSamples(): void {
  const samples = collectEnvSampleFiles(rootDir);
  const created: string[] = [];

  for (const samplePath of samples) {
    const targetPath = samplePath.replace(ENV_SAMPLE_SUFFIX, "");
    if (existsSync(targetPath)) continue;
    copyFileSync(samplePath, targetPath);
    created.push(targetPath);
  }

  if (created.length > 0) {
    console.log(
      `  ${chalk.green("✓")}  ${chalk.bold("env")} — created ${created.length} file(s) from samples`,
    );
  }
}

function ensureServiceEnvFiles(): void {
  const rootEnvPath = join(rootDir, ".env");
  const rootEnvExamplePath = join(rootDir, ".env.example");

  let sourcePath: string | null = null;
  if (existsSync(rootEnvPath)) {
    sourcePath = rootEnvPath;
  } else if (existsSync(rootEnvExamplePath)) {
    sourcePath = rootEnvExamplePath;
  }

  if (!sourcePath) return;

  const nestServices = Object.keys(repos.services ?? {}).filter(
    (name) => name !== "app",
  );
  const created: string[] = [];

  for (const name of nestServices) {
    const serviceDir = join(rootDir, "services", name);
    if (!existsSync(serviceDir) || !statSync(serviceDir).isDirectory())
      continue;

    const serviceEnvPath = join(serviceDir, ".env");
    if (existsSync(serviceEnvPath)) continue;

    copyFileSync(sourcePath, serviceEnvPath);
    created.push(`services/${name}/.env`);
  }

  if (created.length > 0) {
    console.log(
      `  ${chalk.green("✓")}  ${chalk.bold("env")} — created ${created.length} service .env file(s)`,
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

  ensureEnvFilesFromSamples();
  ensureServiceEnvFiles();

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
