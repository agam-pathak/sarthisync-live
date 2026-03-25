"use strict";

const state = {
  user: null,
  vehicles: [],
  drivers: [],
  routes: [],
  consignments: [],
  assignments: [],
  filteredAssignments: [],
  chart: null,
  darkMode: false,
  map: null,
  mapReady: false,
  mapHasFitted: false,
  mapLayers: {
    route: null,
    progress: null,
    marker: null
  },
  fleetLiveItems: [],
  playbackFrames: [],
  playbackIndex: 0,
  playbackMode: false,
  playbackTimer: null,
  fleetRefreshTimer: null,
  liveDriftTimer: null,
  isSignUp: false
};

const STATUS_OPTIONS = ["Pending", "In Transit", "Delivered"];

const ids = {
  loginView: document.getElementById("loginView"),
  appView: document.getElementById("appView"),
  loginForm: document.getElementById("loginForm"),
  flash: document.getElementById("flash"),
  userBadge: document.getElementById("userBadge"),
  darkModeBtn: document.getElementById("darkModeBtn"),
  resetBtn: document.getElementById("resetBtn"),
  exportBtn: document.getElementById("exportBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  metricVehicles: document.getElementById("metricVehicles"),
  metricDrivers: document.getElementById("metricDrivers"),
  metricRoutes: document.getElementById("metricRoutes"),
  metricAssignments: document.getElementById("metricAssignments"),
  vehicleForm: document.getElementById("vehicleForm"),
  driverForm: document.getElementById("driverForm"),
  routeForm: document.getElementById("routeForm"),
  consignmentForm: document.getElementById("consignmentForm"),
  assignmentForm: document.getElementById("assignmentForm"),
  assignmentVehicle: document.getElementById("assignmentVehicle"),
  assignmentRoute: document.getElementById("assignmentRoute"),
  assignmentDriver: document.getElementById("assignmentDriver"),
  assignmentConsignment: document.getElementById("assignmentConsignment"),
  searchBox: document.getElementById("searchBox"),
  assignmentTableBody: document.getElementById("assignmentTableBody"),
  consignmentTableBody: document.getElementById("consignmentTableBody"),
  vehicleTableBody: document.getElementById("vehicleTableBody"),
  driverTableBody: document.getElementById("driverTableBody"),
  routeTableBody: document.getElementById("routeTableBody"),
  statusChart: document.getElementById("statusChart"),
  fleetMap: document.getElementById("fleetMap"),
  fleetMeta: document.getElementById("fleetMeta"),
  playbackRange: document.getElementById("playbackRange"),
  playbackPlayBtn: document.getElementById("playbackPlayBtn"),
  playbackPauseBtn: document.getElementById("playbackPauseBtn"),
  playbackLiveBtn: document.getElementById("playbackLiveBtn"),
  playbackTime: document.getElementById("playbackTime"),
  copilotForm: document.getElementById("copilotForm"),
  copilotRoute: document.getElementById("copilotRoute"),
  copilotLoad: document.getElementById("copilotLoad"),
  copilotPriority: document.getElementById("copilotPriority"),
  copilotResult: document.getElementById("copilotResult"),
  opsConsignment: document.getElementById("opsConsignment"),
  opsStage: document.getElementById("opsStage"),
  opsOtp: document.getElementById("opsOtp"),
  otpVerifyForm: document.getElementById("otpVerifyForm"),
  podForm: document.getElementById("podForm"),
  podReceiver: document.getElementById("podReceiver"),
  podSignature: document.getElementById("podSignature"),
  podPhotoUrl: document.getElementById("podPhotoUrl"),
  podGpsLat: document.getElementById("podGpsLat"),
  podGpsLng: document.getElementById("podGpsLng"),
  opsStatus: document.getElementById("opsStatus"),
  invoiceForm: document.getElementById("invoiceForm"),
  invoiceToll: document.getElementById("invoiceToll"),
  invoiceFuel: document.getElementById("invoiceFuel"),
  invoiceWaiting: document.getElementById("invoiceWaiting"),
  invoiceTax: document.getElementById("invoiceTax"),
  invoiceResult: document.getElementById("invoiceResult"),
  exceptionForm: document.getElementById("exceptionForm"),
  exceptionType: document.getElementById("exceptionType"),
  exceptionNote: document.getElementById("exceptionNote"),
  nameGroup: document.getElementById("nameGroup"),
  nameInput: document.getElementById("name"),
  authBtn: document.getElementById("authBtn"),
  authToggle: document.getElementById("authToggle")
};

function showFlash(message, type = "info") {
  const item = document.createElement("div");
  item.className = `flash-item ${type}`;
  item.textContent = message;
  ids.flash.appendChild(item);

  setTimeout(() => {
    item.remove();
  }, 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const hasBody = response.status !== 204;
  let payload = null;
  if (hasBody) {
    payload = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const message = payload && payload.error ? payload.error : "Request failed";
    throw new Error(message);
  }

  return payload;
}

function setView(loggedIn) {
  ids.loginView.classList.toggle("d-none", loggedIn);
  ids.appView.classList.toggle("d-none", !loggedIn);

  if (loggedIn) {
    ensureMap();
    startFleetRefresh();
    startLiveDrift();
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
      }
    }, 80);
  } else {
    stopFleetRefresh();
    stopPlayback();
    stopLiveDrift();
    state.playbackMode = false;
  }
}

