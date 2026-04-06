import { execa } from "execa";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";

const rootDir = process.cwd();
const COMPOSE_DEV = "docker/docker-compose.dev.yml";

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — DB Down\n"));

  console.log(chalk.blue("  Stopping PostgreSQL container…"));
  try {
    await execa("docker", ["compose", "-f", COMPOSE_DEV, "stop", "postgres"], {
      stdio: "inherit",
      cwd: rootDir,
    });
    console.log(chalk.green("  ✓  PostgreSQL stopped.\n"));
  } catch (err: any) {
    console.error(chalk.red("  ✗  Failed to stop postgres:"), err.message);
    process.exit(1);
  }

  const removeVolumes = await confirm({
    message: chalk.red("Remove database volumes? ALL DATA WILL BE LOST."),
    default: false,
  });

  if (!removeVolumes) {
    console.log(chalk.gray("\n  Volumes retained. Data is preserved.\n"));
    return;
  }

  console.log(chalk.red("\n  Removing container and volumes…"));
  await execa(
    "docker",
    ["compose", "-f", COMPOSE_DEV, "rm", "--force", "--volumes", "postgres"],
    { stdio: "inherit", cwd: rootDir },
  );

  await execa("docker", ["volume", "rm", "--force", "idemos-dev_pgdata_dev"], {
    stdio: "pipe",
    cwd: rootDir,
  }).catch(() => {});

  console.log(chalk.red.bold("\n  Volumes removed. All data deleted.\n"));
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
