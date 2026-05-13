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
  gametools:
    "https://api.gametools.network/bfv/stats/?name={player}&platform={platform}",
  statbitsLink: "https://statbits.io/chatmsg-api/battlefield-5/",
  gametoolsLink: "https://gametools.network/?game=bfv&platform={platform}&query={player}",
  bfvhackersLink: "https://bfvhackers.com/?search={player}",
  trackerLink: "https://battlefieldtracker.com/bfv/search/{player}",
  bfbanLink: "https://bfban.com/player?name={player}",
  eaReportLink: "https://help.ea.com/en/help/faq/report-players-for-cheating-abuse-and-harassment/"
};

const adapters = [
  {
    name: "statbits",
    enabled: true,
    buildUrl(name, platform) {
      return sourceTemplates.statbits
        .replace("{platform}", encodeURIComponent(platform))
        .replace("{player}", encodeURIComponent(name));
    },
    async fetch(name, platform) {
      const response = await fetch(this.buildUrl(name, platform), {
        method: "GET",
        headers: { Accept: "text/plain, application/json;q=0.8" }
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Statbits returned HTTP ${response.status}`);
      }
      return raw;
    },
    parse(raw, name, platform) {
      const value = String(raw || "").trim();
      if (!value || /source unavailable|blocked|failed|error|not found|invalid/i.test(value)) {
        return null;
      }
      const player = emptyPlayer(name, platform);
      player.hoursPlayed = parseHours(value);
      player.kd = matchNumber(value, /([\d.]+)\s*K\/D/i);
      player.kpm = matchNumber(value, /([\d.]+)\s*KPM/i);
      player.spm = matchNumber(value, /([\d.]+)\s*SPM/i);
      player.accuracy = matchNumber(value, /([\d.]+)%\s*accuracy/i);
      player.headshotPercent = matchNumber(value, /([\d.]+)%\s*headshots?/i);
      return hasAnyStat(player) ? { player, raw: value, warnings: ["Parsed from Statbits text response; review fields before saving."] } : null;
    }
  },
  {
    name: "gametools",
    enabled: true,
    buildUrl(name, platform) {
      return sourceTemplates.gametools
        .replace("{platform}", encodeURIComponent(platform))
        .replace("{player}", encodeURIComponent(name));
    },
    async fetch(name, platform) {
      const response = await fetch(this.buildUrl(name, platform), {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`GameTools returned HTTP ${response.status}`);
      }
      return JSON.parse(raw);
    },
    parse(raw, name, platform) {
      const root = raw && typeof raw === "object" ? raw : {};
      const stats = root.stats || root.result || root.player || root;
      const player = emptyPlayer(name, platform);
      player.name = asText(stats.name || stats.userName || stats.displayName || root.name || name);
      player.platform = asText(stats.platform || platform) || platform;
      player.id = asText(stats.id || stats.playerId || stats.personaId || stats.nucleusId);
      player.rank = asNumber(stats.rank || stats.rankNumber);
      player.kills = asNumber(stats.kills || stats.killCount);
      player.deaths = asNumber(stats.deaths || stats.deathCount);
      player.kd = asNumber(stats.kd || stats.kdr || stats.killDeath || stats.killDeathRatio);
      player.kpm = asNumber(stats.kpm || stats.killsPerMinute);
      player.spm = asNumber(stats.spm || stats.scorePerMinute);
      player.accuracy = asNumber(stats.accuracy || stats.accuracyPercent);
      player.headshotPercent = asNumber(stats.headshotPercent || stats.headshotsPercent || stats.headshotRatio);
      player.hoursPlayed = asNumber(stats.hoursPlayed || stats.timePlayedHours) || secondsToHours(stats.timePlayed || stats.secondsPlayed);
      player.favoriteWeapon = asText(stats.favoriteWeapon || stats.favoriteWeaponName);
      player.favoriteVehicle = asText(stats.favoriteVehicle || stats.favoriteVehicleName);
      player.planeHours = asNumber(stats.planeHours || stats.airHours);
      player.planeKills = asNumber(stats.planeKills || stats.airKills);
      player.planeKpm = asNumber(stats.planeKpm || stats.airKpm);
      player.tankHours = asNumber(stats.tankHours || stats.armorHours);
      player.tankKills = asNumber(stats.tankKills || stats.armorKills);
      player.vehicleKills = asNumber(stats.vehicleKills || stats.vehiclesKills);
      return hasAnyStat(player) ? { player, raw: root, warnings: ["Parsed defensively from GameTools JSON; missing fields are left null."] } : null;
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
    if (url.pathname !== "/api/player") {
      return json({ ok: false, error: "Not found", fallback: "Use /api/player?name=PLAYERNAME&platform=pc", links: [] }, 404);
    }

    const name = String(url.searchParams.get("name") || "").trim();
    const platform = String(url.searchParams.get("platform") || "pc").trim().toLowerCase();

    if (!name) {
      return json({ ok: false, error: "Player name is required", fallback: "Enter one player name and try again", links: fallbackLinks("", platform) }, 400);
    }

    if (name.length > 64) {
      return json({ ok: false, error: "Player name is too long", fallback: "Use a shorter public player name", links: fallbackLinks(name, platform) }, 400);
    }

    if (!SUPPORTED_PLATFORMS.has(platform)) {
      return json({ ok: false, error: "Unsupported platform", fallback: "Use pc, ps4, or xboxone", links: fallbackLinks(name, "pc") }, 400);
    }

    const warnings = [];
    for (const adapter of adapters) {
      if (!adapter.enabled) continue;
      try {
        const raw = await adapter.fetch(name, platform);
        const parsed = adapter.parse(raw, name, platform);
        if (parsed && parsed.player) {
          return json({
            ok: true,
            source: adapter.name,
            player: normalizePlayer(parsed.player, name, platform),
            raw: parsed.raw,
            warnings: [...warnings, ...(parsed.warnings || [])]
          });
        }
        warnings.push(`${adapter.name} returned no usable stats.`);
      } catch (error) {
        warnings.push(`${adapter.name}: ${readableError(error)}`);
      }
    }

    return json({
      ok: false,
      error: "Source unavailable or blocked",
      fallback: "Open public source link and paste stats manually",
      links: fallbackLinks(name, platform),
      warnings
    }, 200);
  }
};

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
  const n = Number(String(value).replace("%", ""));
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
