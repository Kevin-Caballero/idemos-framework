import { execa } from "execa";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { join } from "node:path";

const rootDir = process.cwd();

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — Prepare Migrations\n"));

  const commonPkg = join(rootDir, "packages", "common", "package.json");
  if (!existsSync(commonPkg)) {
    console.log(
      chalk.yellow(
        "  ⚠  packages/common not found — migration generation will fail until you run: npm run pull\n",
      ),
    );
  }

  const migrationsDir = join(rootDir, "packages", "migrations");
  console.log(`  ${chalk.blue("↓")}  Installing migration dependencies…`);
  await execa("npm", ["install"], { cwd: migrationsDir, stdio: "pipe" });
  console.log(`  ${chalk.green("✓")}  packages/migrations — ready`);

  console.log(chalk.green.bold("\n  Migrations prepared.\n"));
  console.log(
    `  Generate a new migration:  ${chalk.cyan("npm run --prefix packages/migrations migration:generate -- src/migrations/DescribeName")}`,
  );
  console.log(`  Apply migrations:          ${chalk.cyan("npm run db:up")}\n`);
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
