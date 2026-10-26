import { GLSL_NOISE } from "@/features/living-covers/engine/shaders";

/**
 * GLSL for an arriving cover: one quad per book, drawn over the paper the
 * page already shows. Every direction ends on the plain cover: at
 * `uReveal = 1` the output is the cover image and nothing else, so the
 * Library's own image can take over without a seam.
 *
 * Output is premultiplied: alpha 0 shows the page's paper underneath.
 */

export const ARRIVAL_VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const ARRIVAL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uCover;
uniform sampler2D uRelief;
// x: a cover image, y: a hand-made relief map
uniform vec2 uHas;
// The part of the cover image in the slot: x, y, width, height.
uniform vec4 uCrop;
// The slot in CSS pixels.
uniform vec2 uSize;
// 0 to 1 from the moment the cover is known to the book at rest.
uniform float uReveal;
// 0 to 1 through the steps before the cover is known.
uniform float uBefore;
uniform vec3 uPaper;
uniform float uSeed;
// 0: develop, 1: raking light, 2: ink.
uniform int uDirection;
out vec4 outColor;

${GLSL_NOISE}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// The face's height for lighting, from a living cover's relief channel.
float height(vec2 uv) {
  return texture(uRelief, uv).g;
}

// A printed cover's surface: the fine tooth of the board, in CSS pixels.
float tooth(vec2 px) {
  return noise(px * 1.1 + uSeed * 3.1) * 0.75 +
         noise(px * vec2(0.35, 0.5) + uSeed * 7.7) * 0.25;
}

// Film grain, per device pixel: white noise softened with a little value
// noise, so it reads as silver, not as a dither.
float grain(float seed) {
  vec2 fc = gl_FragCoord.xy;
  return (hash12(fc + seed * 31.7) - 0.5) * 0.6 +
         (noise(fc * 0.5 + seed * 7.3) - 0.5) * 0.8;
}

// A print in the tray. Shadows come first on light paper (highlights first
// on dark paper), through a fine grain; then the colour arrives over the
// black and white, and the grain goes as it fixes.
vec4 develop(vec3 cover) {
  float L = luma(cover);
  float paperL = luma(uPaper);
  float contrast = clamp(abs(L - paperL) * 1.15, 0.0, 1.0);
  float g = grain(uSeed);
  float d = clamp(uReveal / 0.7, 0.0, 1.0);
  float density = smoothstep(
    0.0, 1.0,
    d * 1.9 - (1.0 - contrast) * 0.9 + g * 0.12 * (1.0 - d)
  ) * smoothstep(0.0, 0.05, uReveal);
  // A warm-toned silver print of the cover.
  vec3 mono = vec3(L) * vec3(1.015, 1.0, 0.965);
  float colour = smoothstep(0.5, 1.0, uReveal);
  vec3 rgb = mix(mono, cover, colour) + g * 0.05 * (1.0 - colour);
  float alpha = max(density, colour);
  return vec4(rgb * alpha, alpha);
}

