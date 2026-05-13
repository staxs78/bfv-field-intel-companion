const SUPPORTED_PLATFORMS = new Set(["pc", "ps4", "xboxone"]);
const FETCH_TIMEOUT_MS = 10000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

const sourceTemplates = {
  statbits:
    "https://api.statbits.io/chatmsg/bfv/stats/{platform}/players/{player}/summary-short-a?forceOk=true&errMsg=Source%20unavailable%20or%20blocked",
  statbitsLink: "https://statbits.io/chatmsg-api/battlefield-5/",
  gametoolsDocs: "https://api.gametools.network/docs",
  gametoolsLink: "https://gametools.network/?game=bfv&platform={platform}&query={player}",
  bfvhackersDocs: "https://bfvhackers.com/api/docs/",
  bfvhackersApi: "https://bfvhackers.com/api/v1/is-hacker?name={player}&stats=true",
  bfvhackersLink: "https://bfvhackers.com/?search={player}",
  trackerLink: "https://battlefieldtracker.com/bfv/search/{player}",
  bfbanLink: "https://bfban.com/player?name={player}",
  eaReportLink: "https://help.ea.com/en/help/faq/report-players-for-cheating-abuse-and-harassment/"
};

const gametoolsEndpointSpecs = [
  ["gametools-stats-format-values", "https://api.gametools.network/bfv/stats/?format_values=true&name={player}&platform={platform}"],
  ["gametools-stats", "https://api.gametools.network/bfv/stats/?name={player}&platform={platform}"],
  ["gametools-stats-playerid", "https://api.gametools.network/bfv/stats/?format_values=true&playerid={player}&platform={platform}"],
  ["gametools-all", "https://api.gametools.network/bfv/all/?format_values=true&name={player}&platform={platform}"],
  ["gametools-weapons", "https://api.gametools.network/bfv/weapons/?format_values=true&name={player}&platform={platform}"],
  ["gametools-vehicles", "https://api.gametools.network/bfv/vehicles/?name={player}&platform={platform}"]
];

const statbitsAdapter = {
  name: "statbits",
  mode: "fetch",
  enabled: true,
  buildUrl(name, platform) {
    return buildUrl(sourceTemplates.statbits, name, platform);
  },
  fetchRaw(name, platform) {
    return fetchRawUrl(this.buildUrl(name, platform));
  },
  parse(raw, name, platform, debug) {
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (!value) return null;
    if (/source unavailable|blocked|failed|error|not found|invalid|could not/i.test(value)) {
      debug.error = `Text response was not usable stats: ${value.slice(0, 160)}`;
      return null;
    }
    const player = parseStatsText(value, name, platform);
    return hasAnyStat(player)
      ? { player, raw: value, warnings: ["Parsed from Statbits text response; review fields before saving."] }
      : null;
  },
  normalize(parsed, name, platform) {
    return normalizePlayer(parsed.player, name, platform);
  }
};

const gametoolsAdapters = gametoolsEndpointSpecs.map(([name, template]) => ({
  name,
  mode: "fetch",
  enabled: true,
  supports(playerName) {
    return name !== "gametools-stats-playerid" || /^\d+$/.test(String(playerName).trim());
  },
  buildUrl(playerName, platform) {
    return buildUrl(template, playerName, platform);
  },
  fetchRaw(playerName, platform) {
    return fetchRawUrl(this.buildUrl(playerName, platform));
  },
  parse(raw, playerName, platform) {
    const root = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (!Object.keys(root).length || root.errors || root.error) return null;
    const player = parseGameToolsObject(root, playerName, platform);
    return hasAnyStat(player)
      ? { player, raw: root, warnings: ["Parsed defensively from GameTools JSON; missing fields are left null."] }
      : null;
  },
  normalize(parsed, playerName, platform) {
    return normalizePlayer(parsed.player, playerName, platform);
  }
}));

