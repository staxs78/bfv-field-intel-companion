(function () {
  "use strict";

  const D = BFV_DATA;
  const $ = (id) => document.getElementById(id);
  const nowIso = () => new Date().toISOString();
  const localNow = () => new Date().toISOString().slice(0, 16);
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const num = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };
  const text = (value) => String(value || "").trim();
  const encode = (value) => encodeURIComponent(text(value));

  let state = loadState();
  let currentLinks = [];
  let lastLookupStats = null;
  let lastLookupWarnings = [];
  let selectedPlayerId = "";
  let selectedEvidenceId = "";
  let selectedServerId = "";
  let hasPlayerDraft = false;
  let toastTimer = null;

  const sourceAdapters = {
    statbits: {
      name: "Statbits BFV stats fetch",
      status: "not tested",
      buildUrl(player, platform, playerId) {
        const identifier = playerId ? `${encode(playerId)}:${encode(player)}` : encode(player);
        return D.sourceTemplates.statbits
          .replace("{platform}", encode(platform || "pc"))
          .replace("{identifier}", identifier);
      },
      async fetchStats(player, platform, playerId) {
        this.status = "available";
        renderSourcePanels();
        const url = this.buildUrl(player, platform, playerId);
        try {
          const response = await fetch(url, { method: "GET", cache: "no-store" });
          const raw = await response.text();
          if (!response.ok) {
            this.status = "failed";
            throw new Error(raw || `HTTP ${response.status}`);
          }
          const parsed = this.parseResponse(raw);
          if (!parsed || parsed.error) {
            this.status = "failed";
            throw new Error(parsed ? parsed.error : D.disclaimers.fetch);
          }
          this.status = "available";
          return { raw, parsed, url };
        } catch (error) {
          this.status = error instanceof TypeError ? "blocked" : "failed";
          throw error;
        } finally {
          renderSourcePanels();
          save();
        }
      },
      parseResponse(raw) {
        const value = text(raw);
        if (!value || /failed|blocked|error|not found|invalid/i.test(value)) {
          return { error: value || D.disclaimers.fetch };
        }
        const parsed = {};
        const hours = value.match(/(\d+(?:\.\d+)?)h(?:\s+(\d+)m)?/i);
        const kd = value.match(/([\d.]+)\s*K\/D/i);
        const spm = value.match(/([\d.]+)\s*SPM/i);
        const kpm = value.match(/([\d.]+)\s*KPM/i);
        const accuracy = value.match(/([\d.]+)%\s*accuracy/i);
        const hs = value.match(/([\d.]+)%\s*headshots/i);
        if (hours) parsed.hoursPlayed = (parseFloat(hours[1]) + (parseFloat(hours[2] || "0") / 60)).toFixed(1);
        if (kd) parsed.kd = kd[1];
        if (spm) parsed.spm = spm[1];
        if (kpm) parsed.kpm = kpm[1];
        if (accuracy) parsed.accuracy = accuracy[1];
        if (hs) parsed.headshot = hs[1];
        if (!Object.keys(parsed).length) {
          return { error: "Malformed or unsupported Statbits response. Paste stats manually." };
        }
        return parsed;
      }
    },
    bfvhackers: {
      name: "BFVHackers",
      mode: "link-manual",
      buildLink(player) {
        return D.sourceTemplates.bfvhackers.replace("{player}", encode(player));
      }
    },
    gametools: {
      name: "GameTools",
      mode: "link-manual",
      buildLink(player, platform) {
        return D.sourceTemplates.gametools
          .replace("{platform}", encode(platform || "pc"))
          .replace("{player}", encode(player));
      }
    },
    tracker: {
      name: "Battlefield Tracker",
      mode: "link-manual",
      buildLink(player) {
        return D.sourceTemplates.tracker.replace("{player}", encode(player));
      }
    },
    bfban: {
      name: "BFBan",
      mode: "link-manual",
      buildLink(player) {
        return D.sourceTemplates.bfban.replace("{player}", encode(player));
      }
    },
    eaReport: {
      name: "EA report/help",
      mode: "link-only",
      buildLink() {
        return D.sourceTemplates.eaReport;
      }
    }
  };

  window.sourceAdapters = sourceAdapters;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(D.storageKey) || "{}");
      return {
        players: Array.isArray(saved.players) ? saved.players : [],
        serverChecks: Array.isArray(saved.serverChecks) ? saved.serverChecks : [],
        evidence: Array.isArray(saved.evidence) ? saved.evidence : [],
        sourceStatus: saved.sourceStatus || {},
        settings: {
          apiBaseUrl: text(saved.settings && saved.settings.apiBaseUrl)
        },
        lastBackupAt: saved.lastBackupAt || ""
      };
    } catch {
      return { players: [], serverChecks: [], evidence: [], sourceStatus: {}, settings: { apiBaseUrl: "" }, lastBackupAt: "" };
    }
  }

  function save() {
    state.sourceStatus = Object.fromEntries(
      Object.entries(sourceAdapters)
        .filter(([, adapter]) => adapter.status)
        .map(([key, adapter]) => [key, adapter.status])
    );
    localStorage.setItem(D.storageKey, JSON.stringify(state));
  }

  function init() {
    Object.entries(state.sourceStatus || {}).forEach(([key, status]) => {
      if (sourceAdapters[key]) sourceAdapters[key].status = status;
    });
    $("globalDisclaimer").textContent = D.disclaimers.primary;
    state.settings = state.settings || { apiBaseUrl: "" };
    populateSelects();
    bindEvents();
    setDefaults();
    renderAll();
  }

  function populateSelects() {
    const platformOptions = D.supportedPlatforms.map((p) => `<option value="${p.value}">${p.label}</option>`).join("");
    ["quickPlatform", "lookupPlatform", "playerPlatform"].forEach((id) => ($(id).innerHTML = platformOptions));
    const mapOptions = `<option value="">Unknown / not listed</option>${D.maps.map((m) => `<option>${m}</option>`).join("")}`;
    ["lookupMap", "playerMap", "serverMap", "evidenceMap"].forEach((id) => ($(id).innerHTML = mapOptions));
    const reportOptions = D.reportStatuses.map((s) => `<option>${s}</option>`).join("");
    ["playerReportStatus", "evidenceReportStatus", "evidenceFilterStatus"].forEach((id) => {
      const prefix = id === "evidenceFilterStatus" ? '<option value="">All report statuses</option>' : "";
      $(id).innerHTML = prefix + reportOptions;
    });
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => showTab(button.dataset.tab));
    });
    $("quickLookup").addEventListener("click", quickLookup);
    $("generateLinks").addEventListener("click", handleGenerateLinks);
    $("tryFetch").addEventListener("click", handleLiveFetch);
    $("addFromLookup").addEventListener("click", addFromLookup);
    $("copyLinks").addEventListener("click", () => copyText(formatLinks(currentLinks), "Source links copied."));
    $("clearLookup").addEventListener("click", clearLookup);
    $("dashQuickExport").addEventListener("click", exportData);
    $("newPlayer").addEventListener("click", () => loadPlayerForm(null));
    $("playerForm").addEventListener("submit", savePlayer);
    $("duplicatePlayer").addEventListener("click", duplicatePlayer);
    $("deletePlayer").addEventListener("click", deletePlayer);
    $("copyPlayerSummary").addEventListener("click", copyPlayerSummary);
    $("serverForm").addEventListener("submit", saveServerCheck);
    $("copyServerSummary").addEventListener("click", copyServerSummary);
    $("clearServerForm").addEventListener("click", () => loadServerForm(null));
    $("evidenceForm").addEventListener("submit", saveEvidence);
    $("deleteEvidence").addEventListener("click", deleteEvidence);
    $("copyEvidenceSummary").addEventListener("click", copyEvidenceSummary);
    $("clearEvidenceForm").addEventListener("click", () => loadEvidenceForm(null));
    $("evidenceFilterPlayer").addEventListener("change", renderEvidenceList);
    $("evidenceFilterStatus").addEventListener("change", renderEvidenceList);
    $("generateReport").addEventListener("click", generateReport);
    $("copyReport").addEventListener("click", () => copyText($("reportOutput").textContent, "Report text copied."));
    $("exportJson").addEventListener("click", exportData);
    $("importJson").addEventListener("click", importData);
    $("copyCurrentReport").addEventListener("click", copyPlayerSummary);
    $("copyCurrentLinks").addEventListener("click", () => copyText(formatLinks(currentLinks), "Source links copied."));
    $("clearAllData").addEventListener("click", clearAllData);
    $("manualPaste").addEventListener("input", handleManualPaste);
    $("parsePastedStats").addEventListener("click", handleParsePastedStats);
    $("saveApiBaseUrl").addEventListener("click", saveApiBaseUrl);
    $("testApiBaseUrl").addEventListener("click", testApiBaseUrl);
    $("clearApiBaseUrl").addEventListener("click", clearApiBaseUrl);
  }

  function setDefaults() {
    $("serverDateTime").value = localNow();
    $("evidenceDateTime").value = localNow();
    $("reportOutput").textContent = D.reportTemplate;
    $("apiBaseUrl").value = state.settings.apiBaseUrl || "";
    renderApiStatus();
  }

  function showTab(id) {
    document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
    if (id === "players" && state.players.length && !selectedPlayerId && !hasPlayerDraft) loadPlayerForm(state.players[0].id);
  }

  function renderAll() {
    renderDashboard();
    renderSourcePanels();
    renderPlayers();
    renderServerLists();
    renderEvidenceFilters();
    renderEvidenceList();
    renderStorageSummary();
    renderApiStatus();
    if (selectedPlayerId) renderPlayerSidebars(getPlayer(selectedPlayerId));
  }

  function renderDashboard() {
    const counts = { Watch: 0, Suspicious: 0, "Very Suspicious": 0, "Report-worthy evidence": 0 };
    state.players.forEach((player) => {
      const label = scorePlayer(player).label;
      if (counts[label] !== undefined) counts[label] += 1;
    });
    $("dashboardStats").innerHTML = [
      statCard("Watched players", state.players.length),
      statCard("Watch", counts.Watch),
      statCard("Suspicious", counts.Suspicious),
      statCard("Very Suspicious", counts["Very Suspicious"]),
      statCard("Report-worthy evidence", counts["Report-worthy evidence"])
    ].join("");
    $("dashboardSourceStatus").innerHTML = sourceStatusLines();
    $("recentServers").innerHTML = recentItems(state.serverChecks, (item) => `${item.serverName || "Unknown server"} · ${item.map || "Unknown map"} · ${prettyDate(item.dateTime || item.createdAt)}`);
    $("recentEvidence").innerHTML = recentItems(state.evidence, (item) => `${item.player || "Unknown player"} · ${item.reportStatus} · ${prettyDate(item.dateTime || item.createdAt)}`);
    $("backupReminder").textContent = state.lastBackupAt
      ? `Last export reminder: ${prettyDate(state.lastBackupAt)}. Keep a JSON backup if this matters.`
      : "No export recorded yet. Export JSON periodically because this app stores data only in this browser.";
  }

  function statCard(label, value) {
    return `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
  }

  function recentItems(items, formatter) {
    if (!items.length) return '<p class="subtle">No entries yet.</p>';
    return items
      .slice()
      .sort((a, b) => String(b.createdAt || b.dateTime).localeCompare(String(a.createdAt || a.dateTime)))
      .slice(0, 5)
      .map((item) => `<div class="compact-item">${escapeHtml(formatter(item))}</div>`)
      .join("");
  }

  function sourceStatusLines() {
    return Object.entries(sourceAdapters)
      .map(([key, adapter]) => {
        const status = adapter.mode || adapter.status || "not tested";
        return `<div class="status-line"><strong>${escapeHtml(adapter.name)}</strong><br><span class="subtle">${escapeHtml(status)}</span></div>`;
      })
      .join("");
  }

  function renderSourcePanels() {
    const html = Object.entries(sourceAdapters)
      .map(([key, adapter]) => {
        const status = adapter.mode || adapter.status || "not tested";
        const detail = key === "statbits"
          ? "One manual browser fetch per click from the documented public Statbits BFV chat-message endpoint."
          : "Manual link only. Open the source and paste public notes or stats yourself.";
        return `<article class="adapter-card">
          <h4>${escapeHtml(adapter.name)}</h4>
          <span class="badge neutral">${escapeHtml(status)}</span>
          <p class="subtle">${escapeHtml(detail)}</p>
        </article>`;
      })
      .join("");
    if ($("sourcePanel")) $("sourcePanel").innerHTML = html;
    if ($("dashboardSourceStatus")) $("dashboardSourceStatus").innerHTML = sourceStatusLines();
  }

  function quickLookup() {
    const player = $("quickPlayer").value;
    const platform = $("quickPlatform").value;
    currentLinks = buildSourceLinks(player, platform);
    $("quickLinks").innerHTML = renderLinks(currentLinks);
    showTab("lookup");
    $("lookupName").value = player;
    $("lookupPlatform").value = platform;
    $("lookupLinks").innerHTML = renderLinks(currentLinks);
  }

  function handleGenerateLinks() {
    lastLookupStats = null;
    currentLinks = buildSourceLinks($("lookupName").value, $("lookupPlatform").value, $("lookupPlayerId").value);
    $("lookupLinks").innerHTML = renderLinks(currentLinks);
    toast("Source links generated.");
  }

  function buildSourceLinks(player, platform, playerId) {
    const name = text(player);
    if (!name) return [];
    return [
      { label: "Statbits BFV stats source", url: sourceAdapters.statbits.buildUrl(name, platform, playerId) },
      { label: "Statbits BFV docs", url: D.sourceTemplates.statbitsReadable },
      { label: "GameTools public search/template", url: sourceAdapters.gametools.buildLink(name, platform) },
      { label: "BFVHackers search/check", url: sourceAdapters.bfvhackers.buildLink(name) },
      { label: "Battlefield Tracker search/profile", url: sourceAdapters.tracker.buildLink(name) },
      { label: "BFBan search/status", url: sourceAdapters.bfban.buildLink(name) },
      { label: "EA report/help", url: sourceAdapters.eaReport.buildLink() }
    ];
  }

  function renderLinks(links) {
    if (!links.length) return '<p class="subtle">Enter a player name first.</p>';
    return links
      .map((link) => `<a class="source-link" href="${escapeAttr(link.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(link.label)}</span><small>open</small></a>`)
      .join("");
  }

  function formatLinks(links) {
    return (links || []).map((link) => `${link.label}: ${link.url}`).join("\n");
  }

  async function handleStatbitsFetch() {
    const player = text($("lookupName").value);
    if (!player) {
      toast("Enter a player name first.");
      return;
    }
    currentLinks = buildSourceLinks(player, $("lookupPlatform").value, $("lookupPlayerId").value);
    $("lookupLinks").innerHTML = renderLinks(currentLinks);
    $("fetchResult").textContent = "Trying Statbits fetch...";
    try {
      const result = await sourceAdapters.statbits.fetchStats(player, $("lookupPlatform").value, $("lookupPlayerId").value);
      lastLookupStats = result.parsed;
      applyParsedStatsToLookup(result.parsed);
      $("fetchResult").textContent = `${result.raw}\n\nParsed fields:\n${JSON.stringify(result.parsed, null, 2)}`;
      toast("Statbits response parsed. Review before saving.");
    } catch (error) {
      $("fetchResult").textContent = `${D.disclaimers.fetch}\n\nReason: ${error.message || error}`;
      toast(D.disclaimers.fetch);
    }
  }

  async function handleLiveFetch() {
    const apiBaseUrl = normalizeApiBaseUrl(state.settings && state.settings.apiBaseUrl);
    if (!apiBaseUrl) {
      await handleStatbitsFetch();
      return;
    }

    const player = text($("lookupName").value);
    if (!player) {
      toast("Enter a player name first.");
      return;
    }

    const platform = $("lookupPlatform").value;
    currentLinks = buildSourceLinks(player, platform, $("lookupPlayerId").value);
    $("lookupLinks").innerHTML = renderLinks(currentLinks);
    $("fetchResult").textContent = "Trying live Worker fetch...";

    try {
      const response = await fetch(buildWorkerUrl(apiBaseUrl, player, platform), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      if (!payload) throw new Error("Worker returned malformed JSON.");
      if (!response.ok || !payload.ok) {
        const fallbackLinks = Array.isArray(payload.links) ? payload.links : currentLinks;
        currentLinks = fallbackLinks.length ? fallbackLinks : currentLinks;
        $("lookupLinks").innerHTML = renderLinks(currentLinks);
        $("fetchResult").textContent = `${payload.error || D.disclaimers.workerFetch}

${payload.fallback || "Open public source link and paste stats manually."}

Could be wrong name, private/missing stats, upstream downtime, or unsupported source response.

Warnings:
${(payload.warnings || []).join("\n") || "None"}

Adapter diagnostics:
${formatAdapterDebug(payload.adapterDebug)}

Fallback links:
${formatLinks(currentLinks)}`;
        toast(D.disclaimers.workerFetch);
        return;
      }

      const parsed = mapNormalizedPlayer(payload.player || {});
      lastLookupStats = parsed;
      lastLookupWarnings = Array.isArray(payload.warnings) ? payload.warnings : [];
      applyParsedStatsToLookup(parsed);
      $("fetchResult").textContent = `Live fetch succeeded.
Source: ${payload.source || "public source"}
Warnings:
${lastLookupWarnings.join("\n") || "None"}

Adapter diagnostics:
${formatAdapterDebug(payload.adapterDebug)}

Parsed fields:
${JSON.stringify(parsed, null, 2)}

${D.disclaimers.primary}`;
      toast("Live fetch parsed. Review before saving.");
    } catch (error) {
      $("fetchResult").textContent = `${D.disclaimers.workerFetch}

Reason: ${error.message || error}

Could be wrong name, private/missing stats, upstream downtime, or unsupported source response.

Fallback links:
${formatLinks(currentLinks)}`;
      toast(D.disclaimers.workerFetch);
    }
  }

  function mapNormalizedPlayer(player) {
    return {
      name: text(player.name),
      platform: text(player.platform) || "pc",
      playerId: text(player.id),
      rank: valueOrBlank(player.rank),
      kills: valueOrBlank(player.kills),
      deaths: valueOrBlank(player.deaths),
      kd: valueOrBlank(player.kd),
      kpm: valueOrBlank(player.kpm),
      spm: valueOrBlank(player.spm),
      accuracy: valueOrBlank(player.accuracy),
      headshot: valueOrBlank(player.headshotPercent),
      hoursPlayed: valueOrBlank(player.hoursPlayed),
      favoriteWeapon: text(player.favoriteWeapon),
      favoriteVehicle: text(player.favoriteVehicle),
      planeHours: valueOrBlank(player.planeHours),
      planeKills: valueOrBlank(player.planeKills),
      planeKpm: valueOrBlank(player.planeKpm),
      tankHours: valueOrBlank(player.tankHours),
      tankKills: valueOrBlank(player.tankKills),
      vehicleKills: valueOrBlank(player.vehicleKills)
    };
  }

  function valueOrBlank(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function handleManualPaste() {
    parsePastedStats(false);
  }

  function handleParsePastedStats() {
    parsePastedStats(true);
  }

  function parsePastedStats(showEmptyMessage) {
    const parsed = parseRawStatsText($("manualPaste").value);
    if (parsed && Object.keys(parsed).length) {
      lastLookupStats = parsed;
      applyParsedStatsToLookup(parsed);
      $("fetchResult").textContent = `Manual paste parsed:\n${JSON.stringify(parsed, null, 2)}`;
      toast("Pasted stats parsed. Review before saving.");
      return parsed;
    }
    if (showEmptyMessage) {
      $("fetchResult").textContent = "No usable stats found in pasted text. Keep manual entry available and verify the source text.";
      toast("No usable pasted stats found.");
    }
    return null;
  }

  function applyParsedStatsToLookup(parsed) {
    const draft = {
      ...D.defaultPlayer,
      id: "",
      name: text($("lookupName").value) || parsed.name || "",
      platform: $("lookupPlatform").value || parsed.platform || "pc",
      playerId: text($("lookupPlayerId").value) || parsed.playerId || "",
      serverName: text($("lookupServer").value),
      map: $("lookupMap").value,
      contextNotes: text($("lookupNotes").value),
      sourceLinks: currentLinks,
      ...parsed
    };
    loadPlayerDraft(draft);
  }

  function loadPlayerDraft(player) {
    selectedPlayerId = "";
    hasPlayerDraft = true;
    $("playerEditId").value = "";
    setValueMap("player", {
      Name: player.name,
      Platform: player.platform || "pc",
      PlayerId: player.playerId,
      ReportStatus: player.reportStatus || "not reported",
      ServerName: player.serverName,
      Map: player.map,
      Kd: player.kd,
      Kpm: player.kpm,
      Spm: player.spm,
      Accuracy: player.accuracy,
      Headshot: player.headshot,
      Kills: player.kills,
      Deaths: player.deaths,
      Rank: player.rank,
      HoursPlayed: player.hoursPlayed,
      PlaneHours: player.planeHours,
      PlaneKills: player.planeKills,
      PlaneKpm: player.planeKpm,
      TankHours: player.tankHours,
      TankKills: player.tankKills,
      VehicleKills: player.vehicleKills,
      FavoriteVehicle: player.favoriteVehicle,
      FavoriteWeapon: player.favoriteWeapon,
      BfvhackersStatus: player.bfvhackersStatus,
      BfbanStatus: player.bfbanStatus,
      VideoEvidenceLink: player.videoEvidenceLink,
      SourceLinks: Array.isArray(player.sourceLinks) ? formatLinks(player.sourceLinks) : player.sourceLinks,
      ContextNotes: player.contextNotes,
      SuspiciousWeaponNotes: player.suspiciousWeaponNotes,
      SuspiciousVehicleNotes: player.suspiciousVehicleNotes,
      VehicleHeadshotNotes: player.vehicleHeadshotNotes,
      ScreenshotNote: player.screenshotNote,
      ScoreboardNote: player.scoreboardNote,
      ObservedBehavior: player.observedBehavior
    });
    renderPlayerSidebars(player);
  }

  function addFromLookup() {
    const name = text($("lookupName").value);
    if (!name) {
      toast("Enter a player name first.");
      return;
    }
    currentLinks = currentLinks.length ? currentLinks : buildSourceLinks(name, $("lookupPlatform").value, $("lookupPlayerId").value);
    const pasted = parseRawStatsText($("manualPaste").value);
    const parsed = lastLookupStats || (pasted && Object.keys(pasted).length ? pasted : null);
    const player = {
      ...D.defaultPlayer,
      id: uid(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      name,
      platform: $("lookupPlatform").value,
      playerId: text($("lookupPlayerId").value),
      serverName: text($("lookupServer").value),
      map: $("lookupMap").value,
      contextNotes: text($("lookupNotes").value),
      sourceLinks: currentLinks
    };
    if (parsed) Object.assign(player, parsed);
    state.players.unshift(player);
    selectedPlayerId = player.id;
    save();
    renderAll();
    loadPlayerForm(player.id);
    showTab("players");
    toast("Player added to watchlist.");
  }

  function clearLookup() {
    $("lookupForm").reset();
    $("lookupPlatform").value = "pc";
    $("lookupLinks").innerHTML = "";
    $("fetchResult").textContent = "No fetch attempted.";
    currentLinks = [];
    lastLookupStats = null;
  }

  function renderPlayers() {
    $("playersTable").innerHTML = state.players.length
      ? `<table><thead><tr><th>Player</th><th>Label</th><th>Stats</th><th>Vehicle focus</th><th>Actions</th></tr></thead><tbody>${state.players.map(playerRow).join("")}</tbody></table>`
      : '<p class="subtle">No players yet. Use Lookup or New Player.</p>';
    renderLinkedPlayerSelects();
    if (!selectedPlayerId && !hasPlayerDraft && state.players.length) loadPlayerForm(state.players[0].id);
  }

  function playerRow(player) {
    const score = scorePlayer(player);
    const focus = classifyVehicleFocus(player);
    return `<tr>
      <td><strong>${escapeHtml(player.name || "Unnamed")}</strong><br><span class="subtle">${escapeHtml(player.platform || "")}</span></td>
      <td>${labelBadge(score.label)}<br><span class="subtle">${score.score}/100 · ${score.confidence}</span></td>
      <td>K/D ${blank(player.kd)} · KPM ${blank(player.kpm)}<br>Hours ${blank(player.hoursPlayed)}</td>
      <td>${labelBadge(focus.label)}<br><span class="subtle">${escapeHtml(focus.notes)}</span></td>
      <td><div class="row-actions">
        <button data-action="edit-player" data-id="${player.id}">Edit</button>
        <button data-action="copy-player" data-id="${player.id}" class="secondary">Copy</button>
      </div></td>
    </tr>`;
  }

  function renderLinkedPlayerSelects() {
    const options = state.players.map((p) => `<option value="${p.id}">${escapeHtml(p.name || "Unnamed")}</option>`).join("");
    $("serverLinkedPlayers").innerHTML = options;
    $("evidenceFilterPlayer").innerHTML = '<option value="">All players</option>' + state.players.map((p) => `<option>${escapeHtml(p.name || "")}</option>`).join("");
    document.querySelectorAll("[data-action='edit-player']").forEach((button) => button.addEventListener("click", () => loadPlayerForm(button.dataset.id)));
    document.querySelectorAll("[data-action='copy-player']").forEach((button) => button.addEventListener("click", () => copyPlayerSummary(button.dataset.id)));
  }

  function loadPlayerForm(id) {
    const player = id ? getPlayer(id) : { ...D.defaultPlayer, platform: "pc", reportStatus: "not reported" };
    hasPlayerDraft = false;
    selectedPlayerId = player.id || "";
    $("playerEditId").value = selectedPlayerId;
    setValueMap("player", {
      Name: player.name,
      Platform: player.platform || "pc",
      PlayerId: player.playerId,
      ReportStatus: player.reportStatus || "not reported",
      ServerName: player.serverName,
      Map: player.map,
      Kd: player.kd,
      Kpm: player.kpm,
      Spm: player.spm,
      Accuracy: player.accuracy,
      Headshot: player.headshot,
      Kills: player.kills,
      Deaths: player.deaths,
      Rank: player.rank,
      HoursPlayed: player.hoursPlayed,
      PlaneHours: player.planeHours,
      PlaneKills: player.planeKills,
      PlaneKpm: player.planeKpm,
      TankHours: player.tankHours,
      TankKills: player.tankKills,
      VehicleKills: player.vehicleKills,
      FavoriteVehicle: player.favoriteVehicle,
      FavoriteWeapon: player.favoriteWeapon,
      BfvhackersStatus: player.bfvhackersStatus,
      BfbanStatus: player.bfbanStatus,
      VideoEvidenceLink: player.videoEvidenceLink,
      SourceLinks: Array.isArray(player.sourceLinks) ? formatLinks(player.sourceLinks) : player.sourceLinks,
      ContextNotes: player.contextNotes,
      SuspiciousWeaponNotes: player.suspiciousWeaponNotes,
      SuspiciousVehicleNotes: player.suspiciousVehicleNotes,
      VehicleHeadshotNotes: player.vehicleHeadshotNotes,
      ScreenshotNote: player.screenshotNote,
      ScoreboardNote: player.scoreboardNote,
      ObservedBehavior: player.observedBehavior
    });
    currentLinks = Array.isArray(player.sourceLinks) ? player.sourceLinks : [];
    renderPlayerSidebars(player);
  }

  function savePlayer(event) {
    event.preventDefault();
    const id = $("playerEditId").value || uid();
    const existing = getPlayer(id);
    const player = {
      ...(existing || D.defaultPlayer),
      id,
      createdAt: existing ? existing.createdAt : nowIso(),
      updatedAt: nowIso(),
      name: text($("playerName").value),
      platform: $("playerPlatform").value,
      playerId: text($("playerPlayerId").value),
      reportStatus: $("playerReportStatus").value,
      serverName: text($("playerServerName").value),
      map: $("playerMap").value,
      kd: $("playerKd").value,
      kpm: $("playerKpm").value,
      spm: $("playerSpm").value,
      accuracy: $("playerAccuracy").value,
      headshot: $("playerHeadshot").value,
      kills: $("playerKills").value,
      deaths: $("playerDeaths").value,
      rank: text($("playerRank").value),
      hoursPlayed: $("playerHoursPlayed").value,
      planeHours: $("playerPlaneHours").value,
      planeKills: $("playerPlaneKills").value,
      planeKpm: $("playerPlaneKpm").value,
      tankHours: $("playerTankHours").value,
      tankKills: $("playerTankKills").value,
      vehicleKills: $("playerVehicleKills").value,
      favoriteVehicle: text($("playerFavoriteVehicle").value),
      favoriteWeapon: text($("playerFavoriteWeapon").value),
      bfvhackersStatus: text($("playerBfvhackersStatus").value),
      bfbanStatus: text($("playerBfbanStatus").value),
      videoEvidenceLink: text($("playerVideoEvidenceLink").value),
      sourceLinks: parseLinks($("playerSourceLinks").value),
      contextNotes: text($("playerContextNotes").value),
      suspiciousWeaponNotes: text($("playerSuspiciousWeaponNotes").value),
      suspiciousVehicleNotes: text($("playerSuspiciousVehicleNotes").value),
      vehicleHeadshotNotes: text($("playerVehicleHeadshotNotes").value),
      screenshotNote: text($("playerScreenshotNote").value),
      scoreboardNote: text($("playerScoreboardNote").value),
      observedBehavior: text($("playerObservedBehavior").value)
    };
    if (!player.name) {
      toast("Player name is required.");
      return;
    }
    const index = state.players.findIndex((item) => item.id === id);
    if (index >= 0) state.players[index] = player;
    else state.players.unshift(player);
    selectedPlayerId = id;
    hasPlayerDraft = false;
    currentLinks = player.sourceLinks;
    save();
    renderAll();
    renderPlayerSidebars(player);
    toast("Player saved.");
  }

  function duplicatePlayer() {
    const player = getPlayer(selectedPlayerId);
    if (!player) return toast("Select a player first.");
    const copy = { ...player, id: uid(), name: `${player.name} copy`, createdAt: nowIso(), updatedAt: nowIso() };
    state.players.unshift(copy);
    selectedPlayerId = copy.id;
    hasPlayerDraft = false;
    save();
    renderAll();
    loadPlayerForm(copy.id);
    toast("Player duplicated.");
  }

  function deletePlayer() {
    if (!selectedPlayerId) return toast("Select a player first.");
    state.players = state.players.filter((player) => player.id !== selectedPlayerId);
    selectedPlayerId = "";
    hasPlayerDraft = false;
    save();
    renderAll();
    loadPlayerForm(null);
    toast("Player deleted.");
  }

  function renderPlayerSidebars(player) {
    const target = player && (player.id || player.name) ? player : null;
    if (!target) {
      $("scorePanel").innerHTML = '<p class="subtle">Select or save a player to score.</p>';
      $("vehiclePanel").innerHTML = '<p class="subtle">Select or save a player to classify focus.</p>';
      return;
    }
    const score = scorePlayer(target);
    $("scorePanel").innerHTML = `
      ${labelBadge(score.label)}
      <p><strong>${score.score}/100</strong> · Confidence: ${escapeHtml(score.confidence)}</p>
      <p class="subtle">${escapeHtml(D.disclaimers.primary)}</p>
      <p class="subtle">${escapeHtml(D.disclaimers.scoring)}</p>
      <strong>Top reasons</strong>${list(score.reasons)}
      <strong>Missing data</strong>${list(score.missing)}
      <strong>Next verification step</strong><p class="subtle">${escapeHtml(score.nextStep)}</p>`;
    const focus = classifyVehicleFocus(target);
    $("vehiclePanel").innerHTML = `
      ${labelBadge(focus.label)}
      <p class="subtle">${escapeHtml(focus.notes)}</p>
      <strong>Missing fields needed</strong>${list(focus.missing)}`;
  }

  function scorePlayer(player) {
    let score = 0;
    const reasons = [];
    const missing = [];
    const kd = num(player.kd);
    const kpm = num(player.kpm);
    const spm = num(player.spm);
    const hours = num(player.hoursPlayed);
    const accuracy = num(player.accuracy);
    const headshot = num(player.headshot);
    const planeKpm = num(player.planeKpm);
    const planeHours = num(player.planeHours);
    const tankHours = num(player.tankHours);
    const vehicleKills = num(player.vehicleKills);
    const evidenceCount = state.evidence.filter((e) => samePlayer(e, player)).length;
    const serverCount = state.serverChecks.filter((s) => serverMentionsPlayer(s, player)).length;

    if (kd === null) missing.push("K/D");
    if (kpm === null) missing.push("KPM");
    if (hours === null) missing.push("hours played");
    if (accuracy === null) missing.push("accuracy");
    if (headshot === null) missing.push("headshot percentage");

    if (kd !== null && kd >= 5) {
      score += kpm !== null || hours !== null ? 8 : 3;
      reasons.push("K/D is high, but it needs supporting context.");
    }
    if (kd !== null && kpm !== null && hours !== null && kd >= 4 && kpm >= 1.7 && hours <= 120) {
      score += 18;
      reasons.push("K/D, KPM, and low-hours pattern deserves manual review.");
    }
    if (spm !== null && spm >= 900 && kpm !== null && kpm >= 1.8) {
      score += 10;
      reasons.push("SPM and KPM are both outlier-level.");
    }
    if (accuracy !== null && accuracy >= 35) {
      score += 10;
      reasons.push("Overall accuracy is unusually high.");
    }
    if (headshot !== null && headshot >= 45) {
      score += 12;
      reasons.push("Headshot percentage is unusually high.");
    }
    if (text(player.suspiciousWeaponNotes)) {
      score += 10;
      reasons.push("Weapon-stat notes need verification.");
    }
    if (text(player.suspiciousVehicleNotes) || text(player.vehicleHeadshotNotes)) {
      score += 10;
      reasons.push("Vehicle/plane notes need verification.");
    }
    if (planeKpm !== null && planeKpm >= 3 && planeHours !== null && planeHours < 40) {
      score += 12;
      reasons.push("Plane KPM and plane hours form an outlier pattern.");
    }
    if (tankHours !== null && tankHours < 25 && vehicleKills !== null && vehicleKills >= 1500) {
      score += 10;
      reasons.push("Vehicle kills are high relative to recorded tank hours.");
    }
    if (concerningStatus(player.bfvhackersStatus) || concerningStatus(player.bfbanStatus)) {
      score += 14;
      reasons.push("Manual community-status note is concerning and should be checked at source.");
    }
    if (text(player.videoEvidenceLink) || text(player.screenshotNote)) {
      score += 14;
      reasons.push("Direct video/screenshot evidence is recorded.");
    }
    if (evidenceCount >= 2) {
      score += 10;
      reasons.push("Repeated evidence entries are linked to this player.");
    }
    if (serverCount >= 2) {
      score += 8;
      reasons.push("Repeated independent server observations are logged.");
    }
    if (text(player.observedBehavior) || text(player.scoreboardNote)) {
      score += 8;
      reasons.push("Server behavior or scoreboard context is documented.");
    }

    const missingPenalty = Math.min(18, missing.length * 3);
    score = Math.max(0, Math.min(100, Math.round(score - missingPenalty)));
    const label = D.scoringThresholds.find((item) => score <= item.max).label;
    const confidence = missing.length >= 4 ? "Low" : evidenceCount + serverCount >= 3 && missing.length <= 2 ? "High" : "Medium";
    const nextStep = missing.length
      ? `Add ${missing.slice(0, 3).join(", ")} from public sources or manual review.`
      : "Compare public source links, attach evidence, and use official tools only if the notes are factual and specific.";
    return {
      score,
      label,
      confidence,
      reasons: reasons.length ? reasons.slice(0, 5) : ["No strong local outlier pattern found."],
      missing: missing.length ? missing : ["No major core fields missing."],
      nextStep
    };
  }

  function concerningStatus(value) {
    return /watch|flag|suspicious|reported|linked|review|concerning/i.test(text(value));
  }

  function classifyVehicleFocus(player) {
    const planeHours = num(player.planeHours) || 0;
    const tankHours = num(player.tankHours) || 0;
    const vehicleKills = num(player.vehicleKills) || 0;
    const totalHours = num(player.hoursPlayed) || 0;
    const missing = [];
    if (!num(player.planeHours)) missing.push("plane hours");
    if (!num(player.tankHours)) missing.push("tank hours");
    if (!num(player.vehicleKills)) missing.push("vehicle kills");
    if (!totalHours) missing.push("total hours");
    if (missing.length >= 3 && !text(player.favoriteVehicle)) {
      return { label: "unknown", notes: "Not enough vehicle data entered.", missing };
    }
    const planeRatio = totalHours ? planeHours / totalHours : 0;
    const tankRatio = totalHours ? tankHours / totalHours : 0;
    if (planeRatio >= 0.28 || /plane|fighter|bomber|spitfire|zero|corsair/i.test(player.favoriteVehicle)) {
      return { label: "plane-focused", notes: "Plane hours or favorite vehicle indicate air focus.", missing };
    }
    if (tankRatio >= 0.28 || /tank|tiger|sherman|panzer|staghound|valentine/i.test(player.favoriteVehicle)) {
      return { label: "tank-focused", notes: "Tank hours or favorite vehicle indicate armor focus.", missing };
    }
    if ((planeHours > 0 && tankHours > 0) || vehicleKills >= 1000) {
      return { label: "mixed", notes: "Vehicle data spans more than one category.", missing };
    }
    return { label: "infantry-focused", notes: "Vehicle indicators are limited compared with total play.", missing };
  }

  function saveServerCheck(event) {
    event.preventDefault();
    const id = $("serverEditId").value || uid();
    const existing = state.serverChecks.find((item) => item.id === id);
    const entry = {
      ...(existing || D.defaultServerCheck),
      id,
      createdAt: existing ? existing.createdAt : nowIso(),
      dateTime: $("serverDateTime").value,
      serverName: text($("serverName").value),
      region: text($("serverRegion").value),
      map: $("serverMap").value,
      mode: text($("serverMode").value),
      suspectedPlayers: text($("serverSuspectedPlayers").value),
      strongNormalPlayers: text($("serverStrongNormalPlayers").value),
      observedBehavior: text($("serverObservedBehavior").value),
      disconnectNotes: text($("serverDisconnectNotes").value),
      evidenceRefs: text($("serverEvidenceRefs").value),
      finalNotes: text($("serverFinalNotes").value),
      linkedPlayerIds: selectedOptions($("serverLinkedPlayers"))
    };
    upsert(state.serverChecks, entry);
    selectedServerId = id;
    save();
    renderAll();
    toast("Server check saved.");
  }

  function renderServerLists() {
    $("serverList").innerHTML = state.serverChecks.length
      ? `<table><thead><tr><th>Session</th><th>Players</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${state.serverChecks.map(serverRow).join("")}</tbody></table>`
      : '<p class="subtle">No server checks yet.</p>';
    document.querySelectorAll("[data-action='edit-server']").forEach((button) => button.addEventListener("click", () => loadServerForm(button.dataset.id)));
    document.querySelectorAll("[data-action='delete-server']").forEach((button) => button.addEventListener("click", () => deleteServer(button.dataset.id)));
  }

  function serverRow(entry) {
    return `<tr><td><strong>${escapeHtml(entry.serverName || "Unknown server")}</strong><br>${escapeHtml(entry.map || "Unknown map")} · ${prettyDate(entry.dateTime)}</td>
      <td>${escapeHtml(entry.suspectedPlayers || linkedNames(entry.linkedPlayerIds) || "None noted")}</td>
      <td>${escapeHtml(entry.observedBehavior || entry.finalNotes || "No notes")}</td>
      <td><div class="row-actions"><button data-action="edit-server" data-id="${entry.id}">Edit</button><button data-action="delete-server" data-id="${entry.id}" class="danger">Delete</button></div></td></tr>`;
  }

  function loadServerForm(id) {
    const entry = id ? state.serverChecks.find((item) => item.id === id) : { ...D.defaultServerCheck, dateTime: localNow() };
    selectedServerId = entry.id || "";
    $("serverEditId").value = selectedServerId;
    setValueMap("server", {
      DateTime: entry.dateTime || localNow(),
      Name: entry.serverName,
      Region: entry.region,
      Map: entry.map,
      Mode: entry.mode,
      SuspectedPlayers: entry.suspectedPlayers,
      StrongNormalPlayers: entry.strongNormalPlayers,
      ObservedBehavior: entry.observedBehavior,
      DisconnectNotes: entry.disconnectNotes,
      EvidenceRefs: entry.evidenceRefs,
      FinalNotes: entry.finalNotes
    });
    setSelectedOptions($("serverLinkedPlayers"), entry.linkedPlayerIds || []);
  }

  function deleteServer(id) {
    state.serverChecks = state.serverChecks.filter((entry) => entry.id !== id);
    save();
    renderAll();
  }

  function copyServerSummary() {
    const entry = selectedServerId ? state.serverChecks.find((item) => item.id === selectedServerId) : readServerForm();
    copyText(`Server check: ${entry.serverName || "Unknown server"} / ${entry.map || "Unknown map"} / ${prettyDate(entry.dateTime)}
Players: ${entry.suspectedPlayers || linkedNames(entry.linkedPlayerIds) || "None noted"}
Observed behavior: ${entry.observedBehavior || "No behavior notes"}
Evidence refs: ${entry.evidenceRefs || "None"}
Final notes: ${entry.finalNotes || "None"}`, "Server summary copied.");
  }

  function readServerForm() {
    return {
      dateTime: $("serverDateTime").value,
      serverName: $("serverName").value,
      map: $("serverMap").value,
      suspectedPlayers: $("serverSuspectedPlayers").value,
      linkedPlayerIds: selectedOptions($("serverLinkedPlayers")),
      observedBehavior: $("serverObservedBehavior").value,
      evidenceRefs: $("serverEvidenceRefs").value,
      finalNotes: $("serverFinalNotes").value
    };
  }

  function saveEvidence(event) {
    event.preventDefault();
    const id = $("evidenceEditId").value || uid();
    const existing = state.evidence.find((item) => item.id === id);
    const entry = {
      ...(existing || D.defaultEvidence),
      id,
      createdAt: existing ? existing.createdAt : nowIso(),
      player: text($("evidencePlayer").value),
      dateTime: $("evidenceDateTime").value,
      server: text($("evidenceServer").value),
      map: $("evidenceMap").value,
      observedBehavior: text($("evidenceObservedBehavior").value),
      killCardNotes: text($("evidenceKillCardNotes").value),
      scoreboardNotes: text($("evidenceScoreboardNotes").value),
      weaponVehicleUsed: text($("evidenceWeaponVehicleUsed").value),
      screenshotNote: text($("evidenceScreenshotNote").value),
      videoLink: text($("evidenceVideoLink").value),
      sourceLinks: text($("evidenceSourceLinks").value),
      reportStatus: $("evidenceReportStatus").value,
      followUpNotes: text($("evidenceFollowUpNotes").value)
    };
    upsert(state.evidence, entry);
    selectedEvidenceId = id;
    save();
    renderAll();
    toast("Evidence saved.");
  }

  function renderEvidenceFilters() {
    const currentPlayer = $("evidenceFilterPlayer").value;
    $("evidenceFilterPlayer").innerHTML = '<option value="">All players</option>' + state.players.map((p) => `<option>${escapeHtml(p.name || "")}</option>`).join("");
    $("evidenceFilterPlayer").value = currentPlayer;
  }

  function renderEvidenceList() {
    const playerFilter = $("evidenceFilterPlayer").value;
    const statusFilter = $("evidenceFilterStatus").value;
    const rows = state.evidence.filter((entry) => {
      return (!playerFilter || entry.player === playerFilter) && (!statusFilter || entry.reportStatus === statusFilter);
    });
    $("evidenceList").innerHTML = rows.length
      ? `<table><thead><tr><th>Player</th><th>Context</th><th>Evidence</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(evidenceRow).join("")}</tbody></table>`
      : '<p class="subtle">No matching evidence entries.</p>';
    document.querySelectorAll("[data-action='edit-evidence']").forEach((button) => button.addEventListener("click", () => loadEvidenceForm(button.dataset.id)));
  }

  function evidenceRow(entry) {
    return `<tr><td><strong>${escapeHtml(entry.player || "Unknown")}</strong></td>
      <td>${escapeHtml(entry.server || "Unknown server")}<br>${escapeHtml(entry.map || "Unknown map")} · ${prettyDate(entry.dateTime)}</td>
      <td>${escapeHtml(entry.observedBehavior || entry.scoreboardNotes || "No notes")}</td>
      <td>${escapeHtml(entry.reportStatus)}</td>
      <td><button data-action="edit-evidence" data-id="${entry.id}">Edit</button></td></tr>`;
  }

  function loadEvidenceForm(id) {
    const entry = id ? state.evidence.find((item) => item.id === id) : { ...D.defaultEvidence, dateTime: localNow() };
    selectedEvidenceId = entry.id || "";
    $("evidenceEditId").value = selectedEvidenceId;
    setValueMap("evidence", {
      Player: entry.player,
      DateTime: entry.dateTime || localNow(),
      Server: entry.server,
      Map: entry.map,
      WeaponVehicleUsed: entry.weaponVehicleUsed,
      ReportStatus: entry.reportStatus || "not reported",
      ObservedBehavior: entry.observedBehavior,
      KillCardNotes: entry.killCardNotes,
      ScoreboardNotes: entry.scoreboardNotes,
      ScreenshotNote: entry.screenshotNote,
      VideoLink: entry.videoLink,
      SourceLinks: entry.sourceLinks,
      FollowUpNotes: entry.followUpNotes
    });
  }

  function deleteEvidence() {
    if (!selectedEvidenceId) return toast("Select evidence first.");
    state.evidence = state.evidence.filter((entry) => entry.id !== selectedEvidenceId);
    selectedEvidenceId = "";
    save();
    renderAll();
    loadEvidenceForm(null);
    toast("Evidence deleted.");
  }

  function copyEvidenceSummary() {
    const entry = selectedEvidenceId ? state.evidence.find((item) => item.id === selectedEvidenceId) : readEvidenceForm();
    copyText(`Evidence summary
Player: ${entry.player || "Unknown"}
Context: ${entry.server || "Unknown server"} / ${entry.map || "Unknown map"} / ${prettyDate(entry.dateTime)}
Observed behavior: ${entry.observedBehavior || "No behavior notes"}
Kill card: ${entry.killCardNotes || "None"}
Scoreboard: ${entry.scoreboardNotes || "None"}
Screenshot/video: ${entry.screenshotNote || "None"} ${entry.videoLink || ""}
Source links: ${entry.sourceLinks || "None"}
Report status: ${entry.reportStatus || "not reported"}`, "Evidence summary copied.");
  }

  function readEvidenceForm() {
    return {
      player: $("evidencePlayer").value,
      dateTime: $("evidenceDateTime").value,
      server: $("evidenceServer").value,
      map: $("evidenceMap").value,
      observedBehavior: $("evidenceObservedBehavior").value,
      killCardNotes: $("evidenceKillCardNotes").value,
      scoreboardNotes: $("evidenceScoreboardNotes").value,
      screenshotNote: $("evidenceScreenshotNote").value,
      videoLink: $("evidenceVideoLink").value,
      sourceLinks: $("evidenceSourceLinks").value,
      reportStatus: $("evidenceReportStatus").value
    };
  }

  function generateReport() {
    const player = text($("reportPlayerName").value) || "the player";
    const behavior = text($("reportBehavior").value) || "the behavior described in my notes";
    const context = text($("reportContext").value) || "the listed server/map/date";
    const evidence = text($("reportEvidence").value) || "screenshot/video/scoreboard/source links noted below";
    const links = text($("reportLinks").value);
    $("reportOutput").textContent =
      `Player: ${player}

I observed ${behavior} on ${context}. Evidence available: ${evidence}. Please review.

Links/notes: ${links || "None added."}

Use official in-game/profile reporting tools. Attach screenshot/video where possible.

${D.disclaimers.primary}`;
  }

  function exportData() {
    state.lastBackupAt = nowIso();
    save();
    const payload = JSON.stringify({ app: D.appName, exportedAt: nowIso(), ...state }, null, 2);
    $("jsonBox").value = payload;
    $("jsonBox").textContent = payload;
    renderDashboard();
    showTab("importExport");
    toast("JSON export prepared.");
  }

  function importData() {
    try {
      const incoming = JSON.parse($("jsonBox").value);
      state = {
        players: Array.isArray(incoming.players) ? incoming.players : [],
        serverChecks: Array.isArray(incoming.serverChecks) ? incoming.serverChecks : [],
        evidence: Array.isArray(incoming.evidence) ? incoming.evidence : [],
        sourceStatus: incoming.sourceStatus || {},
        settings: {
          apiBaseUrl: text(incoming.settings && incoming.settings.apiBaseUrl)
        },
        lastBackupAt: incoming.lastBackupAt || nowIso()
      };
      save();
      renderAll();
      toast("JSON imported.");
    } catch (error) {
      toast(`Import failed: ${error.message}`);
    }
  }

  function clearAllData() {
    if (!confirm("Clear all local data for this app in this browser?")) return;
    state = { players: [], serverChecks: [], evidence: [], sourceStatus: {}, settings: { apiBaseUrl: "" }, lastBackupAt: "" };
    selectedPlayerId = "";
    selectedEvidenceId = "";
    selectedServerId = "";
    localStorage.removeItem(D.storageKey);
    renderAll();
    loadPlayerForm(null);
    loadEvidenceForm(null);
    loadServerForm(null);
    toast("Local data cleared.");
  }

  function copyPlayerSummary(id) {
    const player = getPlayer(id || selectedPlayerId);
    if (!player) return toast("Select a player first.");
    const score = scorePlayer(player);
    const focus = classifyVehicleFocus(player);
    copyText(`Player summary
Player: ${player.name} (${player.platform})
Triage label: ${score.label} (${score.score}/100, confidence ${score.confidence})
Vehicle focus: ${focus.label}
K/D: ${blank(player.kd)}, KPM: ${blank(player.kpm)}, SPM: ${blank(player.spm)}, hours: ${blank(player.hoursPlayed)}
Accuracy: ${blank(player.accuracy)}%, headshot: ${blank(player.headshot)}%
Observed behavior: ${player.observedBehavior || "No behavior notes"}
Evidence: ${player.screenshotNote || "No screenshot note"} ${player.videoEvidenceLink || ""}
Reminder: ${D.disclaimers.primary}`, "Player summary copied.");
  }

  function getPlayer(id) {
    return state.players.find((player) => player.id === id);
  }

  function samePlayer(entry, player) {
    return text(entry.player).toLowerCase() === text(player.name).toLowerCase() || entry.playerId === player.id;
  }

  function serverMentionsPlayer(server, player) {
    const haystack = `${server.suspectedPlayers} ${linkedNames(server.linkedPlayerIds)}`.toLowerCase();
    return haystack.includes(text(player.name).toLowerCase());
  }

  function linkedNames(ids) {
    return (ids || []).map((id) => getPlayer(id)).filter(Boolean).map((p) => p.name).join(", ");
  }

  function upsert(list, entry) {
    const index = list.findIndex((item) => item.id === entry.id);
    if (index >= 0) list[index] = entry;
    else list.unshift(entry);
  }

  function setValueMap(prefix, map) {
    Object.entries(map).forEach(([suffix, value]) => {
      const el = $(`${prefix}${suffix}`);
      if (el) el.value = value || "";
    });
  }

  function selectedOptions(select) {
    return Array.from(select.selectedOptions).map((option) => option.value);
  }

  function setSelectedOptions(select, values) {
    Array.from(select.options).forEach((option) => {
      option.selected = values.includes(option.value);
    });
  }

  function parseLinks(value) {
    return text(value)
      .split(/\n+/)
      .map((line) => {
        const parts = line.split(/:\s+(https?:\/\/)/);
        if (parts.length >= 3) return { label: parts[0], url: `${parts[1]}${parts.slice(2).join(": ")}` };
        return { label: "Source", url: line.trim() };
      })
      .filter((link) => link.url);
  }

  function labelBadge(label) {
    const cls = label.toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ")[0] || "neutral";
    const className = label === "Very Suspicious" ? "very" : label === "Report-worthy evidence" ? "report" : cls;
    return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
  }

  function list(items) {
    return `<ul class="clean-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function blank(value) {
    return text(value) || "n/a";
  }

  function prettyDate(value) {
    if (!value) return "No date";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function renderStorageSummary() {
    $("storageSummary").textContent = `${state.players.length} players, ${state.serverChecks.length} server checks, and ${state.evidence.length} evidence entries are stored in localStorage under ${D.storageKey}.`;
  }

  function parseRawStatsText(raw) {
    const value = text(raw);
    if (!value) return {};
    const parsed = {};
    assignIfFound(parsed, "kd", value, [
      /\bK\/D\s*[:#-]?\s*([\d,.]+)/i,
      /\bKD\s*[:#-]?\s*([\d,.]+)/i,
      /([\d,.]+)\s*K\/D/i
    ]);
    assignIfFound(parsed, "kpm", value, [/\bKPM\s*[:#-]?\s*([\d,.]+)/i, /([\d,.]+)\s*KPM/i]);
    assignIfFound(parsed, "spm", value, [/\bSPM\s*[:#-]?\s*([\d,.]+)/i, /([\d,.]+)\s*SPM/i]);
    assignIfFound(parsed, "kills", value, [/\bkills?\s*[:#-]?\s*([\d,.]+)/i, /([\d,.]+)\s*kills?\b/i]);
    assignIfFound(parsed, "deaths", value, [/\bdeaths?\s*[:#-]?\s*([\d,.]+)/i, /([\d,.]+)\s*deaths?\b/i]);
    assignIfFound(parsed, "rank", value, [/\brank\s*[:#-]?\s*([\d,.]+)/i, /([\d,.]+)\s*rank/i]);
    assignIfFound(parsed, "accuracy", value, [/\baccuracy\s*[:#-]?\s*([\d,.]+)%?/i, /([\d,.]+)%\s*accuracy/i]);
    assignIfFound(parsed, "headshot", value, [
      /\bheadshots?\s*[:#-]?\s*([\d,.]+)%?/i,
      /\bHS\s*%?\s*[:#-]?\s*([\d,.]+)%?/i,
      /([\d,.]+)%\s*headshots?/i
    ]);
    assignIfFound(parsed, "planeKills", value, [/\bplane kills?\s*[:#-]?\s*([\d,.]+)/i, /\bair kills?\s*[:#-]?\s*([\d,.]+)/i]);
    assignIfFound(parsed, "tankKills", value, [/\btank kills?\s*[:#-]?\s*([\d,.]+)/i, /\barmor kills?\s*[:#-]?\s*([\d,.]+)/i]);
    assignIfFound(parsed, "vehicleKills", value, [/\bvehicle kills?\s*[:#-]?\s*([\d,.]+)/i, /\bvehicles kills?\s*[:#-]?\s*([\d,.]+)/i]);
    const hours = parseHoursFromText(value);
    if (hours !== null) parsed.hoursPlayed = String(hours);
    return parsed;
  }

  function assignIfFound(target, key, value, patterns) {
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) {
        target[key] = cleanNumber(match[1]);
        return;
      }
    }
  }

  function parseHoursFromText(value) {
    const compact = value.match(/(\d+(?:\.\d+)?)h(?:\s+(\d+)m)?/i);
    if (compact) {
      return Math.round((parseFloat(compact[1]) + parseFloat(compact[2] || "0") / 60) * 100) / 100;
    }
    const labeled = value.match(/\b(?:time played|hours played|playtime)\s*[:#-]?\s*([\d,.]+)\s*h(?:ours?)?/i);
    if (labeled) return parseFloat(cleanNumber(labeled[1]));
    const plain = value.match(/([\d,.]+)\s*(?:hours|hrs)\s*played/i);
    return plain ? parseFloat(cleanNumber(plain[1])) : null;
  }

  function cleanNumber(value) {
    return String(value || "").replace(/,/g, "");
  }

  function formatAdapterDebug(adapterDebug) {
    if (!Array.isArray(adapterDebug) || !adapterDebug.length) return "No adapter diagnostics returned.";
    return adapterDebug
      .map((item) => {
        return [
          `- ${item.name || "unknown adapter"}`,
          `  status: ${item.httpStatus === null || item.httpStatus === undefined ? "n/a" : item.httpStatus}`,
          `  url: ${item.url || "n/a"}`,
          `  parsed: ${item.parsed ? "yes" : "no"}`,
          `  error: ${item.error || "none"}`,
          `  raw preview: ${item.rawPreview || "none"}`
        ].join("\n");
      })
      .join("\n");
  }

  function saveApiBaseUrl() {
    state.settings = state.settings || { apiBaseUrl: "" };
    state.settings.apiBaseUrl = normalizeApiBaseUrl($("apiBaseUrl").value);
    $("apiBaseUrl").value = state.settings.apiBaseUrl;
    save();
    renderApiStatus();
    toast(state.settings.apiBaseUrl ? "API Base URL saved." : "API Base URL cleared.");
  }

  async function testApiBaseUrl() {
    saveApiBaseUrl();
    const apiBaseUrl = normalizeApiBaseUrl(state.settings.apiBaseUrl);
    if (!apiBaseUrl) {
      toast("Set an API Base URL first.");
      return;
    }
    $("apiStatus").textContent = "Testing Worker API...";
    try {
      const response = await fetch(buildWorkerUrl(apiBaseUrl, "test", "pc"), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      if (!payload) throw new Error("Malformed JSON response.");
      $("apiStatus").textContent = response.ok
        ? `API reachable. Response: ${payload.ok ? "normalized data returned" : payload.error || "clean fallback returned"}.`
        : `API reachable with error: ${payload.error || response.status}.`;
      toast("API test completed.");
    } catch (error) {
      $("apiStatus").textContent = `API test failed: ${error.message || error}`;
      toast("API test failed.");
    }
  }

  function clearApiBaseUrl() {
    state.settings = state.settings || { apiBaseUrl: "" };
    state.settings.apiBaseUrl = "";
    $("apiBaseUrl").value = "";
    save();
    renderApiStatus();
    toast("API Base URL cleared.");
  }

  function renderApiStatus() {
    if (!$("apiStatus")) return;
    const apiBaseUrl = normalizeApiBaseUrl(state.settings && state.settings.apiBaseUrl);
    $("apiStatus").textContent = apiBaseUrl
      ? `Live fetch mode enabled. Try Live Fetch calls ${apiBaseUrl}/api/player.`
      : "Manual/link mode enabled. Add a Cloudflare Worker URL to use Try Live Fetch.";
  }

  function normalizeApiBaseUrl(value) {
    return text(value).replace(/\/+$/, "");
  }

  function buildWorkerUrl(apiBaseUrl, player, platform) {
    return `${normalizeApiBaseUrl(apiBaseUrl)}/api/player?name=${encode(player)}&platform=${encode(platform || "pc")}`;
  }

  async function copyText(value, message) {
    const output = text(value);
    if (!output) return toast("Nothing to copy.");
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      const area = document.createElement("textarea");
      area.value = output;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast(message || "Copied.");
  }

  function toast(message) {
    const box = $("toast");
    box.textContent = message;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("show"), 2600);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === "edit-player") loadPlayerForm(target.dataset.id);
  });

  init();
})();
