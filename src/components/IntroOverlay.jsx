import { useEffect, useRef } from "react";
import gsap from "gsap";

// Cinematic intro, phase 1–3: a swarm of monospace ASCII characters flies in from
// the viewport edges and assembles into the headline, holds while the hero avatar
// warms up + fades in behind it, then scatters back off-screen. Purely visual —
// asset preloading stays in App so unmounting this (skip) can't cancel it.

const HEADLINE = "Christian Bianchi  frontend developer";
// Below this viewport width the headline wraps onto two lines at the em dash.
const NARROW_VW = 640;

// Glyph soup the swarm is made of: the site's ascii ramp plus the headline's own
// letters, so the cloud already reads as "text stuff" while flying.
const CHAR_POOL = (".:-=+*#%@" + HEADLINE.replace(/[\s—]/g, "")).split("");

// Particle budgets — one particle per sampled lit pixel of the rasterized headline.
// The sampling step is widened until the count fits, keeping fill-rate sane on phones.
const BUDGET_DESKTOP = 500;
const BUDGET_MOBILE = 425;

// Rasterize the headline on an offscreen canvas and sample lit pixels on a grid.
// Returns particle targets (CSS px) plus the glyph size to draw the particles at.
function computeTargets(vw, vh) {
  const off = document.createElement("canvas");
  off.width = vw;
  off.height = vh;
  const ctx = off.getContext("2d", { willReadFrequently: true });

  // Narrow screens: wrap onto two lines at the double-space gap in the headline.
  const lines = vw < NARROW_VW ? HEADLINE.split(/\s{2,}/) : [HEADLINE];

  // Fit the font so the widest line spans ~86% of the viewport, capped by height.
  const probe = 100;
  ctx.font = `700 ${probe}px "Courier New", monospace`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const fontSize = Math.min((probe * vw * 0.86) / widest, vh * 0.14);

  ctx.font = `700 ${fontSize}px "Courier New", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  const lineHeight = fontSize * 1.35;
  const firstY = vh / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, vw / 2, firstY + i * lineHeight));

  const data = ctx.getImageData(0, 0, vw, vh).data;
  const budget = vw < NARROW_VW ? BUDGET_MOBILE : BUDGET_DESKTOP;

  let step = Math.max(2, Math.round(fontSize / 14));
  let targets = [];
  do {
    targets = [];
    for (let y = 0; y < vh; y += step) {
      for (let x = 0; x < vw; x += step) {
        if (data[(y * vw + x) * 4 + 3] > 128) targets.push({ x, y });
      }
    }
    step += 1;
  } while (targets.length > budget * 1.25 && step < 40);

  // Glyphs slightly larger than the grid step so the letterforms read as solid.
  return { targets, glyph: Math.max(7, (step - 1) * 1.7) };
}

// A scatter point for a particle: pushed well past the viewport edge along the
// direction from the center through its position (plus jitter), so both the
// fly-in origin and the disperse exit feel radial.
function edgePoint(x, y, vw, vh) {
  let dx = x - vw / 2;
  let dy = y - vh / 2;
  const len = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9;
  const r = Math.hypot(vw, vh) * (0.65 + Math.random() * 0.35);
  return {
    x: vw / 2 + Math.cos(angle) * Math.max(r, len + 80),
    y: vh / 2 + Math.sin(angle) * Math.max(r, len + 80),
  };
}

export function IntroOverlay({ phase, onFormed, onDispersed }) {
  const canvasRef = useRef(null);
  // Swarm state shared between the two effects: particle objects + hold flag.
  const swarmRef = useRef(null);
  const onFormedRef = useRef(onFormed);
  onFormedRef.current = onFormed;
  const onDispersedRef = useRef(onDispersed);
  onDispersedRef.current = onDispersed;

  // Build the swarm, fly the particles in, and keep a rAF loop painting them.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { targets, glyph } = computeTargets(vw, vh);

    const particles = targets.map((t) => {
      const start = edgePoint(t.x, t.y, vw, vh);
      return {
        x: start.x,
        y: start.y,
        tx: t.x,
        ty: t.y,
        char: CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)],
        // The site accent blue, sparingly, so the swarm matches the pills/bar.
        color: Math.random() < 0.12 ? "#0000ff" : "#fff",
        alpha: 0.95,
      };
    });

    const swarm = {
      particles,
      glyph,
      // Set when the forming tween lands: enables the idle jitter while holding.
      formedAt: 0,
      dispersing: false,
    };
    swarmRef.current = swarm;

    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();

    gsap.to(particles, {
      x: (i) => particles[i].tx,
      y: (i) => particles[i].ty,
      duration: 1.8,
      ease: "power3.out",
      stagger: { each: 0.0015, from: "random" },
      onComplete: () => {
        swarm.formedAt = performance.now();
        onFormedRef.current?.();
      },
    });

    let rafId = 0;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `700 ${swarm.glyph}px "Courier New", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Idle jitter while the formed text holds (ramps in over ~1s to avoid a pop).
      const now = performance.now();
      const jitterAmp =
        swarm.formedAt && !swarm.dispersing
          ? Math.min(1, (now - swarm.formedAt) / 1000) * 0.7
          : 0;
      const t = now * 0.002;
      for (let i = 0; i < swarm.particles.length; i++) {
        const p = swarm.particles[i];
        if (p.alpha <= 0.01) continue;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        const jx = jitterAmp ? Math.sin(t + i * 1.3) * jitterAmp : 0;
        const jy = jitterAmp ? Math.cos(t * 1.4 + i * 0.7) * jitterAmp : 0;
        ctx.fillText(p.char, p.x + jx, p.y + jy);
      }
      ctx.globalAlpha = 1;
    };
    draw();

    // Resize: re-rasterize the headline and glide particles to the new layout.
    // Once dispersing, exits are already in flight — just keep the canvas sized.
    const onResize = () => {
      sizeCanvas();
      if (swarm.dispersing) return;
      const next = computeTargets(window.innerWidth, window.innerHeight);
      swarm.glyph = next.glyph;
      const n = next.targets.length;
      gsap.to(particles, {
        x: (i) => next.targets[i % n].x,
        y: (i) => next.targets[i % n].y,
        duration: 0.5,
        ease: "power2.out",
        overwrite: true,
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafId);
      gsap.killTweensOf(particles);
      swarmRef.current = null;
    };
  }, []);

  // Phase 3: scatter the particles off-screen and fade them out.
  useEffect(() => {
    if (phase !== "disperse") return;
    const swarm = swarmRef.current;
    if (!swarm || swarm.dispersing) return;
    swarm.dispersing = true;

    const { particles } = swarm;
    gsap.killTweensOf(particles);
    const exits = particles.map((p) =>
      edgePoint(p.tx, p.ty, window.innerWidth, window.innerHeight),
    );
    gsap.to(particles, {
      x: (i) => exits[i].x,
      y: (i) => exits[i].y,
      alpha: 0,
      duration: 1.1,
      ease: "power2.in",
      stagger: { each: 0.001, from: "random" },
      onComplete: () => onDispersedRef.current?.(),
    });
    // No cleanup that kills this tween on phase change: the component unmounts
    // right after onDispersed, and the mount effect's cleanup kills everything.
  }, [phase]);

  return (
    <div className="intro-swarm" aria-hidden={false}>
      <canvas ref={canvasRef} className="intro-swarm__canvas" />
      {/* The real headline for screen readers — the canvas is decoration. */}
      <h1 className="intro-swarm__sr">{HEADLINE}</h1>
    </div>
  );
}
