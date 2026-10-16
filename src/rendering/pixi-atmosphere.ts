import { Container, Filter, Rectangle, Texture } from 'pixi.js';
import type { GameRuntime } from '../runtime.ts';
import type { PremultipliedTint } from './renderer.ts';

const vertex = `
precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 pixel = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  gl_Position = vec4(pixel.x / uOutputTexture.x * 2.0 - 1.0,
    (pixel.y / uOutputTexture.y * 2.0 - 1.0) * uOutputTexture.z, 0.0, 1.0);
  vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`;

// A single GPU pass veils and grades the painted artwork. Particles and weather
// remain native scene commands, so lighting never requires a Canvas frame upload.
// The premultiplied night, dusk, rain and lightning veil is composited
// source-over first, so grading and bloom see the veiled scene.
const fragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec2 uViewport;
uniform vec2 uCamera;
uniform float uScale;
uniform float uSun;
uniform float uBloom;
uniform vec4 uTint;
vec3 veiled(vec3 value) {
  return uTint.rgb + value * (1.0 - uTint.a);
}
vec3 highlight(vec2 delta) {
  vec3 value = texture(uTexture, clamp(vTextureCoord + delta * uInputSize.zw,
    uInputClamp.xy, uInputClamp.zw)).rgb;
  return max(veiled(value) - vec3(0.77), vec3(0.0));
}
void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  float alpha = uTint.a + source.a * (1.0 - uTint.a);
  vec2 pixel = vTextureCoord * uInputSize.xy;
  vec2 uv = pixel / uViewport;
  vec2 world = uCamera + pixel / max(uScale, 0.01);
  vec3 c = veiled(source.rgb);
  float luminance = dot(c, vec3(0.2126,0.7152,0.0722));
  vec3 graded = mix(vec3(luminance), c, 1.03);
  graded = (graded - vec3(0.27)) * 1.02 + vec3(0.27);
  // Preserve blue water and green foliage while warming sun-facing highlights.
  graded *= mix(vec3(0.99,1.01,1.025), vec3(1.05,1.005,0.96),
    smoothstep(0.09,0.7,luminance));
  c = mix(c, graded, uSun);
  float shaft = pow(max(0.0,sin((world.x-world.y*0.66)/55.0)),12.0);
  float sun = exp(-length(uv-vec2(0.03,0.02))*1.8);
  c += vec3(0.042,0.025,0.007) * sun * (0.2+shaft*0.8) * uSun;
  if (uBloom > 0.5) {
    vec3 bloom = (highlight(vec2(3,0))+highlight(vec2(-3,0))+
      highlight(vec2(0,3))+highlight(vec2(0,-3)))/4.0;
    c += bloom * vec3(0.21,0.17,0.09) * uSun;
  }
  float edge = smoothstep(0.35,0.8,length((uv-0.5)*vec2(1.0,0.85)));
  c *= 1.0-edge*0.065;
  finalColor = vec4(clamp(c,vec3(0.0),vec3(alpha)),alpha);
}`;

export function createProductionAtmosphere(scene: Container) {
  const area = new Rectangle();
  // Persistent uniform arrays: mutated in place, never reallocated per frame.
  const viewport = [1, 1];
  const camera = [0, 0];
  const tint = [0, 0, 0, 0];
  const filter = Filter.from({
    gl: { vertex, fragment },
    resources: {
      atmosphere: {
        uViewport: { value: viewport, type: 'vec2<f32>' },
        uCamera: { value: camera, type: 'vec2<f32>' },
        uScale: { value: 1, type: 'f32' },
        uSun: { value: 1, type: 'f32' },
        uBloom: { value: 1, type: 'f32' },
        uTint: { value: tint, type: 'vec4<f32>' },
      },
    },
  });
  scene.filters = [filter];
  scene.filterArea = area;
  let lastWidth = 1,
    lastHeight = 1,
    lastCamX = 0,
    lastCamY = 0,
    lastScale = 1,
    lastSun = 1,
    lastBloom = 1,
    lastResolution = 1;
  return {
    update(game: GameRuntime, width: number, height: number, veil: PremultipliedTint) {
      // Clarity preserves the painted colors without shafts, bloom or vignette.
      // Disabling this persistent filter does not allocate replacement textures.
      filter.enabled = !game.renderPrefs().clarity;
      area.width = width;
      area.height = height;
      const night = game.nightAmt();
      const cool = night < 0.45 ? 0 : (night - 0.45) / 0.55;
      const quality = game.renderPrefs().quality;
      // Economical mode softens slightly to shrink the full-screen filter pass.
      const resolution = quality < 1 ? 0.75 : 1;
      if (resolution !== lastResolution) {
        filter.resolution = resolution;
        lastResolution = resolution;
      }
      const scale = (width / Math.max(1, game.vw)) * game.z;
      const sun = (1 - cool) * (1 - game.rainAmt() * 0.85);
      const bloom = quality < 1 ? 0 : 1;
      if (
        width !== lastWidth ||
        height !== lastHeight ||
        game.cam.x !== lastCamX ||
        game.cam.y !== lastCamY ||
        scale !== lastScale ||
        sun !== lastSun ||
        bloom !== lastBloom ||
        veil[0] !== tint[0] ||
        veil[1] !== tint[1] ||
        veil[2] !== tint[2] ||
        veil[3] !== tint[3]
      ) {
        viewport[0] = width;
        viewport[1] = height;
        camera[0] = game.cam.x;
        camera[1] = game.cam.y;
        for (let i = 0; i < 4; i++) tint[i] = veil[i];
        const uniforms = filter.resources.atmosphere.uniforms;
        uniforms.uViewport = viewport;
        uniforms.uCamera = camera;
        uniforms.uScale = scale;
        uniforms.uSun = sun;
        uniforms.uBloom = bloom;
        uniforms.uTint = tint;
        filter.resources.atmosphere.update();
        lastWidth = width;
        lastHeight = height;
        lastCamX = game.cam.x;
        lastCamY = game.cam.y;
        lastScale = scale;
        lastSun = sun;
        lastBloom = bloom;
      }
    },
    afterRender() {
      // Release the transient render texture before resize or filter-pool cleanup.
      filter.groups[0]?.setResource(Texture.EMPTY.source, 1);
      filter.groups[0]?.setResource(Texture.EMPTY.source.style, 2);
    },
    destroy() {
      scene.filters = null;
      scene.filterArea = undefined;
      filter.destroy();
    },
  };
}
