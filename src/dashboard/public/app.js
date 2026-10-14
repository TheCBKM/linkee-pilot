const REFRESH_MS = 15_000;

let followerChart = null;
let lastSuccessAt = null;
let refreshTimer = null;
let hasLoadedOnce = false;

const ACTION_LABELS = {
  like_post: "Like post",
  like_comment: "Like comment",
  comment_post: "Comment",
  reply_comment: "Reply (own post)",
  send_invite: "Invite",
  withdraw_invite: "Withdraw invite",
  sync_connections: "Sync connections",
  view_profile: "Profile view",
  create_post: "Publish post",
  search: "Research",
  profile_audit: "Profile audit",
  discover_jobs: "Job discovery",
  send_dm: "DM",
  dm_followup: "DM follow-up",
};

const STAGE_LABELS = {
  discovered: "Discovered",
  liked: "Liked",
  commented: "Commented",
  viewed: "Viewed",
  invite_ready: "Invite ready",
  invited: "Invited",
  withdrawn: "Withdrawn",
  connected: "Connected",
  messaged: "Messaged",
  replied: "Replied",
};

const QUOTA_ORDER = [
  "search",
  "discover_jobs",
  "like_post",
  "comment_post",
  "reply_comment",
  "like_comment",
  "view_profile",
  "send_invite",
  "withdraw_invite",
  "send_dm",
  "dm_followup",
  "create_post",
  "profile_audit",
];

