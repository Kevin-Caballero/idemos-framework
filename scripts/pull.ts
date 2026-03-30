import { execa } from "execa";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Repos {
  services: Record<string, string>;
  packages: Record<string, string>;
}

type CloneStatus = "cloned" | "updated" | "already-up-to-date" | "error";

interface CloneResult {
  label: string;
  status: CloneStatus;
  detail?: string;
}

const rootDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const repos = pkg.repos as Repos;

const PALETTE = [
  chalk.cyan,
  chalk.green,
  chalk.yellow,
  chalk.magenta,
  chalk.blue,
  chalk.red,
];
let colorIdx = 0;
function nextColor() {
  return PALETTE[colorIdx++ % PALETTE.length];
}

async function ensureRepo(
  label: string,
  url: string,
  dir: string,
): Promise<CloneResult> {
  if (!existsSync(dir)) {
    try {
      await execa("git", ["clone", "--progress", url, dir], { stdio: "pipe" });
      return { label, status: "cloned" };
    } catch (err: any) {
      return { label, status: "error", detail: err.stderr ?? err.message };
    }
  }

  if (!existsSync(`${dir}/.git`)) {
    try {
      await execa("git", ["clone", "--progress", url, dir], { stdio: "pipe" });
      return { label, status: "cloned" };
    } catch (err: any) {
      return {
        label,
        status: "error",
        detail: `directory exists but is not a git repo; clone failed: ${err.stderr ?? err.message}`,
      };
    }
  }

  try {
    const { stdout: currentUrl } = await execa(
      "git",
      ["-C", dir, "remote", "get-url", "origin"],
      { stdio: "pipe" },
    );
    if (currentUrl.trim() !== url) {
      await execa("git", ["-C", dir, "remote", "set-url", "origin", url], {
        stdio: "pipe",
      });
    }
  } catch {
    await execa("git", ["-C", dir, "remote", "add", "origin", url], {
      stdio: "pipe",
    }).catch(() => {});
  }

  try {
    await execa("git", ["-C", dir, "fetch", "origin"], { stdio: "pipe" });
    const { stdout } = await execa(
      "git",
      ["-C", dir, "pull", "--ff-only", "origin"],
      { stdio: "pipe" },
    );
    const alreadyUpToDate =
      stdout.includes("Already up to date") ||
      stdout.includes("Ya está actualizado");
    return {
      label,
      status: alreadyUpToDate ? "already-up-to-date" : "updated",
      detail: stdout.trim(),
    };
  } catch (err: any) {
    return { label, status: "error", detail: err.stderr ?? err.message };
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold.blue("\n  IDemos — Pull Repositories\n"));

  try {
    await execa("git", ["--version"], { stdio: "pipe" });
  } catch {
    console.error(
      chalk.red("  ✗  git not found in PATH. Install Git and retry."),
    );
    process.exit(1);
  }

  const tasks: Array<{ label: string; url: string; dir: string }> = [];

  for (const [name, url] of Object.entries(repos.services ?? {})) {
    tasks.push({ label: name, url, dir: join(rootDir, "services", name) });
  }
  for (const [name, url] of Object.entries(repos.packages ?? {})) {
    tasks.push({
      label: `packages/${name}`,
      url,
      dir: join(rootDir, "packages", name),
    });
  }

  if (tasks.length === 0) {
    console.log(
      chalk.yellow('  No repos configured in package.json "repos" field.'),
    );
    return;
  }

  const promises = tasks.map(({ label, url, dir }) => {
    const c = nextColor()(`[${label}]`.padEnd(20));
    const action = existsSync(dir) ? "Pulling …" : "Cloning …";
    console.log(`  ${c} ${action}  ${chalk.gray(url)}`);
    return ensureRepo(label, url, dir);
  });

  const results = await Promise.all(promises);

  console.log("");
  let hasError = false;

  for (const { label, status, detail } of results) {
    if (status === "cloned") {
      console.log(`  ${chalk.green("✓")}  ${chalk.bold(label)} — cloned`);
    } else if (status === "updated") {
      console.log(
        `  ${chalk.green("✓")}  ${chalk.bold(label)} — updated  ${chalk.gray(detail ?? "")}`,
      );
    } else if (status === "already-up-to-date") {
      console.log(
        `  ${chalk.gray("·")}  ${chalk.bold(label)} — already up to date`,
      );
    } else {
      console.log(
        `  ${chalk.red("✗")}  ${chalk.bold(label)} — ${chalk.red(detail)}`,
      );
      hasError = true;
    }
  }

  console.log("");
  if (hasError) {
    console.log(
      chalk.yellow(
        "  Completed with errors. Check your git credentials / network.\n",
      ),
    );
    process.exit(1);
  }
  console.log(chalk.green.bold("  All repositories are up to date.\n"));
}

main().catch((err: Error) => {
  console.error(chalk.red("\n  Fatal:"), err.message);
  process.exit(1);
});