function applyTheme() {
  document.body.classList.toggle("dark", state.darkMode);
  localStorage.setItem("ss_dark_mode", state.darkMode ? "1" : "0");

  if (state.chart) {
    state.chart.options.plugins.legend.labels.color = getComputedStyle(document.body)
      .getPropertyValue("--text")
      .trim();
    state.chart.update();
  }
}

function formatCurrency(num) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(num || 0));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function statusBadge(status) {
  const map = {
    Pending: "text-bg-warning",
    "In Transit": "text-bg-primary",
    Delivered: "text-bg-success"
  };
  return `<span class="badge ${map[status] || "text-bg-secondary"} badge-status">${status}</span>`;
}

function statusColor(status) {
  if (status === "Pending") return "#f59e0b";
  if (status === "In Transit") return "#2563eb";
  if (status === "Delivered") return "#16a34a";
  return "#64748b";
}

function consignmentStatusBadge(status) {
  const map = {
    Draft: "text-bg-secondary",
    Assigned: "text-bg-primary",
    "In Transit": "text-bg-warning",
    Delivered: "text-bg-success",
    Exception: "text-bg-danger"
  };
  return `<span class="badge ${map[status] || "text-bg-secondary"} badge-status">${status}</span>`;
}

function formatConsignmentOption(item) {
  return `${item.lrNumber} • ${item.customerName} • ${item.status}`;
}

function parseSelectedConsignmentId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function interpolateTrackPosition(source, destination, progress) {
  const ratio = clampNumber(Number(progress) / 100, 0, 1);
  return {
    lat: Number((source.lat + (destination.lat - source.lat) * ratio).toFixed(5)),
    lng: Number((source.lng + (destination.lng - source.lng) * ratio).toFixed(5))
  };
}

function statusFromProgress(progress) {
  const safe = clampNumber(Number(progress), 0, 100);
  if (safe <= 0) return "Pending";
  if (safe >= 100) return "Delivered";
  return "In Transit";
}

function renderMetrics() {
  ids.metricVehicles.textContent = String(state.vehicles.length);
  ids.metricDrivers.textContent = String(state.drivers.length);
  ids.metricRoutes.textContent = String(state.routes.length);
  ids.metricAssignments.textContent = String(state.assignments.length);
}

function renderSelect(el, items, labelBuilder, emptyLabel = "No data available") {
  if (!items.length) {
    el.innerHTML = `<option value="">${emptyLabel}</option>`;
    return;
  }

  el.innerHTML = items
    .map((item) => `<option value="${item.id}">${labelBuilder(item)}</option>`)
    .join("");
}

function renderMasterDataTables() {
  ids.vehicleTableBody.innerHTML = state.vehicles.length
    ? state.vehicles
        .map(
          (v) => `
            <tr>
              <td><strong>#${v.id}</strong> ${v.plate}<br><small class="text-secondary">${v.type} • ${v.capacity} kg • ${formatCurrency(v.rate)}/km</small></td>
            </tr>`
        )
        .join("")
    : '<tr><td class="text-secondary">No vehicles added.</td></tr>';

  ids.driverTableBody.innerHTML = state.drivers.length
    ? state.drivers
        .map(
          (d) => `
            <tr>
              <td><strong>#${d.id}</strong> ${d.name}<br><small class="text-secondary">${d.license} • ${d.phone}</small></td>
            </tr>`
        )
        .join("")
    : '<tr><td class="text-secondary">No drivers added.</td></tr>';

  ids.routeTableBody.innerHTML = state.routes.length
    ? state.routes
        .map(
          (r) => `
            <tr>
              <td><strong>#${r.id}</strong> ${r.source} → ${r.destination}<br><small class="text-secondary">${r.distance} km • ${r.duration} hrs</small></td>
            </tr>`
        )
        .join("")
    : '<tr><td class="text-secondary">No routes added.</td></tr>';
}

function updateAssignmentSelects() {
  renderSelect(ids.assignmentVehicle, state.vehicles, (v) => `#${v.id} ${v.plate} (${v.type})`);
  renderSelect(ids.assignmentRoute, state.routes, (r) => `#${r.id} ${r.source} → ${r.destination} (${r.distance} km)`);
  renderSelect(ids.assignmentDriver, state.drivers, (d) => `#${d.id} ${d.name} (${d.license})`);

  const freeConsignments = state.consignments.filter((item) => !item.assignmentId);
  if (!freeConsignments.length) {
    ids.assignmentConsignment.innerHTML = '<option value="">No unassigned consignment</option>';
  } else {
    ids.assignmentConsignment.innerHTML = [
      '<option value="">No consignment</option>',
      ...freeConsignments.map((item) => `<option value="${item.id}">${formatConsignmentOption(item)}</option>`)
    ].join("");
  }
}

function updateCopilotRouteSelect() {
  renderSelect(
    ids.copilotRoute,
    state.routes,
    (r) => `#${r.id} ${r.source} → ${r.destination} (${r.distance} km)`
  );
}

function updateOpsConsignmentSelect() {
  if (!state.consignments.length) {
    ids.opsConsignment.innerHTML = '<option value="">No consignments available</option>';
    return;
  }

  ids.opsConsignment.innerHTML = state.consignments
    .map((item) => `<option value="${item.id}">${formatConsignmentOption(item)}</option>`)
    .join("");
}

