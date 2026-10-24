
import { useEffect, useRef, useState } from 'react';
import { gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';

const BRAND = 'ClinicSaathi';

export function Preloader() {
  const [show, setShow] = useState(true);

  const panelRef = useRef(null);
  const doctorImageRef = useRef(null);
  const glowRef = useRef(null);
  const pulseRef = useRef(null);
  const progressRef = useRef(null);
  const exited = useRef(false);

  const exit = () => {
    if (exited.current) return;

    exited.current = true;

    if (prefersReducedMotion()) {
      document.body.style.overflow = '';
      setShow(false);
      return;
    }

    const tl = gsap.timeline({
      delay: 0.25,
      onComplete: () => {
        document.body.style.overflow = '';
        setShow(false);
      },
    });

    tl.to(
      glowRef.current,
      {
        scale: 1.5,
        opacity: 0,
        duration: 0.45,
        ease: 'power2.in',
      },
      0
    );

    tl.to(
      doctorImageRef.current,
      {
        scale: 1.1,
        opacity: 0,
        duration: 0.35,
        ease: 'power2.in',
      },
      0
    );

    tl.to(
      panelRef.current,
      {
        yPercent: -100,
        duration: 0.65,
        ease: 'power4.inOut',
      },
      0.08
    );
  };

  useEffect(() => {
    document.body.style.overflow = 'hidden';

    if (prefersReducedMotion()) {
      exit();
      return undefined;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        delay: 0.15,
        onComplete: exit,
      });

      // Initial states
      gsap.set(doctorImageRef.current, {
        opacity: 0,
        scale: 0.7,
        rotation: -15,
      });

      gsap.set(pulseRef.current, {
        scale: 0.8,
        opacity: 0,
      });

      gsap.set(progressRef.current, {
        scaleX: 0,
        transformOrigin: 'left center',
      });

      // Ambient glow
      gsap.fromTo(
        glowRef.current,
        {
          scale: 0.65,
          opacity: 0,
        },
        {
          scale: 1,
          opacity: 1,
          duration: 1.2,
          ease: 'power3.out',
        }
      );

      // Doctor image entrance with rotation
      tl.to(doctorImageRef.current, {
        opacity: 1,
        scale: 1,
        rotation: 0,
        duration: 0.8,
        ease: 'back.out(1.5)',
      });

      // Pulse animation
      tl.to(
        pulseRef.current,
        {
          scale: 1.3,
          opacity: 0,
          duration: 0.8,
          ease: 'power1.inOut',
          repeat: 2,
          repeatDelay: 0.4,
        },
        0.1
      );

      // Progress bar
      tl.to(
        progressRef.current,
        {
          scaleX: 1,
          duration: 1.2,
          ease: 'power2.inOut',
        },
        '-=0.35'
      );

      // Gentle floating animation
      tl.to(
        doctorImageRef.current,
        {
          y: -8,
          duration: 0.4,
          ease: 'sine.inOut',
        },
        '-=0.3'
      );

      tl.to(doctorImageRef.current, {
        y: 0,
        duration: 0.4,
        ease: 'sine.inOut',
      });
    }, panelRef);

    const timeout = setTimeout(exit, 4500);

    return () => {
      ctx.revert();
      clearTimeout(timeout);
      document.body.style.overflow = '';
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!show) return null;

  return (
    <div
      ref={panelRef}
      role="status"
      aria-live="polite"
      className="
        fixed inset-0 z-[100]
        flex items-center justify-center
        overflow-hidden bg-[#071110]
      "
    >
      {/* Accessibility */}
      <span className="sr-only">
        Loading ClinicSaathi
      </span>

      {/* Ambient glow */}
      <div
        ref={glowRef}
        aria-hidden="true"
        className="
          pointer-events-none absolute
          h-[500px] w-[500px]
          rounded-full
          bg-[radial-gradient(circle,rgba(45,212,191,0.15)_0%,rgba(45,212,191,0.06)_35%,transparent_70%)]
          blur-3xl
        "
      />

      {/* Decorative circles */}
      <div
        aria-hidden="true"
        className="
          pointer-events-none absolute
          h-[320px] w-[320px]
          rounded-full border border-emerald-300/[0.08]
        "
      />

      <div
        aria-hidden="true"
        className="
          pointer-events-none absolute
          h-[430px] w-[430px]
          rounded-full border border-emerald-300/[0.035]
        "
      />

      {/* Main content */}
      <div className="relative flex w-full flex-col items-center px-6">

        {/* Brand category */}
        <div className="mb-8 flex items-center gap-3">
          <span
            className="
              h-[6px] w-[6px] rounded-full
              bg-emerald-300
              shadow-[0_0_14px_rgba(110,231,183,0.9)]
            "
          />

          <span
            className="
              text-[11px] font-semibold uppercase
              tracking-[0.32em] text-emerald-200/85
              drop-shadow-[0_0_10px_rgba(110,231,183,0.35)]
              sm:text-xs
            "
          >
            Healthcare Technology
          </span>

          <span
            className="
              h-[6px] w-[6px] rounded-full
              bg-emerald-300
              shadow-[0_0_14px_rgba(110,231,183,0.9)]
            "
          />
        </div>

        {/* Doctor Image with Pulse */}
        <div className="relative mb-6 flex items-center justify-center">
          {/* Pulse circle background */}
          <div
            ref={pulseRef}
            aria-hidden="true"
            className="
              pointer-events-none absolute
              h-32 w-32 rounded-full
              bg-emerald-400/30 blur-lg
            "
          />

          {/* Doctor SVG Icon */}
          <div
            ref={doctorImageRef}
            className="relative z-10"
          >
            <svg
              width="120"
              height="120"
              viewBox="0 0 120 120"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="drop-shadow-[0_0_20px_rgba(45,212,191,0.4)]"
            >
              {/* Head */}
              <circle cx="60" cy="35" r="20" fill="#2dd4bf" opacity="0.9" />

              {/* Body - Torso */}
              <rect x="42" y="58" width="36" height="35" rx="4" fill="#2dd4bf" opacity="0.85" />

              {/* Medical Cross on Chest */}
              <g opacity="0.7">
                <rect x="54" y="68" width="3" height="14" fill="white" />
                <rect x="49" y="73" width="14" height="3" fill="white" />
              </g>

              {/* Left Arm */}
              <g>
                <rect x="28" y="65" width="16" height="12" rx="6" fill="#2dd4bf" opacity="0.8" />
                <circle cx="28" cy="71" r="5" fill="#2dd4bf" opacity="0.8" />
              </g>

              {/* Right Arm */}
              <g>
                <rect x="76" y="65" width="16" height="12" rx="6" fill="#2dd4bf" opacity="0.8" />
                <circle cx="92" cy="71" r="5" fill="#2dd4bf" opacity="0.8" />
              </g>

              {/* Left Leg */}
              <rect x="48" y="95" width="8" height="20" rx="4" fill="#2dd4bf" opacity="0.8" />

              {/* Right Leg */}
              <rect x="64" y="95" width="8" height="20" rx="4" fill="#2dd4bf" opacity="0.8" />

              {/* Stethoscope around neck - decorative */}
              <path
                d="M 45 55 Q 60 65 75 55"
                stroke="#7cebd8"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
                opacity="0.7"
              />
            </svg>
          </div>
        </div>

        {/* ClinicSaathi wordmark */}
        <h1
          className="
            relative text-center leading-none
          "
          style={{
            fontSize: 'clamp(2rem, 7vw, 5rem)',
          }}
        >
          <span
            className="
              block whitespace-nowrap
              font-display font-black
              tracking-[-0.055em]
            "
            style={{
              background:
                'linear-gradient(135deg, #ffffff 0%, #e5fff8 28%, #7cebd8 58%, #2dd4bf 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter:
                'drop-shadow(0 0 20px rgba(45,212,191,0.18))',
            }}
          >
            {BRAND}
          </span>
        </h1>

        {/* Tagline */}
        <p
          className="
            mt-6 text-center text-xs font-semibold uppercase
            tracking-[0.28em] text-teal-100/75
            drop-shadow-[0_0_12px_rgba(45,212,191,0.2)]
            sm:text-sm
          "
        >
          Smarter Clinics. Happier Patients.
        </p>

        {/* Progress bar */}
        <div
          className="
            mt-10 h-[2px] w-40 overflow-hidden
            rounded-full bg-white/[0.10] sm:w-56
          "
        >
          <div
            ref={progressRef}
            className="
              h-full w-full origin-left rounded-full
              bg-gradient-to-r from-emerald-400
              via-teal-300 to-white
              shadow-[0_0_15px_rgba(45,212,191,0.75)]
            "
          />
        </div>

        {/* Loading text */}
        <div className="mt-4 flex items-center gap-2">
          <span
            className="
              text-[10px] font-medium uppercase
              tracking-[0.28em] text-emerald-100/50
              sm:text-[11px]
            "
          >
            Preparing your experience
          </span>
        </div>
      </div>

      {/* Bottom decoration */}
      <div
        aria-hidden="true"
        className="
          absolute bottom-8 left-1/2
          h-px w-20 -translate-x-1/2
          bg-gradient-to-r from-transparent
          via-emerald-300/30 to-transparent
        "
      />
    </div>
  );
}