const REFRESH_MS = 15_000;

let followerChart = null;

const ACTION_LABELS = {
  like_post: "Like post",
  like_comment: "Like comment",
  comment_post: "Comment",
  send_invite: "Invite",
  view_profile: "Profile view",
  create_post: "Publish post",
  search: "Research",
  profile_audit: "Profile audit",
};

const STAGE_LABELS = {
  discovered: "Discovered",
  liked: "Liked",
  commented: "Commented",
  viewed: "Viewed",
  invite_ready: "Invite ready",
  invited: "Invited",
};

const QUOTA_ORDER = [
  "search",
  "like_post",
  "comment_post",
  "like_comment",
  "view_profile",
  "send_invite",
  "create_post",
  "profile_audit",
];

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

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labelAction(type) {
  return ACTION_LABELS[type] ?? type;
}

function labelStage(stage) {
  return STAGE_LABELS[stage] ?? stage ?? "—";
}

function stageClass(stage) {
  if (!stage) return "stage-default";
  return `stage-${stage.replace(/_/g, "-")}`;
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
  document.getElementById("last-action").textContent = agent.lastAction
    ? (labelAction(agent.lastAction) ?? agent.lastAction)
    : "none";

  const haltBanner = document.getElementById("halt-banner");
  if (agent.halted) {
    haltBanner.classList.remove("hidden");
    document.getElementById("halt-reason").textContent = agent.haltReason ?? "Unknown reason";
  } else {
    haltBanner.classList.add("hidden");
  }
}

function renderOutreachStats(outreach) {
  if (!outreach) return;
  document.getElementById("stat-invite-ready").textContent = String(outreach.inviteReady);
  document.getElementById("stat-invited").textContent = String(outreach.invitedTotal);
  document.getElementById("stat-people").textContent = String(outreach.peopleTotal);
  document.getElementById("stat-posts").textContent = String(outreach.postTargets);
  document.getElementById("stat-reposts").textContent = String(outreach.repostsPublished);
}

function renderPostHealth(ph) {
  if (!ph) return;
  document.getElementById("ph-posts-week").textContent = String(ph.postsThisWeek);
  document.getElementById("ph-expected").textContent =
    `${ph.postsThisWeek} / ${ph.expectedThisWeek} expected so far · ${ph.weeklyTarget}/week target`;
  document.getElementById("ph-format-split").textContent =
    `${ph.originalsThisWeek} / ${ph.repostsThisWeek}`;
  document.getElementById("ph-last-publish").textContent = ph.lastPublishedAt
    ? `${relativeTime(ph.lastPublishedAt)}${ph.lastFormat === "repost" ? " (repost)" : ""}`
    : "never";
  const boostEl = document.getElementById("ph-boost");
  if (ph.boostActive && ph.boostUntil) {
    const msLeft = new Date(ph.boostUntil).getTime() - Date.now();
    const min = Math.max(1, Math.round(msLeft / 60000));
    boostEl.textContent = `Active · ${min}m left`;
    boostEl.className = "card-value card-value-sm status-running";
  } else {
    boostEl.textContent = "Idle";
    boostEl.className = "card-value card-value-sm";
  }
}

function renderIcpQuality(icp) {
  if (!icp) return;
  document.getElementById("icp-hit-rate").textContent =
    icp.hitRatePct == null ? "—" : `${icp.hitRatePct}%`;
  document.getElementById("icp-pass-filter").textContent =
    `${icp.passed7d} passed · ${icp.filtered7d} filtered`;
  document.getElementById("icp-avg-score").textContent =
    icp.outreachAvgScore == null ? "—" : String(icp.outreachAvgScore);
  document.getElementById("icp-sample").textContent =
    icp.outreachSampleSize
      ? `n=${icp.outreachSampleSize} comments + invites (7d)`
      : "no outreach in last 7d";
  document.getElementById("icp-pct-70").textContent =
    icp.outreachPctAbove70 == null ? "—" : `${icp.outreachPctAbove70}%`;
}

function renderPipelineFunnel(sequenceStages) {
  const container = document.getElementById("pipeline-funnel");
  const stages = sequenceStages ?? {};
  const entries = Object.entries(stages);
  const max = Math.max(1, ...entries.map(([, n]) => n));

  if (entries.every(([, n]) => n === 0)) {
    container.innerHTML = '<p class="empty">No people in pipeline yet — research will populate targets</p>';
    return;
  }

  container.innerHTML = entries
    .map(([stage, count]) => {
      const pct = Math.max(8, (count / max) * 100);
      return `
        <div class="pipeline-step">
          <div class="pipeline-bar-wrap">
            <div class="pipeline-bar ${stageClass(stage)}" style="height: ${pct}%"></div>
          </div>
          <span class="pipeline-count">${count}</span>
          <span class="pipeline-label">${labelStage(stage)}</span>
        </div>
      `;
    })
    .join("");
}

