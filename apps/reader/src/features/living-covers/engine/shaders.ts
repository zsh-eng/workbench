/**
 * GLSL for a living cover. One book is three draws: its soft shadow, the
 * sides that face the eye (spine and page block), then the cover itself.
 *
 * World units are CSS pixels. The screen is the plane z = 0 and the eye is in
 * front of it at +z, so the cover's face, also at z = 0, lands exactly on its
 * place in the page. Anything deeper than the face moves with the eye.
 */

export const COVER_VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec2 uSize;
out vec2 vUv;
out vec3 vWorld;
void main() {
  vUv = aPos;
  vec3 local = vec3((aPos.x - 0.5) * uSize.x, (0.5 - aPos.y) * uSize.y, 0.0);
  vec4 world = uModel * vec4(local, 1.0);
  vWorld = world.xyz;
  gl_Position = uViewProj * world;
}`;

export const COVER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vWorld;
uniform sampler2D uCover;
uniform sampler2D uDepth;
uniform sampler2D uMaterials;
uniform sampler2D uLife;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec3 uT;
uniform vec3 uB;
uniform vec3 uN;
uniform vec2 uSize;
// The part of the cover image on the face: x, y, width, height.
uniform vec4 uCrop;
// x: parallax depth, y: relief height (cover widths), z: shading, w: hinge
uniform vec4 uShape;
// gloss, roughness, grain, weave
uniform vec4 uPaper;
// roughness, iridescence, grain, strength
uniform vec4 uFoil;
// x: glow, y: has materials, z: has life, w: time in seconds
uniform vec4 uMisc;
// shimmer amount, mist opacity, pulse amount, unused
uniform vec4 uLifeAmount;
// shimmer speed, mist speed, pulse speed, unused
uniform vec4 uLifeSpeed;
uniform vec3 uMistColor;
uniform int uGlintCount;
uniform vec4 uGlints[8];
uniform vec3 uGlintColors[8];
// x: parallax steps, y: shadow steps, z: corner radius (px), w: light power
uniform vec4 uQuality;
// 0: lit, 1: the depth map, 2: the material and life masks.
uniform int uView;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amp *= 0.5;
  }
  return sum;
}

// A studio: a soft sky from above, a softbox where the key light is, and a
// dim fill opposite. Rougher surfaces see a wider softbox.
vec3 studio(vec3 r, vec3 l, float rough) {
  float sky = 0.5 + 0.5 * r.y;
  float lobe = mix(90.0, 5.0, rough);
  float box = pow(max(dot(r, l), 0.0), lobe) * (lobe + 2.0) / 24.0;
  vec3 fillDir = normalize(vec3(-l.x, 0.25, 0.9));
  float fill = pow(max(dot(r, fillDir), 0.0), lobe * 0.5) * 0.12;
  return vec3(0.10 + 0.22 * sky * sky) + vec3(1.0, 0.96, 0.9) * min(box, 6.0) + fill;
}

float blinn(vec3 n, vec3 h, float rough) {
  float a = max(rough * rough, 0.002);
  float shin = 2.0 / (a * a) - 2.0;
  return pow(max(dot(n, h), 0.0), shin) * (shin + 8.0) / 25.13;
}

vec3 rainbow(float t) {
  return 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + t));
}

void main() {
  // Work in the cover image's own space, so the maps line up with it.
  vec2 imageSize = uSize / uCrop.zw;
  float aspect = imageSize.y / imageSize.x;
  float time = uMisc.w;
  vec3 V = normalize(uEye - vWorld);
  vec3 Vt = vec3(dot(V, uT), dot(V, uB), dot(V, uN));

  // Parallax: march the eye ray into the hand-made height field.
  vec2 uv = uCrop.xy + vUv * uCrop.zw;
  if (uShape.x > 0.0) {
    float steps = uQuality.x;
    float layer = 1.0 / steps;
    vec2 shift = -Vt.xy / max(Vt.z, 0.3) * uShape.x * vec2(1.0, 1.0 / aspect);
    vec2 dUv = shift * layer;
    float rayDepth = 0.0;
    float surfaceDepth = 1.0 - textureLod(uDepth, uv, 0.0).r;
    vec2 prevUv = uv;
    float prevGap = surfaceDepth;
    for (int i = 0; i < 64; i++) {
      if (float(i) >= steps || rayDepth >= surfaceDepth) break;
      prevUv = uv;
      prevGap = surfaceDepth - rayDepth;
      uv += dUv;
      rayDepth += layer;
      surfaceDepth = 1.0 - textureLod(uDepth, uv, 0.0).r;
    }
    float gap = surfaceDepth - rayDepth;
    float w = prevGap / max(prevGap - gap, 1e-4);
    uv = mix(prevUv, uv, clamp(w, 0.0, 1.0));
  }
  uv = clamp(uv, vec2(0.0), vec2(1.0));

  vec3 life = uMisc.z > 0.0 ? texture(uLife, uv).rgb : vec3(0.0);
  // Shimmer bends the art itself, a little, where water is.
  vec2 flow = vec2(0.0);
  if (life.r > 0.0 && uLifeAmount.x > 0.0) {
    float t = time * uLifeSpeed.x;
    vec2 q = uv * vec2(26.0, 70.0);
    flow = vec2(sin(q.y + t * 2.1 + 3.0 * noise(q * 0.21 + t * 0.3)),
                cos(q.x * 0.6 + t * 1.7 + 2.0 * noise(q * 0.17 - t * 0.2))) * life.r;
    uv += flow * uLifeAmount.x * 0.0035;
  }

  vec3 albedo = texture(uCover, uv).rgb;
  vec3 mats = uMisc.y > 0.0 ? texture(uMaterials, uv).rgb : vec3(0.0);
  float foil = mats.r;
  float gloss = mats.g;
  float glow = mats.b;

  // Relief: lighting normals from the relief channel, the paper grain, the
  // weave of a cloth binding and the hinge where the cover folds.
  vec2 texel = 1.0 / vec2(textureSize(uDepth, 0));
  float gx = texture(uDepth, uv + vec2(texel.x, 0.0)).g - texture(uDepth, uv - vec2(texel.x, 0.0)).g;
  float gy = texture(uDepth, uv + vec2(0.0, texel.y)).g - texture(uDepth, uv - vec2(0.0, texel.y)).g;
  vec2 slope = vec2(gx / (2.0 * texel.x), gy / (2.0 * texel.y * aspect)) * uShape.y;
  vec2 px = uv * imageSize;
  slope += (hash22(floor(px * 0.8)) - 0.5) * uPaper.z * 0.18;
  if (uPaper.w > 0.0) {
    vec2 w = px * 2.4;
    float warp = step(0.5, fract((floor(w.x) + floor(w.y)) * 0.5));
    slope += vec2(cos(w.x * 3.1416) * (1.0 - warp), cos(w.y * 3.1416) * warp) * uPaper.w * 0.35;
  }
  float hingeX = 0.045;
  float hinge = (uv.x - hingeX) / 0.006;
  slope.x += uShape.w * -2.0 * hinge * exp(-hinge * hinge) * 0.12;
  slope += flow * life.r * 0.25;
  vec3 nT = normalize(vec3(-slope, 1.0));
  vec3 N = normalize(uT * nT.x + uB * nT.y + uN * nT.z);

  vec3 L = normalize(uLight - vWorld);
  vec3 Lt = vec3(dot(L, uT), dot(L, uB), dot(L, uN));
  vec3 H = normalize(L + V);
  float power = uQuality.w;

  // Soft self-shadow from the relief, so stamped letters sit in the board.
  float shadow = 1.0;
  if (uShape.y > 0.0 && uQuality.y > 0.0 && Lt.z > 0.05) {
    float h0 = texture(uDepth, uv).g;
    float reach = (1.0 - h0) * uShape.y / Lt.z;
    vec2 dir = Lt.xy * vec2(1.0, 1.0 / aspect);
    for (int i = 1; i <= 12; i++) {
      if (float(i) > uQuality.y) break;
      float t = reach * float(i) / uQuality.y;
      float rayH = h0 * uShape.y + t * Lt.z;
      float surfaceH = textureLod(uDepth, uv + dir * t, 0.0).g * uShape.y;
      shadow = min(shadow, clamp(1.0 - (surfaceH - rayH) / (uShape.y * 0.08), 0.0, 1.0));
    }
    shadow = mix(1.0, shadow, 0.65);
  }

  // The art keeps its own colours at rest; relief and the light shape it.
  float flatLight = max(dot(uN, L), 0.0);
  float nl = max(dot(N, L), 0.0) * shadow;
  float reliefShade = nl / max(flatLight, 0.2);
  float overall = mix(0.86, 1.06, flatLight);
  vec3 lin = albedo * albedo;
  vec3 base = lin * mix(1.0, reliefShade, 0.85) * mix(1.0, overall, uShape.z);

  float nv = max(dot(N, V), 0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);

  // The laminate: a broad sheen and the studio in reflection.
  vec3 sheen = vec3(blinn(N, H, uPaper.y) * power * shadow) +
               studio(R, L, uPaper.y) * 0.25;
  vec3 color = base + sheen * fresnel * uPaper.x;

  // Foil: a mirror tinted by its own colour, broken up by its grain.
  if (foil > 0.0) {
    vec2 grain = hash22(floor(px * 0.7)) - 0.5;
    vec3 nf = normalize(N + (uT * grain.x + uB * grain.y) * uFoil.z * 0.5);
    vec3 rf = reflect(-V, nf);
    vec3 hf = normalize(L + V);
    vec3 tint = mix(vec3(dot(lin, vec3(0.333))), lin, 1.35);
    tint = max(tint, vec3(0.0)) * 1.6 + 0.03;
    // The studio reflects in the smooth foil; the grain only breaks up the
    // highlight itself into sparkle.
    vec3 env = studio(R, L, uFoil.x);
    vec3 metal = tint * (0.32 + env * 0.9 * uFoil.w + blinn(nf, hf, uFoil.x) * power * 1.4 * shadow);
    if (uFoil.y > 0.0) {
      vec3 film = rainbow(dot(nf, V) * 1.8 + uv.x * 0.7 + uv.y * 0.4);
      metal = mix(metal, metal * film * 1.6, uFoil.y);
    }
    color = mix(color, metal, foil);
  }

  // Spot gloss: a clear coat with a sharp highlight on top.
  if (gloss > 0.0) {
    vec3 coat = vec3(blinn(N, H, 0.08) * power * 0.5 * shadow) + studio(R, L, 0.08) * 0.35;
    color += coat * (0.06 + 0.94 * pow(1.0 - nv, 4.0) + 0.12) * gloss;
  }

  // Glow and its slow pulse.
  float pulse = 1.0;
  if (life.b > 0.0 && uLifeAmount.z > 0.0) {
    pulse = 1.0 + uLifeAmount.z * life.b * sin(time * uLifeSpeed.z);
  }
  color += lin * glow * uMisc.x * pulse;
  color *= 1.0 + (pulse - 1.0) * 0.35;

  // Mist drifts across where it was painted.
  if (life.g > 0.0 && uLifeAmount.y > 0.0) {
    vec2 m = uv * vec2(3.0, 5.0 * aspect) + vec2(time * uLifeSpeed.y * 0.05, time * uLifeSpeed.y * 0.012);
    float density = smoothstep(0.35, 0.85, fbm(m));
    vec3 mist = uMistColor * uMistColor;
    color = mix(color, mist, life.g * uLifeAmount.y * density);
  }

  // Glints: hand-placed stars that twinkle, and flare when the light lines up.
  for (int i = 0; i < 8; i++) {
    if (i >= uGlintCount) break;
    vec4 g = uGlints[i];
    vec2 d = (uv - g.xy) * vec2(1.0, aspect) / g.z;
    float twinkle = pow(0.5 + 0.5 * sin(time * 1.1 + g.w * 6.2832), 5.0);
    float aligned = pow(max(dot(uN, H), 0.0), 40.0);
    float strength = twinkle * 0.85 + aligned * 0.6;
    float cross = exp(-abs(d.y) * 9.0 - abs(d.x) * 1.4) + exp(-abs(d.x) * 9.0 - abs(d.y) * 1.4);
    float core = exp(-dot(d, d) * 7.0);
    vec3 c = uGlintColors[i] * uGlintColors[i];
    color += c * (cross * 0.55 + core) * strength;
  }

  // The board's edge catches the light; the corners are a little round.
  vec2 p = (vUv - 0.5) * uSize;
  vec2 q = abs(p) - (uSize * 0.5 - uQuality.z);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uQuality.z;
  float aa = max(fwidth(sd), 1e-3);
  float alpha = clamp(0.5 - sd / aa, 0.0, 1.0);
  float rim = smoothstep(-1.6, 0.0, sd);
  vec2 out2 = p.x * p.x / (uSize.x * uSize.x) > p.y * p.y / (uSize.y * uSize.y)
    ? vec2(sign(p.x), 0.0) : vec2(0.0, -sign(p.y));
  vec3 rimN = normalize(uN + (uT * out2.x + uB * out2.y) * 1.2);
  color += vec3(blinn(rimN, H, 0.3) * 0.25 + 0.04) * rim * fresnel * 3.0;

  // X-ray views of the hand-work.
  if (uView == 1) {
    float d = textureLod(uDepth, uv, 0.0).r;
    vec3 tone = mix(vec3(0.04, 0.05, 0.12), vec3(0.98, 0.95, 0.88), d);
    color = tone * tone * (0.3 + 0.8 * max(dot(N, L), 0.0) * shadow);
  } else if (uView == 2) {
    color = lin * 0.1
      + foil * vec3(1.0, 0.7, 0.18) * (0.6 + 0.6 * pow(max(dot(N, H), 0.0), 20.0))
      + gloss * vec3(0.35, 0.7, 1.0) * 0.7
      + glow * vec3(1.0, 0.32, 0.12)
      + life.r * vec3(0.1, 0.55, 1.0) * 0.6
      + life.g * vec3(0.85) * 0.45
      + life.b * vec3(1.0, 0.25, 0.6) * 0.6;
  }

  color = sqrt(max(color, vec3(0.0)));
  outColor = vec4(color * alpha, alpha);
}`;

