"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3001);
const IS_VERCEL = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = process.env.DATA_FILE || (IS_VERCEL ? path.join("/tmp", "sarthisync-data.json") : path.join(__dirname, "data.json"));
const SESSION_COOKIE = "ss_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SESSION_SECRET = process.env.SESSION_SECRET || "sarthisync-dev-session-secret";
const VALID_STATUSES = ["Pending", "In Transit", "Delivered"];
const VALID_CONSIGNMENT_STATUSES = ["Draft", "Assigned", "In Transit", "Delivered", "Exception"];
const DEFAULT_MAP_CENTER = { lat: 22.5937, lng: 78.9629 };

const CITY_COORDINATES = {
  "new delhi": { lat: 28.6139, lng: 77.209 },
  "delhi": { lat: 28.6139, lng: 77.209 },
  "mumbai": { lat: 19.076, lng: 72.8777 },
  "pune": { lat: 18.5204, lng: 73.8567 },
  "jaipur": { lat: 26.9124, lng: 75.7873 },
  "lucknow": { lat: 26.8467, lng: 80.9462 },
  "kanpur": { lat: 26.4499, lng: 80.3319 },
  "prayagraj": { lat: 25.4358, lng: 81.8463 },
  "agra": { lat: 27.1767, lng: 78.0081 },
  "meerut": { lat: 28.9845, lng: 77.7064 },
  "noida": { lat: 28.5355, lng: 77.391 },
  "gurugram": { lat: 28.4595, lng: 77.0266 },
  "chandigarh": { lat: 30.7333, lng: 76.7794 },
  "dehradun": { lat: 30.3165, lng: 78.0322 },
  "amritsar": { lat: 31.634, lng: 74.8723 },
  "varanasi": { lat: 25.3176, lng: 82.9739 },
  "patna": { lat: 25.5941, lng: 85.1376 },
  "ranchi": { lat: 23.3441, lng: 85.3096 },
  "kolkata": { lat: 22.5726, lng: 88.3639 },
  "bhubaneswar": { lat: 20.2961, lng: 85.8245 },
  "raipur": { lat: 21.2514, lng: 81.6296 },
  "nagpur": { lat: 21.1458, lng: 79.0882 },
  "hyderabad": { lat: 17.385, lng: 78.4867 },
  "bengaluru": { lat: 12.9716, lng: 77.5946 },
  "mysuru": { lat: 12.2958, lng: 76.6394 },
  "chennai": { lat: 13.0827, lng: 80.2707 },
  "coimbatore": { lat: 11.0168, lng: 76.9558 },
  "kochi": { lat: 9.9312, lng: 76.2673 },
  "thiruvananthapuram": { lat: 8.5241, lng: 76.9366 },
  "visakhapatnam": { lat: 17.6868, lng: 83.2185 },
  "indore": { lat: 22.7196, lng: 75.8577 },
  "bhopal": { lat: 23.2599, lng: 77.4126 },
  "surat": { lat: 21.1702, lng: 72.8311 },
  "ahmedabad": { lat: 23.0225, lng: 72.5714 },
  "vadodara": { lat: 22.3072, lng: 73.1812 },
  "goa": { lat: 15.2993, lng: 74.124 }
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

let dataInitPromise = null;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function unauthorized(res) {
  sendJson(res, 401, { error: "Unauthorized" });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};

  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx < 0) return acc;
      const key = decodeURIComponent(part.slice(0, eqIdx));
      const value = decodeURIComponent(part.slice(eqIdx + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function signSessionPayload(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}

function safeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createSessionToken(userId, expiresAt) {
  const payload = `${userId}.${expiresAt}`;
  const signature = signSessionPayload(payload);
  return `${payload}.${signature}`;
}

function parseSessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  const [userIdRaw, expiresAtRaw, signature] = parts;
  const payload = `${userIdRaw}.${expiresAtRaw}`;
  const expectedSignature = signSessionPayload(payload);
  if (!safeStringEqual(signature, expectedSignature)) {
    return null;
  }

  const userId = Number(userIdRaw);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isInteger(userId) || !Number.isFinite(expiresAt)) {
    return null;
  }

  if (expiresAt <= Date.now()) {
    return null;
  }

  return { userId, expiresAt };
}

function setSessionCookie(res, token) {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = parseSessionToken(token);
  if (!session) return null;

  return { token, ...session };
}

function cleanExpiredSessions() {
  // Stateless signed-cookie sessions do not need in-memory cleanup.
}

async function parseJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

async function readData() {
  const raw = await fsp.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return ensureDataShape(parsed);
}

