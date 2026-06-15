"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { MobileBlocker } from "./MobileBlocker";
import { MIN_CREDITS_TO_GENERATE } from "@/lib/constants";
import { toast } from "sonner";
import type {
  Message,
  FileData,
  StatusStep,
  WorkspaceData,
} from "@/types/workspace";

export type {
  MessageRole,
  Message,
  FileData,
  StatusStep,
} from "@/types/workspace";

interface WorkspaceClientProps {
  initialPrompt: string | null;
  workspace: WorkspaceData | null;
  userCredits: number;
  userId: string;
  userPlan: string;
}

function parseMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is Message =>
      typeof m === "object" && m !== null && "role" in m && "content" in m
  );
}

function parseFileData(raw: unknown): FileData | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (!f.files || !f.dependencies) return null;
  return raw as FileData;
}

export function WorkspaceClient({
  initialPrompt,
  workspace,
  userCredits,
  userId,
  userPlan,
}: WorkspaceClientProps) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    workspace?.id ?? null
  );
  const [messages, setMessages] = useState<Message[]>(
    parseMessages(workspace?.messages)
  );
  const [fileData, setFileData] = useState<FileData | null>(
    parseFileData(workspace?.fileData)
  );
  const [credits, setCredits] = useState(userCredits);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusLog, setStatusLog] = useState<StatusStep[]>([]);
  const [isImproving, setIsImproving] = useState(false);

  // AbortController refs — used to cancel in-flight streams
  const generateAbortRef = useRef<AbortController | null>(null);
  const improveAbortRef = useRef<AbortController | null>(null);

  // Refs to avoid stale closures in callbacks
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const workspaceIdRef = useRef<string | null>(workspaceId);
  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  // fileData ref — so handleImprove never closes over stale fileData
  // even as file_patch events stream in
  const fileDataRef = useRef<FileData | null>(fileData);
  useEffect(() => {
    fileDataRef.current = fileData;
  }, [fileData]);

  const pushStep = (label: string) => {
    setStatusLog((prev) => [
      ...prev.map((s, i) =>
        i === prev.length - 1 ? { ...s, status: "done" as const } : s
      ),
      { label, status: "running" as const },
    ]);
  };

  const completeSteps = () => {
    setStatusLog((prev) =>
      prev.map((s, i) =>
        i === prev.length - 1 ? { ...s, status: "done" as const } : s
      )
    );
  };

  const handleGenerate = useCallback(
    async (prompt: string, imageUrl?: string) => {
      if (isGenerating) return;
      if (credits < MIN_CREDITS_TO_GENERATE) {
        toast.error("Not enough credits. Please upgrade your plan.");
        return;
      }

      const userMessage: Message = {
        role: "user",
        content: prompt,
        ...(imageUrl ? { imageUrl } : {}),
      };

      const currentMessages = messagesRef.current;
      const currentWorkspaceId = workspaceIdRef.current;

      setMessages((prev) => [...prev, userMessage]);
      setIsGenerating(true);
      setStatusLog([{ label: "Thinking…", status: "running" }]);

      // Create a fresh AbortController for this request
      const abortController = new AbortController();
      generateAbortRef.current = abortController;

      try {
        const conversationHistory = [...currentMessages, userMessage];

        const res = await fetch("/api/gen-ai-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            userId,
            messages: conversationHistory,
            fileData: fileDataRef.current,
          }),
        });

        if (res.status === 402) {
          toast.error("Not enough credits. Please upgrade your plan.");
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        if (res.status === 429) {
          toast.error("Too many requests. Please slow down.");
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        if (res.status === 503) {
          toast.error("AI service is busy. Please try again in a moment.");
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        if (!res.ok || !res.body) throw new Error("Generation failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              // skip malformed SSE lines
              continue;
            }
            if (event.type === "status") {
              pushStep(event.message);
            } else if (event.type === "progress") {
              setStatusLog((prev) => {
                if (prev.length === 0) return prev;
                return prev.map((s, idx) =>
                  idx === prev.length - 1 ? { ...s, label: event.message } : s
                );
              });
            } else if (event.type === "done") {
              completeSteps();
              setWorkspaceId(event.workspaceId);
              setFileData(event.fileData);
              setCredits(event.creditsRemaining);
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: event.assistantMessage },
              ]);
              window.history.replaceState(
                null,
                "",
                `/workspace?id=${event.workspaceId}`
              );
              toast.success("App generated successfully!");
            } else if (event.type === "error") {
              const err = new Error(event.message);
              (err as any).isExpected = true;
              throw err;
            }
          }
        }
      } catch (err) {
        // User-initiated stop — silently roll back the user message
        if (err instanceof Error && err.name === "AbortError") {
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        if (err instanceof Error && (err as any).isExpected) {
          toast.error(err.message);
        } else {
          console.error(err);
          toast.error(
            err instanceof Error ? err.message : "Something went wrong."
          );
        }
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        generateAbortRef.current = null;
        setIsGenerating(false);
        setStatusLog([]);
      }
    },
    [credits, isGenerating, userId]
  );

  const handleImprove = useCallback(
    async (userRequest: string) => {
      if (isGenerating || isImproving) return;
      if (credits < MIN_CREDITS_TO_GENERATE) {
        toast.error("Not enough credits.");
        return;
      }
      if (!workspaceIdRef.current) return;

      // Read fileData from ref — never stale, never causes recreating this fn
      const currentFileData = fileDataRef.current;
      if (!currentFileData) return;

      setIsImproving(true);

      setMessages((prev) => [
        ...prev,
        { role: "user", content: userRequest },
        { role: "assistant", content: "" }, // placeholder, updated live
      ]);

      // Create a fresh AbortController for this request
      const abortController = new AbortController();
      improveAbortRef.current = abortController;

      try {
        const res = await fetch("/api/improve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
          body: JSON.stringify({
            userId,
            workspaceId: workspaceIdRef.current,
            userRequest,
            fileData: currentFileData,
          }),
        });

        if (res.status === 403) {
          toast.error(
            "Upgrade to Starter or Pro to use Improve with Flow Agent."
          );
          setMessages((prev) => prev.slice(0, -2));
          return;
        }
        if (res.status === 402) {
          toast.error("Not enough credits.");
          setMessages((prev) => prev.slice(0, -2));
          return;
        }
        if (!res.ok || !res.body) throw new Error("Improve failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulatedThinking = "";

        // Accumulate patches locally — only apply to state at done.
        // Applying on every file_patch event would update fileData state,
        // which feeds into SandpackProvider and can cause remounts mid-stream.
        const localPatches: Record<string, { code: string }> = {};

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              // skip malformed SSE lines
              continue;
            }

            if (event.type === "thinking") {
              // Stream agent reasoning into the placeholder assistant message
              accumulatedThinking += event.text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: accumulatedThinking,
                };
                return updated;
              });
            } else if (event.type === "file_patch") {
              // Accumulate locally — don't touch state yet
              localPatches[event.path] = { code: event.code };
            } else if (event.type === "done") {
              // Apply all patches at once now that the stream is complete
              setFileData(event.fileData);
              setCredits(event.creditsRemaining);
              // Replace thinking text with clean summary
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: event.summary,
                };
                return updated;
              });
              toast.success("App improved successfully!");
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          }
        }
      } catch (err) {
        // User-initiated stop — silently roll back the user + placeholder messages
        if (err instanceof Error && err.name === "AbortError") {
          setMessages((prev) => prev.slice(0, -2));
          return;
        }
        toast.error(err instanceof Error ? err.message : "Improve failed.");
        setMessages((prev) => prev.slice(0, -2));
      } finally {
        improveAbortRef.current = null;
        setIsImproving(false);
      }
    },
    [credits, isGenerating, isImproving, userId]
  );

  // Cancel whichever stream is currently in-flight
  const handleStop = useCallback(() => {
    generateAbortRef.current?.abort();
    improveAbortRef.current?.abort();
  }, []);

  const handleFilePatch = useCallback((patches: FileData) => {
    setFileData(patches);
  }, []);

  return (
    <>
      {/* Mobile blocker — visible only on small screens with generation support */}
      <div className="md:hidden">
        <MobileBlocker
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
        />
      </div>

      {/* Workspace — visible only on md+ screens */}
      <div className="hidden md:flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[#0a0a0a]">
        <ChatPanel
          isImproving={isImproving}
          messages={messages}
          isGenerating={isGenerating}
          statusLog={statusLog}
          credits={credits}
          initialPrompt={initialPrompt}
          onGenerate={handleGenerate}
          onStop={handleStop}
          userId={userId}
          workspaceId={workspaceId}
          appTitle={fileData?.title ?? workspace?.title ?? null}
        />
        <div className="w-px shrink-0 bg-white/6" />
        <CodePanel
          fileData={fileData}
          isGenerating={isGenerating}
          statusLog={statusLog}
          onImprove={handleImprove}
          onFixError={(error) =>
            handleGenerate(
              `There is an error in the preview:\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease fix it.`
            )
          }
          onFilePatch={handleFilePatch}
          appTitle={fileData?.title ?? workspace?.title ?? null}
          isImproving={isImproving}
          isProUser={userPlan === "pro"}
        />
      </div>
    </>
  );
}