function renderInviteReady(people) {
  const tbody = document.getElementById("invite-ready-body");
  const noData = document.getElementById("no-invite-ready");
  const panel = document.getElementById("invite-ready-panel");

  if (!people || people.length === 0) {
    tbody.innerHTML = "";
    noData.classList.remove("hidden");
    panel.classList.remove("panel-active");
    return;
  }

  noData.classList.add("hidden");
  panel.classList.add("panel-active");
  tbody.innerHTML = people
    .map((p) => `
      <tr>
        <td class="score-high">${p.relevance_score}</td>
        <td>${escapeHtml(truncate(p.author_name ?? "—", 28))}</td>
        <td class="preview" title="${escapeHtml(p.author_headline ?? "")}">${escapeHtml(truncate(p.author_headline, 45))}</td>
        <td><span class="source-badge">${escapeHtml(p.person_source ?? "—")}</span></td>
      </tr>
    `)
    .join("");
}

function renderQuotas(quotas) {
  const container = document.getElementById("quotas");
  container.innerHTML = "";

  const ordered = [
    ...QUOTA_ORDER.filter((k) => k in quotas),
    ...Object.keys(quotas).filter((k) => !QUOTA_ORDER.includes(k)),
  ];

  for (const type of ordered) {
    const { used, cap } = quotas[type];
    const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
    let barClass = "";
    if (cap > 0 && used >= cap) barClass = "at-limit";
    else if (cap > 0 && used / cap >= 0.8) barClass = "near-limit";

    const row = document.createElement("div");
    row.className = "quota-row";
    row.innerHTML = `
      <span class="quota-label" title="${type}">${labelAction(type)}</span>
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
  const entries = Object.entries(actionsToday ?? {});

  if (entries.length === 0) {
    container.innerHTML = '<span class="empty">No actions today</span>';
    return;
  }

  const sorted = entries.sort(([a], [b]) => {
    const ia = QUOTA_ORDER.indexOf(a);
    const ib = QUOTA_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  container.innerHTML = sorted
    .map(([type, count]) => `<span class="action-chip">${labelAction(type)}: <strong>${count}</strong></span>`)
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

  countsEl.innerHTML = Object.entries(targets.counts ?? {})
    .map(([status, count]) => `<span class="count-badge">${status}: <strong>${count}</strong></span>`)
    .join("");

  if (!targets.pending || targets.pending.length === 0) {
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
        <td><span class="stage-badge ${stageClass(t.sequence_stage)}">${labelStage(t.sequence_stage)}</span></td>
        <td>${escapeHtml(truncate(t.author_name ?? "—", 30))}</td>
        <td class="preview" title="${escapeHtml(t.content_preview ?? "")}">${escapeHtml(truncate(t.content_preview, 50))}</td>
        <td class="mono">${relativeTime(t.discovered_at)}</td>
      </tr>
    `)
    .join("");
}

function renderPosts(posts) {
  const container = document.getElementById("posts-list");
  const noPosts = document.getElementById("no-posts");

  if (!posts || posts.length === 0) {
    container.innerHTML = "";
    noPosts.classList.remove("hidden");
    return;
  }

  noPosts.classList.add("hidden");
  container.innerHTML = posts
    .map((p) => {
      const formatBadge = p.format === "repost"
        ? '<span class="format-badge format-repost">repost</span>'
        : '<span class="format-badge format-text">text</span>';
      return `
        <div class="post-item">
          <div class="post-meta">
            ${formatTime(p.published_at)}
            ${formatBadge}
            ${p.pillar ? `<span class="pillar-tag">${escapeHtml(p.pillar)}</span>` : ""}
          </div>
          <div class="post-content">${escapeHtml(truncate(p.content, 300))}</div>
        </div>
      `;
    })
    .join("");
}

function renderBackoffs(backoffs) {
  const panel = document.getElementById("backoff-panel");
  const container = document.getElementById("backoffs");

  if (!backoffs || backoffs.length === 0) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  container.innerHTML = backoffs
    .map((b) => `
      <div class="backoff-item">
        <strong>${labelAction(b.action_type)}</strong> blocked until ${formatTime(b.blocked_until)}
        — ${escapeHtml(b.reason)} (retries: ${b.retry_count})
      </div>
    `)
    .join("");
}

function renderRecentActions(actions) {
  const tbody = document.getElementById("actions-body");
  const noActions = document.getElementById("no-actions");

  if (!actions || actions.length === 0) {
    tbody.innerHTML = "";
    noActions.classList.remove("hidden");
    return;
  }

  noActions.classList.add("hidden");
  tbody.innerHTML = actions
    .map((a) => `
      <tr>
        <td class="mono">${relativeTime(a.created_at)}</td>
        <td class="mono">${labelAction(a.action_type)}</td>
        <td class="result-${a.result}">${a.result}</td>
        <td class="mono preview" title="${escapeHtml(a.target_id)}">${escapeHtml(truncate(a.target_id, 24))}</td>
        <td class="preview" title="${escapeHtml(a.content ?? "")}">${escapeHtml(truncate(a.content, 60))}</td>
      </tr>
    `)
    .join("");
}

function render(data) {
  renderStatusCards(data);
  renderOutreachStats(data.outreach);
  renderPostHealth(data.postHealth);
  renderIcpQuality(data.icpQuality);
  renderPipelineFunnel(data.targets?.sequenceStages);
  renderInviteReady(data.inviteReadyPeople);
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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
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
