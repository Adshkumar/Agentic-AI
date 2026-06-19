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