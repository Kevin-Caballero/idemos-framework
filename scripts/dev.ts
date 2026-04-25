import { execa } from "execa";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { checkbox, select } from "@inquirer/prompts";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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

type RunMode = "process" | "terminals" | "docker";

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

async function startInfra(): Promise<void> {
  const env = loadRootEnv(rootDir);
  const useGpu = (env.USE_GPU ?? process.env.USE_GPU) === "true";

  const composeFiles = ["docker/docker-compose.dev.yml"];
  if (useGpu) composeFiles.push("docker/docker-compose.dev.gpu.yml");

  const composeArgs = [
    "compose",
    ...composeFiles.flatMap((f) => ["-f", f]),
    "up",
    "-d",
    "--remove-orphans",
  ];

  console.log(
    chalk.blue(
      `\n  Starting dev infrastructure${useGpu ? " (GPU mode)" : ""}…`,
    ),
  );
  try {
    await execa("docker", composeArgs, { stdio: "inherit", cwd: rootDir });
    console.log(chalk.green("  Infrastructure ready.\n"));
    await waitForOllamaModel(env.AI_MODEL ?? "llama3.2");
  } catch {
    console.error(
      chalk.red("  Failed to start Docker infrastructure. Is Docker running?"),
    );
    process.exit(1);
  }
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

  console.log(
    chalk.gray(
      "\n  Services started in separate windows. Infrastructure remains up.\n",
    ),
  );
}

function buildServiceOverride(selected: string[]): string {
  const rootUnix = rootDir.replaceAll("\\", "/");

  const serviceBlocks = selected
    .map((name) => {
      const startCmd = [
        "cd /workspace/packages/common",
        "npm install --ignore-scripts",
        "npm run build",
        `cd /workspace/services/${name}`,
        "npm install --ignore-scripts",
        "npm run start:dev",
      ].join(" && ");

      const optionalBinds = (
        [
          {
            file: "tsconfig.build.json",
            container: `/workspace/services/${name}/tsconfig.build.json`,
          },
          {
            file: "nest-cli.json",
            container: `/workspace/services/${name}/nest-cli.json`,
          },
        ] as const
      )
        .filter(({ file }) => existsSync(join(rootDir, "services", name, file)))
        .map(
          ({ file, container }) =>
            `      - ${rootUnix}/services/${name}/${file}:${container}:ro`,
        )
        .join("\n");

      const envFileLine = existsSync(join(rootDir, "services", name, ".env"))
        ? `\n    env_file:\n      - ${rootUnix}/services/${name}/.env`
        : "";

      const SERVICE_PORTS: Record<string, number> = {
        gateway: 3000,
        auth: 3001,
        backend: 3002,
        etl: 3003,
        ai: 3004,
      };
      const hostPort = SERVICE_PORTS[name];
      const portsBlock = hostPort
        ? `    ports:\n      - "${hostPort}:${hostPort}"\n`
        : "";
      return `  ${name}:
    image: node:20-alpine
    pull_policy: if_not_present
    working_dir: /workspace/services/${name}
    command: ["/bin/sh", "-c", "${startCmd}"]
${portsBlock}    volumes:
      - type: bind
        source: ${rootUnix}
        target: /workspace
      - ${name}_nm:/workspace/services/${name}/node_modules
      - common_nm:/workspace/packages/common/node_modules
${optionalBinds ? `${optionalBinds}\n` : ""}    environment:
      NODE_ENV: development
      CHOKIDAR_USEPOLLING: "true"
      CHOKIDAR_INTERVAL: "1000"
      RABBITMQ_URL: "amqp://guest:guest@rabbitmq:5672"
      DB_HOST: postgres
      DB_PORT: "5432"${hostPort ? `\n      PORT: "${hostPort}"` : ""}${envFileLine}`;
    })
    .join("\n\n");

  const volumeLines = [
    "  common_nm:",
    ...selected.map((n) => `  ${n}_nm:`),
  ].join("\n");

  return `services:
${serviceBlocks}

volumes:
${volumeLines}
`;
}

