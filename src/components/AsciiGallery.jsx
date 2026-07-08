import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import {
  CSS3DRenderer,
  CSS3DObject,
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import AsciiPlayer from "./AsciiPlayer.jsx";
import { setInteracting } from "../lib/galleryBus.js";
import { getFigureData } from "../lib/api.js";

// A curved wall of floating ASCII players, ported from the Three.js video gallery
// (REFERENCE CODE/cg-threejs-video-gallery) — same camera parallax, per-plane
// oscillation, and hover label, but each plane is a real DOM <AsciiPlayer> positioned
// in 3D via CSS3DRenderer instead of a WebGL video plane.

// Human-facing label for a figure, e.g. "GunInverted" -> "GUNINVERTED".
function labelFor(name) {
  return String(name + ".json");
}

// Configuration parameters (proportions unchanged from the reference). Length-based
// values are multiplied by SCALE below so a PLANE_PX-wide DOM player occupies its slot:
// CSS3D treats 1 world unit as 1 CSS pixel, so we work in pixel space and render the
// ascii text at native resolution (crisp) rather than CSS-downscaling a tiny plane.
// const PLANE_PX = 320; // rendered width of one ascii player, in px
const PLANE_PX = 160; // rendered width of one ascii player, in px
const BASE_IMAGE_WIDTH = 2; // the reference plane width, in world units
const SCALE = PLANE_PX / BASE_IMAGE_WIDTH;

// Code-side toggle: when true, every player is wrapped in a bordered frame with its name
// shown permanently in a caption bar at the bottom (and the floating hover label is
// suppressed since the name is always visible). Flip to false for transparent players +
// the floating hover label.
const FRAMED = false;

// Wall density. Each plane is a retained CSS3D compositor layer transformed every
// frame, so on phones (where most columns sit off-screen anyway) a smaller grid
// roughly halves per-frame transform writes and layer count — the biggest mobile
// win. Evaluated once at module load; tune the 5 below after seeing it on a device.
function pickGridSize() {
  if (typeof window === "undefined") return 7;
  const coarseOrSmall =
    window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768;
  return coarseOrSmall ? 5 : 7;
}
const GRID = pickGridSize();

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
  // Intro choreography: "waiting" builds the wall invisible, "roam" plays the
  // scattered fly-in -> drift -> settle sequence, "done" is the normal wall
  // (also the skip target). Defaults keep the component usable standalone.
  introState = "done",
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
  const roamApiRef = useRef(null);

  // Assign each of rows*columns planes a figure at random (same idea as the old video
  // pool). Stable for the lifetime of the figures array so React never reorders nodes.
  const assignments = useMemo(() => {
    const count = params.rows * params.columns;
    return Array.from(
      { length: count },
      () => figures[Math.floor(Math.random() * figures.length)],
    );
  }, [figures]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Intro roam: planes start scattered off-screen, drift on a slowly revolving
    // shell around the center (where the face sits), then settle into their wall
    // slots. `introActive` gates the per-frame compose and bypasses the idle-skip.
    const introMode = introStateRef.current !== "done";
    let introActive = introMode;
    const spin = { value: 0 };
    let introTl = null;
    const finishIntro = () => {
      if (!introActive) return;
      introActive = false;
      mount.classList.remove("is-intro");
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
    // While a drag is in flight (plus a short settle window after release) the ASCII
    // players pause their frame rewrites so they don't compete with the CSS3D
    // re-composite. SETTLE_MS lets the wall ease back to rest before art resumes.
    let settleTimer = 0;
    const SETTLE_MS = 250;

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
            // Roam poses: a scattered ring loosely around the face — random per-plane
            // radius/depth keeps the drifting-cloud character, while the whole cloud
            // revolves around the screen axis (see the spin compose in the loop) so it
            // reads as clips looping around the face before peeling off to the wall.
            // The ring is sized against the camera frustum at the plane's depth (not
            // against `spacing`) so the orbit stays in frame on any viewport size.
            const theta = Math.random() * Math.PI * 2;
            const ringZ = params.spacing * (0.5 + Math.random() * 1.0);
            const halfH =
              (camera.position.z - ringZ) *
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
            const halfMin = Math.min(halfH, halfH * camera.aspect);
            const ringR = halfMin * (0.55 + Math.random() * 0.35);
            const shell = {
              x: Math.cos(theta) * ringR,
              y: Math.sin(theta) * ringR * 0.6,
              z: ringZ,
            };
            object.userData.intro = {
              arrive: 0,
              settle: 0,
              shell,
              start: {
                x: shell.x * 8,
                y: shell.y * 8,
                z: shell.z - params.spacing * 6,
              },
              startRot: {
                x: (Math.random() - 0.5) * 1.0,
                y: (Math.random() - 0.5) * 1.6,
                z: (Math.random() - 0.5) * 0.6,
              },
            };
            // Park the plane at its start pose so the roam's first frame is right.
            const it = object.userData.intro;
            object.position.set(it.start.x, it.start.y, it.start.z);
            object.rotation.set(it.startRot.x, it.startRot.y, it.startRot.z);
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
      // Pause ASCII playback for the duration of the interaction.
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = 0;
      }
      setInteracting(true);
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
      // Let the wall settle back to rest before resuming the ASCII rewrites.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = 0;
        setInteracting(false);
      }, SETTLE_MS);
    }

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    let rafId = 0;
    function animate() {
      rafId = requestAnimationFrame(animate);

      // Skip work while backgrounded.
      if (document.hidden) return;

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
      // The intro roam writes transforms from GSAP-tweened values, so it must keep
      // the loop hot even with zero mouse input.
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

      // Shell revolution for the intro roam — computed once per frame.
      const spinCos = introActive ? Math.cos(spin.value) : 1;
      const spinSin = introActive ? Math.sin(spin.value) : 0;

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

        const parallaxX = tx3 * parallaxFactor * randomOffset.x;
        const parallaxY = ty3 * parallaxFactor * randomOffset.y;
        // Position offsets are in (unscaled) reference units, so scale them to pixel
        // space once; rotations are radians and stay dimensionless.
        const oscillation = Math.sin(time + phaseOffset) * mouseDistance * 0.1;

        const px =
          basePosition.x + (parallaxX + oscillation * randomOffset.x) * SCALE;
        const py =
          basePosition.y + (parallaxY + oscillation * randomOffset.y) * SCALE;
        const pz =
          basePosition.z +
          oscillation * randomOffset.z * parallaxFactor * SCALE;

        const rx =
          baseRotation.x +
          targetY * rotationModifier.x * mouseDistance +
          oscillation * rotationModifier.x * 0.2;

        const ry =
          baseRotation.y +
          targetX * rotationModifier.y * mouseDistance +
          oscillation * rotationModifier.y * 0.2;

        const rz =
          baseRotation.z +
          targetX * targetY * rotationModifier.z * 2 +
          oscillation * rotationModifier.z * 0.3;

        const it = object.userData.intro;
        if (introActive && it) {
          // Compose: start --arrive--> orbiting ring point --settle--> wall slot.
          // The spin revolves the scattered ring in the screen plane (around Z), so
          // the cloud visibly loops around the face while it drifts.
          const roamX = it.shell.x * spinCos - it.shell.y * spinSin;
          const roamY = it.shell.x * spinSin + it.shell.y * spinCos;
          const ax = it.start.x + (roamX - it.start.x) * it.arrive;
          const ay = it.start.y + (roamY - it.start.y) * it.arrive;
          const az = it.start.z + (it.shell.z - it.start.z) * it.arrive;
          object.position.set(
            ax + (px - ax) * it.settle,
            ay + (py - ay) * it.settle,
            az + (pz - az) * it.settle,
          );
          object.rotation.set(
            it.startRot.x + (rx - it.startRot.x) * it.settle,
            it.startRot.y + (ry - it.startRot.y) * it.settle,
            it.startRot.z + (rz - it.startRot.z) * it.settle,
          );
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
      // The roam timeline: fly-in to the shell (staggered), a slow revolution
      // around the center, then a staggered settle into the wall slots. Created
      // paused; the introState watcher effect plays it when the phase arrives.
      mount.classList.add("is-intro");
      const intros = objects
        .map((o) => o.userData.intro)
        .filter(Boolean);
      introTl = gsap.timeline({ paused: true, onComplete: finishIntro });
      introTl.to(
        intros,
        {
          arrive: 1,
          duration: 1.6,
          ease: "power2.out",
          stagger: { each: 0.035, from: "random" },
        },
        0,
      );
      introTl.to(
        spin,
        { value: Math.PI * 1.5, duration: 4.6, ease: "power1.inOut" },
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
        1.8,
      );
    }
    roamApiRef.current = {
      // Reveal the wall and play the roam (the fade-in and the fly-in overlap).
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
        objects.forEach((o) => {
          const it = o.userData.intro;
          if (it) {
            it.arrive = 1;
            it.settle = 1;
          }
        });
        mount.classList.add("is-ready");
        finishIntro();
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
      if (settleTimer) clearTimeout(settleTimer);
      setInteracting(false);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      elListeners.forEach(([el, type, fn]) => el.removeEventListener(type, fn));
      elListeners.length = 0;

      objects.forEach((object) => scene.remove(object));
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
            <LazyPlane desc={fig} index={i} />
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
function LazyPlane({ desc, index }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    let alive = true;
    const delay = index * 60 + Math.random() * 400;
    const timer = setTimeout(() => {
      getFigureData(desc.url)
        .then((d) => {
          if (alive) setData(d);
        })
        .catch(() => {}); // failed plane stays empty — ambient, not critical
    }, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [desc, index]);

  return (
    <div className={`plane-body${data ? " is-loaded" : ""}`}>
      {data && <AsciiPlayer data={data} width={PLANE_PX} loop />}
    </div>
  );
}
