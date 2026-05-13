const SUPPORTED_PLATFORMS = new Set(["pc", "ps4", "xboxone"]);

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
  gametoolsLink: "https://gametools.network/?game=bfv&platform={platform}&query={player}",
  bfvhackersLink: "https://bfvhackers.com/?search={player}",
  trackerLink: "https://battlefieldtracker.com/bfv/search/{player}",
  bfbanLink: "https://bfban.com/player?name={player}",
  eaReportLink: "https://help.ea.com/en/help/faq/report-players-for-cheating-abuse-and-harassment/"
};

const gametoolsVariants = [
  {
    variant: "stats",
    url: "https://api.gametools.network/bfv/stats/?name={player}&platform={platform}"
  },
  {
    variant: "stats-format-values",
    url: "https://api.gametools.network/bfv/stats/?format_values=true&name={player}&platform={platform}"
  },
  {
    variant: "all",
    url: "https://api.gametools.network/bfv/all/?name={player}&platform={platform}"
  },
  {
    variant: "weapons",
    url: "https://api.gametools.network/bfv/weapons/?name={player}&platform={platform}"
  },
  {
    variant: "vehicles",
    url: "https://api.gametools.network/bfv/vehicles/?name={player}&platform={platform}"
  }
];

const adapters = [
  {
    name: "statbits",
    enabled: true,
    buildUrls(name, platform) {
      return [
        {
          name: "statbits",
          variant: "summary-short-a",
          url: buildUrl(sourceTemplates.statbits, name, platform)
        }
      ];
    },
    parse(raw, name, platform) {
      if (typeof raw !== "string") return null;
      const value = raw.trim();
      if (!value || /source unavailable|blocked|failed|error|not found|invalid|could not/i.test(value)) {
        return null;
      }
      const player = parseStatsText(value, name, platform);
      return hasAnyStat(player)
        ? { player, raw: value, warnings: ["Parsed from Statbits text response; review fields before saving."] }
        : null;
    }
  },
  {
    name: "gametools",
    enabled: true,
    buildUrls(name, platform) {
      return gametoolsVariants.map((item) => ({
        name: "gametools",
        variant: item.variant,
        url: buildUrl(item.url, name, platform)
      }));
    },
    parse(raw, name, platform) {
      const root = raw && typeof raw === "object" ? raw : {};
      const player = parseGameToolsObject(root, name, platform);
      return hasAnyStat(player)
        ? { player, raw: root, warnings: ["Parsed defensively from GameTools JSON; missing fields are left null."] }
        : null;
    }
  }
];

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "Method not allowed", fallback: "Use GET /api/player?name=PLAYERNAME&platform=pc", links: [] }, 405);
    }

    const url = new URL(request.url);
    if (!["/api/player", "/api/diagnostics"].includes(url.pathname)) {
      return json({ ok: false, error: "Not found", fallback: "Use /api/player?name=PLAYERNAME&platform=pc", links: [] }, 404);
    }

    const name = String(url.searchParams.get("name") || "").trim();
    const platform = String(url.searchParams.get("platform") || "pc").trim().toLowerCase();
    const validation = validateInput(name, platform);
    if (validation) return json(validation.body, validation.status);

    const result = await runAdapters(name, platform);

    if (url.pathname === "/api/diagnostics") {
      return json({
        ok: true,
        player: name,
        platform,
        testedAt: new Date().toISOString(),
        adapters: result.adapterDebug
      });
    }

    if (result.success) {
      return json({
        ok: true,
        source: result.source,
        player: normalizePlayer(result.player, name, platform),
        raw: result.raw,
        warnings: result.warnings,
        adapterDebug: result.adapterDebug
      });
    }

    return json({
      ok: false,
      error: "No usable stats returned",
      fallback: "Open public source link and paste stats manually",
      links: fallbackLinks(name, platform),
      warnings: [
        "Could be wrong name, private/missing stats, upstream downtime, or unsupported source response.",
        ...result.warnings
      ],
      adapterDebug: result.adapterDebug
    }, 200);
  }
};

