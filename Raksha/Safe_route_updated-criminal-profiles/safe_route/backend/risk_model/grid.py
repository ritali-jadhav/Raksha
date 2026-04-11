import random


def generate_grid():
    grid = []
    
    lat_min, lat_max = 18.9, 19.3
    lon_min, lon_max = 72.8, 73.0
    
    step = 0.003

    lat = lat_min
    while lat < lat_max:
        lon = lon_min
        while lon < lon_max:
            grid.append({
                "lat": round(lat + random.uniform(-0.002, 0.002), 5),
                "lon": round(lon + random.uniform(-0.002, 0.002), 5),
                "risk": 0
            })
            lon += step
        lat += step

    return grid