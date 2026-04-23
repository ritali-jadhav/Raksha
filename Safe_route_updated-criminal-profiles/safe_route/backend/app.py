from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import time
from datetime import datetime
from model import get_model

from risk_model.grid import generate_grid
from risk_model.risk_calc import calculate_risk

app = FastAPI()

def time_risk_factor(hour: int) -> float:
    """Return a multiplier (0.7–1.5) based on time of day."""
    if hour is None:
        return 1.0
    if 6 <= hour < 12:   # Morning
        return 0.7
    elif 12 <= hour < 18:  # Afternoon
        return 0.9
    elif 18 <= hour < 22:  # Evening
        return 1.1
    else:  # Night
        return 1.5


# Allow frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 🔑 Add your GraphHopper API key here
GRAPHHOPPER_API_KEY = "823224fe-2f07-44e8-9e7f-db72909eccd3"

# Base URLs
GH_GEOCODE_URL = "https://graphhopper.com/api/1/geocode"
GH_ROUTE_URL = "https://graphhopper.com/api/1/route"

safety_model = get_model()


def geocode(location):
    """Get latitude and longitude from GraphHopper."""
    params = {
        "q": location,
        "locale": "en",
        "limit": 1,
        "key": GRAPHHOPPER_API_KEY
    }
    r = requests.get(GH_GEOCODE_URL, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    hits = data.get("hits", [])
    if not hits:
        return None
    point = hits[0]["point"]
    return point["lat"], point["lng"]


# ============================
# ✅ NEW: RISK HEATMAP API
# ============================
@app.get("/risk-map")
def risk_map(hour: int = None):
    from datetime import datetime

    if hour is None:
        hour = datetime.now().hour

    grid = generate_grid()

    for cell in grid:
        base_risk = calculate_risk(cell)
        adjusted_risk = base_risk * time_risk_factor(hour)

        risk_value = round(min(adjusted_risk, 1.0), 3)

        cell["risk"] = risk_value

        # 🔥 NEW: hotspot flag
        cell["is_hotspot"] = risk_value > 0.7

    return {"data": grid}


# ============================
# EXISTING ROUTE API (UNCHANGED)
# ============================
@app.get("/routes")
def get_routes(source: str = Query(...), destination: str = Query(...), hour: int = None):
    """
    Returns safe routes between source and destination using GraphHopper API.
    """
    # Geocode both locations
    s = geocode(source)
    if not s:
        return {"error": f"Could not find source location: {source}"}
    time.sleep(0.5)

    d = geocode(destination)
    if not d:
        return {"error": f"Could not find destination location: {destination}"}
    time.sleep(0.5)

    lat1, lon1 = s
    lat2, lon2 = d

    # Request route from GraphHopper
    params = {
        "point": [f"{lat1},{lon1}", f"{lat2},{lon2}"],
        "vehicle": "car",
        "points_encoded": "false",
        "key": GRAPHHOPPER_API_KEY,
        "locale": "en",
        "instructions": "false",
        "alternative_route.max_paths": 3
    }

    r = requests.get(GH_ROUTE_URL, params=params, timeout=15)
    r.raise_for_status()
    gh_data = r.json()

    routes = []
    if hour is None:
        hour = datetime.now().hour

    for i, path in enumerate(gh_data.get("paths", [])):
        distance_m = path.get("distance", 0)
        duration_s = path.get("time", 0) / 1000
        coords = path.get("points", {}).get("coordinates", [])

        if not coords:
            continue

        start_city = source
        end_city = destination

        # Model-based risk
        r1 = safety_model.get_risk(start_city, hour)
        r2 = safety_model.get_risk(end_city, hour)

        time_factor = time_risk_factor(hour)
        adjusted_score = (r1 + r2) / 2.0 * time_factor
        safety_score = round(min(adjusted_score, 1.0), 3)

        latlngs = [[lat, lon] for lon, lat in coords]

        routes.append({
            "route_id": i + 1,
            "distance_km": round(distance_m / 1000.0, 2),
            "duration_min": round(duration_s / 60.0, 1),
            "safety_score": safety_score,
            "coords": latlngs
        })

    routes = sorted(routes, key=lambda x: x["safety_score"])
    return {"routes": routes}


# ============================
# ✅ NEW: POST /route — for Raksha mobile app
# Accepts raw lat/lng coordinates instead of city name strings.
# Returns the best (safest) route in the normalized Raksha format.
# ============================
class Coordinate(BaseModel):
    lat: float
    lng: float

class RouteRequest(BaseModel):
    source: Coordinate
    destination: Coordinate

@app.post("/route")
def get_route_by_coords(body: RouteRequest):
    """
    Returns the safest route between two lat/lng coordinates.
    Response format:
      { "path": [{"lat": ..., "lng": ...}, ...], "distance": km, "safety_score": 0-1 }
    """
    lat1, lon1 = body.source.lat, body.source.lng
    lat2, lon2 = body.destination.lat, body.destination.lng

    # Validate coordinate ranges
    if not (-90 <= lat1 <= 90 and -180 <= lon1 <= 180):
        return {"error": "Invalid source coordinates"}
    if not (-90 <= lat2 <= 90 and -180 <= lon2 <= 180):
        return {"error": "Invalid destination coordinates"}

    params = {
        "point": [f"{lat1},{lon1}", f"{lat2},{lon2}"],
        "vehicle": "car",
        "points_encoded": "false",
        "key": GRAPHHOPPER_API_KEY,
        "locale": "en",
        "instructions": "false",
        "alternative_route.max_paths": 3
    }

    try:
        r = requests.get(GH_ROUTE_URL, params=params, timeout=15)
        r.raise_for_status()
        gh_data = r.json()
    except requests.exceptions.RequestException as e:
        return {"error": f"Route service unavailable: {str(e)}"}

    paths = gh_data.get("paths", [])
    if not paths:
        return {"error": "No route found between the given coordinates"}

    hour = datetime.now().hour
    time_factor = time_risk_factor(hour)

    best_route = None
    best_score = float("inf")

    for path in paths:
        distance_m = path.get("distance", 0)
        coords = path.get("points", {}).get("coordinates", [])

        if not coords:
            continue

        # Use overall average risk for raw coords (no city name available)
        model = safety_model
        base_risk = model.overall_avg
        safety_score = round(min(base_risk * time_factor, 1.0), 3)

        # Convert [lng, lat] → {lat, lng} objects
        path_points = [{"lat": lat, "lng": lon} for lon, lat in coords]

        route = {
            "path": path_points,
            "distance": round(distance_m / 1000.0, 2),
            "safety_score": safety_score
        }

        if safety_score < best_score:
            best_score = safety_score
            best_route = route

    if not best_route:
        return {"error": "Could not compute a valid route"}

    return best_route