// A lamp low at the spine. It crosses the cover as the book is prepared,
// rising as it goes. Ahead of it the cover waits, pale and grey; in its pool
// the surface shows in a warm grazing light; behind it the colour is back.
// A living cover's hand-made relief stands up in the light. A printed cover
// is flat: the light finds the board's tooth and a sheen that travels with
// the lamp, never embossed ink.
vec4 rake(vec3 cover, vec2 uv, vec2 px) {
  float t = uReveal;
  float L = luma(cover);
  vec2 slope;
  if (uHas.y > 0.5) {
    vec2 texel = 1.4 / uSize * uCrop.zw;
    slope = vec2(
      height(uv + vec2(texel.x, 0.0)) - height(uv - vec2(texel.x, 0.0)),
      height(uv - vec2(0.0, texel.y)) - height(uv + vec2(0.0, texel.y))
    ) * 9.0;
  } else {
    slope = vec2(
      tooth(px + vec2(1.0, 0.0)) - tooth(px - vec2(1.0, 0.0)),
      tooth(px + vec2(0.0, 1.0)) - tooth(px - vec2(0.0, 1.0))
    ) * 0.13;
  }
  vec3 n = normalize(vec3(-slope, 1.0));
  float elevation = mix(0.14, 0.9, t);
  vec3 light = normalize(vec3(-cos(elevation), 0.3, sin(elevation)));
  float shade = clamp(max(dot(n, light), 0.0) / max(light.z, 0.05), 0.5, 1.6);
  // The lamp's edge, slanted, and the pool of light around it.
  float across = vUv.x + (vUv.y - 0.5) * 0.3;
  float edge = mix(-0.4, 1.4, t);
  float lit = smoothstep(edge + 0.02, edge - 0.4, across);
  float pool = exp(-pow((across - edge) / 0.22, 2.0));
  // The board is never quite flat: a slow swell catches the light unevenly.
  float swell = fbm(px * 0.011 + uSeed * 4.3) - 0.5;
  // Laminate and ink take a glancing sheen just behind the lamp's edge,
  // dark ink a little more than bare paper.
  float sheen = exp(-pow((across - edge + 0.07) / 0.05, 2.0)) *
                (0.07 + 0.08 * (1.0 - L)) * (1.0 - t * 0.6);
  vec3 mono = vec3(L);
  vec3 waiting = mix(uPaper, mono, 0.5);
  vec3 warm = vec3(1.04, 1.0, 0.94);
  vec3 grazed = mono * shade * (1.0 + swell * 0.18) * warm + sheen * shade;
  vec3 ahead = mix(waiting, grazed, pool);
  vec3 behind = mix(cover, cover * shade * warm + sheen, pool * (1.0 - t));
  vec3 rgb = mix(ahead, behind, lit);
  rgb = mix(rgb, cover, smoothstep(0.88, 1.0, t));
  float alpha = smoothstep(0.0, 0.12, t);
  return vec4(rgb * alpha, alpha);
}

// Ink dropped into blotting paper. It blooms from three drops in soft lobes,
// feathering along the fibres, dark inks a little ahead, with a pale bleed
// before it; fresh ink is deeper and leaves a faint tide line, then dries to
// the cover's own colour.
vec4 ink(vec3 cover, vec2 px) {
  float t = uReveal;
  float L = luma(cover);
  // Positions in cover widths, so the drops spread at one speed both ways.
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize / uSize.x;
  float aspect = uSize.y / uSize.x;
  float warp = (fbm(px * 0.014 + uSeed * 5.1) - 0.5) * 0.3 +
               (noise(px * vec2(0.12, 0.35) + uSeed * 13.1) - 0.5) * 0.05;
  float reach = -1.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 jitter = hash22(vec2(uSeed * 17.0 + fi, fi * 3.1)) - 0.5;
    vec2 drop = vec2(0.3 + 0.4 * fract(fi * 0.618 + 0.2) + jitter.x * 0.2,
                     aspect * (0.2 + 0.3 * fi + jitter.y * 0.1));
    float delay = fi * 0.14;
    float radius = clamp((t - delay) / (1.0 - delay), 0.0, 1.0) * 1.45 * aspect * 0.75;
    // A drop not yet fallen leaves no mark.
    reach = max(reach, radius - distance(p, drop) + warp * smoothstep(0.0, 0.08, radius));
  }
  float d = reach + (1.0 - L) * 0.04;
  float wet = smoothstep(-0.01, 0.04, d);
  float bleed = smoothstep(-0.09, 0.0, d) * (1.0 - wet) * 0.3;
  float tide = smoothstep(0.0, 0.012, d) * (1.0 - smoothstep(0.012, 0.05, d));
  float dry = smoothstep(0.03, 0.3, d);
  vec3 fresh = mix(cover, cover * cover, 0.35);
  vec3 rgb = mix(fresh, cover, dry) * (1.0 - tide * 0.16);
  vec3 pale = mix(uPaper, cover, 0.35);
  float done = smoothstep(0.9, 1.0, t);
  // Premultiplied: the wet ink and its bleed over the paper.
  vec3 colour = mix(rgb * wet + pale * bleed, cover, done);
  float alpha = mix(wet + bleed, 1.0, done);
  return vec4(colour, alpha);
}

void main() {
  vec2 px = vUv * uSize;
  if (uHas.x < 0.5) {
    outColor = vec4(0.0);
    return;
  }
  // GL's rows run up; the image's run down.
  vec2 uv = uCrop.xy + vec2(vUv.x, 1.0 - vUv.y) * uCrop.zw;
  vec3 cover = texture(uCover, uv).rgb;
  if (uDirection == 1) outColor = rake(cover, uv, px);
  else if (uDirection == 2) outColor = ink(cover, px);
  else outColor = develop(cover);
}`;