const bfvhackersApiAdapter = {
  name: "bfvhackers-public-api",
  mode: "fetch",
  enabled: true,
  supports(_name, platform) {
    return platform === "pc";
  },
  buildUrl(name) {
    return sourceTemplates.bfvhackersApi.replace("{player}", encodeURIComponent(name));
  },
  fetchRaw(name, platform) {
    return fetchRawUrl(this.buildUrl(name, platform));
  },
  parse(raw, name, platform) {
    const root = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (!Object.keys(root).length || root.error || root.errors) return null;
    const player = parseBfvHackersObject(root, name, platform);
    return hasAnyStat(player)
      ? {
          player,
          raw: root,
          warnings: [
            "Parsed public stats from BFVHackers API. Community/algorithmic status is context only; stats are not proof."
          ]
        }
      : null;
  },
  normalize(parsed, name, platform) {
    return normalizePlayer(parsed.player, name, platform);
  }
};

const linkManualAdapters = [
  linkManualAdapter("bfvhackers", "BFVHackers public page", (name) => sourceTemplates.bfvhackersLink.replace("{player}", encodeURIComponent(name))),
  linkManualAdapter("bfban", "BFBan public page", (name) => sourceTemplates.bfbanLink.replace("{player}", encodeURIComponent(name))),
  linkManualAdapter("tracker", "Battlefield Tracker public page", (name) => sourceTemplates.trackerLink.replace("{player}", encodeURIComponent(name))),
  linkManualAdapter("gametools-site", "GameTools public website", (name, platform) =>
    sourceTemplates.gametoolsLink
      .replace("{platform}", encodeURIComponent(platform))
      .replace("{player}", encodeURIComponent(name))
  ),
  linkManualAdapter("ea-report", "EA report/help page", () => sourceTemplates.eaReportLink)
];

const fetchAdapters = [gametoolsAdapters[0], bfvhackersApiAdapter, ...gametoolsAdapters.slice(1), statbitsAdapter];
const sourceAdapters = [...fetchAdapters, ...linkManualAdapters];

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "Method not allowed", fallback: "Use GET /api/player?name=PLAYERNAME&platform=pc", links: [] }, 405);
    }

    const url = new URL(request.url);
    if (!["/api/player", "/api/diagnostics", "/api/sources"].includes(url.pathname)) {
      return json({ ok: false, error: "Not found", fallback: "Use /api/player?name=PLAYERNAME&platform=pc", links: [] }, 404);
    }

    const name = String(url.searchParams.get("name") || "").trim();
    const platform = String(url.searchParams.get("platform") || "pc").trim().toLowerCase();
    const validation = validateInput(name, platform);
    if (validation) return json(validation.body, validation.status);

    if (url.pathname === "/api/sources") {
      const result = await runSources(name, platform, { includeManual: true, stopOnSuccess: false });
      return json({
        ok: true,
        testedAt: new Date().toISOString(),
        name,
        platform,
        warnings: sourceDiscoveryWarnings(),
        sources: result.sources
      });
    }

    const result = await runSources(name, platform, { includeManual: false, stopOnSuccess: url.pathname === "/api/player" });

    if (url.pathname === "/api/diagnostics") {
      return json({
        ok: true,
        player: name,
        platform,
        testedAt: new Date().toISOString(),
        adapters: result.sources
      });
    }

    if (result.success) {
      return json({
        ok: true,
        source: result.source,
        player: normalizePlayer(result.player, name, platform),
        raw: result.raw,
        warnings: result.warnings,
        adapterDebug: result.sources
      });
    }

    return json({
      ok: false,
      error: "No usable public stats returned",
      fallback: "Open public source link and paste stats manually",
      links: fallbackLinks(name, platform),
      warnings: [
        "Could be wrong name, private/missing stats, upstream downtime, or unsupported source response.",
        ...sourceDiscoveryWarnings(),
        ...result.warnings
      ],
      adapterDebug: result.sources
    }, 200);
  }
};