function renderInvoiceSummary(consignment) {
  if (!consignment || !consignment.invoice) {
    ids.invoiceResult.textContent = "Invoice summary will appear here after generation.";
    return;
  }

  const invoice = consignment.invoice;
  ids.invoiceResult.innerHTML = `
    <div class="invoice-card">
      <p class="mb-1"><strong>${invoice.invoiceNumber}</strong> • ${formatDateTime(invoice.generatedAt)}</p>
      <p class="mb-1 text-secondary">Base ${formatCurrency(invoice.baseCost)} + Toll ${formatCurrency(invoice.tollCost)} + Fuel ${formatCurrency(invoice.fuelSurcharge)} + Waiting ${formatCurrency(invoice.waitingCharge)}</p>
      <p class="mb-0"><strong>Total: ${formatCurrency(invoice.totalAmount)}</strong> (Tax ${invoice.taxPercent}%)</p>
    </div>
  `;
}

function renderConsignmentOpsStatus() {
  const selectedId = parseSelectedConsignmentId(ids.opsConsignment.value);
  const consignment = state.consignments.find((item) => item.id === selectedId) || state.consignments[0];
  if (!consignment) {
    ids.opsStatus.textContent = "Select a consignment to verify OTP and capture POD.";
    renderInvoiceSummary(null);
    return;
  }
  ids.opsConsignment.value = String(consignment.id);

  const pickup = consignment.pickupVerifiedAt ? `Verified ${formatDateTime(consignment.pickupVerifiedAt)}` : "Pending";
  const drop = consignment.dropVerifiedAt ? `Verified ${formatDateTime(consignment.dropVerifiedAt)}` : "Pending";
  const podState = consignment.pod ? `Captured ${formatDateTime(consignment.pod.timestamp)}` : "Pending";

  ids.opsStatus.innerHTML = `
    <div class="ops-card">
      <p class="mb-1"><strong>${consignment.lrNumber}</strong> • ${consignment.customerName} • ${consignment.material} (${consignment.weightKg} kg)</p>
      <p class="mb-1 text-secondary">Pickup OTP: ${consignment.pickupOtp} (${pickup}) • Drop OTP: ${consignment.dropOtp} (${drop})</p>
      <p class="mb-0 text-secondary">Status: ${consignment.status} • POD: ${podState}</p>
    </div>
  `;

  renderInvoiceSummary(consignment);
}

function renderConsignmentTable() {
  if (!state.consignments.length) {
    ids.consignmentTableBody.innerHTML =
      '<tr><td colspan="8" class="text-center text-secondary py-4">No consignments created yet.</td></tr>';
    return;
  }

  ids.consignmentTableBody.innerHTML = state.consignments
    .map((item) => {
      const otpState = `P:${item.pickupVerifiedAt ? "OK" : "Pending"} / D:${item.dropVerifiedAt ? "OK" : "Pending"}`;
      const podState = item.pod ? `Yes (${item.pod.receiverName})` : "No";
      const invoiceState = item.invoice ? `${item.invoice.invoiceNumber} • ${formatCurrency(item.invoice.totalAmount)}` : "Not generated";
      return `
        <tr>
          <td><strong>${item.lrNumber}</strong></td>
          <td>${item.customerName}</td>
          <td>${item.material}</td>
          <td>${item.weightKg} kg</td>
          <td>${consignmentStatusBadge(item.status)}</td>
          <td>${otpState}</td>
          <td>${podState}</td>
          <td>${invoiceState}</td>
        </tr>
      `;
    })
    .join("");
}

function filterAssignments() {
  const q = ids.searchBox.value.trim().toLowerCase();
  if (!q) {
    state.filteredAssignments = [...state.assignments];
  } else {
    state.filteredAssignments = state.assignments.filter((a) => {
      return (
        a.vehiclePlate.toLowerCase().includes(q) ||
        a.vehicleType.toLowerCase().includes(q) ||
        a.routeSource.toLowerCase().includes(q) ||
        a.routeDestination.toLowerCase().includes(q) ||
        a.driverName.toLowerCase().includes(q) ||
        String(a.lrNumber || "").toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q)
      );
    });
  }

  renderAssignments();
}

function renderAssignments() {
  if (!state.filteredAssignments.length) {
    ids.assignmentTableBody.innerHTML =
      '<tr><td colspan="8" class="text-center text-secondary py-4">No assignments found.</td></tr>';
    renderChart();
    return;
  }

  ids.assignmentTableBody.innerHTML = state.filteredAssignments
    .map(
      (a) => `
      <tr>
        <td>#${a.id}</td>
        <td>${a.vehiclePlate}<br><small class="text-secondary">${a.vehicleType}</small></td>
        <td>${a.routeSource} → ${a.routeDestination}<br><small class="text-secondary">${a.distanceKm} km</small></td>
        <td>${a.lrNumber ? `<strong>${a.lrNumber}</strong>` : '<span class="text-secondary">-</span>'}</td>
        <td>${a.driverName}</td>
        <td>${formatCurrency(a.cost)}</td>
        <td>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <select class="form-select form-select-sm status-select" data-id="${a.id}">
              ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${status === a.status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
            ${statusBadge(a.status)}
          </div>
        </td>
        <td>
          <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${a.id}"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`
    )
    .join("");

  renderChart();
}

