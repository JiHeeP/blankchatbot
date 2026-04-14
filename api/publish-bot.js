import { HttpError, processPublishRequest } from "../lib/chat-service.js";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    const result = await processPublishRequest(body, {
      userAgent: request.headers.get("user-agent") || "",
      remoteAddress:
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip") ||
        "",
      baseUrl: url.origin,
    });

    return Response.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "챗봇 링크를 발행하지 못했습니다.";

    return Response.json({ error: message }, { status });
  }
}
