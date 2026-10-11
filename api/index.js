// Vercel 함수 하나로 /api/* 전부를 처리한다 (vercel.json 의 rewrites 참고).
import { route } from '../lib/router.js';

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
