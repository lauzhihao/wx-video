import * as THREE from 'three';
import { feature } from 'topojson-client';

// Land mask from Natural Earth 1:110m (world-atlas package), rasterised equirectangularly,
// then a Fibonacci-sphere dot pattern is split into land / ocean dots.

export async function landMask(w = 2048, h = 1024) {
  const topo = await (await fetch('./node_modules/world-atlas/land-110m.json')).json();
  const land = feature(topo, topo.objects.land);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const X = (lon) => ((lon + 180) / 360) * w, Y = (lat) => ((90 - lat) / 180) * h;
  const drawPoly = (rings) => {
    g.beginPath();
    for (const ring of rings) {
      let prev = null;
      ring.forEach(([lon, lat], i) => {
        if (i === 0 || (prev && Math.abs(lon - prev) > 180)) g.moveTo(X(lon), Y(lat));
        else g.lineTo(X(lon), Y(lat));
        prev = lon;
      });
      g.closePath();
    }
    g.fill('evenodd');
  };
  for (const f of land.features) {
    const geo = f.geometry;
    if (geo.type === 'Polygon') drawPoly(geo.coordinates);
    else if (geo.type === 'MultiPolygon') geo.coordinates.forEach(drawPoly);
  }
  return { data: g.getImageData(0, 0, w, h).data, w, h };
}

export function latLonToVec(lat, lon, r = 1, out = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  return out.set(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r);
}

export function globeDots(mask, n = 90000) {
  const land = [], ocean = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = ga * i;
    const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
    const lat = Math.asin(y) * 180 / Math.PI;
    const lon = Math.atan2(x, z) * 180 / Math.PI;
    const px = Math.min(mask.w - 1, Math.floor(((lon + 180) / 360) * mask.w));
    const py = Math.min(mask.h - 1, Math.floor(((90 - lat) / 180) * mask.h));
    const isLand = mask.data[(py * mask.w + px) * 4] > 127;
    (isLand ? land : ocean).push(x, y, z);
  }
  return { land: new Float32Array(land), ocean: new Float32Array(ocean) };
}
