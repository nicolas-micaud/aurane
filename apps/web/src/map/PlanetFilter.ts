// A planet drawn entirely in a fragment shader: sphere shading, procedural continents and
// clouds, day/night terminator with city lights, atmosphere rim and an optional ring.
// Parametrised by type and seed, so every world is different at no asset cost.
import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js';

export type PlanetType = 'rocky' | 'ocean' | 'desert' | 'gas' | 'ice' | 'lava';

const FRAG = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float uTime;
uniform float uSeed;
uniform float uPad;
uniform vec3 uLight;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uAtmo;
uniform float uSea;
uniform float uClouds;
uniform float uBands;
uniform float uCity;
uniform float uRing;
uniform float uIce;

float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }

void main() {
  // The quad covers the sprite's frame inside a (possibly larger) pooled texture.
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 c = uOutputFrame.zw * 0.5;
  float R = c.x / (1.0 + uPad * 2.0);
  vec2 q = (px - c) / R;
  float r2 = dot(q, q);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  vec3 L = normalize(uLight);

  // Ring, drawn behind the sphere on the far half and in front on the near half.
  float ringA = 0.0; vec3 ringC = vec3(0.0);
  if (uRing > 0.0) {
    vec2 rq = vec2(q.x, q.y / 0.32);
    float rr = length(rq);
    float band = smoothstep(1.35, 1.45, rr) * (1.0 - smoothstep(2.05, 2.2, rr));
    float grain = 0.55 + 0.45 * noise(vec3(rr * 40.0, uSeed, 0.0));
    float gap = 1.0 - 0.8 * smoothstep(1.72, 1.75, rr) * (1.0 - smoothstep(1.8, 1.83, rr));
    ringA = band * grain * gap * 0.85;
    ringC = mix(uColorC, vec3(0.9, 0.85, 0.75), 0.4) * (0.35 + 0.65 * max(0.0, L.z));
    float shadow = smoothstep(0.0, 0.25, length(vec2(q.x - L.x * 0.3, q.y)) - 0.95);
    ringC *= shadow;
  }

  if (r2 < 1.0) {
    float z = sqrt(1.0 - r2);
    vec3 n = vec3(q.x, -q.y, z);
    float lon = atan(n.x, n.z) + uTime * 0.03;
    float lat = asin(clamp(n.y, -1.0, 1.0));
    vec3 sp = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    float h = fbm(sp * 2.6 + uSeed);
    float detail = fbm(sp * 9.0 + uSeed * 3.1) * 0.25;
    h = h * 0.85 + detail;
    vec3 surf;
    if (uBands > 0.0) {
      float b = sin(lat * 9.0 + fbm(sp * 3.0 + uSeed) * 2.5) * 0.5 + 0.5;
      surf = mix(uColorA, uColorB, b);
      surf = mix(surf, uColorC, smoothstep(0.62, 0.75, fbm(sp * 5.0 + uSeed * 2.0 + uTime * 0.01)));
    } else {
      float land = smoothstep(uSea - 0.04, uSea + 0.04, h);
      surf = mix(uColorA, uColorB, land);
      surf = mix(surf, uColorC, land * smoothstep(0.6, 0.85, h));
      float ice = smoothstep(0.72 - uIce * 0.5, 0.9 - uIce * 0.5, abs(n.y) + (h - 0.5) * 0.2);
      surf = mix(surf, vec3(0.93, 0.96, 1.0), ice);
    }
    float cl = fbm(sp * 4.0 + vec3(uTime * 0.05, 0.0, 0.0) + uSeed * 5.0);
    float clouds = smoothstep(0.55, 0.75, cl) * uClouds;
    surf = mix(surf, vec3(1.0), clouds * 0.85);
    float diff = max(dot(n, L), 0.0);
    float term = smoothstep(-0.15, 0.3, dot(n, L));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 40.0) * (1.0 - smoothstep(uSea - 0.04, uSea + 0.04, h)) * 0.5 * (1.0 - clouds);
    col = surf * (0.04 + 0.96 * diff) + spec;
    if (uCity > 0.0) {
      float city = smoothstep(0.62, 0.8, noise(sp * 60.0 + uSeed)) * smoothstep(uSea + 0.02, uSea + 0.1, h) * (1.0 - clouds);
      col += vec3(1.0, 0.75, 0.4) * city * (1.0 - term) * uCity;
    }
    float rim = pow(1.0 - z, 2.5);
    col += uAtmo * rim * (0.25 + 0.75 * term) * 1.3;
    alpha = 1.0;
    // Near half of the ring passes in front of the lower hemisphere.
    if (uRing > 0.0 && q.y > 0.0) { col = mix(col, ringC, ringA); }
  } else {
    float d = sqrt(r2) - 1.0;
    float glow = exp(-d * 9.0) * 0.55;
    col = uAtmo * glow * (0.3 + 0.7 * smoothstep(-0.6, 0.6, dot(normalize(vec3(q.x, -q.y, 0.2)), L)));
    alpha = glow;
    col = mix(col, ringC, ringA); alpha = max(alpha, ringA);
  }
  finalColor = vec4(col * alpha, alpha);
}
`;

const PRESETS: Record<PlanetType, { a: number[]; b: number[]; c: number[]; atmo: number[]; sea: number; clouds: number; bands: number; city: number; ice: number }> = {
  rocky: { a: [0.36, 0.30, 0.26], b: [0.55, 0.47, 0.38], c: [0.72, 0.66, 0.58], atmo: [0.55, 0.62, 0.75], sea: 0.2, clouds: 0.3, bands: 0, city: 0.9, ice: 0.2 },
  ocean: { a: [0.05, 0.22, 0.45], b: [0.20, 0.42, 0.20], c: [0.55, 0.50, 0.38], atmo: [0.35, 0.65, 1.0], sea: 0.52, clouds: 0.9, bands: 0, city: 1.0, ice: 0.3 },
  desert: { a: [0.62, 0.45, 0.25], b: [0.78, 0.62, 0.38], c: [0.90, 0.80, 0.60], atmo: [0.95, 0.75, 0.55], sea: 0.05, clouds: 0.2, bands: 0, city: 0.5, ice: 0.0 },
  gas: { a: [0.72, 0.58, 0.42], b: [0.90, 0.80, 0.62], c: [0.55, 0.42, 0.32], atmo: [0.95, 0.85, 0.7], sea: 0, clouds: 0, bands: 1, city: 0, ice: 0 },
  ice: { a: [0.62, 0.72, 0.85], b: [0.85, 0.90, 0.96], c: [0.95, 0.97, 1.0], atmo: [0.7, 0.85, 1.0], sea: 0.3, clouds: 0.5, bands: 0, city: 0.2, ice: 0.9 },
  lava: { a: [0.85, 0.30, 0.05], b: [0.18, 0.14, 0.14], c: [0.30, 0.25, 0.24], atmo: [1.0, 0.5, 0.25], sea: 0.45, clouds: 0.15, bands: 0, city: 0, ice: 0 },
};

export class PlanetFilter extends Filter {
  constructor(type: PlanetType, seed: number, opts: { ring?: boolean; light?: [number, number, number] } = {}) {
    const p = PRESETS[type];
    const pad = 0.28;
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: FRAG, name: 'planet' }),
      resources: {
        planetUniforms: new UniformGroup({
          uTime: { value: 0, type: 'f32' },
          uSeed: { value: seed, type: 'f32' },
          uPad: { value: pad, type: 'f32' },
          uLight: { value: new Float32Array(opts.light ?? [-0.6, 0.5, 0.62]), type: 'vec3<f32>' },
          uColorA: { value: new Float32Array(p.a), type: 'vec3<f32>' },
          uColorB: { value: new Float32Array(p.b), type: 'vec3<f32>' },
          uColorC: { value: new Float32Array(p.c), type: 'vec3<f32>' },
          uAtmo: { value: new Float32Array(p.atmo), type: 'vec3<f32>' },
          uSea: { value: p.sea, type: 'f32' },
          uClouds: { value: p.clouds, type: 'f32' },
          uBands: { value: p.bands, type: 'f32' },
          uCity: { value: p.city, type: 'f32' },
          uRing: { value: opts.ring ? 1 : 0, type: 'f32' },
          uIce: { value: p.ice, type: 'f32' },
        }),
      },
    });
    this.padFraction = pad;
  }
  readonly padFraction: number;
  set time(t: number) { (this.resources as { planetUniforms: UniformGroup }).planetUniforms.uniforms.uTime = t; }
}

/** A stable planet type for a system, from its resource and hue. */
export function planetTypeFor(resource: string, hue: number): PlanetType {
  if (resource === 'energy') return hue % 2 ? 'lava' : 'desert';
  if (resource === 'food') return hue % 3 ? 'ocean' : 'rocky';
  if (resource === 'crystal') return hue % 2 ? 'ice' : 'gas';
  return hue % 3 === 0 ? 'gas' : 'rocky';
}
