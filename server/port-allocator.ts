import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { getAllUsedPorts, setConversationPorts } from "./store.js";
import { atomicWrite } from "./utils.js";

const PORT_MIN = 3000;
const PORT_MAX = 5000;
const MAX_RETRIES = 50;

// Simple promise-based mutex to prevent concurrent allocations picking the same ports
let mutexPromise: Promise<void> = Promise.resolve();

export function scanPortVars(content: string): string[] {
  const vars = new Set<string>();
  const re = /__PORT_(\d+)__/g;
  // Skip comment lines (starting with #) to avoid matching port vars in documentation
  const nonCommentContent = content
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  for (const match of nonCommentContent.matchAll(re)) {
    vars.add(`__PORT_${match[1]}__`);
  }
  return [...vars].sort();
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function pickAvailablePort(usedPorts: Set<number>): Promise<number> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1));
    if (usedPorts.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`Could not find available port after ${MAX_RETRIES} retries`);
}

export function processTemplate(content: string, ports: Record<string, number>): string {
  return content
    .split("\n")
    .map((line) => {
      if (line.trimStart().startsWith("#")) return line;
      let result = line;
      for (const [varName, port] of Object.entries(ports)) {
        result = result.replaceAll(varName, String(port));
      }
      return result;
    })
    .join("\n");
}

export async function allocatePorts(
  conversationId: string,
  worktreeCwd: string,
): Promise<Record<string, number>> {
  // Read template files
  let portsContent = "";
  let startContent = "";
  const portsMdPath = path.join(worktreeCwd, "PORTS");
  const startShPath = path.join(worktreeCwd, "start.sh");

  try {
    portsContent = fs.readFileSync(portsMdPath, "utf8");
  } catch {
    // no PORTS
  }
  try {
    startContent = fs.readFileSync(startShPath, "utf8");
  } catch {
    // no start.sh
  }

  if (!portsContent && !startContent) return {};

  // Scan both files for __PORT_N__ vars
  const vars = [...new Set([...scanPortVars(portsContent), ...scanPortVars(startContent)])].sort();

  if (vars.length === 0) return {};

  // Acquire mutex
  const prevMutex = mutexPromise;
  let releaseMutex: () => void;
  mutexPromise = new Promise((resolve) => {
    releaseMutex = resolve;
  });
  await prevMutex;

  try {
    const usedPorts = getAllUsedPorts();
    const ports: Record<string, number> = {};

    for (const varName of vars) {
      const port = await pickAvailablePort(usedPorts);
      ports[varName] = port;
      usedPorts.add(port);
    }

    // Write processed templates
    if (portsContent) {
      const localPortsMd = path.join(worktreeCwd, "PORTS.LOCAL");
      atomicWrite(localPortsMd, processTemplate(portsContent, ports));
    }

    if (startContent) {
      const localStartSh = path.join(worktreeCwd, "start.local.sh");
      atomicWrite(localStartSh, processTemplate(startContent, ports));
      fs.chmodSync(localStartSh, 0o755);
    }

    // Persist to conversation
    setConversationPorts(conversationId, ports);

    // Append PORTS.LOCAL reference to worktree CLAUDE.md
    const claudeMdPath = path.join(worktreeCwd, "CLAUDE.md");
    const marker = "PORTS.LOCAL";
    try {
      let existing = "";
      try {
        existing = fs.readFileSync(claudeMdPath, "utf8");
      } catch {
        // no CLAUDE.md yet
      }
      if (!existing.includes(marker)) {
        const section = [
          "",
          "",
          "# Dev Server Ports",
          "",
          "Your dev server ports are defined in PORTS.LOCAL (auto-generated per worktree).",
          "Start the server with start.local.sh. Do not edit PORTS.LOCAL or start.local.sh",
          "directly — edit PORTS and start.sh (using __PORT_N__ template variables) instead.",
        ].join("\n");
        atomicWrite(claudeMdPath, `${existing}${section}\n`);
      }
    } catch (err) {
      console.warn("Could not update CLAUDE.md with port info:", (err as Error).message);
    }

    return ports;
  } finally {
    releaseMutex!();
  }
}