const OPPORTUNITY_ACTIONS = [
  { status: "shortlisted", label: "Shortlist" },
  { status: "applied", label: "Applied" },
  { status: "dismissed", label: "Dismiss" },
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

function setRefreshIndicator(state) {
  const indicator = document.getElementById("refresh-indicator");
  indicator.classList.remove("loading", "stale");
  if (state === "loading") indicator.classList.add("loading");
  if (state === "stale") indicator.classList.add("stale");
  indicator.setAttribute(
    "aria-label",
    state === "loading"
      ? "Refresh status: updating"
      : state === "stale"
        ? "Refresh status: stale"
        : "Refresh status: idle"
  );
}

function showError(message, isStale) {
  const banner = document.getElementById("error-banner");
  const staleText = document.getElementById("stale-banner-text");
  const main = document.getElementById("main-content");
  banner.classList.remove("hidden");
  document.getElementById("error-banner-text").textContent = message;
  if (isStale) {
    staleText.classList.remove("hidden");
    main.classList.add("main-stale");
  } else {
    staleText.classList.add("hidden");
    main.classList.remove("main-stale");
  }
  setRefreshIndicator("stale");
}

function clearError() {
  document.getElementById("error-banner").classList.add("hidden");
  document.getElementById("stale-banner-text").classList.add("hidden");
  document.getElementById("main-content").classList.remove("main-stale");
}

function renderStatusCards(data) {
  const { process, agent } = data;

  const processEl = document.getElementById("process-status");
  if (process.running) {
    processEl.innerHTML = `<span class="status-pill is-running">Running</span> <span class="card-sub">PID ${process.pid}</span>`;
    processEl.className = "card-value status-running";
  } else {
    processEl.innerHTML = `<span class="status-pill is-stopped">Stopped</span>`;
    processEl.className = "card-value status-stopped";
  }

  const statusEl = document.getElementById("agent-status");
  const status = agent.status ?? "unknown";
  let pillClass = "status-pill";
  if (agent.halted) pillClass += " is-halted";
  else if (status === "paused") pillClass += " is-paused";
  else if (process.running) pillClass += " is-running";
  else pillClass += " is-stopped";
  statusEl.innerHTML = `<span class="${pillClass}">${escapeHtml(status)}</span>`;
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

function renderNurtureStats(nurture) {
  if (!nurture) return;
  document.getElementById("stat-connections").textContent = String(nurture.connectionsTotal ?? 0);
  document.getElementById("stat-accepts-14d").textContent = String(nurture.accepted14d ?? 0);
  document.getElementById("stat-accepts-7d").textContent =
    `${nurture.accepted7d ?? 0} in last 7d · ${nurture.fromInvite ?? 0} from our invites`;
  document.getElementById("stat-nurture-pending").textContent = String(
    nurture.pendingNurturePosts ?? 0
  );
  document.getElementById("stat-nurture-likes").textContent = String(nurture.likesToday ?? 0);
  document.getElementById("stat-nurture-comments").textContent = String(
    nurture.commentsToday ?? 0
  );

  const syncMeta = document.getElementById("stat-sync-meta");
  const syncsToday = nurture.syncsToday ?? 0;
  const syncMax = nurture.syncMaxPerDay ?? 3;
  const backfill = nurture.backfillDone ? "backfill done" : "backfill pending";
  let nextLabel = "next unset";
  if (nurture.nextSyncAt) {
    const ts = Date.parse(nurture.nextSyncAt);
    if (!Number.isNaN(ts)) {
      if (ts <= Date.now()) {
        nextLabel = "next due now";
      } else {
        const mins = Math.round((ts - Date.now()) / 60000);
        nextLabel = mins >= 60 ? `next in ${Math.round(mins / 60)}h` : `next in ${Math.max(1, mins)}m`;
      }
    }
  }
  syncMeta.textContent = `${backfill} · ${syncsToday}/${syncMax} syncs today · ${nextLabel}`;
}

function renderRecentAccepts(accepts) {
  const tbody = document.getElementById("recent-accepts-body");
  const noData = document.getElementById("no-recent-accepts");

  if (!accepts || accepts.length === 0) {
    tbody.innerHTML = "";
    noData.classList.remove("hidden");
    return;
  }

  noData.classList.add("hidden");
  tbody.innerHTML = accepts
    .map((a) => `
      <tr>
        <td class="mono">${relativeTime(a.accepted_at)}</td>
        <td>${escapeHtml(truncate(a.full_name ?? a.provider_id ?? "—", 28))}</td>
        <td class="preview" title="${escapeHtml(a.headline ?? "")}">${escapeHtml(truncate(a.headline, 45))}</td>
        <td>${a.from_invite ? "yes" : "no"}</td>
      </tr>
    `)
    .join("");
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
  const threshold = icp.minRelevanceThreshold ?? 75;
  document.getElementById("icp-threshold-label").textContent = `Outreach ≥${threshold}`;
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
  const summaryBody = document.querySelector("#pipeline-summary tbody");
  const stages = sequenceStages ?? {};
  const entries = Object.entries(stages);
  const max = Math.max(1, ...entries.map(([, n]) => n));

  summaryBody.innerHTML = entries
    .map(([stage, count]) => `<tr><td>${escapeHtml(labelStage(stage))}</td><td>${count}</td></tr>`)
    .join("");

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

function renderInviteReady(people, total) {
  const tbody = document.getElementById("invite-ready-body");
  const noData = document.getElementById("no-invite-ready");
  const panel = document.getElementById("invite-ready-panel");
  const meta = document.getElementById("invite-ready-meta");

  const shown = people?.length ?? 0;
  const totalCount = total ?? shown;
  meta.textContent = totalCount > 0 ? `Showing ${shown} of ${totalCount}` : "";

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

function scoreClass(score) {
  if (score >= 85) return "score-high";
  if (score >= 70) return "score-mid";
  return "score-low";
}

function renderOpportunities(opps) {
  const data = opps ?? {};
  const items = data.items ?? [];

  document.getElementById("stat-opp-strong").textContent = data.strong ?? 0;
  document.getElementById("stat-opp-threshold").textContent =
    data.strongThreshold ? `score ≥ ${data.strongThreshold}` : "";
  document.getElementById("stat-opp-new").textContent = data.new7d ?? 0;
  document.getElementById("stat-opp-total").textContent = data.total ?? 0;
  document.getElementById("stat-opp-applied").textContent = data.applied ?? 0;
  document.getElementById("stat-opp-enabled").textContent =
    data.jobDiscoveryEnabled ? "On" : "Off";

  const list = document.getElementById("opportunities-list");
  const noData = document.getElementById("no-opportunities");

  if (items.length === 0) {
    list.innerHTML = "";
    noData.classList.remove("hidden");
    return;
  }
  noData.classList.add("hidden");

  list.innerHTML = items
    .map((o) => {
      const title = o.url
        ? `<a href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.title)}</a>`
        : escapeHtml(o.title);
      const meta = [o.company, o.location, o.job_type, o.role_family]
        .filter(Boolean)
        .map((v) => escapeHtml(String(v)))
        .join(" · ");
      const reasons = (o.match_reasons ?? [])
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("");
      const gaps = (o.match_gaps ?? [])
        .map((g) => `<li>${escapeHtml(g)}</li>`)
        .join("");
      const buttons = OPPORTUNITY_ACTIONS.filter((a) => a.status !== o.status)
        .map(
          (a) =>
            `<button type="button" class="btn btn-sm" data-opp-id="${o.id}" data-opp-status="${a.status}">${a.label}</button>`
        )
        .join("");

      return `
        <article class="post-item opportunity-item">
          <div class="opportunity-head">
            <span class="opportunity-score ${scoreClass(o.match_score)}">${o.match_score}</span>
            <div>
              <h3 class="opportunity-title">${title}</h3>
              <p class="opportunity-meta">${meta || "—"}</p>
            </div>
            <span class="source-badge">${escapeHtml(o.status)}</span>
          </div>
          ${reasons ? `<p class="opportunity-label">Fit</p><ul class="opportunity-list">${reasons}</ul>` : ""}
          ${gaps ? `<p class="opportunity-label">Gaps</p><ul class="opportunity-list opportunity-gaps">${gaps}</ul>` : ""}
          ${o.pitch ? `<p class="opportunity-pitch">${escapeHtml(o.pitch)}</p>` : ""}
          <div class="opportunity-actions">
            ${buttons}
            <span class="opportunity-date">${relativeTime(o.discovered_at)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDms(dms) {
  const data = dms ?? {};

  document.getElementById("stat-dm-pending").textContent =
    data.pendingApproval ?? 0;
  document.getElementById("stat-dm-sent").textContent = data.sentTotal ?? 0;
  document.getElementById("stat-dm-replied").textContent =
    data.repliedTotal ?? 0;
  document.getElementById("stat-dm-enabled").textContent = data.dmEnabled
    ? "On"
    : "Off";

  const pending = data.pending ?? [];
  const list = document.getElementById("dm-pending-list");
  const noPending = document.getElementById("no-dm-pending");
  const panel = document.getElementById("dm-approvals-panel");

  if (pending.length === 0) {
    list.innerHTML = "";
    noPending.classList.remove("hidden");
    panel.classList.remove("panel-active");
  } else {
    noPending.classList.add("hidden");
    panel.classList.add("panel-active");
    list.innerHTML = pending
      .map(
        (d) => `
        <article class="post-item dm-item" data-dm-row="${d.id}">
          <div class="dm-head">
            <div>
              <h3 class="dm-name">${escapeHtml(d.full_name ?? d.provider_id)}</h3>
              <p class="dm-headline">${escapeHtml(d.headline ?? "—")}</p>
            </div>
            <span class="source-badge">${escapeHtml(d.kind)}</span>
          </div>
          <label class="sr-only" for="dm-text-${d.id}">Draft message</label>
          <textarea class="dm-draft" id="dm-text-${d.id}" rows="4">${escapeHtml(d.draft_text)}</textarea>
          <div class="dm-actions">
            <button type="button" class="btn btn-primary btn-sm" data-dm-id="${d.id}" data-dm-action="approve">Approve and send</button>
            <button type="button" class="btn btn-sm" data-dm-id="${d.id}" data-dm-action="reject">Reject</button>
            <span class="dm-date">queued ${relativeTime(d.created_at)}</span>
          </div>
        </article>
      `
      )
      .join("");
  }

  const history = data.recent ?? [];
  const tbody = document.getElementById("dm-history-body");
  const noHistory = document.getElementById("no-dm-history");

  if (history.length === 0) {
    tbody.innerHTML = "";
    noHistory.classList.remove("hidden");
    return;
  }
  noHistory.classList.add("hidden");
  tbody.innerHTML = history
    .map(
      (d) => `
      <tr>
        <td>${relativeTime(d.sent_at ?? d.created_at)}</td>
        <td>${escapeHtml(truncate(d.full_name ?? "—", 24))}</td>
        <td>${escapeHtml(d.kind)}</td>
        <td><span class="result-badge result-${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></td>
        <td class="preview" title="${escapeHtml(d.draft_text)}">${escapeHtml(truncate(d.draft_text, 70))}</td>
      </tr>
    `
    )
    .join("");
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function setupActionHandlers() {
  document.addEventListener("click", async (event) => {
    const dmButton = event.target.closest("[data-dm-action]");
    if (dmButton) {
      const id = dmButton.dataset.dmId;
      const action = dmButton.dataset.dmAction;
      const textarea = document.getElementById(`dm-text-${id}`);

      if (action === "reject" && !confirm("Reject this draft?")) return;

      dmButton.disabled = true;
      try {
        await postJson(
          `/api/dm/${id}/${action}`,
          action === "approve" && textarea ? { text: textarea.value } : {}
        );
        await fetchOverview();
      } catch (err) {
        dmButton.disabled = false;
        showError(`DM ${action} failed: ${err.message}`, true);
      }
      return;
    }

    const oppButton = event.target.closest("[data-opp-status]");
    if (oppButton) {
      oppButton.disabled = true;
      try {
        await postJson(`/api/opportunity/${oppButton.dataset.oppId}/status`, {
          status: oppButton.dataset.oppStatus,
        });
        await fetchOverview();
      } catch (err) {
        oppButton.disabled = false;
        showError(`Update failed: ${err.message}`, true);
      }
    }
  });
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
      <div class="quota-bar-bg" role="progressbar" aria-valuemin="0" aria-valuemax="${cap}" aria-valuenow="${used}" aria-label="${labelAction(type)} quota">
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

  if (!history || history.length === 0) {
    canvas.classList.add("hidden");
    noData.classList.remove("hidden");
    canvas.setAttribute("aria-label", "Follower count over time: no data");
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
  const latest = counts[counts.length - 1];
  const first = counts[0];
  const delta = latest - first;
  const trend = delta === 0 ? "flat" : delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`;
  canvas.setAttribute(
    "aria-label",
    `Follower count over time. Latest ${latest}, trend ${trend} across ${counts.length} points.`
  );

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
        backgroundColor: "rgba(10, 102, 194, 0.12)",
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
          ticks: { color: "#5b6775", maxTicksLimit: 8 },
          grid: { color: "#e4ebf3" },
        },
        y: {
          ticks: { color: "#5b6775" },
          grid: { color: "#e4ebf3" },
        },
      },
    },
  });
}

function renderTargets(targets, pendingTotal) {
  const countsEl = document.getElementById("target-counts");
  const tbody = document.getElementById("targets-body");
  const noTargets = document.getElementById("no-targets");
  const meta = document.getElementById("targets-meta");

  countsEl.innerHTML = Object.entries(targets.counts ?? {})
    .map(([status, count]) => `<span class="count-badge">${status}: <strong>${count}</strong></span>`)
    .join("");

  const shown = targets.pending?.length ?? 0;
  const total = pendingTotal ?? shown;
  meta.textContent = total > 0 ? `Showing ${shown} of ${total} pending` : "";

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

function resultBadge(result) {
  return `<span class="result-badge result-${escapeHtml(result)}">${escapeHtml(result)}</span>`;
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
        <td>${resultBadge(a.result)}</td>
        <td class="mono">${a.result === "failed" ? escapeHtml(a.error_type ?? "—") : "—"}</td>
        <td class="mono preview" title="${escapeHtml(a.target_id)}">${escapeHtml(truncate(a.target_id, 24))}</td>
        <td class="preview" title="${escapeHtml(a.content ?? "")}">${escapeHtml(truncate(a.content, 60))}</td>
      </tr>
    `)
    .join("");
}

function render(data) {
  renderStatusCards(data);
  renderOpportunities(data.opportunities);
  renderDms(data.dms);
  renderOutreachStats(data.outreach);
  renderNurtureStats(data.nurture);
  renderRecentAccepts(data.nurture?.recentAccepts);
  renderPostHealth(data.postHealth);
  renderIcpQuality(data.icpQuality);
  renderPipelineFunnel(data.targets?.sequenceStages);
  renderInviteReady(data.inviteReadyPeople, data.inviteReadyTotal);
  renderQuotas(data.quotas);
  renderActionsToday(data.actionsToday);
  renderFollowerChart(data.followerHistory);
  renderTargets(data.targets, data.pendingTargetsTotal);
  renderPosts(data.posts);
  renderBackoffs(data.backoffs);
  renderRecentActions(data.recentActions);
}

async function fetchOverview() {
  setRefreshIndicator("loading");

  try {
    const res = await fetch("/api/overview");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    render(data);
    hasLoadedOnce = true;
    lastSuccessAt = new Date();
    clearError();
    setRefreshIndicator("idle");
    document.getElementById("last-updated").textContent =
      `Updated ${lastSuccessAt.toLocaleTimeString()}`;
  } catch (err) {
    const msg = err.message || "Unknown error";
    if (hasLoadedOnce && lastSuccessAt) {
      showError(msg, true);
      document.getElementById("last-updated").textContent =
        `Update failed · last success ${lastSuccessAt.toLocaleTimeString()}`;
    } else {
      showError(msg, false);
      document.getElementById("last-updated").textContent = `Error: ${msg}`;
      setRefreshIndicator("stale");
    }
  }
}

function startPolling() {
  stopPolling();
  refreshTimer = setInterval(() => {
    if (!document.hidden) fetchOverview();
  }, REFRESH_MS);
}

function stopPolling() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function setupSectionNav() {
  const links = Array.from(document.querySelectorAll(".section-nav a"));
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (!("IntersectionObserver" in window) || sections.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const id = `#${visible.target.id}`;
      links.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === id);
      });
    },
    { rootMargin: "-20% 0px -60% 0px", threshold: [0.1, 0.4, 0.7] }
  );

  sections.forEach((section) => observer.observe(section));
}

document.getElementById("refresh-btn").addEventListener("click", () => fetchOverview());
document.getElementById("retry-btn").addEventListener("click", () => fetchOverview());

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) fetchOverview();
});

setupSectionNav();
setupActionHandlers();
fetchOverview();
startPolling();
