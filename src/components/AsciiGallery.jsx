import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  CSS3DRenderer,
  CSS3DObject,
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import AsciiPlayer from "./AsciiPlayer.jsx";

// A curved wall of floating ASCII players, ported from the Three.js video gallery
// (REFERENCE CODE/cg-threejs-video-gallery) — same camera parallax, per-plane
// oscillation, and hover label, but each plane is a real DOM <AsciiPlayer> positioned
// in 3D via CSS3DRenderer instead of a WebGL video plane.

// Human-facing label for a figure, e.g. "GunInverted" -> "GUNINVERTED".
function labelFor(name) {
  return String(name).toUpperCase();
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

const params = {
  rows: 7,
  columns: 7,
  curvature: 5, // dimensionless shape factor — not scaled
  spacing: 10 * SCALE,
  depth: 7.5 * SCALE,
  elevation: 0 * SCALE,
  lookAtRange: 20 * SCALE,
  verticalCurvature: 0.5, // dimensionless — feeds rotation (rad) and a scaled z-offset
};

export function AsciiGallery({ figures, onReady }) {
  const mountRef = useRef(null);
  const stageRef = useRef(null);
  // The hover label is positioned imperatively every frame (it tracks a moving 3D plane),
  // so it's driven via a DOM ref rather than React state to avoid per-frame re-renders.
  const labelRef = useRef(null);
  const planeRefs = useRef([]);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

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

          // Hover label: set on enter, cleared on leave (positioned per-frame below).
          el.addEventListener("pointerenter", () => {
            hoveredObject = object;
          });
          el.addEventListener("pointerleave", () => {
            if (hoveredObject === object) hoveredObject = null;
          });

          objects.push(object);
          scene.add(object);
        }
      }
    }

    // event listeners
    function onMouseMove(event) {
      mouseX =
        (event.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
      mouseY =
        (event.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
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
      targetX += (mouseX - targetX) * 0.05;
      targetY += (mouseY - targetY) * 0.05;

      lookAtTarget.x = targetX * params.lookAtRange;
      lookAtTarget.y = -targetY * params.lookAtRange;
      lookAtTarget.z =
        (lookAtTarget.x * lookAtTarget.x) / (params.depth * params.curvature);

      const time = performance.now() * 0.001;

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

        const mouseDistance = Math.sqrt(targetX * targetX + targetY * targetY);
        const parallaxX = targetX * parallaxFactor * 3 * randomOffset.x;
        const parallaxY = targetY * parallaxFactor * 3 * randomOffset.y;
        // Position offsets are in (unscaled) reference units, so scale them to pixel
        // space once; rotations are radians and stay dimensionless.
        const oscillation = Math.sin(time + phaseOffset) * mouseDistance * 0.1;

        object.position.x =
          basePosition.x + (parallaxX + oscillation * randomOffset.x) * SCALE;
        object.position.y =
          basePosition.y + (parallaxY + oscillation * randomOffset.y) * SCALE;
        object.position.z =
          basePosition.z +
          oscillation * randomOffset.z * parallaxFactor * SCALE;

        object.rotation.x =
          baseRotation.x +
          targetY * rotationModifier.x * mouseDistance +
          oscillation * rotationModifier.x * 0.2;

        object.rotation.y =
          baseRotation.y +
          targetX * rotationModifier.y * mouseDistance +
          oscillation * rotationModifier.y * 0.2;

        object.rotation.z =
          baseRotation.z +
          targetX * targetY * rotationModifier.z * 2 +
          oscillation * rotationModifier.z * 0.3;
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

    // First render, then signal ready on the next tick.
    camera.lookAt(lookAtTarget);
    renderer.render(scene, camera);
    requestAnimationFrame(() => onReadyRef.current?.());

    document.addEventListener("mousemove", onMouseMove);
    window.addEventListener("resize", onResize);

    animate();

    // teardown — idempotent so StrictMode's dev remount doesn't duplicate the wall
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);

      objects.forEach((object) => scene.remove(object));
      objects.length = 0;

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [assignments]);

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
            <AsciiPlayer data={fig.data} width={PLANE_PX} loop />
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
