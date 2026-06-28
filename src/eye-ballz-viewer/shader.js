// Luminance above which the white cutout background is keyed out (made transparent).
export const WHITE_KEY_THRESHOLD = 0.85;

// Depth value below which a fragment is treated as background and keyed out. The depth
// map reads ~0 (black) for the background and bright for head/shoulders, so this cleanly
// removes the inpainted gray smudges/halo that the luminance key misses (e.g. the
// bottom-right corner of down-right gaze frames). Tunable: lower keeps more, higher cuts more.
export const BACKGROUND_DEPTH_THRESHOLD = 0.12;

// Create the `{ value }` uniform holders three.js uses for shader uniforms. We keep
// references to these so the React layer can mutate `.value` live without recompiling.
export function createUniforms() {
  return {
    uInvert: { value: 0 },
    uTime: { value: 0 },
    uWaveAmp: { value: 0 },
    uWaveSpeed: { value: 2 },
    uSwirl: { value: 0 },
    uGlitch: { value: 0 },
    uNoise: { value: 0 },
    uRGBShift: { value: 0 },
    // Depth-based background key. uDepthMap mirrors the current cell's displacement
    // texture (set in applyTexture); uHasDepth guards against sampling a null sampler
    // before the first reveal.
    uDepthMap: { value: null },
    uHasDepth: { value: 0 },
    uDepthKey: { value: BACKGROUND_DEPTH_THRESHOLD },
  };
}

// Warp the texture UVs with time-driven distortions before sampling, then key out
// the (near-white) cutout background (discard -> transparent / blank ASCII space) and
// optionally invert the surviving head fragments. The discard uses the original
// luminance, so the background stays empty regardless of distortion or invert.
//
// invert is applied here (not via AsciiEffect's invert option) so the keyed-out
// background stays empty in both the normal and inverted states.
export function applyShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInvert = uniforms.uInvert;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWaveAmp = uniforms.uWaveAmp;
    shader.uniforms.uWaveSpeed = uniforms.uWaveSpeed;
    shader.uniforms.uSwirl = uniforms.uSwirl;
    shader.uniforms.uGlitch = uniforms.uGlitch;
    shader.uniforms.uNoise = uniforms.uNoise;
    shader.uniforms.uRGBShift = uniforms.uRGBShift;
    shader.uniforms.uDepthMap = uniforms.uDepthMap;
    shader.uniforms.uHasDepth = uniforms.uHasDepth;
    shader.uniforms.uDepthKey = uniforms.uDepthKey;

    shader.fragmentShader =
      `uniform float uInvert;
       uniform float uTime;
       uniform float uWaveAmp;
       uniform float uWaveSpeed;
       uniform float uSwirl;
       uniform float uGlitch;
       uniform float uNoise;
       uniform float uRGBShift;
       uniform sampler2D uDepthMap;
       uniform float uHasDepth;
       uniform float uDepthKey;
      ` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
           vec2 duv = vMapUv;
           // wave / ripple
           duv.x += sin(duv.y * 12.0 + uTime * uWaveSpeed) * uWaveAmp;
           duv.y += cos(duv.x * 12.0 + uTime * uWaveSpeed) * uWaveAmp;
           // swirl / twist around center
           vec2 sc = duv - 0.5;
           float sr = length(sc);
           float sa = uSwirl * (0.5 - sr);
           float ss = sin(sa), scn = cos(sa);
           duv = mat2(scn, -ss, ss, scn) * sc + 0.5;
           // glitch: per-row horizontal jitter
           float band = floor(duv.y * 24.0);
           duv.x += (fract(sin(band * 91.17 + floor(uTime * 12.0)) * 43758.5453) - 0.5) * uGlitch;
           // noise wobble
           vec2 nseed = duv * 8.0 + uTime;
           duv += (vec2(
               fract(sin(dot(nseed, vec2(12.9898, 78.233))) * 43758.5453),
               fract(sin(dot(nseed, vec2(39.346, 11.135))) * 43758.5453)
             ) - 0.5) * uNoise;
           // rgb shift (chromatic aberration)
           vec2 rgo = vec2(uRGBShift, 0.0);
           vec4 sampledDiffuseColor = vec4(
             texture2D(map, duv + rgo).r,
             texture2D(map, duv).g,
             texture2D(map, duv - rgo).b,
             texture2D(map, duv).a
           );
           diffuseColor *= sampledDiffuseColor;
         #endif
         if (dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) > ${WHITE_KEY_THRESHOLD}) discard;
         // Depth key: the background reads ~0 in the depth map, so drop fragments below the
         // threshold. Catches the inpainted gray smudges/halo the luminance key (above) misses.
         if (uHasDepth > 0.5 && texture2D(uDepthMap, vMapUv).r < uDepthKey) discard;
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0) - diffuseColor.rgb, uInvert);`
      );
  };
}