// USE THIS TO SHOW THE APP IN THE PHONE

// "use client";

// import { useState, useCallback, useRef, useEffect } from "react";
// import { ChatPanel } from "./ChatPanel";
// import { CodePanel } from "./CodePanel";
// import { MIN_CREDITS_TO_GENERATE } from "@/lib/constants";
// import { toast } from "sonner";
// import type {
//   Message,
//   FileData,
//   StatusStep,
//   WorkspaceData,
// } from "@/types/workspace";

// export type {
//   MessageRole,
//   Message,
//   FileData,
//   StatusStep,
// } from "@/types/workspace";

// interface WorkspaceClientProps {
//   initialPrompt: string | null;
//   workspace: WorkspaceData | null;
//   userCredits: number;
//   userId: string;
//   userPlan: string;
// }

// function parseMessages(raw: unknown): Message[] {
//   if (!Array.isArray(raw)) return [];
//   return raw.filter(
//     (m): m is Message =>
//       typeof m === "object" && m !== null && "role" in m && "content" in m
//   );
// }

// function parseFileData(raw: unknown): FileData | null {
//   if (!raw || typeof raw !== "object") return null;
//   const f = raw as Record<string, unknown>;
//   if (!f.files || !f.dependencies) return null;
//   return raw as FileData;
// }

