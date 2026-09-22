// Extension: kanban-board
// A simple triage Kanban board for the open GitHub issues on
// marcelmedina/tailspin-toys-1. Surfaces the three issues most likely to
// need attention right now (with a justification for each), and lists the
// remaining open issues below. Each card has an "Add to context" button
// that sends the issue's details into the current Copilot CLI session so
// the user can start working on it immediately.

import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

// Static snapshot of the repo's open issues, curated at scaffold time.
// `priority: true` + `justification` mark the three cards that should be
// highlighted at the top of the board.
const ISSUES = [
    {
        number: 8,
        title: "Update our repository coding standards",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/8",
        body: "Clear, documented coding standards keep the codebase consistent and make it easier for new contributors (and Copilot) to produce correct changes. Current guidance on comments and documentation is thin, leading to inconsistent commenting. Wants a single convention for: commenting intent (not mechanics), TSDoc/JSDoc on db/ and src/lib/ exports, documented Props on .astro components, enforced formatting rules, and an updated README.",
        priority: true,
        justification:
            "Foundational and low-effort: every future PR (including ones written by Copilot) inherits whatever standard is set here. Left unresolved, inconsistency compounds with each new feature merged.",
    },
    {
        number: 1,
        title: "Add a search box to find games by title",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/1",
        body: "Players who already know what they're looking for shouldn't have to scan the whole catalog. Add a case-insensitive title search on the game list page, with an empty state, accessibility support, and unit + e2e test coverage.",
        priority: true,
        justification:
            "Core discoverability gap for a catalog site — it's the single most requested type of feature (find-by-name) and currently has no workaround, unlike sorting/pagination which are conveniences on top of an existing list.",
    },
    {
        number: 6,
        title: "Implement pagination on the game list page",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/6",
        body: "As the number of games grows, loading the entire catalog on a single page hurts performance and makes the list harder to browse. Needs paginated data-access helpers, page controls on the game list, accessibility, and tests.",
        priority: true,
        justification:
            "Explicitly framed as a scaling risk (\"as the number of games grows\") — the catalog is actively being seeded with more games in other in-flight issues, so this becomes more urgent the longer it's deferred.",
    },
    {
        number: 9,
        title: "Add a Backer Concierge assistant for catalog questions",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/9",
        body: "A grounded assistant that answers free-text catalog questions (e.g. 'what's the highest rated strategy game?'), refusing to invent data or state facts the catalog doesn't track (funding totals, prices, release dates), reachable from the main nav, accessible, and covered by e2e/unit tests.",
        priority: false,
    },
    {
        number: 5,
        title: "Show a catalog summary on the home page",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/5",
        body: "Show total game count and average star rating on the home page, handling the no-games / no-ratings edge cases, backed by a tested data-access helper.",
        priority: false,
    },
    {
        number: 4,
        title: "Add a publisher page listing that publisher's games",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/4",
        body: "A prerendered per-publisher page listing that publisher's games, linked from the game card/detail page, following the existing dynamic-route pattern.",
        priority: false,
    },
    {
        number: 3,
        title: "Show category and publisher descriptions on the game detail page",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/3",
        body: "Surface the existing category/publisher description fields on the game detail page, hiding the section gracefully when a description is missing. No schema changes required.",
        priority: false,
    },
    {
        number: 2,
        title: "Allow users to sort the game list",
        url: "https://github.com/marcelmedina/tailspin-toys-1/issues/2",
        body: "Sort the game list by title (A–Z / Z–A) and by star rating (highest first), with a documented tie-break for unrated games, plus tests.",
        priority: false,
    },
];

// One local HTTP server per open canvas instance.
const servers = new Map();

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[c]);
}

function renderCard(issue, highlighted) {
    const justificationHtml = issue.justification
        ? `<p class="justification"><strong>Why now:</strong> ${escapeHtml(issue.justification)}</p>`
        : "";
    return `
    <article class="card ${highlighted ? "card--priority" : ""}" data-issue="${issue.number}">
      <header class="card__header">
        <span class="card__number">#${issue.number}</span>
        ${highlighted ? '<span class="badge">Needs attention</span>' : ""}
      </header>
      <h3 class="card__title"><a href="${issue.url}" target="_blank" rel="noopener">${escapeHtml(issue.title)}</a></h3>
      <p class="card__body">${escapeHtml(issue.body)}</p>
      ${justificationHtml}
      <footer class="card__footer">
        <button class="add-btn" data-issue="${issue.number}">Add to context</button>
        <span class="status" data-status-for="${issue.number}" role="status" aria-live="polite"></span>
      </footer>
    </article>`;
}