async function runSources(name, platform, options = {}) {
  const includeManual = Boolean(options.includeManual);
  const stopOnSuccess = Boolean(options.stopOnSuccess);
  const adapters = includeManual ? sourceAdapters : fetchAdapters;
  const sources = [];
  const warnings = [];

  for (const adapter of adapters) {
    if (!adapter.enabled) {
      sources.push(disabledSource(adapter, name, platform, "Adapter disabled"));
      continue;
    }

    const result = adapter.mode === "fetch"
      ? await fetchAndParse(adapter, name, platform)
      : manualSource(adapter, name, platform);

    sources.push(result.debug);
    if (result.warning) warnings.push(result.warning);

    if (result.player && result.debug.parsed) {
      if (stopOnSuccess) {
        return {
          success: true,
          source: adapter.name,
          player: result.player,
          raw: result.raw,
          warnings: [...warnings, ...(result.warnings || [])],
          sources
        };
      }
    }
  }

  const firstWorking = sources.find((source) => source.parsed);
  if (!stopOnSuccess && firstWorking) {
    const successful = sources.find((source) => source.parsed);
    return { success: true, source: successful.name, warnings, sources };
  }

  return { success: false, warnings, sources };
}

async function fetchAndParse(adapter, name, platform) {
  const url = adapter.buildUrl(name, platform);
  const debug = baseDebug(adapter.name, adapter.mode, url);

  if (adapter.supports && !adapter.supports(name, platform)) {
    debug.mode = "unavailable";
    debug.status = "unavailable";
    debug.decision = "disabled";
    debug.error = "Source does not support this platform.";
    return { debug, warning: `${adapter.name}: ${debug.error}` };
  }

  try {
    const { response, rawText } = await adapter.fetchRaw(name, platform);
    debug.httpStatus = response.status;
    debug.contentType = response.headers.get("content-type") || "";
    debug.rawPreview = rawText.slice(0, 500);

    if (!response.ok) {
      debug.status = classifyHttpStatus(response.status);
      debug.decision = "fallback-only";
      debug.error = `HTTP ${response.status}`;
      return { debug, warning: `${adapter.name}: ${debug.error}` };
    }

    const raw = parseRawByContentType(rawText, debug.contentType);
    const parsed = adapter.parse(raw, name, platform, debug);
    if (!parsed || !parsed.player) {
      debug.status = debug.status === "not tested" ? "no usable stats" : debug.status;
      debug.decision = "fallback-only";
      debug.error = debug.error || "No usable stats parsed";
      return { debug, warning: `${adapter.name}: ${debug.error}` };
    }

    const player = adapter.normalize(parsed, name, platform);
    debug.usableFields = usableFields(player);
    debug.parsed = debug.usableFields.length > 0;
    debug.status = debug.parsed ? "working" : "no usable stats";
    debug.decision = debug.parsed ? "use-adapter" : "fallback-only";
    if (!debug.parsed) debug.error = "No normalized stat fields were usable";

    return {
      debug,
      player,
      raw: parsed.raw,
      warnings: parsed.warnings || [],
      warning: debug.parsed ? "" : `${adapter.name}: ${debug.error}`
    };
  } catch (error) {
    debug.status = "upstream unavailable";
    debug.decision = "fallback-only";
    debug.error = readableError(error);
    return { debug, warning: `${adapter.name}: ${debug.error}` };
  }
}

function disabledSource(adapter, name, platform, reason) {
  return {
    ...baseDebug(adapter.name, "unavailable", adapter.buildUrl ? adapter.buildUrl(name, platform) : ""),
    status: "unavailable",
    decision: "disabled",
    error: reason
  };
}

function manualSource(adapter, name, platform) {
  return {
    debug: {
      ...baseDebug(adapter.name, adapter.mode, adapter.buildUrl(name, platform)),
      status: "link/manual only",
      decision: "fallback-only",
      error: "No stable public no-auth stat endpoint is used for this source. Open the link and paste public stats or notes manually."
    }
  };
}

function baseDebug(name, mode, url) {
  return {
    name,
    mode,
    url,
    httpStatus: null,
    contentType: "",
    rawPreview: "",
    parsed: false,
    usableFields: [],
    status: mode === "link-manual" ? "link/manual only" : "not tested",
    decision: mode === "link-manual" ? "fallback-only" : "fallback-only",
    error: ""
  };
}