function renderChart() {
  const totals = {
    pending: state.assignments.filter((a) => a.status === "Pending").length,
    transit: state.assignments.filter((a) => a.status === "In Transit").length,
    delivered: state.assignments.filter((a) => a.status === "Delivered").length
  };

  const data = {
    labels: ["Pending", "In Transit", "Delivered"],
    datasets: [
      {
        data: [totals.pending, totals.transit, totals.delivered],
        backgroundColor: ["#f59e0b", "#3b82f6", "#22c55e"],
        borderWidth: 0
      }
    ]
  };

  if (state.chart) {
    state.chart.data = data;
    state.chart.update();
    return;
  }

  state.chart = new Chart(ids.statusChart, {
    type: "pie",
    data,
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            color: getComputedStyle(document.body).getPropertyValue("--text").trim()
          }
        }
      }
    }
  });
}

function renderAll() {
  renderMetrics();
  renderMasterDataTables();
  updateAssignmentSelects();
  updateCopilotRouteSelect();
  updateOpsConsignmentSelect();
  renderConsignmentTable();
  renderConsignmentOpsStatus();
  filterAssignments();
}

function ensureMap() {
  if (state.mapReady) return;

  if (!window.L) {
    ids.fleetMeta.textContent = "Map library failed to load.";
    return;
  }

  state.map = window.L.map(ids.fleetMap, {
    zoomControl: true,
    attributionControl: true
  }).setView([22.5937, 78.9629], 5);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.map);

  state.mapLayers.route = window.L.layerGroup().addTo(state.map);
  state.mapLayers.progress = window.L.layerGroup().addTo(state.map);
  state.mapLayers.marker = window.L.layerGroup().addTo(state.map);
  state.mapReady = true;
}

function clearMapLayers() {
  if (!state.mapReady) return;
  state.mapLayers.route.clearLayers();
  state.mapLayers.progress.clearLayers();
  state.mapLayers.marker.clearLayers();
}

function drawFleetTracks(tracks, label) {
  if (!state.mapReady) return;

  clearMapLayers();

  if (!tracks.length) {
    ids.fleetMeta.textContent = "No assignments available for map view.";
    ids.playbackTime.textContent = "-";
    return;
  }

  const bounds = [];

  tracks.forEach((track) => {
    const source = [track.sourceCoords.lat, track.sourceCoords.lng];
    const destination = [track.destinationCoords.lat, track.destinationCoords.lng];
    const position = [track.position.lat, track.position.lng];
    const color = statusColor(track.status);

    bounds.push(source, destination, position);

    window.L.polyline([source, destination], {
      color: "#64748b",
      opacity: 0.38,
      weight: 4,
      dashArray: "8 8"
    }).addTo(state.mapLayers.route);

    window.L.polyline([source, position], {
      color,
      opacity: 0.9,
      weight: 5
    }).addTo(state.mapLayers.progress);

    const marker = window.L.circleMarker(position, {
      radius: 8,
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 2
    }).addTo(state.mapLayers.marker);

    marker.bindPopup(`
      <div class="map-popup">
        <strong>${track.vehiclePlate}</strong><br/>
        ${track.source} → ${track.destination}<br/>
        Driver: ${track.driverName}<br/>
        Status: ${track.status} (${track.progress.toFixed(1)}%)
      </div>
    `);
  });

  if (!state.mapHasFitted && bounds.length) {
    state.map.fitBounds(bounds, {
      padding: [28, 28],
      maxZoom: 7
    });
    state.mapHasFitted = true;
  }

  ids.fleetMeta.textContent = label;
}

function densifyTimelineForPlayback(item) {
  const nowIso = new Date().toISOString();
  const ordered = (item.timeline || [])
    .slice()
    .filter((event) => event && event.timestamp)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((event) => ({
      timestamp: event.timestamp,
      status: event.status || "Pending",
      progress: clampNumber(Number(event.progress || 0), 0, 100)
    }));

  if (!ordered.length) {
    ordered.push({
      timestamp: item.createdAt || nowIso,
      status: item.status || "Pending",
      progress: clampNumber(Number(item.progress || 0), 0, 100)
    });
  }

  const liveProgress = clampNumber(Number(item.progress || 0), 0, 100);
  const last = ordered[ordered.length - 1];

  if (Math.abs(liveProgress - Number(last.progress || 0)) >= 0.25 || (item.status && item.status !== last.status)) {
    ordered.push({
      timestamp: nowIso,
      status: item.status || statusFromProgress(liveProgress),
      progress: liveProgress
    });
  }

  if (ordered.length < 3 && liveProgress > 0) {
    const startMs = Date.parse(item.createdAt || ordered[0].timestamp || nowIso);
    const endMs = Date.parse(ordered[ordered.length - 1].timestamp || nowIso);
    const steps = Math.max(8, Math.ceil(liveProgress / 8));

    for (let i = 0; i <= steps; i += 1) {
      const ratio = i / steps;
      const ts = new Date(startMs + (endMs - startMs) * ratio).toISOString();
      const progress = Number((liveProgress * ratio).toFixed(2));
      ordered.push({
        timestamp: ts,
        status: statusFromProgress(progress),
        progress
      });
    }
  }

  const deduped = Array.from(
    new Map(
      ordered
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .map((event) => [`${event.timestamp}-${event.status}-${event.progress.toFixed(2)}`, event])
    ).values()
  );

  return deduped.map((event) => ({
    ...event,
    position: interpolateTrackPosition(item.sourceCoords, item.destinationCoords, event.progress)
  }));
}

