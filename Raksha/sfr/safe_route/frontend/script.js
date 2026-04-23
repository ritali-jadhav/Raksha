// 🌍 Initialize Map
const map = L.map("map").setView([19.07, 72.87], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

let routeLayers = [];
let heatLayer = null;
let hotspotMarkers = [];

// 🔥 Dummy Criminal Profiles
function generateDummyProfiles() {
  const crimes = ["Theft", "Robbery", "Assault", "Fraud", "Harassment"];
  const names = ["Ravi Shankar", "Amit Rajan", "Sameer Ibrahim", "Rajesh Patel", "Imran Mahood", "Mohmd Shaikh"];

  let profiles = [];

  for (let i = 0; i < 3; i++) {
    profiles.push({
      name: names[Math.floor(Math.random() * names.length)],
      crime: crimes[Math.floor(Math.random() * crimes.length)],
      risk: (Math.random() * 1).toFixed(2)
    });
  }

  return profiles;
}

// 🔥 Load Heatmap + Hotspots
async function loadHeatmap(hour = null) {
  try {
    let url = "http://127.0.0.1:8000/risk-map";
    if (hour) url += `?hour=${hour}`;

    const response = await fetch(url);
    const data = await response.json();

    // 🔥 Heatmap points
    const points = data.data.map(cell => [
      cell.lat,
      cell.lon,
      cell.risk * (1 + Math.random())
    ]);

    // Remove old heatmap
    if (heatLayer) {
      map.removeLayer(heatLayer);
    }

    // Remove old markers
    hotspotMarkers.forEach(m => map.removeLayer(m));
    hotspotMarkers = [];

    // 🔥 Create heatmap
    heatLayer = L.heatLayer(points, {
      radius: 25,
      blur: 18,
      maxZoom: 17,
      max: 1.2,
      gradient: {
        0.1: "green",
        0.3: "yellow",
        0.5: "orange",
        0.7: "red",
        1.0: "darkred"
      }
    }).addTo(map);

    // 🔥 Add clickable hotspot markers
    data.data.forEach(cell => {
      if (cell.is_hotspot) {
        const profiles = generateDummyProfiles();

        let popupContent = `
          <div style="font-family:sans-serif">
            <h4 style="color:red;">⚠️ High Risk Zone</h4>
            ${profiles.map(p => `
              <div style="margin-bottom:6px;">
                <b>${p.name}</b><br>
                ${p.crime} | Risk: ${p.risk}
              </div>
            `).join("")}
          </div>
        `;

        const marker = L.circleMarker([cell.lat, cell.lon], {
          radius: 6,
          color: "red",
          fillOpacity: 0.4
        }).addTo(map);

        marker.bindPopup(popupContent);

        hotspotMarkers.push(marker);
      }
    });

  } catch (error) {
    console.error("Error loading heatmap:", error);
  }
}

// 🚗 Fetch Routes
async function fetchRoutes(source, destination, hour) {
  const loader = document.getElementById("loadingOverlay");
  loader.style.display = "flex";

  try {
    let url = `http://127.0.0.1:8000/routes?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}`;
    if (hour) url += `&hour=${hour}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      alert("No routes found.");
      return;
    }

    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];

    const routesDiv = document.getElementById("routes");
    routesDiv.innerHTML = "";

    data.routes.forEach((route, idx) => {
      const latlngs = route.coords.map(coord => [coord[0], coord[1]]);

      let color;
      if (route.safety_score <= 0.3) color = "green";
      else if (route.safety_score <= 0.6) color = "orange";
      else color = "red";

      const polyline = L.polyline(latlngs, {
        color,
        weight: 7,
        opacity: 0.95
      }).addTo(map);

      routeLayers.push(polyline);

      const info = document.createElement("div");
      info.className = "route-info";
      info.innerHTML = `
        <h3>Route ${route.route_id}</h3>
        <p><b>Distance:</b> ${route.distance_km} km</p>
        <p><b>Duration:</b> ${route.duration_min} min</p>
        <p><b>Safety Score:</b> 
          <span style="color:${color}; font-weight:bold;">
            ${route.safety_score}
          </span>
        </p>
      `;

      routesDiv.appendChild(info);

      if (idx === 0) map.fitBounds(polyline.getBounds());
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    loader.style.display = "none";
  }
}

// 🧭 Button Click
document.getElementById("findRoute").addEventListener("click", () => {
  const source = document.getElementById("source").value.trim();
  const destination = document.getElementById("destination").value.trim();
  const hour = document.getElementById("hour").value.trim();

  if (!source || !destination) {
    alert("Enter source & destination");
    return;
  }

  fetchRoutes(source, destination, hour);
  loadHeatmap(hour);
});

// 🔥 Load heatmap on startup
loadHeatmap();
