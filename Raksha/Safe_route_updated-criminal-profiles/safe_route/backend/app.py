from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
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

# ============================
# CRIME ANALYTICS ENDPOINTS
# ============================

@app.get("/crime-trends")
def crime_trends(city: str = None):
    """Return hourly crime distribution for a city (or overall)."""
    df = safety_model.df.copy()
    if city:
        city_norm = city.title().strip()
        df = df[df['City'] == city_norm]
        if df.empty:
            return {"city": city, "hourly": [], "total": 0}

    hourly = df.groupby('OccHour').size().reset_index(name='count')
    hourly = hourly[hourly['OccHour'] >= 0]  # exclude -1 unknowns
    total = int(df.shape[0])

    result = [{"hour": int(r['OccHour']), "count": int(r['count'])} for _, r in hourly.iterrows()]
    return {"city": city or "All Cities", "hourly": result, "total": total}


@app.get("/top-cities")
def top_cities(limit: int = 10):
    """Return top cities by average crime risk."""
    top = sorted(safety_model.city_avg_risk.items(), key=lambda x: x[1], reverse=True)[:limit]
    return {"cities": [{"city": c, "risk": round(r, 3)} for c, r in top]}


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
# Run with uvicorn (Railway uses $PORT)
# ============================
if __name__ == "__main__":
    import uvicorn, os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port)
