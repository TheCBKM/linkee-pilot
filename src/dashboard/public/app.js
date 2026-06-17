const REFRESH_MS = 15_000;

let followerChart = null;

function relativeTime(iso) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function truncate(str, len = 80) {
  if (!str) return "—";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

function renderStatusCards(data) {
  const { process, agent } = data;

  const processEl = document.getElementById("process-status");
  if (process.running) {
    processEl.textContent = `Running (PID ${process.pid})`;
    processEl.className = "card-value status-running";
  } else {
    processEl.textContent = "Stopped";
    processEl.className = "card-value status-stopped";
  }

  const statusEl = document.getElementById("agent-status");
  statusEl.textContent = agent.status ?? "unknown";
  statusEl.className = "card-value" + (agent.halted ? " status-halted" : "");

  document.getElementById("last-heartbeat").textContent = relativeTime(agent.lastHeartbeat);
  document.getElementById("last-action").textContent = agent.lastAction ?? "none";

  const haltBanner = document.getElementById("halt-banner");
  if (agent.halted) {
    haltBanner.classList.remove("hidden");
    document.getElementById("halt-reason").textContent = agent.haltReason ?? "Unknown reason";
  } else {
    haltBanner.classList.add("hidden");
  }
}

function renderQuotas(quotas) {
  const container = document.getElementById("quotas");
  container.innerHTML = "";

  for (const [type, { used, cap }] of Object.entries(quotas)) {
    const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
    let barClass = "";
    if (cap > 0 && used >= cap) barClass = "at-limit";
    else if (cap > 0 && used / cap >= 0.8) barClass = "near-limit";

    const row = document.createElement("div");
    row.className = "quota-row";
    row.innerHTML = `
      <span class="quota-label">${type}</span>
      <div class="quota-bar-bg">
        <div class="quota-bar-fill ${barClass}" style="width: ${pct}%"></div>
      </div>
      <span class="quota-count">${used}/${cap}</span>
    `;
    container.appendChild(row);
  }
}

function renderActionsToday(actionsToday) {
  const container = document.getElementById("actions-today");
  const entries = Object.entries(actionsToday);

  if (entries.length === 0) {
    container.innerHTML = '<span class="empty">No actions today</span>';
    return;
  }

  container.innerHTML = entries
    .map(([type, count]) => `<span class="action-chip">${type}: ${count}</span>`)
    .join("");
}

function renderFollowerChart(history) {
  const canvas = document.getElementById("follower-chart");
  const noData = document.getElementById("no-followers");

  if (history.length === 0) {
    canvas.classList.add("hidden");
    noData.classList.remove("hidden");
    if (followerChart) {
      followerChart.destroy();
      followerChart = null;
    }
    return;
  }

  canvas.classList.remove("hidden");
  noData.classList.add("hidden");

  const labels = history.map((h) => h.recorded_at.slice(0, 10));
  const counts = history.map((h) => h.count);

  if (followerChart) {
    followerChart.data.labels = labels;
    followerChart.data.datasets[0].data = counts;
    followerChart.update();
    return;
  }

  followerChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Followers",
        data: counts,
        borderColor: "#0a66c2",
        backgroundColor: "rgba(10, 102, 194, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#8b90a0", maxTicksLimit: 8 },
          grid: { color: "#2a2e3d" },
        },
        y: {
          ticks: { color: "#8b90a0" },
          grid: { color: "#2a2e3d" },
        },
      },
    },
  });
}

function renderTargets(targets) {
  const countsEl = document.getElementById("target-counts");
  const tbody = document.getElementById("targets-body");
  const noTargets = document.getElementById("no-targets");

  countsEl.innerHTML = Object.entries(targets.counts)
    .map(([status, count]) => `<span class="count-badge">${status}: <strong>${count}</strong></span>`)
    .join("");

  if (targets.pending.length === 0) {
    tbody.innerHTML = "";
    noTargets.classList.remove("hidden");
    return;
  }

  noTargets.classList.add("hidden");
  tbody.innerHTML = targets.pending
    .map((t) => `
      <tr>
        <td class="score-high">${t.relevance_score}</td>
        <td class="mono">${t.target_type}</td>
        <td>${truncate(t.author_name ?? "—", 30)}</td>
        <td class="preview" title="${t.content_preview ?? ""}">${truncate(t.content_preview, 50)}</td>
        <td class="mono">${relativeTime(t.discovered_at)}</td>
      </tr>
    `)
    .join("");
}

function renderPosts(posts) {
  const container = document.getElementById("posts-list");
  const noPosts = document.getElementById("no-posts");

  if (posts.length === 0) {
    container.innerHTML = "";
    noPosts.classList.remove("hidden");
    return;
  }

  noPosts.classList.add("hidden");
  container.innerHTML = posts
    .map((p) => `
      <div class="post-item">
        <div class="post-meta">${formatTime(p.published_at)}${p.pillar ? ` · ${p.pillar}` : ""}</div>
        <div class="post-content">${truncate(p.content, 300)}</div>
      </div>
    `)
    .join("");
}

function renderBackoffs(backoffs) {
  const panel = document.getElementById("backoff-panel");
  const container = document.getElementById("backoffs");

  if (backoffs.length === 0) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  container.innerHTML = backoffs
    .map((b) => `
      <div class="backoff-item">
        <strong>${b.action_type}</strong> blocked until ${formatTime(b.blocked_until)}
        — ${b.reason} (retries: ${b.retry_count})
      </div>
    `)
    .join("");
}

function renderRecentActions(actions) {
  const tbody = document.getElementById("actions-body");
  const noActions = document.getElementById("no-actions");

  if (actions.length === 0) {
    tbody.innerHTML = "";
    noActions.classList.remove("hidden");
    return;
  }

  noActions.classList.add("hidden");
  tbody.innerHTML = actions
    .map((a) => `
      <tr>
        <td class="mono">${relativeTime(a.created_at)}</td>
        <td class="mono">${a.action_type}</td>
        <td class="result-${a.result}">${a.result}</td>
        <td class="mono preview" title="${a.target_id}">${truncate(a.target_id, 24)}</td>
        <td class="preview" title="${a.content ?? ""}">${truncate(a.content, 60)}</td>
      </tr>
    `)
    .join("");
}

function render(data) {
  renderStatusCards(data);
  renderQuotas(data.quotas);
  renderActionsToday(data.actionsToday);
  renderFollowerChart(data.followerHistory);
  renderTargets(data.targets);
  renderPosts(data.posts);
  renderBackoffs(data.backoffs);
  renderRecentActions(data.recentActions);
}

async function fetchOverview() {
  const indicator = document.getElementById("refresh-indicator");
  indicator.classList.add("loading");

  try {
    const res = await fetch("/api/overview");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
    document.getElementById("last-updated").textContent =
      `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    document.getElementById("last-updated").textContent =
      `Error: ${err.message}`;
  } finally {
    indicator.classList.remove("loading");
  }
}

fetchOverview();
setInterval(fetchOverview, REFRESH_MS);
