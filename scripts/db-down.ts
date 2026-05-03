import { execa } from "execa";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";

const rootDir = process.cwd();
const COMPOSE_INFRA = "docker/docker-compose.infra.yml";

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — DB Down\n"));

  console.log(chalk.blue("  Stopping PostgreSQL container…"));
  try {
    await execa(
      "docker",
      ["compose", "-f", COMPOSE_INFRA, "stop", "postgres"],
      { stdio: "inherit", cwd: rootDir },
    );
    console.log(chalk.green("  ✓  PostgreSQL stopped.\n"));
  } catch (err: unknown) {
    console.error(
      chalk.red("  ✗  Failed to stop postgres:"),
      (err as Error).message,
    );
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
    ["compose", "-f", COMPOSE_INFRA, "rm", "--force", "--volumes", "postgres"],
    { stdio: "inherit", cwd: rootDir },
  );

  await execa("docker", ["volume", "rm", "--force", "idemos_postgres_data"], {
    stdio: "pipe",
    cwd: rootDir,
  }).catch(() => {});

  console.log(chalk.red.bold("\n  Volumes removed. All data deleted.\n"));
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
