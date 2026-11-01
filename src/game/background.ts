// Fullscreen animated WebGL background shared by menus and gameplay. Four themeable scenes that
// cross-fade, react to beat pulses and gameplay intensity. Falls back to CSS gradients without WebGL.

const VERT = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform float uModeA; uniform float uModeB; uniform float uMix;
uniform float uPulse; uniform float uIntensity; uniform float uDim;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }

vec3 stars(vec2 uv, float t){
  vec2 g = uv*vec2(60.0, 60.0);
  vec2 id = floor(g); vec2 f = fract(g)-0.5;
  float h = hash(id);
  float s = smoothstep(0.08, 0.0, length(f + (vec2(hash(id+1.3), hash(id+2.7))-0.5)*0.7)) * step(0.93, h);
  s *= 0.5 + 0.5*sin(t*2.0 + h*40.0);
  return vec3(s);
}

vec3 sceneNebula(vec2 uv, vec2 q, float t){
  vec2 p = q*1.6;
  float n1 = fbm(p + vec2(t*0.05, t*0.03));
  float n2 = fbm(p*1.7 - vec2(t*0.04, -t*0.06) + n1*1.5);
  vec3 col = mix(uC2*0.25, uC1*0.9, smoothstep(0.25, 0.85, n2));
  col = mix(col, uC3, smoothstep(0.62, 0.95, n1*n2*1.9)*0.55);
  col *= 0.55 + 0.6*n2;
  col += stars(uv + vec2(t*0.004, 0.0), t)*0.8;
  return col;
}

vec3 sceneGrid(vec2 uv, vec2 q, float t){
  float horizon = 0.08;
  vec3 col = mix(uC2*0.18, uC1*0.35, smoothstep(-0.6, 0.9, q.y));
  // sun
  vec2 sp = q - vec2(0.0, horizon+0.2);
  float sd = length(sp);
  float sun = smoothstep(0.24, 0.225, sd);
  float bands = step(0.0, sin((q.y-horizon)*70.0 - t*1.5)) + step(0.17, q.y-horizon);
  col += mix(uC3, uC1, smoothstep(0.0, 0.4, q.y-horizon)) * sun * clamp(bands, 0.0, 1.0) * 0.55;
  col += uC1 * smoothstep(0.7, 0.0, sd) * 0.3;
  if (q.y < horizon){
    float d = horizon - q.y;
    float z = 0.35 / d;
    vec2 g = vec2(q.x*z*1.2, z + t*1.6);
    vec2 gf = abs(fract(g)-0.5);
    float line = smoothstep(0.06*z*0.15+0.02, 0.0, min(gf.x, gf.y)*(1.0/(z*0.08+1.0)));
    float fade = smoothstep(0.0, 0.25, d);
    col = mix(uC2*0.12, col*0.3, 0.3);
    col += mix(uC1, uC3, 0.3) * line * fade * 1.2;
    col += uC1 * smoothstep(0.08, 0.0, d) * 0.6;
  }
  col += stars(uv, t)*0.5*step(horizon+0.05, q.y);
  return col;
}

vec3 sceneTunnel(vec2 uv, vec2 q, float t){
  float r = length(q);
  float a = atan(q.y, q.x);
  float z = 0.3 / (r + 0.02);
  float rings = sin(z*6.0 - t*4.0);
  float spokes = sin(a*12.0 + z*0.6 + t*0.3);
  float v = smoothstep(0.7, 1.0, rings) * 0.9 + smoothstep(0.85, 1.0, spokes)*0.35;
  vec3 col = mix(uC2*0.2, uC1, v);
  col += uC3 * smoothstep(0.96, 1.0, rings) * 0.6;
  col *= smoothstep(0.0, 0.35, r);
  col += uC1 * smoothstep(0.25, 0.0, r) * 0.5;
  col += fbm(vec2(a*2.0, z*0.5 - t*0.5))*uC2*0.25;
  return col;
}

vec3 sceneAurora(vec2 uv, vec2 q, float t){
  vec3 col = mix(uC2*0.12, uC2*0.3, uv.y);
  for (int i=0; i<4; i++){
    float fi = float(i);
    float y = 0.15*fi - 0.2 + 0.12*sin(q.x*(1.5+fi*0.4) + t*(0.35+fi*0.1) + fi) + 0.06*fbm(vec2(q.x*2.0 + t*0.1, fi));
    float d = abs(q.y - y);
    float band = exp(-d*d*180.0) * 0.8 + exp(-d*14.0)*0.25;
    vec3 c = mix(uC1, uC3, fi/3.0);
    col += c * band * (0.6 + 0.4*sin(q.x*8.0 + t + fi));
  }
  col += stars(uv, t)*0.6;
  return col;
}