/** The sides that can face the eye: spine, fore-edge, head and tail. */
export const SIDE_VERTEX = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aFace;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vFace;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vFace = aFace;
  gl_Position = uViewProj * world;
}`;

export const SIDE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
// x: face (0 spine, 1 pages), y: across the thickness 0..1, z: along the edge 0..1
in vec3 vFace;
uniform sampler2D uCover;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec3 uEdge;
uniform float uPages;
uniform float uThickness;
out vec4 outColor;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 L = normalize(uLight - vWorld);
  vec3 V = normalize(uEye - vWorld);
  float nl = max(dot(n, L), 0.0);
  vec3 color;
  if (vFace.x < 0.5) {
    // The spine continues the cover's own edge, darker where it rounds.
    vec3 c = texture(uCover, vec2(0.004 + 0.01 * (1.0 - vFace.y), vFace.z)).rgb;
    c *= c;
    float round = 1.0 - pow(abs(vFace.y * 2.0 - 1.0), 3.0) * 0.45;
    color = c * (0.42 + 0.5 * nl) * round;
  } else {
    // The page block: fine lines of paper, the boards at either face.
    vec3 paper = uEdge * uEdge;
    float leaves = max(uPages * 0.5, 1.0);
    float line = hash11(floor(vFace.y * leaves));
    float fine = fwidth(vFace.y * leaves);
    float pages = mix(0.9 + 0.1 * line, 0.95, clamp(fine - 0.5, 0.0, 1.0));
    float board = smoothstep(0.035, 0.0, vFace.y) + smoothstep(0.965, 1.0, vFace.y);
    vec3 boardColor = vec3(0.86, 0.84, 0.8);
    color = mix(paper * pages, boardColor * boardColor, board * 0.6) * (0.5 + 0.55 * nl);
  }
  vec3 h = normalize(L + V);
  color += vec3(pow(max(dot(n, h), 0.0), 30.0) * 0.06);
  outColor = vec4(sqrt(color), 1.0);
}`;

/** A soft contact shadow and a wider ambient one, on the page behind. */
export const SHADOW_VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec2 uSize;
uniform float uSpread;
uniform float uDepthZ;
out vec2 vP;
void main() {
  vec2 half_ = uSize * 0.5 + uSpread;
  vec2 local = (aPos * 2.0 - 1.0) * half_;
  vP = local;
  vec4 world = uModel * vec4(local, uDepthZ, 1.0);
  gl_Position = uViewProj * world;
}`;

export const SHADOW_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vP;
uniform vec2 uSize;
// xy: offset of the wide shadow, z: its blur, w: overall opacity
uniform vec4 uShadow;
out vec4 outColor;

float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 b = uSize * 0.5;
  float contact = 1.0 - smoothstep(-2.0, 3.0, box(vP - vec2(0.0, -1.0), b, 3.0));
  float wide = 1.0 - smoothstep(-uShadow.z, uShadow.z, box(vP - uShadow.xy, b - uShadow.z * 0.3, 6.0));
  float a = (contact * 0.22 + wide * 0.32) * uShadow.w;
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;
