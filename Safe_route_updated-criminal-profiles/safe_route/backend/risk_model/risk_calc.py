import random
from turtle import distance

def calculate_risk(cell, is_night=True):
  

    lat = cell["lat"]
    lon = cell["lon"]

    # Base low risk
    risk = random.uniform(0.05, 0.2)

    center_lat, center_lon = 19.07, 72.87

    distance = abs(lat - center_lat) + abs(lon - center_lon)

    # reduce risk as we move away
    risk -= distance * 0.2


    # 🔴 High-risk hotspot (South Mumbai example)
    if 18.95 < lat < 19.05 and 72.82 < lon < 72.9:
        risk += random.uniform(0.4, 0.6)

    # Add micro hotspots (NEW)
    elif random.random() < 0.1:
        risk += random.uniform(0.3, 0.6)

    # 🟡 Medium-risk zone (Central Mumbai)
    elif 19.05 < lat < 19.15:
        risk += random.uniform(0.2, 0.4)

    # 🟢 Safer zone (suburbs)
    else:
        risk += random.uniform(0.0, 0.2)

    # 🌙 Night effect
    if is_night:
        risk += 0.1

    return min(risk, 1.0)