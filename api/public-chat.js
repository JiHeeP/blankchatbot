import { HttpError, processPublicChatRequest } from "../lib/chat-service.js";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await processPublicChatRequest(body, {
      userAgent: request.headers.get("user-agent") || "",
      remoteAddress:
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip") ||
        "",
    });

    return Response.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "공개 챗봇 응답을 처리하지 못했습니다.";

    return Response.json({ error: message }, { status });
  }
}
