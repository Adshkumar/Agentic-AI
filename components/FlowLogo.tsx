import React from "react";
import { cn } from "@/lib/utils";

interface FlowLogoProps {
  showText?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export function FlowLogo({ showText = true, size = "md", className }: FlowLogoProps) {
  const dimensions = {
    xs: { icon: "h-5 w-5", text: "text-sm", gap: "gap-1.5" },
    sm: { icon: "h-6 w-6", text: "text-base", gap: "gap-2" },
    md: { icon: "h-8 w-8", text: "text-xl", gap: "gap-2.5" },
    lg: { icon: "h-10 w-10", text: "text-2xl", gap: "gap-3" },
  }[size];

  return (
    <div className={cn("flex items-center select-none", dimensions.gap, className)}>
      {/* 3D Isometric Cube Icon */}
      <div className={cn("relative shrink-0", dimensions.icon)}>
        {/* Glowing aura */}
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-600 rounded-lg blur-[6px] opacity-40" />
        
        {/* SVG Graphic */}
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative w-full h-full drop-shadow-[0_2px_8px_rgba(6,182,212,0.4)]"
        >
          <defs>
            <linearGradient id="cubeTop" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <linearGradient id="cubeLeft" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
            <linearGradient id="cubeRight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="40%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Central Floating Orb (Core) */}
          <circle
            cx="16"
            cy="15.5"
            r="4.5"
            fill="url(#coreGlow)"
            className="animate-pulse"
          />

          {/* Top Face (Floating) */}
          <path
            d="M16 3.5L25.5 8.25L16 13L6.5 8.25Z"
            fill="url(#cubeTop)"
            fillOpacity="0.9"
            className="transition-transform duration-300 hover:translate-y-[-1px]"
          />

          {/* Left Face (Floating) */}
          <path
            d="M5 12L14 16.5V25.5L5 21Z"
            fill="url(#cubeLeft)"
            fillOpacity="0.85"
          />

          {/* Right Face (Floating) */}
          <path
            d="M18 16.5L27 12V21L18 25.5Z"
            fill="url(#cubeRight)"
            fillOpacity="0.85"
          />
        </svg>
      </div>

      {/* Typography */}
      {showText && (
        <span className={cn("font-sans font-black tracking-tight text-white", dimensions.text)}>
          F
          <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
            low
          </span>
          <span className="text-cyan-400">.</span>
        </span>
      )}
    </div>
  );
}
