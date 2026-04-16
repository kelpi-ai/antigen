import type { RunDetailViewModel } from "./runDetails";

function escapeHtml(input: unknown): string {
  const text = input === null || input === undefined ? "" : String(input);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function titleCaseStatus(status: string): string {
  return status
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function labelForStep(step: string): string {
  return step
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function toolLabel(server?: string): string {
  switch (server) {
    case "sentry-bubble-reel":
      return "Sentry MCP";
    case "chrome-devtools":
      return "Chrome DevTools MCP";
    case "linear":
      return "Linear MCP";
    default:
      return "Codex Runtime";
  }
}

function emptyText(input: string, fallback: string): string {
  return input.trim() ? input : fallback;
}

function renderSummary(detail: RunDetailViewModel): string {
  const { summary, evidence } = detail;
  const sentryLink = summary.sentryIssueUrl
    ? `<a class="stage-link" href="${escapeHtml(summary.sentryIssueUrl)}">Sentry issue ${escapeHtml(summary.sentryIssueId)}</a>`
    : `<span class="stage-link muted-link">Sentry issue ${escapeHtml(summary.sentryIssueId)}</span>`;

  const linearLink = summary.ticketUrl
    ? `<a class="stage-link" href="${escapeHtml(summary.ticketUrl)}">Linear ticket</a>`
    : `<span class="stage-link muted-link">Linear ticket unavailable</span>`;

  const finalUrl = summary.finalUrl
    ? `<a class="final-url" href="${escapeHtml(summary.finalUrl)}">${escapeHtml(summary.finalUrl)}</a>`
    : `<span class="muted-copy">URL not persisted for this run</span>`;

  const videoBlock = evidence.videoAvailable
    ? `<div class="stage-video-wrap"><video controls preload="metadata" src="${escapeHtml(evidence.videoUrl)}"></video></div>`
    : `<div class="stage-video-wrap video-empty"><div><p class="eyebrow">Capture</p><h3>${escapeHtml(
        evidence.videoLabel,
      )}</h3><p class="supporting-copy">Use your own screen recording for this run. The page still reflects the full incident flow from local artifacts.</p></div></div>`;

  return `
    <section class="stage-shell" data-reveal="0">
      <div class="stage-header">
        <div>
          <p class="eyebrow">Incident Loop</p>
          <h1>Latest Run</h1>
        </div>
        <div class="status-cluster">
          <span class="status-pill status-${escapeHtml(summary.status)}">${escapeHtml(titleCaseStatus(summary.status))}</span>
          <span class="run-id">${escapeHtml(summary.runId)}</span>
        </div>
      </div>

      <div class="stage-meta">
        ${sentryLink}
        ${linearLink}
      </div>

      <div class="demo-stage">
        <div class="stage-copy">
          <p class="eyebrow">Outcome</p>
          <h2>Incident flow and current state</h2>
          <p class="supporting-copy">${escapeHtml(emptyText(evidence.summary, "The latest run is loaded from local artifacts."))}</p>
        </div>

        ${videoBlock}

        <div class="metric-rail" aria-label="Run metrics">
          <div class="metric">
            <span class="metric-label">Console errors</span>
            <strong>${escapeHtml(evidence.consoleErrors)}</strong>
          </div>
          <div class="metric">
            <span class="metric-label">Failed requests</span>
            <strong>${escapeHtml(evidence.failedRequests)}</strong>
          </div>
          <div class="metric">
            <span class="metric-label">Flow stages</span>
            <strong>${escapeHtml(detail.flow.length)}</strong>
          </div>
        </div>

        <div class="outcome-grid">
          <div class="outcome-block">
            <span class="outcome-label">Expected outcome</span>
            <p>${escapeHtml(emptyText(summary.expected, "Not persisted for this run"))}</p>
          </div>
          <div class="outcome-block">
            <span class="outcome-label">Observed outcome</span>
            <p>${escapeHtml(emptyText(summary.actual, "Not persisted for this run"))}</p>
          </div>
        </div>

        <div class="final-url-row">
          <span class="metric-label">Target URL</span>
          <span class="muted-copy">${escapeHtml(emptyText(summary.targetAppUrl, "URL not persisted"))}</span>
        </div>
        <div class="final-url-row">
          <span class="metric-label">Final URL</span>
          ${finalUrl}
        </div>
      </div>
    </section>
  `;
}

function renderFlow(flow: RunDetailViewModel["flow"]): string {
  const items = flow
    .map(
      (item) => `
        <li class="flow-item status-${escapeHtml(item.status)}">
          <div class="flow-badge">${escapeHtml(item.key.replaceAll("-", " "))}</div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.summary)}</p>
          <p class="timeline-time">${escapeHtml(item.detail)}</p>
        </li>
      `,
    )
    .join("");

  return `
    <section id="flow-panel" class="detail-shell flow-shell" data-reveal="1">
      <div class="section-heading">
        <p class="eyebrow">Flow</p>
        <h2>What the loop has done</h2>
      </div>
      <ul class="flow-list">
        ${items}
      </ul>
    </section>
  `;
}

function renderTimeline(timeline: RunDetailViewModel["timeline"]): string {
  const items = timeline
    .map(
      (event, index) => `
        <li class="timeline-item status-${escapeHtml(event.status)}" style="--delay:${index * 50}ms">
          <div class="timeline-node"></div>
          <div class="timeline-copy">
            <div class="timeline-row">
              <strong>${escapeHtml(labelForStep(event.step))}</strong>
              <span class="timeline-status">${escapeHtml(titleCaseStatus(event.status))}</span>
            </div>
            <p>${escapeHtml(event.summary)}</p>
            ${
              event.startedAt || event.endedAt
                ? `<p class="timeline-time">${escapeHtml(event.startedAt || "")}${event.startedAt && event.endedAt ? " to " : ""}${escapeHtml(event.endedAt || "")}</p>`
                : ""
            }
          </div>
        </li>
      `,
    )
    .join("");

  return `
    <aside class="timeline-shell" data-reveal="2">
      <div class="section-heading">
        <p class="eyebrow">Lifecycle</p>
        <h2>Vertical timeline</h2>
      </div>
      <ul class="vertical-timeline">
        ${items || '<li class="timeline-item"><div class="timeline-node"></div><div class="timeline-copy"><p>No timeline events available.</p></div></li>'}
      </ul>
    </aside>
  `;
}

function renderEvidence(detail: RunDetailViewModel): string {
  const steps = detail.evidence.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");

  return `
    <section id="evidence-panel" class="detail-shell" data-reveal="3">
      <div class="section-heading">
        <p class="eyebrow">Replay</p>
        <h2>Evidence trail</h2>
      </div>
      <ul class="detail-list">
        ${steps || "<li>Reproduction steps were not persisted for this run.</li>"}
      </ul>
    </section>
  `;
}

function renderSentry(sentry: RunDetailViewModel["sentry"]): string {
  const breadcrumbs = sentry.breadcrumbs.map((breadcrumb) => `<li>${escapeHtml(breadcrumb)}</li>`).join("");

  return `
    <section id="sentry-panel" class="detail-shell" data-reveal="4">
      <div class="section-heading">
        <p class="eyebrow">Sentry</p>
        <h2>Issue context</h2>
      </div>
      <dl class="definition-grid">
        <div>
          <dt>Title</dt>
          <dd>${escapeHtml(emptyText(sentry.title, "Not persisted for this run"))}</dd>
        </div>
        <div>
          <dt>Culprit</dt>
          <dd>${escapeHtml(emptyText(sentry.culprit, "Not persisted for this run"))}</dd>
        </div>
      </dl>
      ${
        sentry.permalink
          ? `<p><a class="text-link" href="${escapeHtml(sentry.permalink)}">Open issue in Sentry</a></p>`
          : ""
      }
      <div class="subsection">
        <h3>Breadcrumbs</h3>
        <ul class="detail-list">${breadcrumbs || "<li>No breadcrumbs persisted yet.</li>"}</ul>
      </div>
      <div class="subsection">
        <h3>Stack snippet</h3>
        <pre class="log-block">${escapeHtml(emptyText(sentry.stackSnippet, "Stack snippet not persisted yet."))}</pre>
      </div>
    </section>
  `;
}

function renderCodex(detail: RunDetailViewModel): string {
  const milestones = detail.codex.milestones
    .map((milestone) => {
      const tool = toolLabel(milestone.raw.item?.server);
      const call = milestone.raw.item?.tool ? String(milestone.raw.item.tool) : milestone.step;
      return `
        <li class="codex-row">
          <div class="codex-row-head">
            <span class="tool-badge">${escapeHtml(tool)}</span>
            <span class="call-badge">${escapeHtml(call)}</span>
          </div>
          <p><strong>${escapeHtml(labelForStep(milestone.step))}</strong></p>
          <p>${escapeHtml(milestone.summary)}</p>
        </li>
      `;
    })
    .join("");

  const rawEvents = detail.codex.rawEvents
    .map((event) => escapeHtml(JSON.stringify(event, null, 2)))
    .join("\n\n");

  return `
    <section id="codex-panel" class="detail-shell codex-shell" data-reveal="5">
      <div class="section-heading">
        <p class="eyebrow">Codex</p>
        <h2>Under the hood</h2>
      </div>
      <p class="supporting-copy">Codex orchestrated MCP calls across Sentry, Chrome DevTools, and Linear during this run.</p>
      <ul class="codex-list">
        ${milestones || "<li class=\"codex-row\">No Codex milestones were parsed for this run.</li>"}
      </ul>
      <details class="raw-log">
        <summary>Collapsed raw codex events (${detail.codex.rawEvents.length})</summary>
        <pre class="log-block">${rawEvents || "No raw Codex events available."}</pre>
      </details>
    </section>
  `;
}

const pollingScript = `<script>
  (function () {
    const currentDigest = JSON.stringify(window.__INCIDENT_DETAIL__);
    window.setInterval(async function () {
      try {
        const response = await fetch("/demo/data", { cache: "no-store" });
        if (!response.ok) return;
        const nextDetail = await response.json();
        if (JSON.stringify(nextDetail) !== currentDigest) {
          window.location.reload();
        }
      } catch (_error) {
        // keep current page if polling fails
      }
    }, 5000);
  })();
</script>`;

export function renderRunDetailPage(detail: RunDetailViewModel): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Incident Run ${escapeHtml(detail.summary.runId)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1013;
        --surface: #15171c;
        --line: #2a2d33;
        --text: #f2efe8;
        --muted: #b0aca2;
        --accent: #b6ff5c;
        --danger: #ff6b57;
        --warn: #f9b64d;
      }
      * { box-sizing: border-box; }
      html { background: var(--bg); }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(182, 255, 92, 0.08), transparent 28%),
          radial-gradient(circle at bottom right, rgba(255, 107, 87, 0.05), transparent 26%),
          var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .incident-shell {
        width: min(1380px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 56px;
      }
      .top-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.95fr);
        gap: 22px;
        align-items: start;
      }
      .bottom-grid {
        display: grid;
        grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
        gap: 22px;
        margin-top: 22px;
      }
      .stage-shell,
      .timeline-shell,
      .detail-shell {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
      }
      .stage-shell { padding: 22px; display: grid; gap: 18px; }
      .timeline-shell,
      .detail-shell { padding: 22px; }
      .demo-stage,
      .stage-header,
      .stage-meta,
      .metric-rail,
      .outcome-grid,
      .definition-grid,
      .codex-row-head,
      .flow-list {
        display: grid;
        gap: 12px;
      }
      .stage-header {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
      }
      .stage-meta,
      .outcome-grid,
      .definition-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .metric-rail {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
        padding: 14px 0;
      }
      .flow-list {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        list-style: none;
        padding: 0;
      }
      .flow-item {
        min-height: 152px;
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
        display: grid;
        gap: 8px;
      }
      .flow-item.status-completed { border-color: rgba(182, 255, 92, 0.3); }
      .flow-item.status-failed { border-color: rgba(255, 107, 87, 0.35); }
      .flow-badge,
      .eyebrow,
      .metric-label,
      dt,
      .timeline-status,
      .call-badge,
      .tool-badge {
        font-size: 0.76rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .flow-badge {
        color: var(--accent);
      }
      .stage-video-wrap {
        border-radius: 8px;
        overflow: hidden;
        background: #090a0d;
        border: 1px solid rgba(182, 255, 92, 0.22);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      .video-empty {
        min-height: 220px;
        display: grid;
        place-items: center;
        padding: 20px;
      }
      video {
        width: 100%;
        display: block;
        aspect-ratio: 16 / 9;
        background: #090a0d;
      }
      h1, h2, h3, p, ul, li, dd, dt, pre { margin: 0; }
      h1 {
        font-size: clamp(2.3rem, 5vw, 4.6rem);
        line-height: 0.94;
        max-width: 8ch;
      }
      h2 {
        font-size: clamp(1.25rem, 2vw, 1.85rem);
        line-height: 1.02;
      }
      h3 {
        font-size: 0.95rem;
        line-height: 1.15;
      }
      .supporting-copy,
      .timeline-copy p,
      .detail-list,
      dd,
      .final-url,
      .run-id {
        color: var(--muted);
      }
      .status-cluster {
        display: grid;
        justify-items: end;
        gap: 10px;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(182, 255, 92, 0.35);
        background: rgba(182, 255, 92, 0.08);
        color: var(--accent);
      }
      .status-failed,
      .status-cancelled { color: var(--danger); }
      .status-in_progress,
      .status-started,
      .status-pending { color: var(--warn); }
      .stage-link,
      .text-link,
      .final-url {
        color: var(--text);
        text-decoration: none;
        border-bottom: 1px solid rgba(242, 239, 232, 0.18);
        width: fit-content;
      }
      .muted-link { color: var(--muted); border-bottom-style: dotted; }
      .section-heading {
        display: grid;
        gap: 8px;
        margin-bottom: 18px;
      }
      .vertical-timeline,
      .detail-list,
      .codex-list {
        list-style: none;
        padding: 0;
      }
      .vertical-timeline,
      .codex-list { display: grid; gap: 14px; }
      .timeline-item {
        display: grid;
        grid-template-columns: 12px minmax(0, 1fr);
        gap: 14px;
        align-items: start;
        padding: 12px 0 0;
        border-top: 1px solid rgba(255, 255, 255, 0.04);
      }
      .timeline-item:first-child { border-top: 0; padding-top: 0; }
      .timeline-node {
        width: 10px;
        height: 10px;
        margin-top: 4px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 6px rgba(182, 255, 92, 0.08);
      }
      .status-failed .timeline-node {
        background: var(--danger);
        box-shadow: 0 0 0 6px rgba(255, 107, 87, 0.08);
      }
      .timeline-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
      }
      .timeline-time { font-size: 0.84rem; color: var(--muted); }
      .detail-list li,
      .codex-row {
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .detail-list li:first-child,
      .codex-row:first-child {
        padding-top: 0;
        border-top: 0;
      }
      .subsection {
        margin-top: 18px;
        display: grid;
        gap: 10px;
      }
      .log-block {
        padding: 14px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(255, 255, 255, 0.05);
        color: #d7d4cc;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.84rem;
        line-height: 1.45;
      }
      .codex-row { display: grid; gap: 8px; }
      .codex-row-head { grid-template-columns: repeat(2, max-content); }
      .tool-badge,
      .call-badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text);
      }
      .tool-badge {
        color: var(--accent);
        border-color: rgba(182, 255, 92, 0.18);
      }
      .raw-log { margin-top: 18px; }
      .raw-log summary { cursor: pointer; color: var(--text); }
      @media (max-width: 980px) {
        .incident-shell {
          width: min(100vw - 24px, 1380px);
          padding: 18px 0 40px;
        }
        .top-grid,
        .bottom-grid,
        .stage-meta,
        .metric-rail,
        .outcome-grid,
        .definition-grid,
        .flow-list {
          grid-template-columns: 1fr;
        }
        h1 { max-width: none; }
        .status-cluster { justify-items: start; }
      }
    </style>
  </head>
  <body>
    <main class="incident-shell">
      <div class="top-grid">
        ${renderSummary(detail)}
        ${renderTimeline(detail.timeline)}
      </div>
      <div class="bottom-grid">
        <div>
          ${renderFlow(detail.flow)}
          ${renderEvidence(detail)}
          ${renderSentry(detail.sentry)}
        </div>
        <div>
          ${renderCodex(detail)}
        </div>
      </div>
    </main>
    <script>window.__INCIDENT_DETAIL__ = ${JSON.stringify(detail)};</script>
    ${pollingScript}
  </body>
</html>`;
}
