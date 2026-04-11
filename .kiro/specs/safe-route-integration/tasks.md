# Implementation Plan: Safe Route Integration

## Overview

Integrate the Python safe route microservice into the Raksha Node.js backend (proxy layer) and React web frontend (Safe Route page), with live GPS sync, crime risk heatmap, hotspot warning, and geofence risk enhancement.

## Tasks

- [ ] 1. Add Node.js proxy route for Safe Route Service
  - Create `Raksha/src/routes/safeRoute.ts` with `GET /safe-route/routes` and `GET /safe-route/risk-map` endpoints
  - Use `node-fetch` or native `fetch` to proxy requests to the Python service at `SAFE_ROUTE_URL` (env var, default `http://127.0.0.1:8000`)
  - Forward `source`, `destination`, and `hour` query params for `/routes`; forward `hour` for `/risk-map`
  - Return 503 with descriptive message when Python service is unreachable
  - Apply `requireAuth` middleware to both endpoints
  - Register the router in `Raksha/src/index.ts` at `/safe-route`
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 1.1 Write unit tests for the proxy route
  - Mock `fetch` to verify parameter forwarding for `/routes` and `/risk-map`
  - Test 503 response when Python service throws a network error
  - Test 401 response when no JWT token is provided
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 2. Extend frontend API client with safeRouteApi
  - Add `safeRouteApi` object to `raksha-web/src/api/client.ts` with `routes()` and `riskMap()` methods
  - Both methods call through the existing authenticated `api()` helper
  - _Requirements: 6.1, 6.2_

- [ ] 3. Implement core utility functions
  - Create `raksha-web/src/utils/safeRouteUtils.ts` with:
    - `safetyScoreToColor(score: number): string` — returns `"green"` | `"orange"` | `"red"`
    - `isLocationInHotspot(lat: number, lng: number, cells: RiskCell[]): boolean` — bounding-box check with ~0.003 degree cell half-width
  - Export `Route` and `RiskCell` TypeScript interfaces from this file
  - _Requirements: 1.4, 4.1_

- [ ] 3.1 Write property test for safetyScoreToColor (Property 1)
  - **Property 1: Safety score to color mapping is total and correct**
  - Use fast-check to generate random floats in [0, 1]; assert color is one of three valid values and matches the correct range
  - **Validates: Requirements 1.4**

- [ ] 3.2 Write property test for isLocationInHotspot (Property 6 & 7)
  - **Property 6: Hotspot containment drives banner visibility**
  - **Property 7: Backend highRisk flag matches hotspot containment**
  - Generate random coordinates and hotspot cell arrays; assert the function returns true iff the point is within a cell's bounding box
  - **Validates: Requirements 4.1, 4.5**

- [ ] 4. Build the SafeRoute page — map and geolocation
  - Create `raksha-web/src/pages/SafeRoute.tsx`
  - Initialize a Leaflet map centered on Mumbai fallback (19.07, 72.87)
  - On mount, call `navigator.geolocation.getCurrentPosition` and center the map + place a blue user marker
  - Watch position with `watchPosition`; update marker and re-center only when haversine distance > 50m (use existing `distance.ts` util or inline)
  - Show fallback message when geolocation is denied
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4.1 Write property test for 50m position update threshold (Property 5)
  - **Property 5: Position update threshold — 50 meter rule**
  - Extract the threshold check into a pure function `shouldUpdatePosition(prev, next): boolean`
  - Generate random coordinate pairs; assert update only when haversine distance > 50m
  - **Validates: Requirements 3.4**

- [ ] 5. Build the SafeRoute page — heatmap and hotspot markers
  - Install `leaflet.heat` types if not present; import the plugin in SafeRoute.tsx
  - On mount (and on hour change), call `safeRouteApi.riskMap(hour)` and render a `L.heatLayer`
  - Render `L.circleMarker` for each cell where `is_hotspot === true`; bind a popup showing the risk score
  - Center the map on Current_Location when heatmap data loads
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 5.1 Write property test for hotspot marker count (Property 3)
  - **Property 3: Hotspot marker count matches hotspot cell count**
  - Generate random RiskCell arrays with random `is_hotspot` flags; assert the count of rendered markers equals the hotspot count
  - **Validates: Requirements 2.3**

- [ ] 6. Build the SafeRoute page — route finding and display
  - Add source, destination, and hour inputs to SafeRoute.tsx
  - Auto-populate source with `"${lat},${lng}"` from Current_Location on mount
  - On "Find Safe Routes" click, call `safeRouteApi.routes(source, destination, hour)` and render polylines using `safetyScoreToColor`
  - Render route info cards below the map (distance, duration, safety score)
  - Show error message when no routes returned or API fails
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 6.1 Write property test for route info rendering (Property 2)
  - **Property 2: Route info rendering contains all required fields**
  - Generate random Route arrays; render the info cards and assert each card contains distance_km, duration_min, and safety_score
  - **Validates: Requirements 1.5**

- [ ] 7. Add hotspot warning banner to SafeRoute page
  - After each location update, call `isLocationInHotspot(lat, lng, hotspotCells)` and set a `inHighRiskZone` state flag
  - Render a red warning banner at the top of the page when `inHighRiskZone === true`
  - Hide the banner when `inHighRiskZone === false`
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 8. Enhance geofenceService with highRisk flag
  - Add `isLocationInHotspot` import from a shared util (or duplicate the logic in the backend)
  - In `checkGeofenceBreach`, after detecting a breach, fetch the current risk-map from the Python service (with a 1-hour in-memory cache)
  - Set `highRisk: true` in the Firestore breach document and in the WebSocket breach event when the breached location overlaps a hotspot
  - _Requirements: 4.5_

- [ ] 8.1 Write property test for backend highRisk flag (Property 7)
  - **Property 7: Backend highRisk flag matches hotspot containment**
  - Generate random breach coordinates and hotspot cell arrays; assert `highRisk` equals `isLocationInHotspot(lat, lng, cells)`
  - **Validates: Requirements 4.5**

- [ ] 9. Wire navigation — BottomNav and App router
  - Add `{ path: '/safe-route', icon: '🗺️', label: 'Safe Route' }` to the tabs array in `BottomNav.tsx`
  - Import `SafeRoute` in `App.tsx` and add `<Route path="/safe-route" element={<SafeRoute />} />` inside `ProtectedLayout`
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 10. Checkpoint — Ensure all tests pass
  - Run `vitest --run` in `raksha-web`; all property and unit tests should pass
  - Verify the Node proxy compiles with `tsc --noEmit` in `Raksha`
  - Ask the user if any questions arise before proceeding

## Notes

- All tasks including tests are required
- The Python FastAPI service must be running locally (`uvicorn app:app --reload` in the backend folder) for end-to-end testing
- Set `SAFE_ROUTE_URL=http://127.0.0.1:8000` in `Raksha/.env` for local development
- fast-check is the property-based testing library; install with `npm install --save-dev fast-check` in `raksha-web`
- Each property test must run a minimum of 100 iterations