function buildPlaybackFrames(items) {
  if (!items.length) return [];

  const timestampSet = new Set();
  const sortedTracks = items.map((item) => {
    const timeline = densifyTimelineForPlayback(item);

    timeline.forEach((event) => {
      if (event.timestamp) {
        timestampSet.add(event.timestamp);
      }
    });

    return {
      ...item,
      timeline
    };
  });

  const orderedTimestamps = Array.from(timestampSet).sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!orderedTimestamps.length) return [];

  return orderedTimestamps.map((timestamp) => {
    const targetTime = Date.parse(timestamp);
    const tracks = sortedTracks
      .map((item) => {
        let selected = item.timeline[0] || null;
        for (const event of item.timeline) {
          if (Date.parse(event.timestamp) <= targetTime) {
            selected = event;
          }
        }

        if (!selected) return null;

        return {
          assignmentId: item.id,
          vehiclePlate: item.vehiclePlate,
          driverName: item.driverName,
          source: item.routeSource,
          destination: item.routeDestination,
          sourceCoords: item.sourceCoords,
          destinationCoords: item.destinationCoords,
          position: selected.position,
          status: selected.status,
          progress: Number(selected.progress)
        };
      })
      .filter(Boolean);

    return {
      timestamp,
      tracks
    };
  });
}

function renderPlaybackFrame(index) {
  if (!state.playbackFrames.length) {
    ids.playbackTime.textContent = "No playback data yet.";
    return;
  }

  const safeIndex = Math.max(0, Math.min(index, state.playbackFrames.length - 1));
  state.playbackIndex = safeIndex;
  ids.playbackRange.value = String(safeIndex);

  const frame = state.playbackFrames[safeIndex];
  drawFleetTracks(frame.tracks, `Playback frame ${safeIndex + 1}/${state.playbackFrames.length}`);
  ids.playbackTime.textContent = `Playback @ ${formatDateTime(frame.timestamp)}`;
}

function renderLiveFleetMap() {
  const tracks = state.fleetLiveItems.map((item) => ({
    assignmentId: item.id,
    vehiclePlate: item.vehiclePlate,
    driverName: item.driverName,
    source: item.routeSource,
    destination: item.routeDestination,
    sourceCoords: item.sourceCoords,
    destinationCoords: item.destinationCoords,
    position: item.currentPosition,
    status: item.status,
    progress: Number(item.progress || 0)
  }));

  const counts = tracks.reduce(
    (acc, track) => {
      if (track.status === "Pending") acc.pending += 1;
      else if (track.status === "In Transit") acc.transit += 1;
      else if (track.status === "Delivered") acc.delivered += 1;
      return acc;
    },
    { pending: 0, transit: 0, delivered: 0 }
  );

  drawFleetTracks(
    tracks,
    `Live feed: ${tracks.length} tracked | Pending ${counts.pending} | In Transit ${counts.transit} | Delivered ${counts.delivered}`
  );
  ids.playbackTime.textContent = `Live @ ${formatDateTime(new Date().toISOString())}`;
}

function refreshPlaybackControls() {
  const count = state.playbackFrames.length;
  const max = Math.max(0, count - 1);
  ids.playbackRange.max = String(max);

  if (!count) {
    ids.playbackRange.value = "0";
    return;
  }

  if (!state.playbackMode) {
    state.playbackIndex = max;
    ids.playbackRange.value = String(max);
  } else {
    state.playbackIndex = Math.min(state.playbackIndex, max);
    ids.playbackRange.value = String(state.playbackIndex);
  }
}

function startPlayback() {
  if (!state.playbackFrames.length) {
    showFlash("No playback events available yet.", "error");
    return;
  }

  state.playbackMode = true;
  if (state.playbackIndex >= state.playbackFrames.length - 1) {
    state.playbackIndex = 0;
  }

  renderPlaybackFrame(state.playbackIndex);

  if (state.playbackTimer) return;

  state.playbackTimer = window.setInterval(() => {
    if (state.playbackIndex >= state.playbackFrames.length - 1) {
      stopPlayback();
      return;
    }

    renderPlaybackFrame(state.playbackIndex + 1);
  }, 1200);
}

function stopPlayback() {
  if (state.playbackTimer) {
    window.clearInterval(state.playbackTimer);
    state.playbackTimer = null;
  }
}

function switchToLiveMap() {
  stopPlayback();
  state.playbackMode = false;
  refreshPlaybackControls();
  renderLiveFleetMap();
}

async function loadFleetLiveData(silent = false) {
  try {
    ensureMap();
    const fleet = await api("/api/fleet/live");
    state.fleetLiveItems = fleet.items || [];
    state.playbackFrames = buildPlaybackFrames(state.fleetLiveItems);
    refreshPlaybackControls();

    if (state.playbackMode) {
      renderPlaybackFrame(state.playbackIndex);
    } else {
      renderLiveFleetMap();
    }
  } catch (err) {
    if (!silent) {
      showFlash(err.message, "error");
    }
  }
}

function startFleetRefresh() {
  if (state.fleetRefreshTimer) return;
  state.fleetRefreshTimer = window.setInterval(() => {
    loadFleetLiveData(true);
  }, 5000);
}

