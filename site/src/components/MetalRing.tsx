/*
 * Liquid metal ring: an animated metal border around a single child box.
 * Two WebGL passes per instance - plasma into a small texture, then a
 * bilinear upscale masked to the border (rounded-box SDF). While the ring is
 * live the wrapper carries `is-active` so CSS can drop the child's own
 * border; without WebGL the child keeps its hairline.
 * Plasma shader and presets adapted from metal-fx (c) Jakub Antalik, MIT.
 */
import { useEffect, useRef, type ReactNode } from "react";

/* Tiny on purpose: the upscale melts the noise into smooth liquid streaks. */
const PLASMA_SIZE = 66;

const VERTEX_SOURCE = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const PLASMA_SOURCE = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color1, u_color2, u_color3, u_color4, u_color5;
uniform float u_intensity, u_scale, u_direction;
uniform float u_distortion, u_complexity, u_blur;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x_) - 0.5;
  vec3 ox = floor(x_ + 0.5);
  vec3 a0 = x_ - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  int n = int(3.0 + u_complexity * 4.0);
  for (int i = 0; i < 7; i++) {
    if (i >= n) break;
    val += amp * snoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return val;
}

/* 5-stop palette: gaussian-weighted blend across the preset colors. */
vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  float k = 64.0;
  float w1 = exp(-k * t * t);
  float w2 = exp(-k * (t - 0.25) * (t - 0.25));
  float w3 = exp(-k * (t - 0.5) * (t - 0.5));
  float w4 = exp(-k * (t - 0.75) * (t - 0.75));
  float w5 = exp(-k * (t - 1.0) * (t - 1.0));
  float total = w1 + w2 + w3 + w4 + w5 + 0.0001;
  return (u_color1 * w1 + u_color2 * w2 + u_color3 * w3 +
          u_color4 * w4 + u_color5 * w5) / total;
}

vec2 warp(vec2 p, float t) {
  float strength = u_distortion * 2.0;
  return vec2(
    fbm(p + vec2(t * 0.1, 0.0)),
    fbm(p + vec2(0.0, t * 0.12) + 5.0)
  ) * strength;
}