vec3 scene(float m, vec2 uv, vec2 q, float t){
  if (m < 0.5) return sceneNebula(uv, q, t);
  if (m < 1.5) return sceneGrid(uv, q, t);
  if (m < 2.5) return sceneTunnel(uv, q, t);
  return sceneAurora(uv, q, t);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 q = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
  float t = uTime;
  vec3 col = scene(uModeA, uv, q, t);
  if (uMix > 0.001) col = mix(col, scene(uModeB, uv, q, t), uMix);
  float energy = 0.75 + uIntensity*0.55 + uPulse*0.35;
  col *= energy;
  col += uC1 * uPulse * 0.06;
  float vig = smoothstep(1.25, 0.25, length(q*vec2(0.85, 1.1)));
  col *= mix(0.45, 1.0, vig);
  col *= (1.0 - uDim);
  col = col / (1.0 + col*0.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const v = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

class Background {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private colors: [number, number, number][] = [hexToRgb('#7b2bff'), hexToRgb('#100828'), hexToRgb('#ff3d9a')];
  private target: [number, number, number][] = this.colors.map((c) => [...c] as [number, number, number]);
  private modeA = 0;
  private modeB = 0;
  private mix = 0;
  private pulseV = 0;
  private intensity = 0;
  private intensityTarget = 0;
  private dim = 0;
  scale = 0.5;
  reducedMotion = false;
  paused = false;
  /** Optional per-frame hook for an external beat source. */
  beatSource: (() => number) | null = null;
  private timeOffset = 0;
  private lastT = 0;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = (canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
      || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) { canvas.classList.add('bg-fallback'); return; }
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); this.gl = null; canvas.classList.add('bg-fallback'); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uTime', 'uC1', 'uC2', 'uC3', 'uModeA', 'uModeB', 'uMix', 'uPulse', 'uIntensity', 'uDim']) this.u[n] = gl.getUniformLocation(prog, n);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(this.raf); });
    canvas.addEventListener('webglcontextrestored', () => this.attach(canvas));
    this.loop();
  }

  setTheme(colors: [string, string, string], mode: number) {
    this.target = colors.map(hexToRgb);
    if (mode !== this.modeA && mode !== this.modeB) {
      if (this.mix > 0.5) this.modeA = this.modeB;
      this.modeB = mode;
      this.mix = 0.0001;
    } else if (mode === this.modeA && this.mix > 0) {
      // reverse an in-flight transition
      [this.modeA, this.modeB] = [this.modeB, this.modeA];
      this.mix = 1 - this.mix;
    }
  }
  pulse(strength = 1) { this.pulseV = Math.min(1.4, Math.max(this.pulseV, strength)); }
  setIntensity(v: number) { this.intensityTarget = Math.max(0, Math.min(1.5, v)); }
  setDim(v: number) { this.dim = v; }

  private resize() {
    const c = this.canvas!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr * this.scale));
    const h = Math.max(1, Math.round(c.clientHeight * dpr * this.scale));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const gl = this.gl;
    if (!gl || !this.canvas || this.paused) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    this.timeOffset += dt * (this.reducedMotion ? 0.25 : 1) * (1 + this.intensity * 0.6);
    this.resize();
    const k = 1 - Math.exp(-dt * 2.5);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.colors[i][j] += (this.target[i][j] - this.colors[i][j]) * k;
    if (this.mix > 0) {
      this.mix += dt / 1.2;
      if (this.mix >= 1) { this.modeA = this.modeB; this.mix = 0; }
    }
    if (this.beatSource) this.pulse(this.beatSource());
    this.pulseV *= Math.exp(-dt * 6);
    this.intensity += (this.intensityTarget - this.intensity) * (1 - Math.exp(-dt * 3));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uTime, this.timeOffset);
    gl.uniform3fv(this.u.uC1, this.colors[0]);
    gl.uniform3fv(this.u.uC2, this.colors[1]);
    gl.uniform3fv(this.u.uC3, this.colors[2]);
    gl.uniform1f(this.u.uModeA, this.modeA);
    gl.uniform1f(this.u.uModeB, this.modeB);
    gl.uniform1f(this.u.uMix, this.mix > 0 ? this.mix * this.mix * (3 - 2 * this.mix) : 0);
    gl.uniform1f(this.u.uPulse, this.reducedMotion ? this.pulseV * 0.3 : this.pulseV);
    gl.uniform1f(this.u.uIntensity, this.intensity);
    gl.uniform1f(this.u.uDim, this.dim);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

export const background = new Background();
