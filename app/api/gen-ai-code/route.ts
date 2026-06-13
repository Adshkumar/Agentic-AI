// import { auth } from "@clerk/nextjs/server";
// import { NextRequest } from "next/server";
// import { GoogleGenAI } from "@google/genai";
// import { db } from "@/lib/prisma";
// import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
// import type { Message, FileData } from "@/types/workspace";
// import { aj } from "@/lib/arcjet";

// console.log("GEMINI:", process.env.GEMINI_API_KEY);
// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
// // ─── SSE helper ───────────────────────────────────────────────────────────────

// function sseEvent(type: string, payload: unknown): string {
//   return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
// }

// // ─── Extract short label from a Gemini thought chunk ─────────────────────────
// // Gemini thoughts often start with a bold heading like **Verify Config**
// // We extract that. If no bold heading, take the first sentence only.

// function extractThoughtLabel(text: string): string | null {
//   // Try to grab **bold heading** at the start
//   const boldMatch = text.match(/\*\*([^*]{4,60})\*\*/);
//   if (boldMatch) return boldMatch[1].trim();

//   // Fall back to first sentence (up to first . or \n), capped at 60 chars
//   const sentence = text.split(/[.\n]/)[0].trim();
//   if (sentence.length >= 8 && sentence.length <= 80) return sentence;

//   return null;
// }

// // ─── npm validation ───────────────────────────────────────────────────────────

// async function validateDependencies(
//   deps: Record<string, string>
// ): Promise<Record<string, string>> {
//   const valid: Record<string, string> = {};
//   await Promise.all(
//     Object.entries(deps).map(async ([pkg, version]) => {
//       try {
//         const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
//           signal: AbortSignal.timeout(1500),
//         });
//         if (res.ok) valid[pkg] = version;
//       } catch {
//         // silently skip hallucinated packages
//       }
//     })
//   );
//   return valid;
// }

// // ─── History trimming ─────────────────────────────────────────────────────────

// function trimHistory(messages: Message[]): Message[] {
//   if (messages.length <= 10) return messages;
//   return [messages[0], ...messages.slice(-8)];
// }

// // ─── System prompt ────────────────────────────────────────────────────────────

// const SYSTEM_PROMPT = `You are an expert React developer. Your job is to generate complete, working React applications based on user prompts.

// RULES:
// 1. Always respond with a valid JSON object — no markdown fences, no extra text.
// 2. The JSON must match this exact shape:
// {
//   "assistantMessage": "<brief explanation of what you built/changed>",
//   "title": "<short 2-4 word title for the app, e.g. 'Todo List App'>",
//   "files": {
//     "/App.js": { "code": "<full file content>" },
//     "/components/SomeComponent.js": { "code": "<full file content>" }
//   },
//   "dependencies": {
//     "some-package": "latest"
//   }
// }
// 3. Use React (functional components + hooks). Do NOT use TypeScript in generated files.
// 4. Use Tailwind CSS for all styling. Do not use CSS modules or inline styles unless absolutely necessary.
// 5. The entry point must always be /App.js and must export a default component.
// 6. All imports must reference files you include in "files" or packages in "dependencies".
// 7. Do not include react, react-dom, or tailwindcss in "dependencies" — they are always available.
// 8. When modifying existing code, include ALL files (both changed and unchanged) in "files".
// 9. Keep code clean, readable, and production-quality.
// 10. If the user attaches an image, use it as a design reference and match the layout/style as closely as possible.`;

// // ─── Gemini contents builder ──────────────────────────────────────────────────

// function buildContents(messages: Message[], fileData: FileData | null) {
//   const trimmed = trimHistory(messages);

//   return trimmed.map((msg, idx) => {
//     const role = msg.role === "assistant" ? "model" : "user";

//     if (msg.role === "user") {
//       const parts: object[] = [];

//       let text = msg.content;

//       if (msg.imageUrl) {
//         text = `[The user has attached an image. Use this URL directly in the generated app where relevant (as img src, background-image, etc.): ${msg.imageUrl}]\n\n${text}`;
//       }

//       const isLast = idx === trimmed.length - 1;
//       if (isLast && fileData) {
//         text +=
//           "\n\nCurrent project files for context:\n" +
//           JSON.stringify(fileData, null, 2);
//       }

//       parts.push({ text });
//       return { role, parts };
//     }

//     return { role, parts: [{ text: msg.content }] };
//   });
// }

// // ─── Route ────────────────────────────────────────────────────────────────────

// export async function POST(request: NextRequest) {
//   const { userId: clerkId } = await auth();
//   if (!clerkId) {
//     return Response.json({ message: "Unauthorized" }, { status: 401 });
//   }

