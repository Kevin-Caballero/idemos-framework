import { execa } from "execa";
import chalk from "chalk";
import { checkbox, select } from "@inquirer/prompts";
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
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\n  Shutting down services…"));
    for (const proc of spawned) {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    }
    setTimeout(() => process.exit(0), 2_000);
  });
}

async function main(): Promise<void> {
  setupShutdown();
  console.log(chalk.bold.blue("\n  IDemos — Start (Production)\n"));

  const nestServices = Object.keys(repos.services ?? {}).filter(
    (n) => n !== "app",
  );

  const available = nestServices.filter((name) =>
    existsSync(join(rootDir, "services", name, "dist", "main.js")),
  );

  if (available.length === 0) {
    console.error(
      chalk.red("  No built services found. Run npm run build first."),
    );
    process.exit(1);
  }

  const selected = await checkbox({
    message: "Select services to start:",
    choices: available.map((name) => ({ name, value: name, checked: true })),
  });

  if (selected.length === 0) {
    console.log(chalk.yellow("  No services selected. Exiting."));
    return;
  }

  const mode = await select({
    message: "Run mode:",
    choices: [
      { name: "Docker Compose (recommended)", value: "docker" },
      { name: "Local  (node dist/main.js)", value: "local" },
    ],
  });

  if (mode === "docker") {
    console.log(chalk.blue("\n  Starting services via Docker Compose…\n"));
    const composeServices = [
      "postgres",
      "rabbitmq",
      "migration-runner",
      ...selected,
    ];
    await execa(
      "docker",
      [
        "compose",
        "-f",
        "docker/docker-compose.yml",
        "up",
        "--build",
        "-d",
        ...composeServices,
      ],
      { stdio: "inherit", cwd: rootDir },
    );
    console.log(chalk.green.bold("\n  Services started.\n"));
    console.log(`  Gateway:   ${chalk.cyan("http://localhost:3000")}`);
    console.log(
      `  RabbitMQ:  ${chalk.cyan("http://localhost:15672")}  (guest / guest)\n`,
    );
    return;
  }

  console.log(chalk.blue("\n  Starting services locally…\n"));

  for (const name of selected) {
    const color = SERVICE_COLORS[name] ?? chalk.white;
    const prefix = color(`[${name}]`.padEnd(12));
    const dir = join(rootDir, "services", name);

    const proc = execa("node", ["dist/main.js"], { cwd: dir, stdio: "pipe" });
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
      `  ${selected.length} service(s) running. Press Ctrl+C to stop.\n`,
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
