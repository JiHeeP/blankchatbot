import { HttpError, getPublishedBotResponse } from "../lib/chat-service.js";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const botId = url.searchParams.get("botId") || "";
    const result = await getPublishedBotResponse(botId);

    return Response.json(result, {
      headers: {
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "공개 챗봇 정보를 불러오지 못했습니다.";

    return Response.json({ error: message }, { status });
  }
}
