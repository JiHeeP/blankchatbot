// 서버 API 호출

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || '요청을 처리하지 못했어요');
    this.status = status;
    this.code = body?.error || (status === 0 ? 'offline' : 'error');
    this.body = body || {};
  }
}

export async function api(method, path, body, { timeout = 15000 } = {}) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError(0, { error: 'offline', message: '인터넷에 연결되지 않았어요' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