async function runDocker(selected: string[]): Promise<void> {
  const BASE_IMAGE = "node:20-alpine";
  const ECR_MIRROR = "public.ecr.aws/docker/library/node:20-alpine";

  const imageExists = await execa("docker", ["image", "inspect", BASE_IMAGE], {
    reject: false,
    stdio: "ignore",
  }).then((r) => r.exitCode === 0);

  if (!imageExists) {
    console.log(chalk.blue(`\n  Pulling base image ${BASE_IMAGE}…`));
    const primary = await execa("docker", ["pull", BASE_IMAGE], {
      reject: false,
      stdio: "inherit",
    });

    if (primary.exitCode !== 0) {
      console.log(
        chalk.yellow(
          `\n  Direct pull failed (Docker Desktop TLS/CDN issue). Trying AWS ECR mirror…\n`,
        ),
      );
      try {
        await execa("docker", ["pull", ECR_MIRROR], { stdio: "inherit" });
        await execa("docker", ["tag", ECR_MIRROR, BASE_IMAGE], {
          stdio: "inherit",
        });
        console.log(
          chalk.green(`  Pulled via ECR mirror and tagged as ${BASE_IMAGE}.\n`),
        );
      } catch {
        console.error(
          chalk.red(`\n  Both pulls failed. Cannot start Docker mode.`),
        );
        console.error(
          chalk.yellow(
            "  Permanent fix: update Docker Desktop to the latest version\n" +
              "  (the TLS issue is caused by an outdated VPNKit proxy in Docker Desktop).\n",
          ),
        );
        process.exit(1);
      }
    }
  }

  const overrideYaml = buildServiceOverride(selected);
  const tmpFile = join(tmpdir(), "idemos-dev-services-override.yml");
  writeFileSync(tmpFile, overrideYaml);

  const composeFiles = ["-f", "docker/docker-compose.dev.yml", "-f", tmpFile];

  const cleanup = async () => {
    try {
      await execa("docker", ["compose", ...composeFiles, "stop", ...selected], {
        stdio: "inherit",
        cwd: rootDir,
      });
      await execa(
        "docker",
        ["compose", ...composeFiles, "rm", "-f", ...selected],
        { stdio: "ignore", cwd: rootDir },
      );
    } catch {}
    try {
      unlinkSync(tmpFile);
    } catch {}
  };

  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n\n  Stopping Docker services…"));
    await cleanup();
    process.exit(0);
  });

  console.log(
    chalk.blue(
      "\n  Starting services in Docker containers (first run installs deps — may take a minute)…\n",
    ),
  );

  try {
    await execa(
      "docker",
      ["compose", ...composeFiles, "up", "-d", ...selected],
      { stdio: "inherit", cwd: rootDir },
    );
    console.log(
      chalk.green("\n  Containers started. Streaming logs (Ctrl+C to stop)…\n"),
    );
    console.log(
      chalk.gray(
        "  Tip: RabbitMQ management UI → http://localhost:15672  (guest/guest)\n",
      ),
    );
    await execa(
      "docker",
      ["compose", ...composeFiles, "logs", "-f", "--tail=50", ...selected],
      { stdio: "inherit", cwd: rootDir },
    );
  } catch {
  } finally {
    await cleanup();
  }
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
      {
        name: "Docker     — containers with hot-reload        (source mounted as volume)",
        value: "docker",
      },
    ],
  });

  const selectableServices =
    mode === "docker" ? available.filter((n) => n !== "gateway") : available;

  const selected = await checkbox({
    message: "Select services to start in dev mode:",
    choices: selectableServices.map((name) => ({
      name,
      value: name,
      checked: false,
    })),
  });

  if (selected.length === 0) {
    console.log(chalk.yellow("  No services selected. Exiting."));
    return;
  }

  await startInfra();
  await runSeeds();

  switch (mode) {
    case "process":
      await runProcess(selected);
      break;
    case "terminals":
      await runTerminals(selected);
      break;
    case "docker":
      await runDocker(selected);
      break;
  }
}

try {
  await main();
} catch (err) {
  console.error(chalk.red("\n  Fatal:"), (err as Error).message);
  process.exit(1);
}
