import { execa } from "execa";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Repos {
  services: Record<string, string>;
  packages: Record<string, string>;
}

const rootDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const repos = pkg.repos as Repos;

async function buildPackage(label: string, dir: string): Promise<boolean> {
  if (!existsSync(join(dir, "package.json"))) {
    console.log(
      `  ${chalk.yellow("⚠")}  ${chalk.bold(label)} — not cloned yet, skipping (run: npm run pull)`,
    );
    return false;
  }
  console.log(`  ${chalk.blue("⚙")}  Building ${chalk.bold(label)}…`);
  try {
    await execa("npm", ["run", "build"], { cwd: dir, stdio: "pipe" });
    console.log(`  ${chalk.green("✓")}  ${chalk.bold(label)} — built`);
    return true;
  } catch (err: any) {
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n");
    console.error(
      `  ${chalk.red("✗")}  ${chalk.bold(label)} — build failed:\n${output}`,
    );
    process.exitCode = 1;
    return false;
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — Build\n"));

  const commonBuilt = await buildPackage(
    "packages/common",
    join(rootDir, "packages", "common"),
  );

  if (!commonBuilt) {
    console.error(
      chalk.red("\n  Cannot continue: packages/common failed to build.\n"),
    );
    process.exit(1);
  }

  const nestServices = Object.keys(repos.services ?? {}).filter(
    (n) => n !== "app",
  );
  await Promise.all(
    nestServices.map((name) =>
      buildPackage(name, join(rootDir, "services", name)),
    ),
  );

  if (process.exitCode === 1) {
    console.log(chalk.yellow("\n  Build completed with errors.\n"));
  } else {
    console.log(chalk.green.bold("\n  Build complete.\n"));
  }
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
