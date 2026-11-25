import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CinematicShader, SanitizeShader } from './postfx/CinematicShader';
import { OUTLINE_LAYER } from './materials/toon';

/**
 * GAME RENDERER — owns the WebGL renderer, post-processing chain and the
 * main loop. Systems register update callbacks; the loop runs on
 * requestAnimationFrame and supports slow motion (timeScale).
 */

export type UpdateFn = (dt: number, time: number) => void;

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  timeScale = 1;
  /** Freezes game time (pause menu) while still rendering. */
  paused = false;
  /** Skip rendering while another layer (video) fully covers the canvas. */
  renderEnabled = true;
  private updates = new Set<UpdateFn>();
  private resizeFns = new Set<(w: number, h: number) => void>();
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private running = false;
  private resizeObs: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    // Neutral tone mapping keeps flat anime colours clean (no ACES hue shift)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.02, 900);
    this.camera.layers.enable(OUTLINE_LAYER);
    this.scene.add(this.camera);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.22, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(CinematicShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  get uniforms() {
    return this.grade.uniforms as unknown as typeof CinematicShader.uniforms;
  }

  /** Called now and on every canvas resize (CSS pixels × pixel ratio). */
  onResize(fn: (w: number, h: number) => void) {
    this.resizeFns.add(fn);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    fn(s.x, s.y);
    return () => {
      this.resizeFns.delete(fn);
    };
  }

  onUpdate(fn: UpdateFn) {
    this.updates.add(fn);
    return () => {
      this.updates.delete(fn);
    };
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.uniforms.uResolution.value.set(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const fn of this.resizeFns) fn(s.x, s.y);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const realDt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const dt = this.paused ? 0 : realDt * this.timeScale;
      this.elapsed += dt;
      this.uniforms.uTime.value = now / 1000;
      for (const fn of this.updates) fn(dt, this.elapsed);
      if (this.renderEnabled) this.composer.render(realDt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Releases every GPU resource of the scene. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObs.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.updates.clear();
  }
}