//   const body = await request.json();
//   const { workspaceId, userId, messages, fileData } = body as {
//     workspaceId: string | null;
//     userId: string;
//     messages: Message[];
//     fileData: FileData | null;
//   };

//   if (!messages?.length) {
//     return Response.json({ message: "No messages provided" }, { status: 400 });
//   }

//   // ── Arcjet: rate limit, prompt injection, sensitive info ──────────────────
//   // detectPromptInjectionMessage requires the actual user text to inspect.

//   // const arcjetReq = new Request(request.url, {
//   //   method: request.method,
//   //   headers: request.headers,
//   //   body: JSON.stringify(body),
//   // });

//   // const lastUserMessage =
//   //   [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
//   // const decision = await aj.protect(arcjetReq, {
//   //   requested: 1,
//   //   userId: clerkId,
//   //   detectPromptInjectionMessage: lastUserMessage,
//   // });

//   // if (decision.isDenied()) {
//   //   return Response.json(
//   //     { message: decision.reason?.type ?? "Request blocked" },
//   //     { status: 429 }
//   //   );
//   // }

//   const user = await db.user.findUnique({
//     where: { id: userId, clerkId },
//     select: { id: true, credits: true },
//   });

//   if (!user)
//     return Response.json({ message: "User not found" }, { status: 404 });
//   if (user.credits < CREDIT_COST_PER_GENERATION) {
//     return Response.json({ message: "Insufficient credits" }, { status: 402 });
//   }

//   const encoder = new TextEncoder();

//   const stream = new ReadableStream({
//     async start(controller) {
//       const enqueue = (chunk: string) => {
//         try {
//           controller.enqueue(encoder.encode(chunk));
//         } catch (err) {
//           console.error("Stream already closed", err);
//         }
//       };

//       try {
//         const contents = buildContents(messages, fileData);

//         enqueue(sseEvent("status", { message: "Connecting to AI…" }));

//         let geminiStream;
//         try {
//           geminiStream = await ai.models.generateContentStream({
//             model: "gemini-3.5-flash",
//             contents,
//             config: {
//               systemInstruction: SYSTEM_PROMPT,
//               temperature: 0.7,
//               responseMimeType: "application/json",
//             },
//           });
//         } catch (apiErr) {
//           console.error("[gen-ai-code] Gemini API error:", apiErr);
//           const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
//           enqueue(
//             sseEvent("error", {
//               message: `AI model error: ${errMsg}`,
//             })
//           );
//           controller.close();
//           return;
//         }

//         enqueue(sseEvent("status", { message: "Generating code…" }));

//         let accumulated = ""; // final JSON output
//         let chunkCount = 0;
//         let lastHeartbeatTime = Date.now();

//         for await (const chunk of geminiStream) {
//           const parts = chunk.candidates?.[0]?.content?.parts ?? [];

//           for (const part of parts) {
//             if (!part.text) continue;

//             // Accumulate all text into final JSON output
//             accumulated += part.text;
//             chunkCount++;
//           }

//           const now = Date.now();
//           if (now - lastHeartbeatTime > 3000) {
//             lastHeartbeatTime = now;
//             const sizeKB = (accumulated.length / 1024).toFixed(1);
//             enqueue(
//               sseEvent("progress", {
//                 message: `Generating code (${sizeKB} KB)…`,
//               })
//             );
//           }
//         }

//         console.log(`[gen-ai-code] Received ${chunkCount} chunks, ${accumulated.length} chars`);

//         if (!accumulated.trim()) {
//           console.error("[gen-ai-code] Empty response from Gemini");
//           enqueue(
//             sseEvent("error", {
//               message: "AI returned an empty response. Please try again with a simpler prompt.",
//             })
//           );
//           controller.close();
//           return;
//         }

//         // ── Parse the complete JSON response ──────────────────────────────────

//         enqueue(sseEvent("status", { message: "Processing response…" }));

//         let parsed: {
//           assistantMessage: string;
//           title?: string;
//           files: Record<string, { code: string }>;
//           dependencies: Record<string, string>;
//         };

//         try {
//           parsed = JSON.parse(accumulated);
//         } catch {
//           console.error("[gen-ai-code] Invalid JSON response:", accumulated.slice(0, 500));
//           enqueue(
//             sseEvent("error", {
//               message: "AI returned invalid JSON. Please try again.",
//             })
//           );
//           controller.close();
//           return;
//         }

//         const {
//           assistantMessage,
//           title: aiTitle,
//           files,
//           dependencies,
//         } = parsed;

//         if (!files || typeof files !== "object") {
//           enqueue(
//             sseEvent("error", {
//               message: "AI response missing files. Please try again.",
//             })
//           );
//           controller.close();
//           return;
//         }

