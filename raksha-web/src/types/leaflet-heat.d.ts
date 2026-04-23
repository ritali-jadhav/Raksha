// Type shim for leaflet.heat (no @types package available)
declare module 'leaflet.heat' {
  // leaflet.heat adds L.heatLayer to the Leaflet namespace as a side-effect
}

import 'leaflet';
declare module 'leaflet' {
  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: {
      minOpacity?: number;
      maxZoom?: number;
      max?: number;
      radius?: number;
      blur?: number;
      gradient?: Record<number, string>;
    }
  ): L.Layer;
}
