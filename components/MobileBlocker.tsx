// "use client";

// import { Monitor, Smartphone } from "lucide-react";

// export function MobileBlocker() {
//   return (
//     <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center bg-[#0a0a0a] px-6 text-center">
//       {/* Icon stack */}
//       <div className="relative mb-8 flex items-center justify-center">
//         <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/10 bg-white/5 shadow-2xl">
//           <Monitor className="h-12 w-12 text-blue-400" />
//         </div>
//         <div className="absolute -bottom-3 -right-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#0a0a0a] shadow-lg">
//           <Smartphone className="h-5 w-5 text-white/40" />
//         </div>
//       </div>

//       {/* Heading */}
//       <h1 className="mb-3 font-serif text-3xl font-semibold tracking-tight text-white">
//         Desktop Required
//       </h1>

//       {/* Description */}
//       <p className="mb-2 max-w-sm text-base leading-relaxed text-white/60">
//         The workspace is designed for larger screens and requires a desktop or
//         laptop to work properly.
//       </p>
//       <p className="max-w-xs text-sm text-white/40">
//         Please open this page on a desktop browser for the best experience.
//       </p>

//       {/* Decorative divider */}
//       <div className="mt-10 flex items-center gap-3">
//         <span className="h-px w-12 bg-white/10" />
//         <span className="text-xs font-semibold uppercase tracking-widest text-white/20">
//           Switch to desktop
//         </span>
//         <span className="h-px w-12 bg-white/10" />
//       </div>
//     </div>
//   );
// }


"use client";

import { useState } from "react";
import { Monitor, Smartphone, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileBlockerProps {
  onGenerate?: (prompt: string, imageUrl?: string) => void;
  isGenerating?: boolean;
}

export function MobileBlocker({ onGenerate, isGenerating = false }: MobileBlockerProps) {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating || !onGenerate) return;
    await onGenerate(prompt);
    setPrompt("");
  };

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col bg-[#0a0a0a]">
      {/* Main content area with original design */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        {/* Icon stack */}
        <div className="relative mb-8 flex items-center justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/10 bg-white/5 shadow-2xl">
            <Monitor className="h-12 w-12 text-blue-400" />
          </div>
          <div className="absolute -bottom-3 -right-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#0a0a0a] shadow-lg">
            <Smartphone className="h-5 w-5 text-white/40" />
          </div>
        </div>

        {/* Heading */}
        <h1 className="mb-3 font-serif text-3xl font-semibold tracking-tight text-white">
          Desktop Required
        </h1>

        {/* Description */}
        <p className="mb-2 max-w-sm text-base leading-relaxed text-white/60">
          The workspace is designed for larger screens and requires a desktop or
          laptop to work properly.
        </p>
        <p className="max-w-xs text-sm text-white/40">
          Please open this page on a desktop browser for the best experience.
        </p>

        {/* Decorative divider */}
        <div className="mt-10 flex items-center gap-3">
          <span className="h-px w-12 bg-white/10" />
          <span className="text-xs font-semibold uppercase tracking-widest text-white/20">
            Switch to desktop
          </span>
          <span className="h-px w-12 bg-white/10" />
        </div>
      </div>

      {/* Input area for mobile generation */}
      <div className="border-t border-white/10 p-4 bg-white/5">
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to build... (e.g., 'A todo app with dark mode')"
            className="w-full h-24 bg-black/50 border border-white/10 rounded-lg p-3 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 resize-none text-sm"
            disabled={isGenerating}
          />

          <Button
            type="submit"
            disabled={isGenerating || !prompt.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Generate App
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}