function linkManualAdapter(name, label, buildUrlFn) {
  return {
    name,
    label,
    mode: "link-manual",
    enabled: true,
    buildUrl: buildUrlFn,
    fetchAndParse() {
      return null;
    },
    parse() {
      return null;
    },
    normalize() {
      return null;
    }
  };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Request timed out"), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.5" }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRawUrl(url) {
  const response = await fetchWithTimeout(url);
  const rawText = await response.text();
  return { response, rawText };
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return "blocked";
  if (status === 502 || status === 503 || status === 504) return "upstream unavailable";
  return "no usable stats";
}

function sourceDiscoveryWarnings() {
  return [
    "GameTools public OpenAPI documents BFV stats endpoints with name, playerid, or oid parameters; name resolution may fail for some players.",
    "BFVHackers exposes a public API and can return public stats for PC players, but its community/algorithmic status is context only.",
    "BFBan, Battlefield Tracker, and EA are kept as link/manual sources here."
  ];
}

function parseRawByContentType(rawText, contentType) {
  if (/json/i.test(contentType)) {
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  }
  const text = rawText.trim();
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      return JSON.parse(text);
    } catch {
      return rawText;
    }
  }
  return rawText;
}

function validateInput(name, platform) {
  if (!name) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "Player name is required",
        fallback: "Enter one player name and try again",
        links: fallbackLinks("", platform),
        adapterDebug: []
      }
    };
  }

  if (name.length > 64) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "Player name is too long",
        fallback: "Use a shorter public player name",
        links: fallbackLinks(name, platform),
        adapterDebug: []
      }
    };
  }

  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "Unsupported platform",
        fallback: "Use pc, ps4, or xboxone",
        links: fallbackLinks(name, "pc"),
        adapterDebug: []
      }
    };
  }

  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: CORS_HEADERS });
}

function emptyPlayer(name, platform) {
  return {
    name,
    platform,
    id: "",
    rank: null,
    kills: null,
    deaths: null,
    kd: null,
    kpm: null,
    spm: null,
    accuracy: null,
    headshotPercent: null,
    hoursPlayed: null,
    favoriteWeapon: "",
    favoriteVehicle: "",
    planeHours: null,
    planeKills: null,
    planeKpm: null,
    tankHours: null,
    tankKills: null,
    vehicleKills: null
  };
}

