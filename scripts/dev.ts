import { execa } from "execa";
import chalk from "chalk";
import { checkbox } from "@inquirer/prompts";
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

const SERVICE_COLORS: Record<string, (s: string) => string> = {
  ai: chalk.magenta,
  auth: chalk.green,
  backend: chalk.blue,
  etl: chalk.yellow,
  gateway: chalk.cyan,
};

const spawned: ReturnType<typeof execa>[] = [];

function setupShutdown(): void {
  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n\n  Stopping dev services…"));
    for (const proc of spawned) {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    }
    setTimeout(() => process.exit(0), 3_000);
  });
}

async function main(): Promise<void> {
  setupShutdown();
  console.log(chalk.bold.blue("\n  IDemos — Dev Mode (hot reload)\n"));

  const nestServices = Object.keys(repos.services ?? {}).filter(
    (n) => n !== "app",
  );

  const available = nestServices.filter((name) =>
    existsSync(join(rootDir, "services", name)),
  );

  if (available.length === 0) {
    console.error(
      chalk.red("  No service repos found. Run npm run pull first."),
    );
    process.exit(1);
  }

  const selected = await checkbox({
    message: "Select services to start in dev mode:",
    choices: available.map((name) => ({
      name,
      value: name,

      checked: name === "gateway" || name === "auth",
    })),
  });

  if (selected.length === 0) {
    console.log(chalk.yellow("  No services selected. Exiting."));
    return;
  }

  console.log(
    chalk.blue("\n  Starting dev infrastructure (postgres + rabbitmq)…"),
  );
  try {
    await execa(
      "docker",
      ["compose", "-f", "docker/docker-compose.dev.yml", "up", "-d"],
      { stdio: "inherit", cwd: rootDir },
    );
    console.log(chalk.green("  Infrastructure ready.\n"));
  } catch {
    console.error(
      chalk.red("  Failed to start Docker infrastructure. Is Docker running?"),
    );
    process.exit(1);
  }

  console.log(
    chalk.blue(`  Starting: ${selected.join(" · ")}  (watch mode)\n`),
  );
  console.log(
    chalk.gray(
      "  Tip: RabbitMQ management UI → http://localhost:15672  (guest/guest)\n",
    ),
  );

  for (const name of selected) {
    const color = SERVICE_COLORS[name] ?? chalk.white;
    const prefix = color(`[${name}]`.padEnd(12));
    const dir = join(rootDir, "services", name);

    const proc = execa("npm", ["run", "start:dev"], {
      cwd: dir,
      stdio: "pipe",
    });
    spawned.push(proc);

    proc.stdout?.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        if (line.trim()) process.stdout.write(`  ${prefix}  ${line}\n`);
      }
    });
    proc.stderr?.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        if (line.trim()) process.stderr.write(`  ${prefix}  ${line}\n`);
      }
    });
    proc.catch(() => {
      /* handled via SIGINT */
    });
  }

  console.log(
    chalk.green(
      `  ${selected.length} service(s) running in watch mode. Press Ctrl+C to stop.\n`,
    ),
  );
  await new Promise(() => {
    /* keep process alive until SIGINT */
  });
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