//         // ── Validate npm packages ──────────────────────────────────────────────

//         enqueue(sseEvent("status", { message: "Validating packages…" }));
//         const validatedDeps = await validateDependencies(dependencies ?? {});
//         const newFileData: FileData = {
//           files,
//           dependencies: validatedDeps,
//           title: aiTitle,
//         };

//         // ── Upsert workspace + deduct credit (single transaction) ──────────────

//         enqueue(sseEvent("status", { message: "Saving…" }));

//         const lastUserMessage = messages[messages.length - 1];
//         const updatedMessages: Message[] = [
//           ...messages,
//           { role: "assistant", content: assistantMessage },
//         ];

//         const [workspace] = await db.$transaction([
//           workspaceId
//             ? db.workspace.update({
//               where: { id: workspaceId, userId },
//               data: {
//                 messages: updatedMessages as never,
//                 fileData: newFileData as never,
//               },
//             })
//             : db.workspace.create({
//               data: {
//                 userId,
//                 title: aiTitle ?? lastUserMessage.content.slice(0, 80),
//                 messages: updatedMessages as never,
//                 fileData: newFileData as never,
//               },
//             }),
//           db.user.update({
//             where: { id: userId },
//             data: { credits: { decrement: CREDIT_COST_PER_GENERATION } },
//           }),
//         ]);

//         const updatedUser = await db.user.findUnique({
//           where: { id: userId },
//           select: { credits: true },
//         });

//         // ── Emit final result ──────────────────────────────────────────────────

//         enqueue(
//           sseEvent("done", {
//             workspaceId: workspace.id,
//             assistantMessage,
//             fileData: newFileData,
//             creditsRemaining:
//               updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
//           })
//         );
//       } catch (err) {
//         console.error("[gen-ai-code] stream error:", err);
//         const errMsg = err instanceof Error ? err.message : "Something went wrong.";
//         enqueue(
//           sseEvent("error", {
//             message: `Generation failed: ${errMsg}`,
//           })
//         );
//       } finally {
//         controller.close();
//       }
//     },
//   });

//   return new Response(stream, {
//     headers: {
//       "Content-Type": "text/event-stream",
//       "Cache-Control": "no-cache",
//       Connection: "keep-alive",
//     },
//   });
// }

// export const runtime = "nodejs";
// export const maxDuration = 300; // for vercel - 300s on Fluid








import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { db } from "@/lib/prisma";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";

function sseEvent(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
}