async function writeData(data) {
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.tmp`;
  await fsp.writeFile(tempFile, JSON.stringify(data, null, 2), "utf8");
  await fsp.rename(tempFile, DATA_FILE);
}

function createStarterData() {
  return {
    users: [
      {
        id: 1,
        username: "Agam",
        password: "5280",
        name: "Agam Pathak",
        role: "admin"
      }
    ],
    vehicles: [],
    drivers: [],
    routes: [],
    assignments: [],
    consignments: [],
    counters: {
      vehicle: 1,
      driver: 1,
      route: 1,
      assignment: 1,
      consignment: 1,
      invoice: 1
    }
  };
}

async function ensureDataFile() {
  if (dataInitPromise) {
    return dataInitPromise;
  }

  dataInitPromise = (async () => {
    await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
    try {
      await fsp.access(DATA_FILE, fs.constants.F_OK);
    } catch {
      await writeData(createStarterData());
    }
  })();

  return dataInitPromise;
}

function pickUserPublic(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role
  };
}

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function generateOtp(length = 4) {
  const max = 10 ** length;
  return String(Math.floor(Math.random() * max)).padStart(length, "0");
}

function nextCounter(data, key) {
  const current = Number.isInteger(data.counters[key]) ? data.counters[key] : 1;
  data.counters[key] = current + 1;
  return current;
}

function sanitizeConsignmentStatus(status) {
  const normalized = String(status || "").trim();
  if (VALID_CONSIGNMENT_STATUSES.includes(normalized)) {
    return normalized;
  }
  return "Draft";
}

function ensureConsignmentShape(consignment) {
  const now = new Date().toISOString();
  if (!consignment.createdAt) consignment.createdAt = now;
  if (!consignment.updatedAt) consignment.updatedAt = consignment.createdAt;
  consignment.status = sanitizeConsignmentStatus(consignment.status);
  consignment.assignmentId = Number.isInteger(consignment.assignmentId) ? consignment.assignmentId : null;
  consignment.weightKg = Math.max(0, toNumber(consignment.weightKg, 0));
  consignment.customerName = String(consignment.customerName || "").trim();
  consignment.material = String(consignment.material || "").trim();
  consignment.lrNumber = String(consignment.lrNumber || "").trim();
  if (consignment.promisedEta) {
    const eta = new Date(consignment.promisedEta);
    consignment.promisedEta = Number.isNaN(eta.getTime()) ? null : eta.toISOString();
  } else {
    consignment.promisedEta = null;
  }
  consignment.pickupOtp = String(consignment.pickupOtp || generateOtp(4));
  consignment.dropOtp = String(consignment.dropOtp || generateOtp(4));
  consignment.pickupVerifiedAt = consignment.pickupVerifiedAt ? new Date(consignment.pickupVerifiedAt).toISOString() : null;
  consignment.dropVerifiedAt = consignment.dropVerifiedAt ? new Date(consignment.dropVerifiedAt).toISOString() : null;
  consignment.invoice = consignment.invoice && typeof consignment.invoice === "object" ? consignment.invoice : null;
  consignment.pod = consignment.pod && typeof consignment.pod === "object" ? consignment.pod : null;
  consignment.exception = consignment.exception && typeof consignment.exception === "object" ? consignment.exception : null;
}

function ensureDataShape(data) {
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.vehicles)) data.vehicles = [];
  if (!Array.isArray(data.drivers)) data.drivers = [];
  if (!Array.isArray(data.routes)) data.routes = [];
  if (!Array.isArray(data.assignments)) data.assignments = [];
  if (!Array.isArray(data.consignments)) data.consignments = [];

  if (!data.counters || typeof data.counters !== "object") {
    data.counters = {};
  }
  if (!Number.isInteger(data.counters.vehicle)) data.counters.vehicle = 1;
  if (!Number.isInteger(data.counters.driver)) data.counters.driver = 1;
  if (!Number.isInteger(data.counters.route)) data.counters.route = 1;
  if (!Number.isInteger(data.counters.assignment)) data.counters.assignment = 1;
  if (!Number.isInteger(data.counters.consignment)) data.counters.consignment = 1;
  if (!Number.isInteger(data.counters.invoice)) data.counters.invoice = 1;

  data.assignments.forEach((assignment) => {
    assignment.consignmentId = Number.isInteger(assignment.consignmentId) ? assignment.consignmentId : null;
  });

  data.consignments.forEach((consignment) => {
    ensureConsignmentShape(consignment);
  });

  return data;
}

function normalizePlace(place) {
  return String(place || "").trim().toLowerCase();
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function fallbackCoordinate(place) {
  const base = hashString(place || "unknown");
  const lat = 8 + (base % 2800) / 100;
  const lng = 68 + ((Math.floor(base / 7) + 97) % 2900) / 100;
  return {
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5))
  };
}

function resolveCoordinate(place) {
  const key = normalizePlace(place);
  if (CITY_COORDINATES[key]) {
    return CITY_COORDINATES[key];
  }
  if (!key) {
    return DEFAULT_MAP_CENTER;
  }
  return fallbackCoordinate(key);
}

function interpolatePosition(source, destination, progress) {
  const ratio = clamp(Number(progress) / 100, 0, 1);
  return {
    lat: Number((source.lat + (destination.lat - source.lat) * ratio).toFixed(5)),
    lng: Number((source.lng + (destination.lng - source.lng) * ratio).toFixed(5))
  };
}

function statusDefaultProgress(status) {
  if (status === "Pending") return 0;
  if (status === "In Transit") return 50;
  if (status === "Delivered") return 100;
  return 0;
}

function sanitizeStatus(value) {
  const status = String(value || "").trim();
  if (VALID_STATUSES.includes(status)) {
    return status;
  }
  return "Pending";
}

function ensureAssignmentTracking(assignment) {
  const now = new Date().toISOString();
  assignment.status = sanitizeStatus(assignment.status);
  assignment.progress = clamp(toNumber(assignment.progress, statusDefaultProgress(assignment.status)), 0, 100);
  if (!assignment.createdAt) assignment.createdAt = now;
  if (!assignment.updatedAt) assignment.updatedAt = assignment.createdAt;

  if (!Array.isArray(assignment.timeline) || assignment.timeline.length === 0) {
    assignment.timeline = [
      {
        timestamp: assignment.createdAt,
        status: assignment.status,
        progress: assignment.progress,
        note: "Tracking initialized"
      }
    ];
    return;
  }

  assignment.timeline = assignment.timeline
    .map((event) => {
      const status = sanitizeStatus(event.status);
      const progress = clamp(toNumber(event.progress, statusDefaultProgress(status)), 0, 100);
      const timestamp = new Date(event.timestamp || assignment.createdAt || now).toISOString();
      const note = String(event.note || "").trim();
      return {
        timestamp,
        status,
        progress,
        note
      };
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function getDynamicProgress(assignment) {
  const saved = clamp(toNumber(assignment.progress, statusDefaultProgress(assignment.status)), 0, 100);

  if (assignment.status === "Pending") return 0;
  if (assignment.status === "Delivered") return 100;

  const reference = Date.parse(assignment.updatedAt || assignment.createdAt || new Date().toISOString());
  const elapsedMinutes = Math.max(0, (Date.now() - reference) / 60000);
  const drift = clamp(elapsedMinutes * 1.25, 0, 24);
  return clamp(Math.max(saved, 45) + drift, 0, 95);
}

function getRouteCoords(route) {
  const sourceCoords = resolveCoordinate(route ? route.source : "");
  const destinationCoords = resolveCoordinate(route ? route.destination : "");
  return { sourceCoords, destinationCoords };
}

function hydrateConsignment(consignment, data) {
  ensureConsignmentShape(consignment);

  const assignment = consignment.assignmentId
    ? data.assignments.find((item) => item.id === consignment.assignmentId)
    : null;
  const hydratedAssignment = assignment ? hydrateAssignment(assignment, data) : null;

  return {
    id: consignment.id,
    lrNumber: consignment.lrNumber,
    customerName: consignment.customerName,
    material: consignment.material,
    weightKg: consignment.weightKg,
    promisedEta: consignment.promisedEta,
    status: consignment.status,
    assignmentId: consignment.assignmentId,
    createdAt: consignment.createdAt,
    updatedAt: consignment.updatedAt,
    pickupOtp: consignment.pickupOtp,
    dropOtp: consignment.dropOtp,
    pickupVerifiedAt: consignment.pickupVerifiedAt,
    dropVerifiedAt: consignment.dropVerifiedAt,
    pod: consignment.pod,
    invoice: consignment.invoice,
    exception: consignment.exception,
    assignment: hydratedAssignment
      ? {
          id: hydratedAssignment.id,
          vehiclePlate: hydratedAssignment.vehiclePlate,
          driverName: hydratedAssignment.driverName,
          routeSource: hydratedAssignment.routeSource,
          routeDestination: hydratedAssignment.routeDestination,
          status: hydratedAssignment.status,
          cost: hydratedAssignment.cost
        }
      : null
  };
}

function hydrateAssignment(assignment, data, options = {}) {
  ensureAssignmentTracking(assignment);

  const vehicle = data.vehicles.find((item) => item.id === assignment.vehicleId);
  const route = data.routes.find((item) => item.id === assignment.routeId);
  const driver = data.drivers.find((item) => item.id === assignment.driverId);
  const consignment = assignment.consignmentId
    ? data.consignments.find((item) => item.id === assignment.consignmentId)
    : null;
  const { sourceCoords, destinationCoords } = getRouteCoords(route);

  const dynamicProgress = options.dynamic ? getDynamicProgress(assignment) : assignment.progress;
  const currentPosition = interpolatePosition(sourceCoords, destinationCoords, dynamicProgress);

  const timeline = assignment.timeline.map((event) => {
    const position = interpolatePosition(sourceCoords, destinationCoords, event.progress);
    return {
      timestamp: event.timestamp,
      status: event.status,
      progress: event.progress,
      note: event.note,
      position
    };
  });

  return {
    id: assignment.id,
    status: assignment.status,
    progress: Number(dynamicProgress.toFixed(2)),
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
    vehicleId: assignment.vehicleId,
    routeId: assignment.routeId,
    driverId: assignment.driverId,
    vehiclePlate: vehicle ? vehicle.plate : "Unknown",
    vehicleType: vehicle ? vehicle.type : "Unknown",
    vehicleCapacity: vehicle ? vehicle.capacity : 0,
    routeSource: route ? route.source : "Unknown",
    routeDestination: route ? route.destination : "Unknown",
    distanceKm: route ? route.distance : 0,
    durationHrs: route ? route.duration : 0,
    driverName: driver ? driver.name : "Unknown",
    consignmentId: assignment.consignmentId || null,
    lrNumber: consignment ? consignment.lrNumber : null,
    cost: vehicle && route ? Number((vehicle.rate * route.distance).toFixed(2)) : 0,
    sourceCoords,
    destinationCoords,
    currentPosition,
    timeline
  };
}

function getVehicleSpeedMultiplier(vehicleType) {
  const type = String(vehicleType || "").toLowerCase();
  if (type.includes("bike")) return 1.3;
  if (type.includes("scooter")) return 1.25;
  if (type.includes("van")) return 1.12;
  if (type.includes("car")) return 1.1;
  if (type.includes("truck")) return 0.9;
  if (type.includes("bus")) return 0.85;
  return 1;
}

function buildCopilotRecommendations(data, route, requiredCapacity, priority) {
  const activeAssignments = data.assignments.map((item) => {
    ensureAssignmentTracking(item);
    return item;
  });

  const candidates = [];

  for (const vehicle of data.vehicles) {
    const capacityGap = vehicle.capacity - requiredCapacity;
    if (requiredCapacity > 0 && capacityGap < 0) {
      continue;
    }

    const vehicleActive = activeAssignments.filter(
      (assignment) => assignment.vehicleId === vehicle.id && assignment.status !== "Delivered"
    ).length;

    const estimatedCost = Number((vehicle.rate * route.distance).toFixed(2));
    const speedMultiplier = getVehicleSpeedMultiplier(vehicle.type);
    const estimatedEtaHrs = Number((route.duration / speedMultiplier).toFixed(2));

    for (const driver of data.drivers) {
      const driverActive = activeAssignments.filter(
        (assignment) => assignment.driverId === driver.id && assignment.status !== "Delivered"
      ).length;

      candidates.push({
        vehicle,
        driver,
        estimatedCost,
        estimatedEtaHrs,
        capacityGap,
        vehicleActive,
        driverActive
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const minCost = Math.min(...candidates.map((item) => item.estimatedCost));
  const maxCost = Math.max(...candidates.map((item) => item.estimatedCost));
  const minEta = Math.min(...candidates.map((item) => item.estimatedEtaHrs));
  const maxEta = Math.max(...candidates.map((item) => item.estimatedEtaHrs));

  const weightsByPriority = {
    cost: { cost: 0.54, speed: 0.18, fit: 0.16, availability: 0.12 },
    speed: { cost: 0.2, speed: 0.52, fit: 0.13, availability: 0.15 },
    balanced: { cost: 0.34, speed: 0.31, fit: 0.2, availability: 0.15 }
  };

  const weights = weightsByPriority[priority] || weightsByPriority.balanced;

  const ranked = candidates.map((candidate) => {
    const costScore = maxCost === minCost ? 100 : 100 - ((candidate.estimatedCost - minCost) / (maxCost - minCost)) * 100;
    const speedScore = maxEta === minEta ? 100 : 100 - ((candidate.estimatedEtaHrs - minEta) / (maxEta - minEta)) * 100;
    const availabilityScore = clamp(100 - (candidate.vehicleActive * 18 + candidate.driverActive * 16), 15, 100);

    let fitScore = 72;
    if (requiredCapacity > 0) {
      const utilization = clamp(requiredCapacity / candidate.vehicle.capacity, 0, 1);
      fitScore = clamp(100 - Math.abs(0.8 - utilization) * 120, 20, 100);
    }

    const score = Number(
      (
        costScore * weights.cost +
        speedScore * weights.speed +
        fitScore * weights.fit +
        availabilityScore * weights.availability
      ).toFixed(2)
    );

    const reason = `Cost ₹${candidate.estimatedCost.toFixed(2)}, ETA ${candidate.estimatedEtaHrs}h, active load V${candidate.vehicleActive}/D${candidate.driverActive}.`;

    return {
      vehicleId: candidate.vehicle.id,
      vehiclePlate: candidate.vehicle.plate,
      vehicleType: candidate.vehicle.type,
      vehicleCapacity: candidate.vehicle.capacity,
      driverId: candidate.driver.id,
      driverName: candidate.driver.name,
      driverLicense: candidate.driver.license,
      estimatedCost: candidate.estimatedCost,
      estimatedEtaHrs: candidate.estimatedEtaHrs,
      score,
      reason
    };
  });

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.estimatedCost - b.estimatedCost;
  });
}

function resolveConsignmentStateFromAssignment(consignment, assignment) {
  if (!assignment) return consignment.status;

  if (consignment.exception) return "Exception";
  if (assignment.status === "Pending") return "Assigned";
  if (assignment.status === "In Transit") return "In Transit";
  if (assignment.status === "Delivered") {
    if (consignment.dropVerifiedAt && consignment.pod) return "Delivered";
    return "In Transit";
  }
  return consignment.status;
}

function calculateInvoiceSummary(assignmentCost, toll, fuelSurcharge, waitingCharge, taxPercent) {
  const baseCost = Math.max(0, toNumber(assignmentCost, 0));
  const tollCost = Math.max(0, toNumber(toll, 0));
  const fuelCost = Math.max(0, toNumber(fuelSurcharge, 0));
  const waitingCost = Math.max(0, toNumber(waitingCharge, 0));
  const tax = clamp(toNumber(taxPercent, 0), 0, 100);
  const subTotal = Number((baseCost + tollCost + fuelCost + waitingCost).toFixed(2));
  const taxAmount = Number((subTotal * (tax / 100)).toFixed(2));
  const totalAmount = Number((subTotal + taxAmount).toFixed(2));
  return {
    baseCost,
    tollCost,
    fuelSurcharge: fuelCost,
    waitingCharge: waitingCost,
    taxPercent: tax,
    taxAmount,
    subTotal,
    totalAmount
  };
}

async function handleApi(req, res, url) {
  cleanExpiredSessions();
  const pathname = url.pathname;

  if (pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, service: "sarthisync-live" });
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return badRequest(res, err.message);
    }

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    if (!username || !password) {
      return badRequest(res, "Username and password are required");
    }

    const data = await readData();
    const user = data.users.find((item) => item.username === username && item.password === password);
    if (!user) {
      return sendJson(res, 401, { error: "Invalid credentials" });
    }

    const token = createSessionToken(user.id, Date.now() + SESSION_TTL_MS);
    setSessionCookie(res, token);
    return sendJson(res, 200, { user: pickUserPublic(user) });
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    clearSessionCookie(res);
    return sendNoContent(res);
  }

  if (pathname === "/api/auth/me" && req.method === "GET") {
    const session = getSession(req);
    if (!session) return unauthorized(res);

    const data = await readData();
    const user = data.users.find((item) => item.id === session.userId);
    if (!user) {
      clearSessionCookie(res);
      return unauthorized(res);
    }

    setSessionCookie(res, createSessionToken(user.id, Date.now() + SESSION_TTL_MS));
    return sendJson(res, 200, { user: pickUserPublic(user) });
  }

  const session = getSession(req);
  if (!session) return unauthorized(res);

  if (pathname === "/api/vehicles") {
    if (req.method === "GET") {
      const data = await readData();
      return sendJson(res, 200, { items: data.vehicles });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return badRequest(res, err.message);
      }

      const plate = String(body.plate || "").trim();
      const type = String(body.type || "").trim();
      const capacity = toNumber(body.capacity);
      const rate = toNumber(body.rate);

      if (!plate || !type || !Number.isFinite(capacity) || !Number.isFinite(rate)) {
        return badRequest(res, "Plate, type, capacity, and rate are required");
      }
      if (capacity <= 0 || rate <= 0) {
        return badRequest(res, "Capacity and rate must be greater than 0");
      }

      const data = await readData();
      const duplicate = data.vehicles.find((item) => item.plate.toLowerCase() === plate.toLowerCase());
      if (duplicate) {
        return badRequest(res, "Vehicle with this number plate already exists");
      }

      const vehicle = {
        id: data.counters.vehicle++,
        plate,
        type,
        capacity,
        rate
      };
      data.vehicles.push(vehicle);
      await writeData(data);
      return sendJson(res, 201, { item: vehicle });
    }
  }

  if (pathname === "/api/drivers") {
    if (req.method === "GET") {
      const data = await readData();
      return sendJson(res, 200, { items: data.drivers });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return badRequest(res, err.message);
      }

      const name = String(body.name || "").trim();
      const license = String(body.license || "").trim();
      const phone = String(body.phone || "").trim();

      if (!name || !license || !phone) {
        return badRequest(res, "Name, license, and phone are required");
      }

      const data = await readData();
      const duplicate = data.drivers.find((item) => item.license.toLowerCase() === license.toLowerCase());
      if (duplicate) {
        return badRequest(res, "Driver with this license already exists");
      }

      const driver = {
        id: data.counters.driver++,
        name,
        license,
        phone
      };
      data.drivers.push(driver);
      await writeData(data);
      return sendJson(res, 201, { item: driver });
    }
  }

  if (pathname === "/api/routes") {
    if (req.method === "GET") {
      const data = await readData();
      return sendJson(res, 200, { items: data.routes });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return badRequest(res, err.message);
      }

      const source = String(body.source || "").trim();
      const destination = String(body.destination || "").trim();
      const distance = toNumber(body.distance);
      const duration = toNumber(body.duration);

      if (!source || !destination || !Number.isFinite(distance) || !Number.isFinite(duration)) {
        return badRequest(res, "Source, destination, distance, and duration are required");
      }
      if (distance <= 0 || duration <= 0) {
        return badRequest(res, "Distance and duration must be greater than 0");
      }

      const data = await readData();
      const route = {
        id: data.counters.route++,
        source,
        destination,
        distance,
        duration
      };
      data.routes.push(route);
      await writeData(data);
      return sendJson(res, 201, { item: route });
    }
  }

  if (pathname === "/api/consignments") {
    if (req.method === "GET") {
      const data = await readData();
      const items = data.consignments
        .map((item) => hydrateConsignment(item, data))
        .sort((a, b) => b.id - a.id);
      return sendJson(res, 200, { items });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return badRequest(res, err.message);
      }

      const lrNumber = String(body.lrNumber || "").trim();
      const customerName = String(body.customerName || "").trim();
      const material = String(body.material || "").trim();
      const weightKg = Math.max(0, toNumber(body.weightKg, NaN));
      const promisedEtaRaw = String(body.promisedEta || "").trim();
      const promisedEta = promisedEtaRaw ? new Date(promisedEtaRaw) : null;

      if (!lrNumber || !customerName || !material || !Number.isFinite(weightKg) || weightKg <= 0) {
        return badRequest(res, "LR number, customer name, material, and weight are required");
      }
      if (promisedEtaRaw && Number.isNaN(promisedEta.getTime())) {
        return badRequest(res, "Invalid promised ETA");
      }

      const data = await readData();
      const duplicate = data.consignments.find((item) => item.lrNumber.toLowerCase() === lrNumber.toLowerCase());
      if (duplicate) {
        return badRequest(res, "Consignment with this LR number already exists");
      }

      const now = new Date().toISOString();
      const consignment = {
        id: nextCounter(data, "consignment"),
        lrNumber,
        customerName,
        material,
        weightKg,
        promisedEta: promisedEta ? promisedEta.toISOString() : null,
        status: "Draft",
        assignmentId: null,
        pickupOtp: generateOtp(4),
        dropOtp: generateOtp(4),
        pickupVerifiedAt: null,
        dropVerifiedAt: null,
        pod: null,
        invoice: null,
        exception: null,
        createdAt: now,
        updatedAt: now
      };
      data.consignments.push(consignment);
      await writeData(data);
      return sendJson(res, 201, { item: hydrateConsignment(consignment, data) });
    }
  }

  if (pathname.startsWith("/api/consignments/") && pathname.endsWith("/otp/verify") && req.method === "POST") {
    const parts = pathname.split("/").filter(Boolean);
    const consignmentId = Number(parts[2]);
    if (!Number.isInteger(consignmentId)) return badRequest(res, "Invalid consignment id");

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return badRequest(res, err.message);
    }

    const stage = String(body.stage || "").trim().toLowerCase();
    const otp = String(body.otp || "").trim();
    if (!["pickup", "drop"].includes(stage)) {
      return badRequest(res, "Stage must be pickup or drop");
    }
    if (!otp) {
      return badRequest(res, "OTP is required");
    }

    const data = await readData();
    const consignment = data.consignments.find((item) => item.id === consignmentId);
    if (!consignment) return notFound(res);

    ensureConsignmentShape(consignment);

    const expectedOtp = stage === "pickup" ? consignment.pickupOtp : consignment.dropOtp;
    if (otp !== expectedOtp) {
      return badRequest(res, `Invalid ${stage} OTP`);
    }

    const now = new Date().toISOString();
    if (stage === "pickup") {
      consignment.pickupVerifiedAt = now;
      if (consignment.status === "Draft") {
        consignment.status = consignment.assignmentId ? "Assigned" : "Draft";
      }
    } else {
      consignment.dropVerifiedAt = now;
      if (consignment.status !== "Exception") {
        consignment.status = "In Transit";
      }
    }
    consignment.updatedAt = now;
    await writeData(data);

    return sendJson(res, 200, {
      item: hydrateConsignment(consignment, data),
      message: `${stage === "pickup" ? "Pickup" : "Drop"} OTP verified`
    });
  }

  if (pathname.startsWith("/api/consignments/") && pathname.endsWith("/pod") && req.method === "POST") {
    const parts = pathname.split("/").filter(Boolean);
    const consignmentId = Number(parts[2]);
    if (!Number.isInteger(consignmentId)) return badRequest(res, "Invalid consignment id");

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return badRequest(res, err.message);
    }

    const receiverName = String(body.receiverName || "").trim();
    const signature = String(body.signature || "").trim();
    const photoUrl = String(body.photoUrl || "").trim();
    const gpsLat = toNumber(body.gpsLat, NaN);
    const gpsLng = toNumber(body.gpsLng, NaN);

    if (!receiverName || !signature) {
      return badRequest(res, "Receiver name and signature are required for POD");
    }

    const data = await readData();
    const consignment = data.consignments.find((item) => item.id === consignmentId);
    if (!consignment) return notFound(res);

    const assignment = consignment.assignmentId
      ? data.assignments.find((item) => item.id === consignment.assignmentId)
      : null;

    const now = new Date().toISOString();
    consignment.pod = {
      receiverName,
      signature,
      photoUrl: photoUrl || null,
      gps:
        Number.isFinite(gpsLat) && Number.isFinite(gpsLng)
          ? {
              lat: Number(gpsLat.toFixed(6)),
              lng: Number(gpsLng.toFixed(6))
            }
          : null,
      timestamp: now
    };
    consignment.updatedAt = now;

    if (assignment && assignment.status === "Delivered" && consignment.dropVerifiedAt) {
      consignment.status = "Delivered";
    } else if (consignment.status !== "Exception") {
      consignment.status = "In Transit";
    }

    await writeData(data);
    return sendJson(res, 200, { item: hydrateConsignment(consignment, data) });
  }

  if (pathname.startsWith("/api/consignments/") && pathname.endsWith("/invoice") && req.method === "POST") {
    const parts = pathname.split("/").filter(Boolean);
    const consignmentId = Number(parts[2]);
    if (!Number.isInteger(consignmentId)) return badRequest(res, "Invalid consignment id");

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return badRequest(res, err.message);
    }

    const data = await readData();
    const consignment = data.consignments.find((item) => item.id === consignmentId);
    if (!consignment) return notFound(res);
    if (!consignment.assignmentId) {
      return badRequest(res, "Consignment must be assigned before invoice generation");
    }

    const assignment = data.assignments.find((item) => item.id === consignment.assignmentId);
    if (!assignment) {
      return badRequest(res, "Linked assignment not found for billing");
    }

    const hydrated = hydrateAssignment(assignment, data);
    const summary = calculateInvoiceSummary(
      hydrated.cost,
      body.toll,
      body.fuelSurcharge,
      body.waitingCharge,
      body.taxPercent
    );

    const invoiceNumber = `INV-${String(nextCounter(data, "invoice")).padStart(5, "0")}`;
    const now = new Date().toISOString();
    consignment.invoice = {
      invoiceNumber,
      generatedAt: now,
      status: "Generated",
      ...summary
    };
    consignment.updatedAt = now;
    await writeData(data);

    return sendJson(res, 200, {
      item: hydrateConsignment(consignment, data),
      invoice: consignment.invoice
    });
  }

  if (pathname.startsWith("/api/consignments/") && pathname.endsWith("/exception") && req.method === "POST") {
    const parts = pathname.split("/").filter(Boolean);
    const consignmentId = Number(parts[2]);
    if (!Number.isInteger(consignmentId)) return badRequest(res, "Invalid consignment id");

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return badRequest(res, err.message);
    }

    const type = String(body.type || "").trim();
    const note = String(body.note || "").trim();
    if (!type || !note) {
      return badRequest(res, "Exception type and note are required");
    }

    const data = await readData();
    const consignment = data.consignments.find((item) => item.id === consignmentId);
    if (!consignment) return notFound(res);

    const now = new Date().toISOString();
    consignment.exception = { type, note, createdAt: now };
    consignment.status = "Exception";
    consignment.updatedAt = now;
    await writeData(data);

    return sendJson(res, 200, { item: hydrateConsignment(consignment, data) });
  }

  if (pathname === "/api/assignments") {
    if (req.method === "GET") {
      const data = await readData();
      const items = data.assignments.map((item) => hydrateAssignment(item, data));
      return sendJson(res, 200, { items });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return badRequest(res, err.message);
      }

      const vehicleId = toNumber(body.vehicleId);
      const routeId = toNumber(body.routeId);
      const driverId = toNumber(body.driverId);
      const consignmentIdRaw = body.consignmentId;
      const consignmentId =
        consignmentIdRaw === null || consignmentIdRaw === undefined || consignmentIdRaw === ""
          ? null
          : toNumber(consignmentIdRaw);

      if (!Number.isInteger(vehicleId) || !Number.isInteger(routeId) || !Number.isInteger(driverId)) {
        return badRequest(res, "Vehicle, route, and driver are required");
      }
      if (consignmentId !== null && !Number.isInteger(consignmentId)) {
        return badRequest(res, "Invalid consignment selection");
      }

      const data = await readData();
      const vehicle = data.vehicles.find((item) => item.id === vehicleId);
      const route = data.routes.find((item) => item.id === routeId);
      const driver = data.drivers.find((item) => item.id === driverId);
      const consignment =
        consignmentId !== null ? data.consignments.find((item) => item.id === consignmentId) : null;

      if (!vehicle || !route || !driver) {
        return badRequest(res, "Invalid vehicle, route, or driver selection");
      }
      if (consignmentId !== null && !consignment) {
        return badRequest(res, "Invalid consignment selection");
      }
      if (consignment && consignment.assignmentId && consignment.assignmentId !== null) {
        return badRequest(res, "Selected consignment is already linked to another assignment");
      }

      const vehicleBusy = data.assignments.some(
        (item) => item.vehicleId === vehicleId && item.status !== "Delivered"
      );
      if (vehicleBusy) {
        return badRequest(res, "Vehicle already has an active assignment");
      }

      const driverBusy = data.assignments.some(
        (item) => item.driverId === driverId && item.status !== "Delivered"
      );
      if (driverBusy) {
        return badRequest(res, "Driver already has an active assignment");
      }

      const now = new Date().toISOString();
      const assignment = {
        id: data.counters.assignment++,
        vehicleId,
        routeId,
        driverId,
        consignmentId,
        status: "Pending",
        progress: 0,
        timeline: [
          {
            timestamp: now,
            status: "Pending",
            progress: 0,
            note: "Assignment created"
          }
        ],
        createdAt: now,
        updatedAt: now
      };

      data.assignments.push(assignment);
      if (consignment) {
        consignment.assignmentId = assignment.id;
        consignment.status = "Assigned";
        consignment.updatedAt = now;
      }
      await writeData(data);

      return sendJson(res, 201, { item: hydrateAssignment(assignment, data) });
    }
  }

  if (pathname.startsWith("/api/assignments/") && pathname.endsWith("/status") && req.method === "PATCH") {
    const parts = pathname.split("/").filter(Boolean);
    const assignmentId = Number(parts[2]);
    if (!Number.isInteger(assignmentId)) return badRequest(res, "Invalid assignment id");

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return badRequest(res, err.message);
    }

    const status = String(body.status || "").trim();
    if (!VALID_STATUSES.includes(status)) {
      return badRequest(res, "Invalid status value");
    }

      const data = await readData();
      const assignment = data.assignments.find((item) => item.id === assignmentId);
      if (!assignment) return notFound(res);
      const consignment = assignment.consignmentId
        ? data.consignments.find((item) => item.id === assignment.consignmentId)
        : null;

      ensureAssignmentTracking(assignment);

      if (status === "Delivered" && consignment) {
        if (!consignment.dropVerifiedAt) {
          return badRequest(res, "Drop OTP must be verified before marking delivered");
        }
        if (!consignment.pod) {
          return badRequest(res, "Proof of delivery is required before marking delivered");
        }
      }

      const requestedProgress = toNumber(body.progress, NaN);
      let nextProgress = assignment.progress;

    if (Number.isFinite(requestedProgress)) {
      nextProgress = clamp(requestedProgress, 0, 100);
    } else if (status === "Pending") {
      nextProgress = 0;
    } else if (status === "Delivered") {
      nextProgress = 100;
    } else {
      nextProgress = clamp(Math.max(assignment.progress, 50), 0, 95);
    }

    const now = new Date().toISOString();
    assignment.status = status;
    assignment.progress = nextProgress;
    assignment.updatedAt = now;
    assignment.timeline.push({
      timestamp: now,
      status,
      progress: nextProgress,
      note: `Status changed to ${status}`
    });

    assignment.timeline = assignment.timeline.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    if (consignment) {
      consignment.status = resolveConsignmentStateFromAssignment(consignment, assignment);
      consignment.updatedAt = now;
    }

    await writeData(data);

    return sendJson(res, 200, { item: hydrateAssignment(assignment, data) });
  }

  if (pathname.startsWith("/api/assignments/") && req.method === "DELETE") {
    const parts = pathname.split("/").filter(Boolean);
    const assignmentId = Number(parts[2]);
    if (!Number.isInteger(assignmentId)) return badRequest(res, "Invalid assignment id");

    const data = await readData();
    const existing = data.assignments.find((item) => item.id === assignmentId);
    if (!existing) return notFound(res);

    const before = data.assignments.length;
    data.assignments = data.assignments.filter((item) => item.id !== assignmentId);
    if (data.assignments.length === before) return notFound(res);

    if (existing.consignmentId) {
      const consignment = data.consignments.find((item) => item.id === existing.consignmentId);
      if (consignment) {
        consignment.assignmentId = null;
        consignment.status = consignment.exception ? "Exception" : "Draft";
        consignment.updatedAt = new Date().toISOString();
      }
    }

    await writeData(data);
    return sendNoContent(res);
  }

  if (pathname === "/api/fleet/live" && req.method === "GET") {
    const data = await readData();
    const items = data.assignments.map((item) => hydrateAssignment(item, data, { dynamic: true }));
    return sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      center: DEFAULT_MAP_CENTER,
      items
    });
  }

  if (pathname === "/api/copilot/recommendation" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return badRequest(res, err.message);
    }

    const routeId = toNumber(body.routeId);
    const requiredCapacity = clamp(toNumber(body.requiredCapacity, 0), 0, 1000000);
    const priority = String(body.priority || "balanced").trim().toLowerCase();

    if (!Number.isInteger(routeId)) {
      return badRequest(res, "Route selection is required for Copilot");
    }

    if (!["cost", "speed", "balanced"].includes(priority)) {
      return badRequest(res, "Priority must be one of: cost, speed, balanced");
    }

    const data = await readData();
    const route = data.routes.find((item) => item.id === routeId);
    if (!route) {
      return badRequest(res, "Route not found");
    }

    if (data.vehicles.length === 0 || data.drivers.length === 0) {
      return badRequest(res, "Add at least one vehicle and one driver to use Copilot");
    }

    const candidates = buildCopilotRecommendations(data, route, requiredCapacity, priority);
    if (candidates.length === 0) {
      return badRequest(res, "No feasible vehicle-driver pair matches requested load");
    }

    const scenarios = ["balanced", "cost", "speed"]
      .map((mode) => {
        const ranked = buildCopilotRecommendations(data, route, requiredCapacity, mode);
        if (!ranked.length) return null;
        return {
          mode,
          recommendation: ranked[0]
        };
      })
      .filter(Boolean);

    const activePriorityResult =
      scenarios.find((scenario) => scenario.mode === priority)?.recommendation || candidates[0];

    let insight = "";
    if (candidates.length === 1) {
      insight =
        "Only one feasible pair is available for current data. Add more vehicles/drivers or reduce load to see alternatives.";
    } else if (requiredCapacity > 0) {
      insight =
        "Load filter is active. Lower required load or add higher-capacity vehicles to broaden suggestions.";
    } else {
      insight = "Multiple pairings were evaluated using cost, ETA, fit, and active load.";
    }

    return sendJson(res, 200, {
      route: {
        id: route.id,
        source: route.source,
        destination: route.destination,
        distanceKm: route.distance,
        durationHrs: route.duration
      },
      requiredCapacity,
      priority,
      recommendation: activePriorityResult,
      alternatives: candidates.slice(1, 5),
      scenarios,
      candidateCount: candidates.length,
      resourceSummary: {
        vehicles: data.vehicles.length,
        drivers: data.drivers.length
      },
      insight
    });
  }

  if (pathname === "/api/reset" && req.method === "POST") {
    const data = await readData();
    data.vehicles = [];
    data.drivers = [];
    data.routes = [];
    data.assignments = [];
    data.consignments = [];
    data.counters.vehicle = 1;
    data.counters.driver = 1;
    data.counters.route = 1;
    data.counters.assignment = 1;
    data.counters.consignment = 1;
    data.counters.invoice = 1;
    await writeData(data);
    return sendNoContent(res);
  }

  return notFound(res);
}

async function serveStatic(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method)) {
    return notFound(res);
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return notFound(res);
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      return notFound(res);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypes[ext] || "application/octet-stream";
    const stream = fs.createReadStream(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size
    });

    if (req.method === "HEAD") {
      res.end();
      stream.destroy();
      return;
    }

    stream.pipe(res);
    stream.on("error", () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Failed to read static file" });
      } else {
        res.destroy();
      }
    });
  } catch {
    notFound(res);
  }
}

function createRequestHandler() {
  return async (req, res) => {
    try {
      await ensureDataFile();
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
      } else {
        await serveStatic(req, res, url);
      }
    } catch (err) {
      sendJson(res, 500, { error: "Internal server error", detail: err.message });
    }
  };
}

async function startServer() {
  await ensureDataFile();
  const server = http.createServer(createRequestHandler());
  server.listen(PORT, () => {
    console.log(`SarthiSync live app running at http://localhost:${PORT}`);
    console.log("Login credentials -> username: Agam | password: 5280");
  });
  return server;
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Failed to start SarthiSync live app:", err);
    process.exit(1);
  });
}

module.exports = {
  createRequestHandler,
  startServer
};