function parseStatsText(value, name, platform) {
  const player = emptyPlayer(name, platform);
  player.rank = matchNumber(value, /\brank\s*[:#-]?\s*([\d,.]+)/i) || matchNumber(value, /([\d,.]+)\s*rank/i);
  player.kills = matchNumber(value, /\bkills?\s*[:#-]?\s*([\d,.]+)/i) || matchNumber(value, /([\d,.]+)\s*kills?\b/i);
  player.deaths = matchNumber(value, /\bdeaths?\s*[:#-]?\s*([\d,.]+)/i) || matchNumber(value, /([\d,.]+)\s*deaths?\b/i);
  player.kd =
    matchNumber(value, /\bK\/D\s*[:#-]?\s*([\d,.]+)/i) ||
    matchNumber(value, /\bKD\s*[:#-]?\s*([\d,.]+)/i) ||
    matchNumber(value, /([\d,.]+)\s*K\/D/i);
  player.kpm = matchNumber(value, /\bKPM\s*[:#-]?\s*([\d,.]+)/i) || matchNumber(value, /([\d,.]+)\s*KPM/i);
  player.spm = matchNumber(value, /\bSPM\s*[:#-]?\s*([\d,.]+)/i) || matchNumber(value, /([\d,.]+)\s*SPM/i);
  player.accuracy =
    matchNumber(value, /\baccuracy\s*[:#-]?\s*([\d,.]+)%?/i) ||
    matchNumber(value, /([\d,.]+)%\s*accuracy/i);
  player.headshotPercent =
    matchNumber(value, /\bheadshots?\s*[:#-]?\s*([\d,.]+)%?/i) ||
    matchNumber(value, /\bHS\s*%?\s*[:#-]?\s*([\d,.]+)%?/i) ||
    matchNumber(value, /([\d,.]+)%\s*headshots?/i);
  player.hoursPlayed =
    parseHours(value) ||
    matchNumber(value, /\b(?:time played|hours played|playtime)\s*[:#-]?\s*([\d,.]+)\s*h(?:ours?)?/i) ||
    matchNumber(value, /([\d,.]+)\s*(?:hours|hrs)\s*played/i);
  player.planeKills = matchNumber(value, /\bplane kills?\s*[:#-]?\s*([\d,.]+)/i);
  player.tankKills = matchNumber(value, /\btank kills?\s*[:#-]?\s*([\d,.]+)/i);
  player.vehicleKills = matchNumber(value, /\bvehicle kills?\s*[:#-]?\s*([\d,.]+)/i);
  return player;
}

function parseGameToolsObject(root, name, platform) {
  const player = emptyPlayer(name, platform);
  player.name = asText(findValue(root, ["name", "userName", "username", "displayName", "personaName"])) || name;
  player.platform = asText(findValue(root, ["platform"])) || platform;
  player.id = asText(root.id ?? root.playerId ?? root.personaId ?? root.nucleusId ?? root.userId ?? findValue(root, ["id", "playerId", "personaId", "nucleusId", "userId"]));
  player.rank = asNumber(findValue(root, ["rank", "rankNumber"]));
  player.kills = asNumber(findValue(root, ["kills", "killCount"]));
  player.deaths = asNumber(findValue(root, ["deaths", "deathCount"]));
  player.kd = asNumber(findValue(root, ["kd", "kdr", "killDeath", "killDeathRatio", "infantryKillDeath"]));
  player.kpm = asNumber(findValue(root, ["kpm", "killsPerMinute", "infantryKillsPerMinute"]));
  player.spm = asNumber(findValue(root, ["spm", "scorePerMinute"]));
  player.accuracy = asNumber(findValue(root, ["accuracy", "accuracyPercent"]));
  player.headshotPercent = asNumber(findValue(root, ["headshotPercent", "headshotsPercent", "headshotRatio", "hsPercent", "headshots"]));
  player.hoursPlayed =
    asNumber(findValue(root, ["hoursPlayed", "timePlayedHours", "playtimeHours"])) ||
    secondsToHours(root.secondsPlayed ?? findValue(root, ["secondsPlayed", "playtime"])) ||
    parseDurationToHours(root.timePlayed ?? findValue(root, ["timePlayed"]));
  player.favoriteWeapon = findNamedEntry(root, ["weapons", "weaponStats"]) || asText(findValue(root, ["favoriteWeapon", "favoriteWeaponName"]));
  player.favoriteVehicle = findNamedEntry(root, ["vehicles", "vehicleStats"]) || asText(findValue(root, ["favoriteVehicle", "favoriteVehicleName"]));
  const vehicleSummary = summarizeVehicles(findValue(root, ["vehicles", "vehicleStats"]));
  player.planeHours = asNumber(findValue(root, ["planeHours", "airHours"])) || vehicleSummary.planeHours;
  player.planeKills = asNumber(findValue(root, ["planeKills", "airKills"])) || vehicleSummary.planeKills;
  player.planeKpm = asNumber(findValue(root, ["planeKpm", "airKpm"])) || vehicleSummary.planeKpm;
  player.tankHours = asNumber(findValue(root, ["tankHours", "armorHours"])) || vehicleSummary.tankHours;
  player.tankKills = asNumber(findValue(root, ["tankKills", "armorKills"])) || vehicleSummary.tankKills;
  player.vehicleKills = asNumber(findValue(root, ["vehicleKills", "vehiclesKills"])) || vehicleSummary.vehicleKills;
  return player;
}

function parseBfvHackersObject(root, name, platform) {
  const statsAll = root.stats_all && typeof root.stats_all === "object" ? root.stats_all : {};
  const player = parseGameToolsObject(Object.keys(statsAll).length ? statsAll : root, name, platform);
  const stats = root.stats && typeof root.stats === "object" ? root.stats : {};
  player.name = asText(root.player_handle) || player.name || name;
  player.id = asText(root.player_id) || player.id;
  player.rank = player.rank ?? asNumber(stats.rank);
  player.kills = player.kills ?? asNumber(stats.kills);
  player.kpm = player.kpm ?? asNumber(stats.kpm);
  const overall = Array.isArray(root.overall) ? root.overall : [];
  for (const item of overall) {
    const key = asText(item.stat_key).toLowerCase();
    if (key === "kd") player.kd = player.kd ?? asNumber(item.value);
    if (key === "spm") player.spm = player.spm ?? asNumber(item.value);
    if (key === "kpm") player.kpm = player.kpm ?? asNumber(item.value);
  }
  return player;
}

function summarizeVehicles(vehicles) {
  const summary = {
    planeHours: null,
    planeKills: null,
    planeKpm: null,
    tankHours: null,
    tankKills: null,
    vehicleKills: null
  };
  if (!Array.isArray(vehicles) || !vehicles.length) return summary;
  let planeSeconds = 0;
  let tankSeconds = 0;
  let planeKills = 0;
  let tankKills = 0;
  let vehicleKills = 0;
  for (const vehicle of vehicles) {
    if (!vehicle || typeof vehicle !== "object") continue;
    const name = `${vehicle.vehicleName || vehicle.name || ""} ${vehicle.type || ""}`.toLowerCase();
    const kills = asNumber(vehicle.kills) || 0;
    const seconds = asNumber(vehicle.timeIn || vehicle.secondsPlayed || vehicle.timePlayed) || 0;
    vehicleKills += kills;
    if (/plane|planes|aircraft|fighter|bomber|stuka|mosquito|spitfire|zero|corsair|blenheim|ju-88|valentine aa/.test(name)) {
      planeKills += kills;
      planeSeconds += seconds;
    }
    if (/tank|tanks|armor|armour|panzer|tiger|valentine|churchill|sherman|staghound|greyhound|halftrack|ka-mi|type 97/.test(name)) {
      tankKills += kills;
      tankSeconds += seconds;
    }
  }
  summary.vehicleKills = vehicleKills || null;
  summary.planeKills = planeKills || null;
  summary.tankKills = tankKills || null;
  summary.planeHours = planeSeconds ? round(planeSeconds / 3600) : null;
  summary.tankHours = tankSeconds ? round(tankSeconds / 3600) : null;
  summary.planeKpm = planeSeconds ? round(planeKills / (planeSeconds / 60)) : null;
  return summary;
}

function findNamedEntry(root, collectionKeys) {
  const collection = findValue(root, collectionKeys);
  if (!Array.isArray(collection) || !collection.length) return "";
  const sorted = collection
    .filter((item) => item && typeof item === "object")
    .slice()
    .sort((a, b) => (asNumber(findValue(b, ["kills"])) || 0) - (asNumber(findValue(a, ["kills"])) || 0));
  return asText(findValue(sorted[0], ["name", "weaponName", "vehicleName"]));
}

function findValue(root, keys) {
  const queue = [root];
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      item.slice(0, 40).forEach((child) => queue.push(child));
      continue;
    }
    for (const [key, value] of Object.entries(item)) {
      if (wanted.has(key.toLowerCase()) && value !== null && value !== undefined && value !== "") return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function normalizePlayer(player, name, platform) {
  const base = emptyPlayer(name, platform);
  return {
    ...base,
    ...player,
    name: asText(player.name) || name,
    platform: SUPPORTED_PLATFORMS.has(asText(player.platform)) ? asText(player.platform) : platform,
    id: asText(player.id),
    rank: asNullableNumber(player.rank),
    kills: asNullableNumber(player.kills),
    deaths: asNullableNumber(player.deaths),
    kd: asNullableNumber(player.kd),
    kpm: asNullableNumber(player.kpm),
    spm: asNullableNumber(player.spm),
    accuracy: asNullableNumber(player.accuracy),
    headshotPercent: asNullableNumber(player.headshotPercent),
    hoursPlayed: asNullableNumber(player.hoursPlayed),
    favoriteWeapon: asText(player.favoriteWeapon),
    favoriteVehicle: asText(player.favoriteVehicle),
    planeHours: asNullableNumber(player.planeHours),
    planeKills: asNullableNumber(player.planeKills),
    planeKpm: asNullableNumber(player.planeKpm),
    tankHours: asNullableNumber(player.tankHours),
    tankKills: asNullableNumber(player.tankKills),
    vehicleKills: asNullableNumber(player.vehicleKills)
  };
}

function hasAnyStat(player) {
  return usableFields(player).length > 0;
}

function usableFields(player) {
  return [
    "rank",
    "kills",
    "deaths",
    "kd",
    "kpm",
    "spm",
    "accuracy",
    "headshotPercent",
    "hoursPlayed",
    "planeHours",
    "planeKills",
    "planeKpm",
    "tankHours",
    "tankKills",
    "vehicleKills"
  ].filter((key) => player[key] !== null && player[key] !== undefined && player[key] !== "");
}

function fallbackLinks(name, platform) {
  const player = encodeURIComponent(name || "");
  const plat = encodeURIComponent(SUPPORTED_PLATFORMS.has(platform) ? platform : "pc");
  return [
    { label: "Statbits BFV docs", url: sourceTemplates.statbitsLink },
    { label: "GameTools API docs", url: sourceTemplates.gametoolsDocs },
    { label: "BFVHackers API docs", url: sourceTemplates.bfvhackersDocs },
    { label: "GameTools public search/template", url: sourceTemplates.gametoolsLink.replace("{platform}", plat).replace("{player}", player) },
    { label: "BFVHackers search/check", url: sourceTemplates.bfvhackersLink.replace("{player}", player) },
    { label: "Battlefield Tracker search/profile", url: sourceTemplates.trackerLink.replace("{player}", player) },
    { label: "BFBan search/status", url: sourceTemplates.bfbanLink.replace("{player}", player) },
    { label: "EA report/help", url: sourceTemplates.eaReportLink }
  ];
}

function buildUrl(template, name, platform) {
  return template
    .replace("{platform}", encodeURIComponent(platform))
    .replace("{player}", encodeURIComponent(name));
}

function parseHours(value) {
  const match = String(value).match(/(\d+(?:\.\d+)?)h(?:\s+(\d+)m)?/i);
  if (!match) return null;
  return round(parseFloat(match[1]) + parseFloat(match[2] || "0") / 60);
}

function matchNumber(value, pattern) {
  const match = String(value).match(pattern);
  return match ? asNumber(match[1]) : null;
}

function secondsToHours(value) {
  const n = asNumber(value);
  return n === null ? null : round(n / 3600);
}

function parseDurationToHours(value) {
  const text = asText(value);
  if (!text) return null;
  const dayMatch = text.match(/(\d+(?:\.\d+)?)\s*days?/i);
  const hmsMatch = text.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (dayMatch || hmsMatch) {
    const days = dayMatch ? parseFloat(dayMatch[1]) : 0;
    const hours = hmsMatch ? parseFloat(hmsMatch[1] || "0") : 0;
    const minutes = hmsMatch ? parseFloat(hmsMatch[2] || "0") : 0;
    return round(days * 24 + hours + minutes / 60);
  }
  return parseHours(text);
}

function asText(value) {
  return String(value || "").trim();
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[,%]/g, ""));
  return Number.isFinite(n) ? round(n) : null;
}

function asNullableNumber(value) {
  const n = asNumber(value);
  return n === null ? null : n;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function readableError(error) {
  if (error && error.name === "AbortError") return "Request timed out";
  const message = error && error.message ? error.message : String(error || "Unknown error");
  return message.slice(0, 180);
}