// export function WorkspaceClient({
//   initialPrompt,
//   workspace,
//   userCredits,
//   userId,
//   userPlan,
// }: WorkspaceClientProps) {
//   const [workspaceId, setWorkspaceId] = useState<string | null>(
//     workspace?.id ?? null
//   );
//   const [messages, setMessages] = useState<Message[]>(
//     parseMessages(workspace?.messages)
//   );
//   const [fileData, setFileData] = useState<FileData | null>(
//     parseFileData(workspace?.fileData)
//   );
//   const [credits, setCredits] = useState(userCredits);
//   const [isGenerating, setIsGenerating] = useState(false);
//   const [statusLog, setStatusLog] = useState<StatusStep[]>([]);
//   const [isImproving, setIsImproving] = useState(false);

//   // AbortController refs — used to cancel in-flight streams
//   const generateAbortRef = useRef<AbortController | null>(null);
//   const improveAbortRef = useRef<AbortController | null>(null);

//   // Refs to avoid stale closures in callbacks
//   const messagesRef = useRef<Message[]>(messages);
//   useEffect(() => {
//     messagesRef.current = messages;
//   }, [messages]);

//   const workspaceIdRef = useRef<string | null>(workspaceId);
//   useEffect(() => {
//     workspaceIdRef.current = workspaceId;
//   }, [workspaceId]);

//   // fileData ref — so handleImprove never closes over stale fileData
//   // even as file_patch events stream in
//   const fileDataRef = useRef<FileData | null>(fileData);
//   useEffect(() => {
//     fileDataRef.current = fileData;
//   }, [fileData]);

//   const pushStep = (label: string) => {
//     setStatusLog((prev) => [
//       ...prev.map((s, i) =>
//         i === prev.length - 1 ? { ...s, status: "done" as const } : s
//       ),
//       { label, status: "running" as const },
//     ]);
//   };

//   const completeSteps = () => {
//     setStatusLog((prev) =>
//       prev.map((s, i) =>
//         i === prev.length - 1 ? { ...s, status: "done" as const } : s
//       )
//     );
//   };

//   const handleGenerate = useCallback(
//     async (prompt: string, imageUrl?: string) => {
//       if (isGenerating) return;
//       if (credits < MIN_CREDITS_TO_GENERATE) {
//         toast.error("Not enough credits. Please upgrade your plan.");
//         return;
//       }

//       const userMessage: Message = {
//         role: "user",
//         content: prompt,
//         ...(imageUrl ? { imageUrl } : {}),
//       };

//       const currentMessages = messagesRef.current;
//       const currentWorkspaceId = workspaceIdRef.current;

//       setMessages((prev) => [...prev, userMessage]);
//       setIsGenerating(true);
//       setStatusLog([{ label: "Thinking…", status: "running" }]);

//       // Create a fresh AbortController for this request
//       const abortController = new AbortController();
//       generateAbortRef.current = abortController;