function renderHtml() {
    const priority = ISSUES.filter((i) => i.priority);
    const rest = ISSUES.filter((i) => !i.priority);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Issue Triage Board</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        margin: 0;
        padding: 1.5rem;
      }
      h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
      h2 {
        font-size: 0.95rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #94a3b8;
        margin: 1.5rem 0 0.75rem;
        border-bottom: 1px solid #1e293b;
        padding-bottom: 0.4rem;
      }
      .subtitle { color: #94a3b8; margin: 0 0 1rem; font-size: 0.85rem; }
      .board { display: flex; flex-direction: column; gap: 0.75rem; }
      .card {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 0.75rem;
        padding: 0.9rem 1.1rem;
      }
      .card--priority {
        border-color: #f59e0b;
        background: linear-gradient(180deg, #2b2411, #1e293b 45%);
      }
      .card__header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; }
      .card__number { color: #64748b; font-size: 0.8rem; font-weight: 600; }
      .badge {
        background: #f59e0b;
        color: #1e293b;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
      }
      .card__title { margin: 0 0 0.4rem; font-size: 1rem; }
      .card__title a { color: #e2e8f0; text-decoration: none; }
      .card__title a:hover, .card__title a:focus-visible { text-decoration: underline; }
      .card__body { margin: 0 0 0.5rem; font-size: 0.85rem; color: #cbd5e1; line-height: 1.4; }
      .justification {
        margin: 0 0 0.6rem;
        font-size: 0.82rem;
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.08);
        border-left: 3px solid #f59e0b;
        padding: 0.4rem 0.6rem;
        border-radius: 0.25rem;
      }
      .card__footer { display: flex; align-items: center; gap: 0.6rem; }
      .add-btn {
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 0.5rem;
        padding: 0.4rem 0.8rem;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
      }
      .add-btn:hover { background: #1d4ed8; }
      .add-btn:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
      .add-btn:disabled { background: #334155; color: #94a3b8; cursor: default; }
      .status { font-size: 0.8rem; color: #4ade80; }
    </style>
  </head>
  <body>
    <h1>Issue Triage Board</h1>
    <p class="subtitle">marcelmedina/tailspin-toys-1 — open issues</p>

    <h2>🔥 Needs attention now</h2>
    <div class="board">${priority.map((i) => renderCard(i, true)).join("\n")}</div>

    <h2>Backlog</h2>
    <div class="board">${rest.map((i) => renderCard(i, false)).join("\n")}</div>

    <script>
      document.addEventListener("click", async (e) => {
        const btn = e.target.closest(".add-btn");
        if (!btn) return;
        const issue = btn.getAttribute("data-issue");
        const statusEl = document.querySelector('[data-status-for="' + issue + '"]');
        btn.disabled = true;
        statusEl.textContent = "Adding…";
        try {
          const res = await fetch("/add-context/" + issue, { method: "POST" });
          if (!res.ok) throw new Error("request failed");
          statusEl.textContent = "Added to session ✓";
        } catch (err) {
          statusEl.textContent = "Failed — try again";
          btn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

async function startServer(session) {
    const server = createServer((req, res) => {
        if (req.method === "GET" && req.url === "/") {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(renderHtml());
            return;
        }
        const match = req.method === "POST" && req.url.match(/^\/add-context\/(\d+)$/);
        if (match) {
            const number = Number(match[1]);
            const issue = ISSUES.find((i) => i.number === number);
            if (!issue) {
                res.statusCode = 404;
                res.end("not found");
                return;
            }
            // Fire-and-forget: inject the issue into the live session as a
            // new user turn so the agent picks up the work immediately.
            session
                .send({
                    prompt:
                        `Let's work on GitHub issue #${issue.number}: "${issue.title}" (${issue.url}).\n\n` +
                        `Issue description:\n${issue.body}\n\n` +
                        `Please read the relevant instructions files, explore the codebase, and implement this issue.`,
                })
                .catch((err) => session.log(`Failed to send issue #${number} to session: ${err}`, { level: "error" }));
            res.statusCode = 202;
            res.end("ok");
            return;
        }
        res.statusCode = 404;
        res.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "kanban-board",
            displayName: "Issue Triage Board",
            description: "Kanban board of open GitHub issues, with the top 3 to triage highlighted and an add-to-context action per card.",
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(session);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Issue Triage Board",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
