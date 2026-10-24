import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

const USAGE = `Foydalanish:
  npm run fix -- --repo https://github.com/OWNER/REPO --bug "bag tavsifi"
  npm run fix -- --repo https://github.com/OWNER/REPO --bug-file bug.md
  npm run fix -- --repo https://github.com/OWNER/REPO --issue 12
  npm run fix -- --repo https://github.com/OWNER/REPO --check     (faqat ulanishni tekshiradi)

Qo'shimcha: --branch NOM (default branch o'rniga), --budget-usd 10 (sessiya chegarasi, $)`;

// Starter rubric - tune it as you see what the grader accepts and rejects.
const RUBRIC = `# Bug fix rubric (starter - tune the criteria)
- A new or updated test reproduces the reported bug and fails on the original code.
- The same test passes after the fix.
- The project's full test suite shows no new failures; its type check and lint pass if the project has them.
- The pull request description names the root cause with a file:line reference.
- The diff is minimal: no refactors, renames or formatting changes unrelated to the bug.
- No test was deleted, skipped or weakened.
- A pull request is open from a new fix/ branch into the default branch, describing the bug, root cause, fix and the test commands run with their results.
`;

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    bug: { type: "string" },
    "bug-file": { type: "string" },
    issue: { type: "string" },
    branch: { type: "string" },
    check: { type: "boolean", default: false },
    "budget-usd": { type: "string", default: "10" },
  },
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} o'rnatilmagan (.env.example ga qarang)`);
    process.exit(1);
  }
  return value;
}

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

if (!values.repo) fail("--repo kerak");
const repoUrl = values.repo.replace(/\/+$/, "").replace(/\.git$/, "");
const repoName = new URL(repoUrl).pathname.split("/").filter(Boolean).at(-1);
if (!repoName) fail(`Repo manzili noto'g'ri: ${values.repo}`);
const mountPath = `/workspace/${repoName}`;

let bugText: string | undefined;
if (values.bug) bugText = values.bug;
else if (values["bug-file"]) bugText = readFileSync(values["bug-file"], "utf8");
else if (values.issue) {
  bugText = `The bug is issue #${values.issue} in this repository. Read it with the GitHub tools.`;
}
if (!values.check && !bugText) fail("--bug, --bug-file yoki --issue kerak");

const budgetCents = Math.round(Number(values["budget-usd"]) * 100);
if (!Number.isFinite(budgetCents) || budgetCents <= 0) fail("--budget-usd musbat son bo'lishi kerak");

const AGENT_ID = requireEnv("AGENT_ID");
const ENVIRONMENT_ID = requireEnv("ENVIRONMENT_ID");
const VAULT_ID = requireEnv("VAULT_ID");
const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const WORKSPACE = process.env.ANTHROPIC_WORKSPACE ?? "default";

const client = new Anthropic();
const terminal = createInterface({ input: process.stdin, output: process.stdout });

async function approve(label: string, input: unknown): Promise<boolean> {
  console.log(`\n⏸  Agent ruxsat so'rayapti: ${label}`);
  console.log(JSON.stringify(input, null, 2));
  const answer = await terminal.question("Ruxsat berasizmi? (y/n) ");
  return answer.trim().toLowerCase().startsWith("y");
}

const session = await client.beta.sessions.create({
  agent: AGENT_ID,
  environment_id: ENVIRONMENT_ID,
  vault_ids: [VAULT_ID],
  title: values.check ? `Check: ${repoName}` : `Bug fix: ${repoName}`,
  budget: { type: "limit", max_list_cost: { currency: "USD", amount: String(budgetCents) } },
  resources: [
    {
      type: "github_repository",
      url: repoUrl,
      authorization_token: GITHUB_TOKEN,
      mount_path: mountPath,
      ...(values.branch ? { checkout: { type: "branch" as const, name: values.branch } } : {}),
    },
  ],
});
console.log(`Sessiya: https://platform.claude.com/workspaces/${WORKSPACE}/sessions/${session.id}`);

// Stream-first: open the stream before sending the kickoff so no early event is missed.
const stream = await client.beta.sessions.events.stream(session.id);

const where = `Repository: ${repoUrl}\nCloned at: ${mountPath}`;
if (values.check) {
  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [
          {
            type: "text",
            text:
              `${where}\n\nDo not start any task. Only check the setup and report what worked and what failed:\n` +
              `1. Run \`git -C ${mountPath} ls-remote --heads origin\`.\n` +
              `2. Call one read-only GitHub tool to fetch this repository's metadata.`,
          },
        ],
      },
    ],
  });
} else {
  // The outcome is worded generally, so the bug report goes first as a message.
  await client.beta.sessions.events.send(session.id, {
    events: [
      { type: "user.message", content: [{ type: "text", text: `${where}\n\nBug report:\n${bugText}` }] },
      {
        type: "user.define_outcome",
        description: "Fix the reported bug and open a pull request with the fix.",
        rubric: { type: "text", content: RUBRIC },
        max_iterations: 3,
      },
    ],
  });
}

loop: for await (const event of stream) {
  switch (event.type) {
    case "agent.message":
      for (const block of event.content) {
        if (block.type === "text") process.stdout.write(`${block.text}\n`);
      }
      break;
    case "agent.tool_use":
      if (event.evaluated_permission === "ask") {
        const allowed = await approve(event.name, event.input);
        await client.beta.sessions.events.send(session.id, {
          events: [{ type: "user.tool_confirmation", tool_use_id: event.id, result: allowed ? "allow" : "deny" }],
        });
      } else {
        const command = typeof event.input.command === "string" ? event.input.command : "";
        console.log(`  · ${event.name} ${command.split("\n")[0]?.slice(0, 120) ?? ""}`);
      }
      break;
    case "agent.mcp_tool_use":
      if (event.evaluated_permission === "ask") {
        const allowed = await approve(`${event.mcp_server_name}.${event.name}`, event.input);
        await client.beta.sessions.events.send(session.id, {
          events: [{ type: "user.tool_confirmation", tool_use_id: event.id, result: allowed ? "allow" : "deny" }],
        });
      } else {
        console.log(`  · ${event.mcp_server_name}.${event.name}`);
      }
      break;
    case "span.outcome_evaluation_end":
      console.log(`\n[baholovchi] ${event.iteration + 1}-urinish: ${event.result}\n${event.explanation}\n`);
      break;
    case "session.error":
      console.error(`[xato] ${event.error.type}: ${event.error.message}`);
      break;
    case "session.status_idle":
      if (event.stop_reason.type === "requires_action") break; // waiting on a confirmation above
      if (event.stop_reason.type === "budget_reached") {
        console.log(`\nBudjet chegarasiga yetdi. Davom ettirish uchun Console'da sessiya budjetini oshiring.`);
      }
      break loop;
    case "session.status_terminated":
      break loop;
  }
}

terminal.close();
console.log(`\nTugadi. Batafsil: https://platform.claude.com/workspaces/${WORKSPACE}/sessions/${session.id}`);
