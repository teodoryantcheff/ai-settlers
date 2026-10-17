import { Mesh, MeshGeometry, Shader, Texture } from 'pixi.js';

// Two cached planes, one quad: contacts stay grounded while sunlight fades.
// The normal renderer's local/global mesh uniforms preserve the camera mapping.
const vertex = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  vUV = aUV;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}`;
// `cast` is a reserved GLSL word that strict compilers (SwiftShader) reject.
const fragment = `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uCast;
uniform sampler2D uContacts;
uniform float uCastOpacity;
uniform float uContactOpacity;
void main() {
  vec4 casts = texture(uCast, vUV) * uCastOpacity;
  vec4 contact = texture(uContacts, vUV) * uContactOpacity;
  finalColor = contact + casts * (1.0 - contact.a);
}`;

export function createShadowQuad(cast: Texture, contacts: Texture, width: number, height: number) {
  const geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const shader = Shader.from({
    gl: { vertex, fragment },
    resources: {
      uCast: cast.source,
      uContacts: contacts.source,
      shadows: {
        uCastOpacity: { value: 1, type: 'f32' },
        uContactOpacity: { value: 1, type: 'f32' },
      },
    },
  });
  const mesh = new Mesh({ geometry, shader, texture: cast });
  return {
    mesh,
    update(castOpacity: number, contactOpacity: number) {
      shader.resources.shadows.uniforms.uCastOpacity = castOpacity;
      shader.resources.shadows.uniforms.uContactOpacity = contactOpacity;
    },
    destroy() {
      shader.destroy();
      geometry.destroy();
    },
  };
}