function stopFleetRefresh() {
  if (!state.fleetRefreshTimer) return;
  window.clearInterval(state.fleetRefreshTimer);
  state.fleetRefreshTimer = null;
}

function tickLiveDrift() {
  if (state.playbackMode || !state.fleetLiveItems.length) return;

  let changed = false;
  state.fleetLiveItems = state.fleetLiveItems.map((item) => {
    if (item.status !== "In Transit") {
      return item;
    }

    const durationSecs = Math.max(Number(item.durationHrs || 1) * 3600, 300);
    const step = 100 / durationSecs;
    const currentProgress = clampNumber(Number(item.progress || 0), 0, 100);
    const nextProgress = clampNumber(currentProgress + step, 0, 99.6);

    if (nextProgress <= currentProgress) {
      return item;
    }

    changed = true;
    return {
      ...item,
      progress: Number(nextProgress.toFixed(2)),
      currentPosition: interpolateTrackPosition(item.sourceCoords, item.destinationCoords, nextProgress)
    };
  });

  if (changed) {
    renderLiveFleetMap();
  }
}

function startLiveDrift() {
  if (state.liveDriftTimer) return;
  state.liveDriftTimer = window.setInterval(() => {
    tickLiveDrift();
  }, 1000);
}

function stopLiveDrift() {
  if (!state.liveDriftTimer) return;
  window.clearInterval(state.liveDriftTimer);
  state.liveDriftTimer = null;
}

function renderCopilotResult(result) {
  const renderCard = (item, heading, highlight = false) => {
    return `
      <article class="suggestion-card ${highlight ? "top" : ""}">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <h3 class="h6 mb-1">${heading}</h3>
            <p class="mb-1"><strong>${item.vehiclePlate}</strong> (${item.vehicleType}) + <strong>${item.driverName}</strong></p>
            <p class="suggestion-meta mb-1">Cost: ${formatCurrency(item.estimatedCost)} | ETA: ${item.estimatedEtaHrs}h | Score: ${item.score}</p>
            <p class="suggestion-reason mb-0">${item.reason}</p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-success use-suggestion-btn"
            data-vehicle-id="${item.vehicleId}"
            data-driver-id="${item.driverId}"
            data-route-id="${result.route.id}"
          >
            Use
          </button>
        </div>
      </article>`;
  };

  const renderScenarioCard = (scenario) => {
    if (!scenario || !scenario.recommendation) return "";
    return `
      <article class="scenario-card">
        <p class="scenario-title mb-1">${scenario.mode.toUpperCase()}</p>
        <p class="mb-1"><strong>${scenario.recommendation.vehiclePlate}</strong> + ${scenario.recommendation.driverName}</p>
        <small class="text-secondary">Score ${scenario.recommendation.score} | ${formatCurrency(scenario.recommendation.estimatedCost)} | ETA ${scenario.recommendation.estimatedEtaHrs}h</small>
      </article>
    `;
  };

  const topCard = renderCard(result.recommendation, "Top Recommendation", true);
  const altCards = (result.alternatives || []).length
    ? result.alternatives
        .map((item, index) => renderCard(item, `Alternative ${index + 1}`))
        .join("")
    : `<p class="text-secondary mb-0">${result.insight || "No additional alternatives for current filters."}</p>`;

  const scenarioCards = (result.scenarios || []).map((scenario) => renderScenarioCard(scenario)).join("");

  ids.copilotResult.innerHTML = `
    <div class="copilot-summary">
      <p class="mb-2"><strong>Route:</strong> ${result.route.source} → ${result.route.destination} (${result.route.distanceKm} km)</p>
      <p class="text-secondary mb-2"><strong>Priority:</strong> ${result.priority} | <strong>Requested load:</strong> ${result.requiredCapacity || 0} kg</p>
      <p class="text-secondary mb-3"><strong>Candidates:</strong> ${result.candidateCount || 0} (${result.resourceSummary?.vehicles || 0} vehicles x ${result.resourceSummary?.drivers || 0} drivers)</p>
      ${scenarioCards ? `<div class="scenario-list mb-3">${scenarioCards}</div>` : ""}
      ${topCard}
      <div class="alt-list mt-2">${altCards}</div>
    </div>
  `;
}

function applySuggestionToAssignment(vehicleId, driverId, routeId) {
  ids.assignmentVehicle.value = String(vehicleId);
  ids.assignmentDriver.value = String(driverId);
  ids.assignmentRoute.value = String(routeId);
  ids.assignmentForm.scrollIntoView({ behavior: "smooth", block: "center" });
  showFlash("Copilot suggestion applied to assignment form.", "success");
}

