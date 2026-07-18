import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import {
  CSS3DRenderer,
  CSS3DObject,
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import AsciiPlayer from "./AsciiPlayer.jsx";
import { setRoaming } from "../lib/galleryBus.js";
import { downsampleFigure } from "../lib/downsampleFigure.js";
import { getFigureData } from "../lib/api.js";
import { isCoarsePointer } from "../lib/utils.js";

// A curved wall of floating ASCII players, ported from the Three.js video gallery
// (REFERENCE CODE/cg-threejs-video-gallery) — same camera parallax, per-plane
// oscillation, and hover label, but each plane is a real DOM <AsciiPlayer> positioned
// in 3D via CSS3DRenderer instead of a WebGL video plane. The intro flies the planes
// through a layered 3D tunnel (a time-driven port of CodeGrid's 3D scroll tunnel)
// before they settle into the wall.

// Human-facing label for a figure, e.g. "GunInverted" -> "GUNINVERTED".
function labelFor(name) {
  return String(name + ".json");
}

// Configuration parameters (proportions unchanged from the reference). Length-based
// values are multiplied by SCALE below so a PLANE_PX-wide DOM player occupies its slot:
// CSS3D treats 1 world unit as 1 CSS pixel, so we work in pixel space and render the
// ascii text at native resolution (crisp) rather than CSS-downscaling a tiny plane.
const PLANE_PX = 160; // rendered width of one ascii player, in px
const BASE_IMAGE_WIDTH = 2; // the reference plane width, in world units
const SCALE = PLANE_PX / BASE_IMAGE_WIDTH;

// Code-side toggle: when true, every player is wrapped in a bordered frame with its name
// shown permanently in a caption bar at the bottom (and the floating hover label is
// suppressed since the name is always visible). Flip to false for transparent players +
// the floating hover label.
const FRAMED = false;

// Touch device or small viewport — evaluated once at module load. Drives both
// the wall density and the per-plane player size below.
const COARSE_OR_SMALL =
  isCoarsePointer() || (typeof window !== "undefined" && window.innerWidth < 768);

// Wall density. Each plane is a retained CSS3D compositor layer transformed every
// frame, so on phones (where most columns sit off-screen anyway) a smaller grid
// cuts per-frame transform writes and layer count — the biggest mobile win.
// 4×4 (16 planes, was 5×5): the intro roam still stuttered on real devices at 25.
const GRID = COARSE_OR_SMALL ? 4 : 7;

// Rendered size of each plane's ascii player. Separate from PLANE_PX so wall
// geometry (SCALE, spacing, camera) stays untouched: on phones the planes just
// render smaller within their slots, and MAX_PLAYER_H keeps extreme-portrait
// figures from towering over the viewport. Display size is cheap now that the
// glyph count is capped (WALL_MAX_COLS below) — these are taste knobs.
const PLAYER_W = COARSE_OR_SMALL ? 150 : 220;
const MAX_PLAYER_H = COARSE_OR_SMALL ? 280 : 400;

// The wall displays a downsampled copy of each figure (client-side twin of the
// gallery's server-side thumbs): high-res figures were the look-around jank —
// panning a dense <pre> into view forces a huge text-layer raster. BOTH axes
// are capped (see downsampleFigure): capping only cols let tall portraits
// (<=96 cols but hundreds of rows) through at full density — one dense figure
// scaling into view was enough to stutter the whole wall. Hover swaps the full
// figure in (desktop only). Phones render smaller/lighter copies.
const WALL_MAX_COLS = COARSE_OR_SMALL ? 72 : 96;
const WALL_MAX_ROWS = COARSE_OR_SMALL ? 64 : 84;

const params = {
  rows: GRID,
  columns: GRID,
  curvature: 5, // dimensionless shape factor — not scaled
  spacing: 10 * SCALE,
  depth: 7.5 * SCALE,
  elevation: 0 * SCALE,
  lookAtRange: 20 * SCALE,
  verticalCurvature: 0.5, // dimensionless — feeds rotation (rad) and a scaled z-offset
};

export function AsciiGallery({
  figures,
  onReady,
  onSelect,
  // Intro choreography: App passes the live intro phase. Anything before "roam"
  // builds the wall invisible ("forming" additionally holds figure fetches off
  // the swarm's main thread), "roam" plays the tunnel fly-through -> settle
  // sequence, "done" is the normal wall (also the skip target). Defaults keep
  // the component usable standalone.
  introState = "done",
  // A routed page covers the hero: skip all per-frame work (same idea as the
  // document.hidden check in the loop) and pause every player's rAF.
  suspended = false,
  onSettled,
}) {
  const mountRef = useRef(null);
  const stageRef = useRef(null);
  // The hover label is positioned imperatively every frame (it tracks a moving 3D plane),
  // so it's driven via a DOM ref rather than React state to avoid per-frame re-renders.
  const labelRef = useRef(null);
  const planeRefs = useRef([]);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  // The build effect reads the intro state it was mounted under; the prop-watcher
  // effect below drives start/skip through this ref-exposed API.
  const introStateRef = useRef(introState);
  // Mirrored so the rAF loop and cursor handler read the live value without
  // re-running the build effect (the wall must survive route changes untouched).
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const roamApiRef = useRef(null);

  // Assign each of rows*columns planes a figure. Stable for the lifetime of the
  // figures array so React never reorders nodes.
  //
  // Two regimes, chosen automatically by how many community figures exist:
  //  • Enough hero uploads to fill every plane (community >= count): drop the
  //    static seeds and give each plane a DISTINCT community figure (shuffle,
  //    no replacement) — the "wall goes API-only" end state, no duplicates.
  //  • Not enough yet: keep the static seeds as filler and assign at random
  //    (with replacement), the original ambient behavior. Degrades gracefully
  //    and flips over on its own once the hero pool crosses `count`.
  const assignments = useMemo(() => {
    const count = params.rows * params.columns;
    const community = figures.filter(
      (f) => !String(f?.key).startsWith("static:"),
    );
    if (community.length >= count) {
      // Fisher–Yates shuffle, then take one figure per plane — all distinct.
      const pool = community.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, count);
    }
    return Array.from(
      { length: count },
      () => figures[Math.floor(Math.random() * figures.length)],
    );
  }, [figures]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Intro tunnel: layered rings of planes stream past the camera (time-driven
    // port of the CodeGrid 3D scroll tunnel — fog in the distance, fade at the
    // exit), then settle into their wall slots. `introActive` gates the
    // per-frame compose and bypasses the idle-skip.
    const introMode = introStateRef.current !== "done";
    let introActive = introMode;
    let introTl = null;
    // Hold every AsciiPlayer's frame for the whole intro (the wall is invisible
    // or roaming until settle) so their textContent rewrites don't compete with
    // the swarm canvas / roam re-composite on the main thread.
    if (introMode) setRoaming(true);
    const finishIntro = () => {
      if (!introActive) return;
      introActive = false;
      setRoaming(false);
      mount.classList.remove("is-intro");
      // Hand opacity back to CSS (hover swap, .plane-body load fade): composed
      // opacity is exactly 1 at settle, so clearing is visually a no-op.
      objects.forEach((o) => {
        o.element.style.opacity = "";
        o.element.style.visibility = "";
      });
      onSettledRef.current?.();
    };

    // scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      25,
      window.innerWidth / window.innerHeight,
      0.1,
      100000,
    );
    camera.position.set(0, 0, 40 * SCALE);

    // ── Intro tunnel geometry (world units; CSS3D: 1 unit = 1 CSS px) ──
    // Groups of 4 billboard planes sit on an ellipse (top/right/bottom/left);
    // layers are stacked LAYER_GAP apart and recycled with a positive modulo so
    // the fly-through is seamless. Ratios follow the reference demo (gap =
    // 2.5× the perspective distance), with the radii sized against the camera
    // frustum — like the old roam ring — so the tunnel stays in frame on any
    // viewport. One divergence: the demo lets panels fly past the viewer, but a
    // CSS3D transform mirrors once a plane crosses the camera plane, so the
    // exit fade completes at EXIT_POINT, well short of CAM_Z.
    const CAM_Z = camera.position.z;
    const halfH0 = CAM_Z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfW0 = halfH0 * camera.aspect;
    const RADIUS_X = halfW0 * 0.5;
    const RADIUS_Y = halfH0 * 0.6;
    const LAYER_GAP = 2.5 * CAM_Z;
    const EXIT_POINT = 0.72 * CAM_Z;
    const VISIBLE_DEPTH = 3 * LAYER_GAP;
    const PLANE_COUNT = params.rows * params.columns;
    const LAYER_COUNT = Math.ceil(PLANE_COUNT / 4);
    const TUNNEL_DEPTH = LAYER_COUNT * LAYER_GAP;
    const TRAVEL_START = 0.3 * LAYER_GAP;
    const TRAVEL_DIST = 4.5 * LAYER_GAP;
    const travel = { value: TRAVEL_START };
    const layerZs = new Array(LAYER_COUNT); // per-frame scratch

    function layerZAt(li, t) {
      const z =
        (((-li * LAYER_GAP + t) % TUNNEL_DEPTH) + TUNNEL_DEPTH) % TUNNEL_DEPTH;
      return z - TUNNEL_DEPTH + EXIT_POINT; // ∈ [EXIT_POINT − TUNNEL_DEPTH, EXIT_POINT)
    }
    // Fade factor per depth (demo port): 1 = fully dark. Quadratic distance fog
    // coming in, linear fade-out while a plane crosses the exit window.
    function calculateOverlay(z) {
      if (z > EXIT_POINT) return 1;
      if (z > 0) return z / EXIT_POINT;
      if (z > -VISIBLE_DEPTH) {
        const p = -z / VISIBLE_DEPTH;
        return p * p;
      }
      return 1;
    }

    const renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    // mouse movement variables
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;
    const lookAtTarget = new THREE.Vector3(0, 0, 0);
    // Below this, the camera target has effectively stopped easing and the
    // oscillation amplitude is invisible — treat the wall as at rest.
    const IDLE_EPS = 0.0005;

    // grab/drag navigation: while a pointer is held, accumulate its delta into mouseX/mouseY
    // (the same normalized target the absolute mousemove drives). Works for mouse and touch.
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    const DRAG_SPEED = 1.5; // how far a full-viewport drag moves the normalized target

    // hover state (driven by DOM pointer events — CSS3D objects aren't raycastable)
    let currentHover = null;
    let hoveredObject = null;
    // Scratch vector for projecting a hovered plane's center to screen space.
    const labelPoint = new THREE.Vector3();

    // gallery mathematics functions (identical to the reference)
    function calculateRotations(x, y) {
      const a = 1 / (params.depth * params.curvature);
      const slopeY = -2 * a * x;
      const rotationY = Math.atan(slopeY);

      const verticalFactor = params.verticalCurvature;
      const maxYDistance = (params.rows * params.spacing) / 2;
      const normalizedY = y / maxYDistance;
      const rotationX = normalizedY * verticalFactor;

      return { rotationX, rotationY };
    }

    function calculatePosition(row, col) {
      let x = (col - params.columns / 2) * params.spacing;
      let y = (row - params.rows / 2) * params.spacing;

      let z = (x * x) / (params.depth * params.curvature);

      const normalizedY = y / ((params.rows * params.spacing) / 2);
      z +=
        Math.abs(normalizedY) *
        normalizedY *
        params.verticalCurvature *
        5 *
        SCALE;

      y += params.elevation;

      const { rotationX, rotationY } = calculateRotations(x, y);

      return { x, y, z, rotationX, rotationY };
    }

    // Build the wall: wrap each pre-rendered player div in a CSS3DObject.
    const objects = [];
    // Per-plane DOM listeners are collected so the effect teardown can remove
    // them — the same divs are reused by React across rerolls, so listeners
    // would otherwise stack up and fire onSelect multiple times per tap.
    const elListeners = [];
    // Click-vs-drag: a tap opens the figure dialog only if the pointer barely
    // moved and released quickly; anything longer is the existing orbit drag.
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    const TAP_DIST = 6;
    const TAP_MS = 400;

    function buildGallery() {
      let i = 0;
      for (let row = 0; row < params.rows; row++) {
        for (let col = 0; col < params.columns; col++) {
          const el = planeRefs.current[i];
          const fig = assignments[i];
          i++;
          if (!el) continue;

          const object = new CSS3DObject(el);
          const { x, y, z, rotationX, rotationY } = calculatePosition(row, col);

          object.position.set(x, y, z);
          object.rotation.x = rotationX;
          object.rotation.y = rotationY;

          object.userData = {
            basePosition: { x, y, z },
            baseRotation: { x: rotationX, y: rotationY, z: 0 },
            parallaxFactor: Math.random() * 0.5 + 0.5,
            randomOffset: {
              x: Math.random() * 2 - 1,
              y: Math.random() * 2 - 1,
              z: Math.random() * 2 - 1,
            },
            rotationModifier: {
              x: Math.random() * 0.15 - 0.075,
              y: Math.random() * 0.15 - 0.075,
              z: Math.random() * 0.2 - 0.1,
            },
            phaseOffset: Math.random() * Math.PI * 2,
            videoName: labelFor(fig?.name),
          };

          if (introMode) {
            // Tunnel slot: 4 billboard panels per layer on an ellipse
            // (top/right/bottom/left, demo layout). Panels never rotate during
            // the fly-through — the camera perspective does all the work.
            const planeIndex = row * params.columns + col;
            const layer = Math.floor(planeIndex / 4);
            const angle = ((planeIndex % 4) / 4) * Math.PI * 2 - Math.PI / 2;
            const slot = {
              x: Math.cos(angle) * RADIUS_X,
              y: Math.sin(angle) * RADIUS_Y,
            };
            object.userData.intro = { settle: 0, layer, slot, zOff: null, lastO: -1 };
            // Park at the initial tunnel pose so the synchronous first render
            // (and frame 0 of the fly) is right.
            const z0 = layerZAt(layer, TRAVEL_START);
            object.position.set(slot.x, slot.y, z0);
            object.rotation.set(0, 0, 0);
            const o0 = 1 - Math.min(1, Math.max(0, calculateOverlay(z0)));
            el.style.opacity = String(o0);
            el.style.visibility = o0 <= 0.01 ? "hidden" : "";
          }

          // Hover label: set on enter, cleared on leave (positioned per-frame below).
          const onEnter = () => {
            hoveredObject = object;
          };
          const onLeave = () => {
            if (hoveredObject === object) hoveredObject = null;
          };
          const onTapUp = (e) => {
            const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (dist < TAP_DIST && performance.now() - downTime < TAP_MS) {
              onSelectRef.current?.(fig);
            }
          };
          el.addEventListener("pointerenter", onEnter);
          el.addEventListener("pointerleave", onLeave);
          el.addEventListener("pointerup", onTapUp);
          elListeners.push([el, "pointerenter", onEnter], [el, "pointerleave", onLeave], [el, "pointerup", onTapUp]);

          objects.push(object);
          scene.add(object);
        }
      }
    }

    // event listeners
    function onMouseMove(event) {
      // Covered by a routed page: the cursor belongs to the page, not the wall
      // (this listener is on document, so it still fires underneath).
      if (suspendedRef.current) return;
      // The wall ignores the cursor entirely until the intro roam has settled.
      if (introActive) return;
      // While dragging, the pointer handlers own mouseX/mouseY — don't let the absolute
      // mapping clobber the accumulated drag delta.
      if (isDragging) return;
      mouseX =
        (event.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
      mouseY =
        (event.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
    }

    function onPointerDown(event) {
      // The wall isn't interactive until the roam has settled.
      if (introActive) return;
      isDragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      downTime = performance.now();
      mount.classList.add("is-grabbing");
    }

    function onPointerMove(event) {
      if (!isDragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      // Grab metaphor: dragging right pulls the view left (flip the sign if it feels reversed).
      mouseX = THREE.MathUtils.clamp(
        mouseX - (dx / (window.innerWidth / 2)) * DRAG_SPEED,
        -1,
        1,
      );
      mouseY = THREE.MathUtils.clamp(
        mouseY - (dy / (window.innerHeight / 2)) * DRAG_SPEED,
        -1,
        1,
      );
    }

    function onPointerUp() {
      isDragging = false;
      mount.classList.remove("is-grabbing");
    }

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    let rafId = 0;
    function animate() {
      rafId = requestAnimationFrame(animate);

      // Skip work while backgrounded — or while a routed page covers the hero
      // (the layer is visibility:hidden; composing an invisible wall is waste).
      if (document.hidden || suspendedRef.current) return;

      // update camera target
      const prevTX = targetX;
      const prevTY = targetY;
      targetX += (mouseX - targetX) * 0.05;
      targetY += (mouseY - targetY) * 0.05;

      // Identical for every plane — compute once here, not 49× inside the loop.
      const mouseDistance = Math.sqrt(targetX * targetX + targetY * targetY);

      // Idle skip: once the target has stopped easing AND the oscillation amplitude
      // (∝ mouseDistance) is negligible, the wall is at rest — skip all per-plane
      // math and the CSS3D render until the next input. rAF stays alive (cheap).
      // The intro tunnel writes transforms from GSAP-tweened values, so it must
      // keep the loop hot even with zero mouse input.
      const eased =
        Math.abs(targetX - prevTX) > IDLE_EPS ||
        Math.abs(targetY - prevTY) > IDLE_EPS;
      if (!introActive && !eased && mouseDistance < IDLE_EPS) return;

      lookAtTarget.x = targetX * params.lookAtRange;
      lookAtTarget.y = -targetY * params.lookAtRange;
      lookAtTarget.z =
        (lookAtTarget.x * lookAtTarget.x) / (params.depth * params.curvature);

      const time = performance.now() * 0.001;
      const tx3 = targetX * 3;
      const ty3 = targetY * 3;

      // Tunnel layer depths — computed once per frame (planes in a layer share
      // the wrapped z until their settle starts).
      if (introActive) {
        for (let li = 0; li < LAYER_COUNT; li++) {
          layerZs[li] = layerZAt(li, travel.value);
        }
      }

      // update each plane (parallax + oscillation), identical to the reference
      objects.forEach((object) => {
        const {
          basePosition,
          baseRotation,
          parallaxFactor,
          randomOffset,
          rotationModifier,
          phaseOffset,
        } = object.userData;

        let px, py, pz, rx, ry, rz;
        if (introActive) {
          // Mouse input is ignored until the roam settles (targetX/Y stay 0), so
          // parallax and oscillation are zero — settle straight into the base
          // pose and skip their per-plane math while the roam is hot.
          px = basePosition.x;
          py = basePosition.y;
          pz = basePosition.z;
          rx = baseRotation.x;
          ry = baseRotation.y;
          rz = baseRotation.z;
        } else {
          const parallaxX = tx3 * parallaxFactor * randomOffset.x;
          const parallaxY = ty3 * parallaxFactor * randomOffset.y;
          // Position offsets are in (unscaled) reference units, so scale them to pixel
          // space once; rotations are radians and stay dimensionless.
          const oscillation = Math.sin(time + phaseOffset) * mouseDistance * 0.1;

          px =
            basePosition.x + (parallaxX + oscillation * randomOffset.x) * SCALE;
          py =
            basePosition.y + (parallaxY + oscillation * randomOffset.y) * SCALE;
          pz =
            basePosition.z +
            oscillation * randomOffset.z * parallaxFactor * SCALE;

          rx =
            baseRotation.x +
            targetY * rotationModifier.x * mouseDistance +
            oscillation * rotationModifier.x * 0.2;

          ry =
            baseRotation.y +
            targetX * rotationModifier.y * mouseDistance +
            oscillation * rotationModifier.y * 0.2;

          rz =
            baseRotation.z +
            targetX * targetY * rotationModifier.z * 2 +
            oscillation * rotationModifier.z * 0.3;
        }

        const it = object.userData.intro;
        if (introActive && it) {
          const s = it.settle;
          // Tunnel depth: the shared wrapped layer z until this plane's settle
          // starts; from then on advance linearly from a frozen offset (a modulo
          // wrap mid-settle would jump the lerp start by TUNNEL_DEPTH) and clamp
          // at EXIT_POINT (an unwrapped z must never cross the camera plane —
          // CSS3D mirrors past it).
          let tz;
          if (s > 0) {
            if (it.zOff === null) it.zOff = layerZs[it.layer] - travel.value;
            tz = Math.min(it.zOff + travel.value, EXIT_POINT);
          } else {
            tz = layerZs[it.layer];
          }
          const tunnelO = 1 - Math.min(1, Math.max(0, calculateOverlay(tz)));
          // Compose: moving tunnel pose --settle--> wall slot (the lerp start
          // keeps moving, so motion stays continuous under the settle wave).
          object.position.set(
            it.slot.x + (px - it.slot.x) * s,
            it.slot.y + (py - it.slot.y) * s,
            tz + (pz - tz) * s,
          );
          object.rotation.set(rx * s, ry * s, rz * s); // billboard → wall curvature
          // Fog/exit fade; lands at exactly 1 when settled even mid-fog. The
          // lastO cache skips style writes for the ~35 fully-hidden planes.
          const o = tunnelO + (1 - tunnelO) * s;
          if (Math.abs(o - it.lastO) > 0.001) {
            it.lastO = o;
            object.element.style.opacity = o.toFixed(3);
            object.element.style.visibility = o <= 0.01 ? "hidden" : "";
          }
        } else {
          object.position.set(px, py, pz);
          object.rotation.set(rx, ry, rz);
        }
      });

      camera.lookAt(lookAtTarget);

      // pin the hovered plane's name label to its projected screen position (skipped when
      // framed — each frame shows its name permanently, so this would just duplicate it)
      const label = labelRef.current;
      if (!FRAMED && label) {
        if (hoveredObject) {
          const name = hoveredObject.userData.videoName;
          if (name !== currentHover) {
            currentHover = name;
            label.textContent = name;
          }
          labelPoint.setFromMatrixPosition(hoveredObject.matrixWorld);
          labelPoint.project(camera);
          const x = (labelPoint.x * 0.5 + 0.5) * window.innerWidth;
          const y = (-labelPoint.y * 0.5 + 0.5) * window.innerHeight;
          label.style.left = `${x}px`;
          label.style.top = `${y}px`;
          label.style.opacity = "1";
        } else if (currentHover !== null) {
          currentHover = null;
          label.style.opacity = "0";
        }
      }

      renderer.render(scene, camera);
    }

    buildGallery();

    if (introMode) {
      // The tunnel timeline: `travel` flies the viewer forward through the layer
      // rings (fog reveals each ring, the exit fade retires it), then a staggered
      // settle peels the planes into their wall slots. Created paused; the
      // introState watcher effect plays it when the phase arrives.
      // Tuning invariant: settleStart + each·(N−1) < travel duration, so every
      // plane's settle begins while the tunnel is still moving.
      mount.classList.add("is-intro");
      const intros = objects
        .map((o) => o.userData.intro)
        .filter(Boolean);
      introTl = gsap.timeline({ paused: true, onComplete: finishIntro });
      introTl.to(
        travel,
        {
          value: TRAVEL_START + TRAVEL_DIST,
          duration: 4.6,
          // Gentle spin-up; the end-of-travel decel hides under the settle wave.
          ease: "power1.inOut",
        },
        0,
      );
      introTl.to(
        intros,
        {
          settle: 1,
          duration: 1.6,
          ease: "power3.inOut",
          stagger: { each: 0.03, from: "center" },
        },
        2.4,
      );
    }
    roamApiRef.current = {
      // Reveal the wall and play the tunnel (the fade-in and the first rings overlap).
      start() {
        mount.classList.add("is-ready");
        introTl?.play();
      },
      // Skip: jump every plane to its slot and hand control back to the loop.
      skipToEnd() {
        if (introTl) {
          introTl.kill();
          introTl = null;
        }
        mount.classList.add("is-ready");
        // The App watcher re-calls this on the normal post-settle "done" — no-op.
        if (!introActive) return;
        objects.forEach((o) => {
          const it = o.userData.intro;
          if (!it) return;
          it.settle = 1;
          const { basePosition: p, baseRotation: r } = o.userData;
          o.position.set(p.x, p.y, p.z);
          o.rotation.set(r.x, r.y, r.z);
        });
        finishIntro(); // flips introActive, clears the inline fade styles
        // Paint the final wall now — the idle-skip won't render again until the
        // mouse moves, and the skip must not leave a mid-tunnel frame on screen.
        renderer.render(scene, camera);
      },
    };

    // First render, then fade the wall in + signal ready on the next tick. The
    // `is-ready` class drives the opacity transition (global.css) so the ambient wall
    // eases in behind the already-revealed hero rather than popping. During the
    // intro the wall stays invisible until the roam phase reveals it.
    camera.lookAt(lookAtTarget);
    renderer.render(scene, camera);
    requestAnimationFrame(() => {
      if (!introMode) mount.classList.add("is-ready");
      onReadyRef.current?.();
    });

    document.addEventListener("mousemove", onMouseMove);
    window.addEventListener("resize", onResize);
    // pointerdown on the mount so a drag can start anywhere over the gallery (events from the
    // planes bubble up through the CSS3D subtree); move/up on window so the drag keeps
    // tracking even if the pointer leaves the element.
    mount.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    animate();

    // teardown — idempotent so StrictMode's dev remount doesn't duplicate the wall
    return () => {
      cancelAnimationFrame(rafId);
      if (introTl) {
        introTl.kill();
        introTl = null;
      }
      roamApiRef.current = null;
      mount.classList.remove("is-intro");
      setRoaming(false);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      elListeners.forEach(([el, type, fn]) => el.removeEventListener(type, fn));
      elListeners.length = 0;

      objects.forEach((object) => {
        // React reuses these divs across rerolls/StrictMode remounts — stale
        // inline fade styles would leave rebuilt planes invisible.
        object.element.style.opacity = "";
        object.element.style.visibility = "";
        scene.remove(object);
      });
      objects.length = 0;

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [assignments]);

  // Drive the roam from the intro phase: "roam" plays the timeline, "done" jumps
  // to the end (skip, or the normal post-settle acknowledgement — skipToEnd is a
  // no-op once the intro has already finished).
  useEffect(() => {
    introStateRef.current = introState;
    if (introState === "roam") roamApiRef.current?.start();
    else if (introState === "done") roamApiRef.current?.skipToEnd();
  }, [introState]);

  return (
    <>
      <div className="ascii-gallery" ref={mountRef} aria-hidden="true" />
      {/* Staging container: React renders the players here, then CSS3DRenderer adopts
          each div into its own DOM tree and positions it in 3D. */}
      <div className="ascii-stage" ref={stageRef} aria-hidden="true">
        {assignments.map((fig, i) => (
          <div
            key={i}
            ref={(el) => (planeRefs.current[i] = el)}
            className={`ascii-plane${FRAMED ? " is-framed" : ""}`}
          >
            <LazyPlane
              desc={fig}
              index={i}
              // Two hold windows: "forming" (fetch/parse/first-paint must not
              // stutter the headline swarm) and "roam" (must not spike a
              // tunnel frame). The face/disperse gap between them is when the
              // parked work flushes.
              hold={introState === "forming" || introState === "roam"}
              // Phones: the wall is stills-only (frame 0, no playback loop at
              // all) — a dozen autoplaying clips re-rastering their text layer
              // mid-drag were the look-around jank. Clips still play in the
              // tap dialog.
              paused={suspended || introState !== "done" || COARSE_OR_SMALL}
            />
            {FRAMED && (
              <div className="ascii-frame-label">{labelFor(fig.name)}</div>
            )}
          </div>
        ))}
      </div>
      <div className="ascii-label" ref={labelRef} aria-hidden="true" />
    </>
  );
}

// One plane's content. Each plane fetches its own figure JSON (promise-cached
// in api.js, so N planes sharing a figure download it once) after a small
// per-plane stagger, then fades in — the wall populates plane by plane instead
// of blocking on one big up-front download.
//
// `hold` is true during the intro's busy windows (the headline swarm forming,
// the tunnel roam): any fetch/parse/first-paint that would land inside one is
// parked and flushed (staggered) in the next quiet window, so a JSON.parse or
// a <pre>'s first raster can't spike a frame of either animation.
function LazyPlane({ desc, index, hold, paused }) {
  const [data, setData] = useState(null);
  // Desktop hover swaps the full-resolution figure in (gallery-card pattern).
  const [hovering, setHovering] = useState(false);
  // Full figure for static planes, whose desc.url is the prebuilt wall thumb —
  // fetched lazily on first hover. Community planes have no fullUrl (their
  // desc.url is already the full JSON, downsampled client-side as before).
  const [fullData, setFullData] = useState(null);
  const rootRef = useRef(null);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  // A fetch deferred by `hold`, parked until the roam settles.
  const deferredRef = useRef(null);

  useEffect(() => {
    setData(null);
    setFullData(null);
    deferredRef.current = null;
    let alive = true;
    const startFetch = () => {
      getFigureData(desc.url)
        .then((d) => {
          if (!alive) return;
          // Landed mid-hold (fetch started just before the window opened):
          // park the apply too — the first paint waits for the next gap.
          if (holdRef.current) deferredRef.current = () => setData(d);
          else setData(d);
        })
        .catch(() => {}); // failed plane stays empty — ambient, not critical
    };
    const delay = index * 60 + Math.random() * 400;
    const timer = setTimeout(() => {
      if (holdRef.current) deferredRef.current = startFetch;
      else startFetch();
    }, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [desc, index]);

  // Flush the parked thunk once the current hold window ends — staggered, so
  // the burst of planes parked during "forming" doesn't fetch/parse/paint in
  // one frame. A flush still pending when the next hold window starts (the
  // roam) re-parks itself and runs after settle.
  useEffect(() => {
    if (hold || !deferredRef.current) return;
    const go = deferredRef.current;
    deferredRef.current = null;
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      if (holdRef.current) deferredRef.current = go;
      else go();
    }, index * 40);
    return () => {
      clearTimeout(timer);
      if (!fired) deferredRef.current = go;
    };
  }, [hold, index]);

  // Phones show a single frame ("image", not a clip): the wall is paused there,
  // so the extra frames only cost memory + per-frame downsample work. Slicing to
  // frame 0 before the downsample keeps ~16 dense multi-frame figures off the
  // main thread. Desktop keeps every frame (it autoplays after settle).
  const source = useMemo(() => {
    if (!data || !COARSE_OR_SMALL || (data.frames?.length ?? 0) <= 1) return data;
    return {
      ...data,
      frames: [data.frames[0]],
      ...(data.edgeFrames ? { edgeFrames: [data.edgeFrames[0]] } : null),
    };
  }, [data]);

  // Downsampled display copy — both axes capped (WALL_MAX_COLS/ROWS) so a dense
  // portrait can't ship a huge <pre> that stutters when it scales into view.
  const display = useMemo(
    () => (source ? downsampleFigure(source, WALL_MAX_COLS, WALL_MAX_ROWS) : null),
    [source],
  );

  // Native listeners, not React synthetic: CSS3DRenderer reparents this div
  // out of the React root (same reason the wall effect's tap/hover listeners
  // are native). Skipped on touch — a tap opens the dialog anyway, no point
  // re-rasterizing the full figure on the way there.
  useEffect(() => {
    if (COARSE_OR_SMALL) return;
    const el = rootRef.current;
    if (!el) return;
    const enter = () => setHovering(true);
    const leave = () => setHovering(false);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);

  // Fetch the full figure on first hover (promise-cached, repeat hovers free).
  // Skipped when the served thumb wasn't actually downsampled (no `wallThumb`
  // marker — the figure was already <=96 cols, so the "thumb" IS the full copy).
  useEffect(() => {
    if (!hovering || !desc.fullUrl || !data?.wallThumb || fullData) return;
    let alive = true;
    getFigureData(desc.fullUrl)
      .then((d) => {
        if (alive) setFullData(d);
      })
      .catch(() => {}); // hover keeps the thumb — ambient, not critical
    return () => {
      alive = false;
    };
  }, [hovering, desc, data, fullData]);

  const full = desc.fullUrl && data?.wallThumb ? fullData : data;
  const shown = hovering && full ? full : display;
  return (
    <div ref={rootRef} className={`plane-body${data ? " is-loaded" : ""}`}>
      {shown && (
        // Stills until the intro settles, then everything autoplays — the
        // downsampled copies keep per-plane glyph counts gallery-card sized.
        <AsciiPlayer
          data={shown}
          width={PLAYER_W}
          maxHeight={MAX_PLAYER_H}
          paused={paused}
          // Wall planes are the only players that follow the galleryBus
          // (frame hold during the roam, low fps during drags).
          busGated
          loop
        />
      )}
      {/* Same muted note the dialog shows while its figure JSON is in flight. */}
      {hovering && data && !full && <span className="plane-loading">loading…</span>}
    </div>
  );
}