async function runAdapters(name, platform) {
  const adapterDebug = [];
  const warnings = [];

  for (const adapter of adapters) {
    if (!adapter.enabled) continue;

    for (const candidate of adapter.buildUrls(name, platform)) {
      const debug = {
        name: candidate.variant ? `${adapter.name}:${candidate.variant}` : adapter.name,
        url: candidate.url,
        httpStatus: null,
        contentType: "",
        rawPreview: "",
        parsed: false,
        error: ""
      };

      try {
        const response = await fetch(candidate.url, {
          method: "GET",
          headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.5" }
        });
        debug.httpStatus = response.status;
        debug.contentType = response.headers.get("content-type") || "";
        const rawText = await response.text();
        debug.rawPreview = rawText.slice(0, 500);

        if (!response.ok) {
          debug.error = `HTTP ${response.status}`;
          adapterDebug.push(debug);
          warnings.push(`${debug.name}: HTTP ${response.status}`);
          continue;
        }

        const raw = parseRawByContentType(rawText, debug.contentType);
        const parsed = adapter.parse(raw, name, platform);
        if (parsed && parsed.player) {
          debug.parsed = true;
          adapterDebug.push(debug);
          return {
            success: true,
            source: debug.name,
            player: parsed.player,
            raw: parsed.raw,
            warnings: [...warnings, ...(parsed.warnings || [])],
            adapterDebug
          };
        }

        debug.error = "No usable stats parsed";
        adapterDebug.push(debug);
        warnings.push(`${debug.name}: no usable stats parsed`);
      } catch (error) {
        debug.error = readableError(error);
        adapterDebug.push(debug);
        warnings.push(`${debug.name}: ${debug.error}`);
      }
    }
  }

  return { success: false, warnings, adapterDebug };
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
  player.id = asText(findValue(root, ["id", "playerId", "personaId", "nucleusId"]));
  player.rank = asNumber(findValue(root, ["rank", "rankNumber"]));
  player.kills = asNumber(findValue(root, ["kills", "killCount"]));
  player.deaths = asNumber(findValue(root, ["deaths", "deathCount"]));
  player.kd = asNumber(findValue(root, ["kd", "kdr", "killDeath", "killDeathRatio"]));
  player.kpm = asNumber(findValue(root, ["kpm", "killsPerMinute"]));
  player.spm = asNumber(findValue(root, ["spm", "scorePerMinute"]));
  player.accuracy = asNumber(findValue(root, ["accuracy", "accuracyPercent"]));
  player.headshotPercent = asNumber(findValue(root, ["headshotPercent", "headshotsPercent", "headshotRatio", "hsPercent"]));
  player.hoursPlayed =
    asNumber(findValue(root, ["hoursPlayed", "timePlayedHours", "playtimeHours"])) ||
    secondsToHours(findValue(root, ["timePlayed", "secondsPlayed", "playtime"]));
  player.favoriteWeapon = asText(findValue(root, ["favoriteWeapon", "favoriteWeaponName"]));
  player.favoriteVehicle = asText(findValue(root, ["favoriteVehicle", "favoriteVehicleName"]));
  player.planeHours = asNumber(findValue(root, ["planeHours", "airHours"]));
  player.planeKills = asNumber(findValue(root, ["planeKills", "airKills"]));
  player.planeKpm = asNumber(findValue(root, ["planeKpm", "airKpm"]));
  player.tankHours = asNumber(findValue(root, ["tankHours", "armorHours"]));
  player.tankKills = asNumber(findValue(root, ["tankKills", "armorKills"]));
  player.vehicleKills = asNumber(findValue(root, ["vehicleKills", "vehiclesKills"]));
  return player;
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
      item.slice(0, 30).forEach((child) => queue.push(child));
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
    planeHours: asNullableNumber(player.planeHours),
    planeKills: asNullableNumber(player.planeKills),
    planeKpm: asNullableNumber(player.planeKpm),
    tankHours: asNullableNumber(player.tankHours),
    tankKills: asNullableNumber(player.tankKills),
    vehicleKills: asNullableNumber(player.vehicleKills)
  };
}

function hasAnyStat(player) {
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
  ].some((key) => player[key] !== null && player[key] !== undefined && player[key] !== "");
}

function fallbackLinks(name, platform) {
  const player = encodeURIComponent(name || "");
  const plat = encodeURIComponent(SUPPORTED_PLATFORMS.has(platform) ? platform : "pc");
  return [
    { label: "Statbits BFV docs", url: sourceTemplates.statbitsLink },
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
  const message = error && error.message ? error.message : String(error || "Unknown error");
  return message.slice(0, 180);
}