//       try {
//         const conversationHistory = [...currentMessages, userMessage];

//         const res = await fetch("/api/gen-ai-code", {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           signal: abortController.signal,
//           body: JSON.stringify({
//             workspaceId: currentWorkspaceId,
//             userId,
//             messages: conversationHistory,
//             fileData: fileDataRef.current,
//           }),
//         });

//         if (res.status === 402) {
//           toast.error("Not enough credits. Please upgrade your plan.");
//           setMessages((prev) => prev.slice(0, -1));
//           return;
//         }
//         if (res.status === 429) {
//           toast.error("Too many requests. Please slow down.");
//           setMessages((prev) => prev.slice(0, -1));
//           return;
//         }
//         if (res.status === 503) {
//           toast.error("AI service is busy. Please try again in a moment.");
//           setMessages((prev) => prev.slice(0, -1));
//           return;
//         }
//         if (!res.ok || !res.body) throw new Error("Generation failed");

//         const reader = res.body.getReader();
//         const decoder = new TextDecoder();
//         let buffer = "";

//         while (true) {
//           const { done, value } = await reader.read();
//           if (done) break;

//           buffer += decoder.decode(value, { stream: true });
//           const lines = buffer.split("\n\n");
//           buffer = lines.pop() ?? "";

//           for (const line of lines) {
//             if (!line.startsWith("data: ")) continue;
//             let event;
//             try {
//               event = JSON.parse(line.slice(6));
//             } catch {
//               continue;
//             }
//             if (event.type === "status") {
//               pushStep(event.message);
//             } else if (event.type === "progress") {
//               setStatusLog((prev) => {
//                 if (prev.length === 0) return prev;
//                 return prev.map((s, idx) =>
//                   idx === prev.length - 1 ? { ...s, label: event.message } : s
//                 );
//               });
//             } else if (event.type === "done") {
//               completeSteps();
//               setWorkspaceId(event.workspaceId);
//               setFileData(event.fileData);
//               setCredits(event.creditsRemaining);
//               setMessages((prev) => [
//                 ...prev,
//                 { role: "assistant", content: event.assistantMessage },
//               ]);
//               window.history.replaceState(
//                 null,
//                 "",
//                 `/workspace?id=${event.workspaceId}`
//               );
//               toast.success("App generated successfully!");
//             } else if (event.type === "error") {
//               const err = new Error(event.message);
//               (err as any).isExpected = true;
//               throw err;
//             }
//           }
//         }
//       } catch (err) {
//         if (err instanceof Error && err.name === "AbortError") {
//           setMessages((prev) => prev.slice(0, -1));
//           return;
//         }
//         if (err instanceof Error && (err as any).isExpected) {
//           toast.error(err.message);
//         } else {
//           console.error(err);
//           toast.error(
//             err instanceof Error ? err.message : "Something went wrong."
//           );
//         }
//         setMessages((prev) => prev.slice(0, -1));
//       } finally {
//         generateAbortRef.current = null;
//         setIsGenerating(false);
//         setStatusLog([]);
//       }
//     },
//     [credits, isGenerating, userId]
//   );

//   const handleImprove = useCallback(
//     async (userRequest: string) => {
//       if (isGenerating || isImproving) return;
//       if (credits < MIN_CREDITS_TO_GENERATE) {
//         toast.error("Not enough credits.");
//         return;
//       }
//       if (!workspaceIdRef.current) return;

//       const currentFileData = fileDataRef.current;
//       if (!currentFileData) return;

//       setIsImproving(true);

//       setMessages((prev) => [
//         ...prev,
//         { role: "user", content: userRequest },
//         { role: "assistant", content: "" },
//       ]);

//       const abortController = new AbortController();
//       improveAbortRef.current = abortController;

//       try {
//         const res = await fetch("/api/improve", {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           signal: abortController.signal,
//           body: JSON.stringify({
//             userId,
//             workspaceId: workspaceIdRef.current,
//             userRequest,
//             fileData: currentFileData,
//           }),
//         });

//         if (res.status === 403) {
//           toast.error(
//             "Upgrade to Starter or Pro to use Improve with Flow Agent."
//           );
//           setMessages((prev) => prev.slice(0, -2));
//           return;
//         }
//         if (res.status === 402) {
//           toast.error("Not enough credits.");
//           setMessages((prev) => prev.slice(0, -2));
//           return;
//         }
//         if (!res.ok || !res.body) throw new Error("Improve failed");

//         const reader = res.body.getReader();
//         const decoder = new TextDecoder();
//         let buffer = "";
//         let accumulatedThinking = "";

