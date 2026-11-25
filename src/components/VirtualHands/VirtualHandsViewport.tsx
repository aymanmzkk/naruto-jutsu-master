import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FirstPersonHands } from '../../engine/characters/FirstPersonHands';
import { getHandTracker } from '../../gestures/HandTracker';
import type { TwoHandPose } from '../../gestures/SyntheticHand';

/**
 * Standalone 3D viewport showing the rigged virtual hands driven by the
 * webcam (NUI LAB). `previewPose` blends in a template's reference pose.
 */
export function VirtualHandsViewport({ previewPose }: { previewPose: TwoHandPose | null }) {
  const host = useRef<HTMLDivElement>(null);
  const handsRef = useRef<FirstPersonHands | null>(null);
  const previewRef = useRef<TwoHandPose | null>(previewPose);
  previewRef.current = previewPose;

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight('#ffd9bf', '#1a0d10', 1.3));
    const key = new THREE.DirectionalLight('#ffd0a0', 2.6);
    key.position.set(1, 2, 1);
    const rim = new THREE.DirectionalLight('#ff5a1a', 3.5);
    rim.position.set(-1.5, 0.5, -2);
    scene.add(key, rim);
    const hands = new FirstPersonHands();
    handsRef.current = hands;
    camera.add(hands.group);
    // look slightly down at the hands like in the game
    camera.position.set(0, 0, 0);
    camera.lookAt(0, -0.16, -1);

    const grid = new THREE.GridHelper(2, 20, '#5a2a1a', '#2a1512');
    grid.position.set(0, -0.45, -0.5);
    scene.add(grid);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const tracker = getHandTracker();
    let last = performance.now();
    let raf = 0;
    let weight = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const pose = previewRef.current;
      if (pose) hands.setOverride(pose);
      weight += ((pose ? 1 : 0) - weight) * (1 - Math.exp(-8 * dt));
      hands.overrideWeight = weight;
      hands.update(tracker.isRunning ? tracker.latest : null, dt, now);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      hands.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="vhands" />;
}