/* Plasma: four sine bands warped by an FBM field, mapped through the palette. */
vec3 plasma(vec2 uv, float t) {
  vec2 p = (uv - 0.5) * u_scale;
  p += vec2(cos(u_direction), sin(u_direction)) * t * 0.15;

  float freq = 3.0 + u_complexity * 8.0;
  float val = 0.0;
  val += sin(p.x * freq + t);
  val += sin(p.y * freq + t * 1.3);
  val += sin((p.x + p.y) * freq * 0.7 + t * 0.7);
  val += sin(length(p) * freq * 0.8 - t * 1.5);
  vec2 w = warp(p, t);
  val += (w.x + w.y) * u_distortion;
  val = val * 0.2 * u_intensity + 0.5;

  return palette(clamp(val, 0.0, 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time;

  vec3 col;
  if (u_blur < 0.01) {
    col = plasma(uv, t);
  } else {
    float r = u_blur * 0.02;
    col  = plasma(uv, t) * 0.4;
    col += plasma(uv + vec2( r, 0.0), t) * 0.15;
    col += plasma(uv + vec2(-r, 0.0), t) * 0.15;
    col += plasma(uv + vec2(0.0,  r), t) * 0.15;
    col += plasma(uv + vec2(0.0, -r), t) * 0.15;
  }
  col = pow(col, vec3(1.3));

  gl_FragColor = vec4(col, 1.0);
}
`;

/* Pass 2: upscale the plasma texture, mask it to the ring (smoothstep AA). */
const COMPOSITE_SOURCE = `
precision mediump float;

uniform sampler2D u_plasma;
uniform vec2 u_resolution;
uniform float u_radius, u_ring;

float roundedBoxSDF(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 col = texture2D(u_plasma, uv).rgb;

  vec2 pos = gl_FragCoord.xy - u_resolution * 0.5;
  float dOuter = roundedBoxSDF(pos, u_resolution * 0.5, u_radius);
  float dInner = roundedBoxSDF(pos, u_resolution * 0.5 - vec2(u_ring),
                               max(u_radius - u_ring, 0.0));
  float ring = smoothstep(0.75, -0.75, dOuter) * smoothstep(-0.75, 0.75, dInner);

  gl_FragColor = vec4(col * ring, ring);
}
`;

interface PresetMode {
  colors: [string, string, string, string, string];
  direction: number;
  speed: number;
  intensity: number;
  scale: number;
  distortion: number;
  complexity: number;
  blur: number;
}

/* Chromatic preset tunings, per theme. */
const CHROMATIC: Record<"dark" | "light", PresetMode> = {
  dark: {
    colors: ["#000000", "#aae8ff", "#c5fe9e", "#f7888d", "#0d0d0d"],
    direction: 80,
    speed: 1.2,
    intensity: 2,
    scale: 1.6,
    distortion: 0.3,
    complexity: 0.68,
    blur: 1,
  },
  light: {
    colors: ["#ffffff", "#ffffff", "#ffffff", "#ffb3b3", "#adadad"],
    direction: 80,
    speed: 1.2,
    intensity: 2,
    scale: 2.5,
    distortion: 0.3,
    complexity: 0.68,
    blur: 1,
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("MetalRing: createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`MetalRing: shader compile failed: ${log}`);
  }
  return shader;
}

function buildProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  try {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return program;
  } catch {
    return null;
  }
}

interface MetalRingProps {
  children: ReactNode;
  theme: "dark" | "light";
  /** Corner radius in CSS px; matches the child's border-radius. */
  radius?: number;
  /** Ring thickness in CSS px. */
  thickness?: number;
  className?: string;
}

export default function MetalRing({
  children,
  theme,
  radius = 8,
  thickness = 1.5,
  className,
}: MetalRingProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef(theme);
  // oxlint-disable-next-line react/refs -- latest-value ref read only inside the WebGL loop; render-time sync keeps it current without re-running the effect
  themeRef.current = theme;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true });
    } catch {
      gl = null;
    }
    if (!gl) return; // no WebGL: the box keeps its plain border

    const plasmaProgram = buildProgram(gl, VERTEX_SOURCE, PLASMA_SOURCE);
    const compositeProgram = buildProgram(gl, VERTEX_SOURCE, COMPOSITE_SOURCE);
    if (!plasmaProgram || !compositeProgram) return;

    // One shared fullscreen triangle.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const program of [plasmaProgram, compositeProgram]) {
      const position = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    }

    // Offscreen plasma texture, linearly sampled for the smoothing upscale.
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      PLASMA_SIZE,
      PLASMA_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) return;

    const plasmaUniform = (name: string) => gl!.getUniformLocation(plasmaProgram, name);
    const plasmaLocations = {
      resolution: plasmaUniform("u_resolution"),
      time: plasmaUniform("u_time"),
      colors: [1, 2, 3, 4, 5].map((n) => plasmaUniform(`u_color${n}`)),
      intensity: plasmaUniform("u_intensity"),
      scale: plasmaUniform("u_scale"),
      direction: plasmaUniform("u_direction"),
      distortion: plasmaUniform("u_distortion"),
      complexity: plasmaUniform("u_complexity"),
      blur: plasmaUniform("u_blur"),
    };
    const compositeUniform = (name: string) => gl!.getUniformLocation(compositeProgram, name);
    const compositeLocations = {
      plasma: compositeUniform("u_plasma"),
      resolution: compositeUniform("u_resolution"),
      radius: compositeUniform("u_radius"),
      ring: compositeUniform("u_ring"),
    };

    gl.useProgram(plasmaProgram);
    gl.uniform2f(plasmaLocations.resolution, PLASMA_SIZE, PLASMA_SIZE);
    gl.useProgram(compositeProgram);
    gl.uniform1i(compositeLocations.plasma, 0);

    let appliedTheme: "dark" | "light" | null = null;
    function applyPreset() {
      const preset = CHROMATIC[themeRef.current];
      gl!.useProgram(plasmaProgram);
      preset.colors.forEach((hex, index) => {
        gl!.uniform3fv(plasmaLocations.colors[index], hexToRgb(hex));
      });
      gl!.uniform1f(plasmaLocations.intensity, preset.intensity);
      gl!.uniform1f(plasmaLocations.scale, preset.scale);
      gl!.uniform1f(plasmaLocations.direction, (preset.direction * Math.PI) / 180);
      gl!.uniform1f(plasmaLocations.distortion, preset.distortion);
      gl!.uniform1f(plasmaLocations.complexity, preset.complexity);
      gl!.uniform1f(plasmaLocations.blur, preset.blur);
      appliedTheme = themeRef.current;
    }

    function resize() {
      const rect = wrapper!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
      }
      gl!.useProgram(compositeProgram);
      gl!.uniform2f(compositeLocations.resolution, width, height);
      gl!.uniform1f(compositeLocations.radius, radius * dpr);
      gl!.uniform1f(compositeLocations.ring, thickness * dpr);
    }

    const start = performance.now();
    let rafId = 0;
    let visible = true;

    function frame() {
      rafId = 0;
      if (!visible) return;
      if (appliedTheme !== themeRef.current) applyPreset();
      const preset = CHROMATIC[themeRef.current];

      gl!.useProgram(plasmaProgram);
      gl!.uniform1f(plasmaLocations.time, ((performance.now() - start) / 1000) * preset.speed);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
      gl!.viewport(0, 0, PLASMA_SIZE, PLASMA_SIZE);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.useProgram(compositeProgram);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);

      if (!reducedMotion.matches) rafId = requestAnimationFrame(frame);
    }
    function schedule() {
      if (rafId === 0) rafId = requestAnimationFrame(frame);
    }

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => schedule();
    reducedMotion.addEventListener("change", onMotionChange);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      schedule();
    });
    resizeObserver.observe(wrapper);

    // Pause the loop while off-screen.
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) schedule();
    });
    intersectionObserver.observe(wrapper);

    applyPreset();
    resize();
    schedule();
    // The ring now replaces the child's border (see .is-active CSS).
    wrapper.classList.add("is-active");

    return () => {
      wrapper.classList.remove("is-active");
      if (rafId) cancelAnimationFrame(rafId);
      reducedMotion.removeEventListener("change", onMotionChange);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      gl!.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [radius, thickness]);

  return (
    <div ref={wrapperRef} className={className} style={{ position: "relative" }}>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          borderRadius: radius,
        }}
      />
    </div>
  );
}
