# Requirements Document

## Introduction

The Safe Route Integration feature connects the existing Python-based safe route and crime risk heatmap service (FastAPI backend) into the Raksha web frontend and Node.js backend. It enables users to find safe routes between two locations, view a live crime risk heatmap, and have the heatmap automatically centered on their current GPS location. The geofence system is also enhanced to warn users when their current location falls inside a high-risk zone identified by the risk model.

## Glossary

- **Safe_Route_Service**: The Python FastAPI microservice that exposes `/routes` and `/risk-map` endpoints using GraphHopper and a crime dataset model.
- **Risk_Heatmap**: A visual overlay on a Leaflet map showing crime risk intensity per geographic cell, color-coded from green (safe) to dark-red (high risk).
- **Safety_Score**: A float between 0.0 and 1.0 representing the crime risk of a route or location, where lower is safer.
- **Hotspot**: A geographic cell with a Safety_Score above 0.7, flagged as a high-risk zone.
- **Current_Location**: The real-time GPS coordinates of the authenticated user as captured by the browser Geolocation API.
- **Geofence**: A named circular safe zone defined by a center coordinate and radius in meters, stored in Firestore.
- **Node_Backend**: The existing TypeScript/Express backend running on port 4000.
- **Safe_Route_Page**: A new page in the `raksha-web` React frontend dedicated to safe route finding and heatmap display.
- **Tracking_Page**: The existing `/tracking` page in `raksha-web` that shows live GPS tracking.

---

## Requirements

### Requirement 1: Safe Route Page

**User Story:** As a user, I want a dedicated Safe Route page in the app, so that I can find safe paths between two locations and see crime risk visually on a map.

#### Acceptance Criteria

1. THE Safe_Route_Page SHALL render a Leaflet map, a source input, a destination input, an optional hour-of-travel input, and a "Find Safe Routes" button.
2. WHEN the Safe_Route_Page loads, THE Safe_Route_Page SHALL automatically populate the source input with the user's Current_Location coordinates (formatted as "lat,lng").
3. WHEN the user clicks "Find Safe Routes", THE Safe_Route_Page SHALL call the Safe_Route_Service `/routes` endpoint with the source, destination, and optional hour parameters.
4. WHEN routes are returned, THE Safe_Route_Page SHALL render each route as a colored polyline on the map — green for Safety_Score ≤ 0.3, orange for ≤ 0.6, and red for > 0.6.
5. WHEN routes are returned, THE Safe_Route_Page SHALL display each route's distance (km), duration (min), and Safety_Score below the map.
6. WHEN the Safe_Route_Service returns an error or no routes, THE Safe_Route_Page SHALL display a user-friendly error message.

---

### Requirement 2: Risk Heatmap Display

**User Story:** As a user, I want to see a crime risk heatmap on the Safe Route page, so that I can visually understand which areas are dangerous.

#### Acceptance Criteria

1. WHEN the Safe_Route_Page loads, THE Safe_Route_Page SHALL fetch the Risk_Heatmap data from the Safe_Route_Service `/risk-map` endpoint using the current hour.
2. WHEN heatmap data is received, THE Safe_Route_Page SHALL render a Leaflet heatmap layer using the risk values, with a gradient from green (low) to dark-red (high).
3. WHEN heatmap data is received, THE Safe_Route_Page SHALL render clickable circle markers on all Hotspot cells.
4. WHEN a Hotspot marker is clicked, THE Safe_Route_Page SHALL display a popup showing the risk score for that cell.
5. WHEN the user changes the hour-of-travel input, THE Safe_Route_Page SHALL reload the Risk_Heatmap for the new hour.
6. THE Safe_Route_Page SHALL center the map on the user's Current_Location when heatmap data loads.

---

### Requirement 3: Current Location Synchronization

**User Story:** As a user, I want the Safe Route map to stay in sync with my live GPS location, so that I always see risk data relevant to where I am.

#### Acceptance Criteria

1. WHEN the Safe_Route_Page mounts, THE Safe_Route_Page SHALL request the browser Geolocation API for the user's Current_Location.
2. WHEN Current_Location is obtained, THE Safe_Route_Page SHALL center the Leaflet map on those coordinates.
3. WHEN Current_Location is obtained, THE Safe_Route_Page SHALL place a distinct user-position marker on the map.
4. WHEN the user's position changes by more than 50 meters, THE Safe_Route_Page SHALL update the user-position marker and re-center the map.
5. IF the Geolocation API is unavailable or denied, THEN THE Safe_Route_Page SHALL display a fallback message and default the map center to Mumbai (19.07, 72.87).

---

### Requirement 4: Geofence Risk Warning

**User Story:** As a user, I want to be warned when my current location is inside a high-risk zone, so that I can take precautions or trigger SOS.

#### Acceptance Criteria

1. WHEN the Safe_Route_Page loads and Current_Location is available, THE Safe_Route_Page SHALL check whether the Current_Location falls within any Hotspot cell from the Risk_Heatmap.
2. WHEN the Current_Location is inside a Hotspot, THE Safe_Route_Page SHALL display a visible warning banner indicating the user is in a high-risk area.
3. WHEN the Current_Location is not inside any Hotspot, THE Safe_Route_Page SHALL not display the risk warning banner.
4. WHILE the Safe_Route_Page is open and tracking is active, THE Safe_Route_Page SHALL re-evaluate the Hotspot check whenever the Current_Location updates.
5. WHEN a geofence breach is detected by the Node_Backend AND the breached zone overlaps a Hotspot, THE Node_Backend SHALL include a `highRisk` flag in the breach event payload emitted via WebSocket.

---

### Requirement 5: Navigation Integration

**User Story:** As a user, I want to access the Safe Route feature from the app's main navigation, so that I can reach it quickly.

#### Acceptance Criteria

1. THE BottomNav component SHALL include a "Safe Route" navigation item with an appropriate icon.
2. WHEN the user taps the "Safe Route" navigation item, THE App SHALL navigate to the Safe_Route_Page.
3. THE App router SHALL register the Safe_Route_Page at the `/safe-route` path.

---

### Requirement 6: API Proxy via Node Backend

**User Story:** As a developer, I want the Node backend to proxy Safe Route Service calls, so that the frontend does not need to know the Python service URL and CORS is handled centrally.

#### Acceptance Criteria

1. THE Node_Backend SHALL expose a `GET /safe-route/routes` endpoint that proxies requests to the Safe_Route_Service `/routes` endpoint, forwarding `source`, `destination`, and `hour` query parameters.
2. THE Node_Backend SHALL expose a `GET /safe-route/risk-map` endpoint that proxies requests to the Safe_Route_Service `/risk-map` endpoint, forwarding the `hour` query parameter.
3. WHEN the Safe_Route_Service is unreachable, THE Node_Backend SHALL return a 503 response with a descriptive error message.
4. THE Node_Backend proxy endpoints SHALL require a valid JWT token (same auth middleware as other routes).