async function validateDependencies(
  deps: Record<string, string>
): Promise<Record<string, string>> {
  const valid: Record<string, string> = {};
  await Promise.all(
    Object.entries(deps).map(async ([pkg, version]) => {
      try {
        const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) valid[pkg] = version;
      } catch {
      }
    })
  );
  return valid;
}

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}
function cleanJsonResponse(raw: string): string {
  let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  return cleaned.trim();
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert React developer. Generate complete React apps based on user prompts.

CRITICAL: Respond with ONLY valid JSON. NO markdown fences. NO extra text.

JSON shape:
{
  "assistantMessage": "<brief explanation>",
  "title": "<short title>",
  "files": {
    "/App.js": { "code": "<full file content>" }
  },
  "dependencies": {}
}

Rules:
- Use React functional components + hooks
- Use Tailwind CSS for styling
- Entry point must be /App.js with default export
- Do NOT include react, react-dom, or tailwindcss in dependencies
- Keep code concise (max 150 lines total)
- Escape quotes inside strings with backslashes`;

// ─── Build Gemini API contents ────────────────────────────────────────────────
function buildGeminiContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  const contents = [];

  contents.push({
    role: "user",
    parts: [{ text: SYSTEM_PROMPT }]
  });

  contents.push({
    role: "model",
    parts: [{ text: "I understand. I will respond with only valid JSON matching the required schema." }]
  });

  for (const msg of trimmed) {
    const role = msg.role === "assistant" ? "model" : "user";
    let text = msg.content;

    if (msg.role === "user" && msg.imageUrl) {
      text = `[User attached image: ${msg.imageUrl}]\n\n${text}`;
    }

    contents.push({ role, parts: [{ text }] });
  }

  if (fileData && trimmed.length > 0) {
    const lastIndex = contents.length - 1;
    if (contents[lastIndex] && contents[lastIndex].role === "user") {
      contents[lastIndex].parts[0].text += `\n\nCurrent project files:\n${JSON.stringify(fileData, null, 2)}`;
    }
  }

  return contents;
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, userId, messages, fileData } = body as {
    workspaceId: string | null;
    userId: string;
    messages: Message[];
    fileData: FileData | null;
  };

  if (!messages?.length) {
    return Response.json({ message: "No messages provided" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: userId, clerkId },
    select: { id: true, credits: true },
  });

  if (!user) return Response.json({ message: "User not found" }, { status: 404 });
  if (user.credits < CREDIT_COST_PER_GENERATION) {
    return Response.json({ message: "Insufficient credits" }, { status: 402 });
  }

  const encoder = new TextEncoder();
  let isStreamClosed = false;
  let streamController: ReadableStreamDefaultController<any> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
    cancel() {
      isStreamClosed = true;
      streamController = null;
    },
  });

  const safeEnqueue = (chunk: string) => {
    if (isStreamClosed || !streamController) return false;
    try {
      streamController.enqueue(encoder.encode(chunk));
      return true;
    } catch (err) {
      isStreamClosed = true;
      streamController = null;
      return false;
    }
  };

  const safeClose = () => {
    if (isStreamClosed || !streamController) return;
    try {
      streamController.close();
      isStreamClosed = true;
      streamController = null;
    } catch (err) {
      console.error("[gen-ai-code] Error closing stream:", err);
    }
  };

  (async () => {
    const timeoutId = setTimeout(() => {
      if (!isStreamClosed) {
        safeEnqueue(sseEvent("error", { message: "Request timeout. Please try again." }));
        safeClose();
      }
    }, 55000);

    try {
      safeEnqueue(sseEvent("status", { message: "Connecting to AI…" }));

      const contents = buildGeminiContents(messages, fileData);
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not configured");
      }

      // Use REST API directly
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.2,
              topP: 0.95,
              topK: 40,
              maxOutputTokens: 4096,
            },
          }),
          signal: AbortSignal.timeout(50000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[gen-ai-code] API error:", errorText);
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();

      let generatedText = "";
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        generatedText = data.candidates[0].content.parts[0].text;
      } else {
        throw new Error("No text in Gemini response");
      }

      console.log(`[gen-ai-code] Received response, length: ${generatedText.length}`);

      if (!generatedText.trim()) {
        safeEnqueue(sseEvent("error", { message: "AI returned empty response" }));
        safeClose();
        return;
      }

      safeEnqueue(sseEvent("status", { message: "Processing response…" }));

      const cleanedJson = cleanJsonResponse(generatedText);
      let parsed: any = null;

      try {
        parsed = JSON.parse(cleanedJson);
      } catch (parseErr) {
        console.error("[gen-ai-code] Invalid JSON:", cleanedJson.slice(0, 500));
        safeEnqueue(sseEvent("error", { message: "Invalid AI response format. Please try again." }));
        safeClose();
        return;
      }

      if (!parsed || !parsed.files || Object.keys(parsed.files).length === 0) {
        safeEnqueue(sseEvent("error", { message: "AI response missing valid files" }));
        safeClose();
        return;
      }

      const { assistantMessage, title: aiTitle, files, dependencies = {} } = parsed;

      safeEnqueue(sseEvent("status", { message: "Validating packages…" }));
      const validatedDeps = await validateDependencies(dependencies);
      const newFileData: FileData = {
        files,
        dependencies: validatedDeps,
        title: aiTitle,
      };

      safeEnqueue(sseEvent("status", { message: "Saving…" }));

      const lastUserMessage = messages[messages.length - 1];
      const updatedMessages: Message[] = [
        ...messages,
        { role: "assistant", content: assistantMessage },
      ];

      const [workspace] = await db.$transaction([
        workspaceId
          ? db.workspace.update({
            where: { id: workspaceId, userId },
            data: {
              messages: updatedMessages as never,
              fileData: newFileData as never,
            },
          })
          : db.workspace.create({
            data: {
              userId,
              title: aiTitle ?? lastUserMessage.content.slice(0, 80),
              messages: updatedMessages as never,
              fileData: newFileData as never,
            },
          }),
        db.user.update({
          where: { id: userId },
          data: { credits: { decrement: CREDIT_COST_PER_GENERATION } },
        }),
      ]);

      const updatedUser = await db.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });

      if (!isStreamClosed) {
        safeEnqueue(
          sseEvent("done", {
            workspaceId: workspace.id,
            assistantMessage,
            fileData: newFileData,
            creditsRemaining: updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
          })
        );
      }
    } catch (err) {
      console.error("[gen-ai-code] error:", err);
      const errMsg = err instanceof Error ? err.message : "Something went wrong.";
      if (!isStreamClosed) {
        safeEnqueue(sseEvent("error", { message: `Generation failed: ${errMsg}` }));
      }
    } finally {
      clearTimeout(timeoutId);
      safeClose();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const runtime = "nodejs";
export const maxDuration = 60;