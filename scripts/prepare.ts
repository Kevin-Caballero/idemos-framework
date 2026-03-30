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

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — Install Dependencies\n"));

  for (const name of Object.keys(repos.packages ?? {})) {
    await npmInstall(`packages/${name}`, join(rootDir, "packages", name));
  }

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

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