//         while (true) {
//           const { done, value } = await reader.read();
//           if (done) break;

//           buffer += decoder.decode(value, { stream: true });
//           const lines = buffer.split("\n\n");
//           buffer = lines.pop() ?? "";

//           for (const line of lines) {
//             if (!line.startsWith("data: ")) continue;
//             let event;
//             try {
//               event = JSON.parse(line.slice(6));
//             } catch {
//               continue;
//             }

//             if (event.type === "thinking") {
//               accumulatedThinking += event.text;
//               setMessages((prev) => {
//                 const updated = [...prev];
//                 updated[updated.length - 1] = {
//                   role: "assistant",
//                   content: accumulatedThinking,
//                 };
//                 return updated;
//               });
//             } else if (event.type === "file_patch") {
//               // Accumulate locally
//             } else if (event.type === "done") {
//               setFileData(event.fileData);
//               setCredits(event.creditsRemaining);
//               setMessages((prev) => {
//                 const updated = [...prev];
//                 updated[updated.length - 1] = {
//                   role: "assistant",
//                   content: event.summary,
//                 };
//                 return updated;
//               });
//               toast.success("App improved successfully!");
//             } else if (event.type === "error") {
//               throw new Error(event.message);
//             }
//           }
//         }
//       } catch (err) {
//         if (err instanceof Error && err.name === "AbortError") {
//           setMessages((prev) => prev.slice(0, -2));
//           return;
//         }
//         toast.error(err instanceof Error ? err.message : "Improve failed.");
//         setMessages((prev) => prev.slice(0, -2));
//       } finally {
//         improveAbortRef.current = null;
//         setIsImproving(false);
//       }
//     },
//     [credits, isGenerating, isImproving, userId]
//   );

//   const handleStop = useCallback(() => {
//     generateAbortRef.current?.abort();
//     improveAbortRef.current?.abort();
//   }, []);

//   const handleFilePatch = useCallback((patches: FileData) => {
//     setFileData(patches);
//   }, []);

//   return (
//     <>
//       {/* Mobile: Show workspace directly (stacked layout) */}
//       <div className="flex flex-col md:hidden h-[calc(100vh-3.5rem)] overflow-hidden bg-[#0a0a0a]">
//         <div className="flex-1 overflow-hidden">
//           <ChatPanel
//             isImproving={isImproving}
//             messages={messages}
//             isGenerating={isGenerating}
//             statusLog={statusLog}
//             credits={credits}
//             initialPrompt={initialPrompt}
//             onGenerate={handleGenerate}
//             onStop={handleStop}
//             userId={userId}
//             workspaceId={workspaceId}
//             appTitle={fileData?.title ?? workspace?.title ?? null}
//           />
//         </div>
//         <div className="h-px shrink-0 bg-white/6" />
//         <div className="flex-1 overflow-hidden">
//           <CodePanel
//             fileData={fileData}
//             isGenerating={isGenerating}
//             statusLog={statusLog}
//             onImprove={handleImprove}
//             onFixError={(error) =>
//               handleGenerate(
//                 `There is an error in the preview:\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease fix it.`
//               )
//             }
//             onFilePatch={handleFilePatch}
//             appTitle={fileData?.title ?? workspace?.title ?? null}
//             isImproving={isImproving}
//             isProUser={userPlan === "pro"}
//           />
//         </div>
//       </div>

//       {/* Desktop: normal side-by-side view */}
//       <div className="hidden md:flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[#0a0a0a]">
//         <ChatPanel
//           isImproving={isImproving}
//           messages={messages}
//           isGenerating={isGenerating}
//           statusLog={statusLog}
//           credits={credits}
//           initialPrompt={initialPrompt}
//           onGenerate={handleGenerate}
//           onStop={handleStop}
//           userId={userId}
//           workspaceId={workspaceId}
//           appTitle={fileData?.title ?? workspace?.title ?? null}
//         />
//         <div className="w-px shrink-0 bg-white/6" />
//         <CodePanel
//           fileData={fileData}
//           isGenerating={isGenerating}
//           statusLog={statusLog}
//           onImprove={handleImprove}
//           onFixError={(error) =>
//             handleGenerate(
//               `There is an error in the preview:\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease fix it.`
//             )
//           }
//           onFilePatch={handleFilePatch}
//           appTitle={fileData?.title ?? workspace?.title ?? null}
//           isImproving={isImproving}
//           isProUser={userPlan === "pro"}
//         />
//       </div>
//     </>
//   );
// }