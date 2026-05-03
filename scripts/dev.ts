import { execa } from "execa";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { checkbox, select } from "@inquirer/prompts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function loadRootEnv(rootDir: string): Record<string, string> {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    vars[key] = value;
  }
  return vars;
}

interface Repos {
  services: Record<string, string>;
  packages: Record<string, string>;
}

type RunMode = "process" | "terminals";

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

const COMPOSE_INFRA = "docker/docker-compose.infra.yml";
const COMPOSE_GPU = "docker/docker-compose.dev.gpu.yml";

async function waitForPostgres(
  maxTries = 30,
  intervalMs = 2_000,
): Promise<void> {
  const env = loadRootEnv(rootDir);
  process.stdout.write(chalk.blue("  Waiting for PostgreSQL"));
  for (let i = 0; i < maxTries; i++) {
    try {
      await execa(
        "docker",
        [
          "compose",
          "-f",
          COMPOSE_INFRA,
          "exec",
          "-T",
          "postgres",
          "pg_isready",
          "-U",
          env.DB_USER ?? "postgres",
          "-d",
          env.DB_NAME ?? "idemos",
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

async function startInfra(): Promise<void> {
  if (!existsSync(join(rootDir, COMPOSE_INFRA))) {
    console.error(chalk.red(`  ✗  ${COMPOSE_INFRA} not found.`));
    process.exit(1);
  }
  const env = loadRootEnv(rootDir);
  const useGpu =
    existsSync(join(rootDir, COMPOSE_GPU)) &&
    env.USE_GPU?.toLowerCase() === "true";

  const composeArgs = useGpu
    ? ["compose", "-f", COMPOSE_INFRA, "-f", COMPOSE_GPU, "up", "-d"]
    : ["compose", "-f", COMPOSE_INFRA, "up", "-d"];

  console.log(
    chalk.blue(
      `  Starting infrastructure (postgres · rabbitmq · ollama${useGpu ? " · GPU" : ""})…`,
    ),
  );
  await execa("docker", composeArgs, { stdio: "inherit", cwd: rootDir });
  await waitForPostgres();
}

async function waitForOllamaModel(model: string): Promise<void> {
  const ollamaUrl = loadRootEnv(rootDir).OLLAMA_URL ?? "http://localhost:11434";
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let tick = 0;

  process.stdout.write(chalk.blue(`  Waiting for Ollama model '${model}'…`));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (res.ok) {
        const data = (await res.json()) as { models: Array<{ name: string }> };
        const modelName = model.includes(":") ? model : `${model}:latest`;
        const found = data.models?.some(
          (m) => m.name === modelName || m.name.startsWith(`${model}:`),
        );
        if (found) {
          process.stdout.write(
            `\r${chalk.green(`  ✓ Ollama model '${model}' ready.`)}            \n\n`,
          );
          return;
        }
      }
    } catch {
      // server not ready yet
    }

    process.stdout.write(
      `\r  ${spinner[tick++ % spinner.length]} ${chalk.blue(`Waiting for Ollama model '${model}'…`)}`,
    );
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

async function runSeeds(): Promise<void> {
  console.log(chalk.blue("  Running dev seeds\u2026"));
  try {
    await execa("npm", ["run", "db:seed"], { stdio: "inherit", cwd: rootDir });
  } catch {
    console.error(chalk.red("  Seeds failed — check output above."));
    process.exit(1);
  }
}

async function runProcess(selected: string[]): Promise<void> {
  const spawned: ReturnType<typeof execa>[] = [];

  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\n  Stopping dev services…"));
    for (const proc of spawned) {
      try {
        proc.kill("SIGTERM");
      } catch {}
    }
    setTimeout(() => process.exit(0), 3_000);
  });

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
      env: { ...process.env, ...loadRootEnv(rootDir), NODE_ENV: "development" },
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
    proc.catch(() => {});
  }

  console.log(
    chalk.green(
      `  ${selected.length} service(s) running in watch mode. Press Ctrl+C to stop.\n`,
    ),
  );
  await new Promise(() => {});
}

async function runTerminals(selected: string[]): Promise<void> {
  console.log(
    chalk.blue(`\n  Opening ${selected.length} terminal window(s)…\n`),
  );

  for (const name of selected) {
    const dir = join(rootDir, "services", name);

    if (process.platform === "win32") {
      const batPath = join(tmpdir(), `idemos-${name}-dev.bat`);
      writeFileSync(
        batPath,
        [
          "@echo off",
          `title idemos-${name}`,
          `cd /D "${dir}"`,
          "npm run start:dev",
          "",
        ].join("\r\n"),
      );
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "cmd.exe",
          ["/c", "start", "", "/D", dir, "cmd.exe", "/k", batPath],
          { stdio: "ignore", detached: true },
        );
        child.unref();
        child.on("error", reject);
        child.on("close", resolve);
      });
    } else {
      const xterm = `xterm -title "${name}" -e "bash -c 'cd ${dir} && npm run start:dev; exec bash'" &`;
      execa(
        "bash",
        [
          "-c",
          `gnome-terminal --title="${name}" -- bash -c "cd '${dir}' && npm run start:dev; exec bash" 2>/dev/null || ${xterm}`,
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
    }

    console.log(chalk.green(`  ✓ ${name}`));
  }

  console.log(chalk.gray("\n  Services started in separate windows.\n"));
}

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — Dev Mode\n"));

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

  await startInfra();

  const env = loadRootEnv(rootDir);
  if (env.AI_MODEL) {
    await waitForOllamaModel(env.AI_MODEL);
  }

  const mode = await select<RunMode>({
    message: "How do you want to run the services?",
    choices: [
      {
        name: "Process    — multiplexed logs in this terminal  (hot-reload)",
        value: "process",
      },
      {
        name: "Terminals  — one terminal window per service   (hot-reload)",
        value: "terminals",
      },
    ],
  });

  const selected = await checkbox({
    message: "Select services to start in dev mode:",
    choices: available.map((name) => ({
      name,
      value: name,
      checked: false,
    })),
  });

  if (selected.length === 0) {
    console.log(chalk.yellow("  No services selected. Exiting."));
    return;
  }

  switch (mode) {
    case "process":
      await runProcess(selected);
      break;
    case "terminals":
      await runTerminals(selected);
      break;
  }
}

try {
  await main();
} catch (err) {
  console.error(chalk.red("\n  Fatal:"), (err as Error).message);
  process.exit(1);
}