async function runCopilot() {
  if (!state.routes.length || !state.vehicles.length || !state.drivers.length) {
    showFlash("Add routes, vehicles, and drivers before using Copilot.", "error");
    return;
  }

  const payload = {
    routeId: Number(ids.copilotRoute.value),
    requiredCapacity: Number(ids.copilotLoad.value || 0),
    priority: ids.copilotPriority.value
  };

  if (!Number.isInteger(payload.routeId)) {
    showFlash("Select a route for Copilot.", "error");
    return;
  }

  try {
    const result = await api("/api/copilot/recommendation", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    renderCopilotResult(result);
    showFlash("Copilot generated recommendations.", "success");
  } catch (err) {
    showFlash(err.message, "error");
  }
}

async function loadAllData() {
  const [vehiclesRes, driversRes, routesRes, consignmentsRes, assignmentsRes] = await Promise.all([
    api("/api/vehicles"),
    api("/api/drivers"),
    api("/api/routes"),
    api("/api/consignments"),
    api("/api/assignments")
  ]);

  state.vehicles = vehiclesRes.items || [];
  state.drivers = driversRes.items || [];
  state.routes = routesRes.items || [];
  state.consignments = consignmentsRes.items || [];
  state.assignments = assignmentsRes.items || [];
  state.filteredAssignments = [...state.assignments];

  renderAll();
  await loadFleetLiveData(true);
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportCsv() {
  const rows = state.filteredAssignments.length ? state.filteredAssignments : state.assignments;
  if (!rows.length) {
    showFlash("No assignments available for export.", "error");
    return;
  }

  const header = ["ID", "Vehicle", "Route", "Consignment_LR", "Driver", "Status", "Progress", "Cost_INR"];
  const lines = [header.join(",")];

  rows.forEach((item) => {
    const row = [
      item.id,
      `${item.vehiclePlate} (${item.vehicleType})`,
      `${item.routeSource} -> ${item.routeDestination}`,
      item.lrNumber || "",
      item.driverName,
      item.status,
      Number(item.progress || 0).toFixed(2),
      item.cost
    ];
    lines.push(row.map(toCsvCell).join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `sarthisync-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

async function handleStatusUpdate(assignmentId, status) {
  try {
    await api(`/api/assignments/${assignmentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadAllData();
    showFlash("Assignment status updated.", "success");
  } catch (err) {
    showFlash(err.message, "error");
  }
}

async function handleDeleteAssignment(assignmentId) {
  if (!confirm("Delete this assignment?")) return;

  try {
    await api(`/api/assignments/${assignmentId}`, { method: "DELETE" });
    await loadAllData();
    showFlash("Assignment deleted.", "success");
  } catch (err) {
    showFlash(err.message, "error");
  }
}

function bindEvents() {
  ids.authToggle.addEventListener("click", (e) => {
    e.preventDefault();
    state.isSignUp = !state.isSignUp;
    ids.nameGroup.classList.toggle("d-none", !state.isSignUp);
    ids.nameInput.required = state.isSignUp;
    ids.authBtn.innerHTML = state.isSignUp ? '<i class="bi bi-person-plus me-2"></i>Sign Up' : '<i class="bi bi-box-arrow-in-right me-2"></i>Login';
    ids.authToggle.textContent = state.isSignUp ? "Already have an account? Login" : "Don't have an account? Sign Up";
  });

  ids.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    const name = ids.nameInput.value.trim();

    const endpoint = state.isSignUp ? "/api/auth/register" : "/api/auth/login";
    const body = state.isSignUp ? { username, password, name } : { username, password };

    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(body)
      });
      state.user = result.user;
      ids.userBadge.textContent = `${state.user.name} (${state.user.role})`;
      setView(true);
      await loadAllData();
      showFlash(state.isSignUp ? "Account created successfully!" : "Logged in successfully.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Intentionally ignore logout errors.
    }

    state.user = null;
    setView(false);
    showFlash("Logged out.", "info");
  });

  ids.darkModeBtn.addEventListener("click", () => {
    state.darkMode = !state.darkMode;
    applyTheme();
  });

  ids.resetBtn.addEventListener("click", async () => {
    if (!confirm("Reset all vehicles, drivers, routes, and assignments?")) return;

    try {
      await api("/api/reset", { method: "POST" });
      state.mapHasFitted = false;
      state.playbackMode = false;
      stopPlayback();
      ids.copilotResult.innerHTML =
        '<p class="text-secondary mb-0">Choose a route and generate a dispatch recommendation.</p>';
      await loadAllData();
      showFlash("App data reset.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.exportBtn.addEventListener("click", exportCsv);

  ids.vehicleForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      plate: document.getElementById("vehiclePlate").value.trim(),
      type: document.getElementById("vehicleType").value.trim(),
      capacity: Number(document.getElementById("vehicleCapacity").value),
      rate: Number(document.getElementById("vehicleRate").value)
    };

    try {
      await api("/api/vehicles", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      ids.vehicleForm.reset();
      await loadAllData();
      showFlash("Vehicle added.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.driverForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      name: document.getElementById("driverName").value.trim(),
      license: document.getElementById("driverLicense").value.trim(),
      phone: document.getElementById("driverPhone").value.trim()
    };

    try {
      await api("/api/drivers", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      ids.driverForm.reset();
      await loadAllData();
      showFlash("Driver added.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.routeForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      source: document.getElementById("routeSource").value.trim(),
      destination: document.getElementById("routeDestination").value.trim(),
      distance: Number(document.getElementById("routeDistance").value),
      duration: Number(document.getElementById("routeDuration").value)
    };

    try {
      await api("/api/routes", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      ids.routeForm.reset();
      await loadAllData();
      showFlash("Route added.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.consignmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      lrNumber: document.getElementById("consignmentLr").value.trim(),
      customerName: document.getElementById("consignmentCustomer").value.trim(),
      material: document.getElementById("consignmentMaterial").value.trim(),
      weightKg: Number(document.getElementById("consignmentWeight").value),
      promisedEta: document.getElementById("consignmentEta").value || null
    };

    try {
      await api("/api/consignments", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      ids.consignmentForm.reset();
      await loadAllData();
      showFlash("Consignment created.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.assignmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.vehicles.length || !state.routes.length || !state.drivers.length) {
      showFlash("Add at least one vehicle, route, and driver first.", "error");
      return;
    }

    const payload = {
      vehicleId: Number(ids.assignmentVehicle.value),
      routeId: Number(ids.assignmentRoute.value),
      driverId: Number(ids.assignmentDriver.value),
      consignmentId: parseSelectedConsignmentId(ids.assignmentConsignment.value)
    };

    try {
      await api("/api/assignments", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await loadAllData();
      showFlash("Assignment created.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.searchBox.addEventListener("input", filterAssignments);

  ids.assignmentTableBody.addEventListener("change", (event) => {
    const target = event.target;
    if (!target.classList.contains("status-select")) return;

    const assignmentId = Number(target.dataset.id);
    const status = target.value;
    handleStatusUpdate(assignmentId, status);
  });

  ids.assignmentTableBody.addEventListener("click", (event) => {
    const btn = event.target.closest(".delete-btn");
    if (!btn) return;

    const assignmentId = Number(btn.dataset.id);
    handleDeleteAssignment(assignmentId);
  });

  ids.opsConsignment.addEventListener("change", () => {
    renderConsignmentOpsStatus();
  });

  ids.otpVerifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const consignmentId = parseSelectedConsignmentId(ids.opsConsignment.value);
    if (!consignmentId) {
      showFlash("Select a consignment first.", "error");
      return;
    }

    try {
      const payload = {
        stage: ids.opsStage.value,
        otp: ids.opsOtp.value.trim()
      };
      await api(`/api/consignments/${consignmentId}/otp/verify`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      ids.opsOtp.value = "";
      await loadAllData();
      showFlash(`${payload.stage} OTP verified.`, "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.podForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const consignmentId = parseSelectedConsignmentId(ids.opsConsignment.value);
    if (!consignmentId) {
      showFlash("Select a consignment first.", "error");
      return;
    }

    const payload = {
      receiverName: ids.podReceiver.value.trim(),
      signature: ids.podSignature.value.trim(),
      photoUrl: ids.podPhotoUrl.value.trim(),
      gpsLat: ids.podGpsLat.value ? Number(ids.podGpsLat.value) : null,
      gpsLng: ids.podGpsLng.value ? Number(ids.podGpsLng.value) : null
    };

    try {
      await api(`/api/consignments/${consignmentId}/pod`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      ids.podForm.reset();
      await loadAllData();
      showFlash("ePOD captured.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.invoiceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const consignmentId = parseSelectedConsignmentId(ids.opsConsignment.value);
    if (!consignmentId) {
      showFlash("Select a consignment first.", "error");
      return;
    }

    const payload = {
      toll: Number(ids.invoiceToll.value || 0),
      fuelSurcharge: Number(ids.invoiceFuel.value || 0),
      waitingCharge: Number(ids.invoiceWaiting.value || 0),
      taxPercent: Number(ids.invoiceTax.value || 0)
    };

    try {
      await api(`/api/consignments/${consignmentId}/invoice`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await loadAllData();
      showFlash("Invoice generated.", "success");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.exceptionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const consignmentId = parseSelectedConsignmentId(ids.opsConsignment.value);
    if (!consignmentId) {
      showFlash("Select a consignment first.", "error");
      return;
    }

    const note = ids.exceptionNote.value.trim();
    if (!note) {
      showFlash("Exception note is required.", "error");
      return;
    }

    try {
      await api(`/api/consignments/${consignmentId}/exception`, {
        method: "POST",
        body: JSON.stringify({
          type: ids.exceptionType.value,
          note
        })
      });
      ids.exceptionNote.value = "";
      await loadAllData();
      showFlash("Exception logged.", "info");
    } catch (err) {
      showFlash(err.message, "error");
    }
  });

  ids.playbackRange.addEventListener("input", (event) => {
    const index = Number(event.target.value);
    state.playbackMode = true;
    stopPlayback();
    renderPlaybackFrame(index);
  });

  ids.playbackPlayBtn.addEventListener("click", () => {
    startPlayback();
  });

  ids.playbackPauseBtn.addEventListener("click", () => {
    stopPlayback();
    state.playbackMode = true;
    showFlash("Playback paused.", "info");
  });

  ids.playbackLiveBtn.addEventListener("click", () => {
    switchToLiveMap();
    showFlash("Switched to live map.", "success");
  });

  ids.copilotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runCopilot();
  });

  ids.copilotResult.addEventListener("click", (event) => {
    const button = event.target.closest(".use-suggestion-btn");
    if (!button) return;

    const vehicleId = Number(button.dataset.vehicleId);
    const driverId = Number(button.dataset.driverId);
    const routeId = Number(button.dataset.routeId);
    applySuggestionToAssignment(vehicleId, driverId, routeId);
  });
}

async function boot() {
  state.darkMode = localStorage.getItem("ss_dark_mode") === "1";
  applyTheme();
  bindEvents();

  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    ids.userBadge.textContent = `${state.user.name} (${state.user.role})`;
    setView(true);
    await loadAllData();
  } catch {
    setView(false);
  }
}

boot();
