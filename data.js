const BFV_DATA = {
  appName: "BFV Field Intel Companion",
  storageKey: "bfvFieldIntelCompanion.v1",
  supportedPlatforms: [
    { value: "pc", label: "PC" },
    { value: "ps4", label: "PS4" },
    { value: "xboxone", label: "Xbox One" }
  ],
  maps: [
    "Arras",
    "Rotterdam",
    "Devastation",
    "Twisted Steel",
    "Hamada",
    "Aerodrome",
    "Narvik",
    "Fjell 652",
    "Panzerstorm",
    "Mercury",
    "Marita",
    "Al Sundan",
    "Operation Underground",
    "Iwo Jima",
    "Pacific Storm",
    "Wake Island",
    "Solomon Islands",
    "Provence",
    "Al Marj Encampment"
  ],
  reportStatuses: [
    "not reported",
    "reported in-game",
    "reported via EA profile",
    "other"
  ],
  scoringThresholds: [
    { max: 20, label: "Legit" },
    { max: 40, label: "Watch" },
    { max: 65, label: "Suspicious" },
    { max: 84, label: "Very Suspicious" },
    { max: 100, label: "Report-worthy evidence" }
  ],
  sourceTemplates: {
    statbits:
      "https://api.statbits.io/chatmsg/bfv/stats/{platform}/players/{identifier}/summary-short-a?forceOk=true&errMsg=Fetch%20failed%20or%20blocked.%20Open%20source%20link%20and%20paste%20stats%20manually.",
    statbitsReadable:
      "https://statbits.io/chatmsg-api/battlefield-5/",
    gametools:
      "https://gametools.network/?game=bfv&platform={platform}&query={player}",
    bfvhackers:
      "https://bfvhackers.com/?search={player}",
    tracker:
      "https://battlefieldtracker.com/bfv/search/{player}",
    bfban:
      "https://bfban.com/player?name={player}",
    eaReport:
      "https://help.ea.com/en/help/faq/report-players-for-cheating-abuse-and-harassment/"
  },
  defaultPlayer: {
    id: "",
    createdAt: "",
    updatedAt: "",
    name: "",
    platform: "pc",
    playerId: "",
    serverName: "",
    map: "",
    contextNotes: "",
    kd: "",
    kpm: "",
    spm: "",
    accuracy: "",
    headshot: "",
    kills: "",
    deaths: "",
    rank: "",
    hoursPlayed: "",
    planeHours: "",
    planeKills: "",
    planeKpm: "",
    tankHours: "",
    tankKills: "",
    vehicleKills: "",
    favoriteVehicle: "",
    vehicleHeadshotNotes: "",
    favoriteWeapon: "",
    suspiciousWeaponNotes: "",
    suspiciousVehicleNotes: "",
    bfvhackersStatus: "",
    bfbanStatus: "",
    sourceLinks: [],
    videoEvidenceLink: "",
    screenshotNote: "",
    scoreboardNote: "",
    observedBehavior: "",
    reportStatus: "not reported"
  },
  defaultServerCheck: {
    id: "",
    createdAt: "",
    dateTime: "",
    serverName: "",
    region: "",
    map: "",
    mode: "",
    suspectedPlayers: "",
    strongNormalPlayers: "",
    observedBehavior: "",
    disconnectNotes: "",
    evidenceRefs: "",
    finalNotes: "",
    linkedPlayerIds: []
  },
  defaultEvidence: {
    id: "",
    createdAt: "",
    player: "",
    playerId: "",
    dateTime: "",
    server: "",
    map: "",
    observedBehavior: "",
    killCardNotes: "",
    scoreboardNotes: "",
    weaponVehicleUsed: "",
    screenshotNote: "",
    videoLink: "",
    sourceLinks: "",
    reportStatus: "not reported",
    followUpNotes: ""
  },
  reportTemplate:
    "I observed [behavior] on [server/map/date]. Evidence available: [screenshot/video/scoreboard/source links]. Please review.",
  disclaimers: {
    primary:
      "Stats are not proof. Use this as triage only. Do not harass. Report through official EA tools with evidence.",
    fan:
      "Fan-made personal companion. Not affiliated with EA, DICE, or Battlefield. No logos, artwork, ads, tracking, logins, or private scraping.",
    fetch:
      "Fetch failed or blocked. Open source link and paste stats manually.",
    scoring:
      "High K/D alone is not proof. Add KPM, hours, weapon stats, and evidence before reporting."
  }
};
