// 저장소: Upstash Redis(REST) 또는 메모리.
// - Vercel 에 Upstash 를 연결하면 KV_REST_API_URL/TOKEN (또는 UPSTASH_REDIS_REST_URL/TOKEN) 이 생긴다.
// - 없으면 메모리 저장소를 쓴다. 로컬 개발·테스트용이며, STORE_FILE 을 주면 파일에도 남긴다.
// 두 저장소 모두 같은 Redis 명령을 쓰고 같은 모양의 결과를 돌려준다.
//   cmd(['HSET', key, field, value])        → 결과 하나
//   pipeline([[...], [...]])                → 결과 목록 (읽기 묶음)
//   multi([[...], [...]])                   → 결과 목록 (한꺼번에 적용되는 쓰기 묶음)

import fs from 'node:fs';
import path from 'node:path';

class UpstashStore {
  constructor(url, token, fetchImpl = globalThis.fetch) {
    this.kind = 'upstash';
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  async post(pathPart, body) {
    const res = await this.fetch(`${this.url}${pathPart}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Upstash 오류 (HTTP ${res.status}) ${data?.error || ''}`.trim());
    return data;
  }

  static unwrap(item) {
    if (item && item.error) throw new Error(`Upstash 명령 오류: ${item.error}`);
    return item?.result ?? null;
  }

  async cmd(args) {
    return UpstashStore.unwrap(await this.post('', args.map(String)));
  }

  async pipeline(cmds) {
    if (!cmds.length) return [];
    const res = await this.post('/pipeline', cmds.map((c) => c.map(String)));
    return res.map(UpstashStore.unwrap);
  }

  async multi(cmds) {
    if (!cmds.length) return [];
    const res = await this.post('/multi-exec', cmds.map((c) => c.map(String)));
    return res.map(UpstashStore.unwrap);
  }
}

class MemoryStore {
  constructor(file) {
    this.kind = 'memory';
    this.file = file || null;
    this.data = new Map(); // key → { type: 'string' | 'hash', value, expires }
    if (this.file) this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw)) {
        this.data.set(k, v.type === 'hash' ? { ...v, value: new Map(Object.entries(v.value)) } : v);
      }
    } catch {
      // 파일이 없으면 빈 저장소로 시작
    }
  }

  save() {
    if (!this.file) return;
    const out = {};
    for (const [k, v] of this.data) {
      out[k] = v.type === 'hash' ? { ...v, value: Object.fromEntries(v.value) } : v;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(out));
  }

  entry(key) {
    const e = this.data.get(key);
    if (e && e.expires && e.expires < Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  hash(key, create) {
    let e = this.entry(key);
    if (!e && create) {
      e = { type: 'hash', value: new Map() };
      this.data.set(key, e);
    }
    return e ? e.value : null;
  }

  run([name, ...a]) {
    const args = a.map(String);
    switch (String(name).toUpperCase()) {
      case 'GET': return this.entry(args[0])?.value ?? null;
      case 'SET': {
        const e = { type: 'string', value: args[1] };
        const ex = args.findIndex((x) => x.toUpperCase() === 'EX');
        if (ex > 1) e.expires = Date.now() + Number(args[ex + 1]) * 1000;
        this.data.set(args[0], e);
        return 'OK';
      }
      case 'DEL': return args.reduce((n, k) => n + (this.data.delete(k) ? 1 : 0), 0);
      case 'INCR': {
        const v = Number(this.entry(args[0])?.value ?? 0) + 1;
        this.data.set(args[0], { type: 'string', value: String(v) });
        return v;
      }
      case 'HGET': return this.hash(args[0])?.get(args[1]) ?? null;
      case 'HGETALL': {
        const h = this.hash(args[0]);
        return h ? [...h].flat() : [];
      }
      case 'HSET': {
        const h = this.hash(args[0], true);
        let added = 0;
        for (let i = 1; i < args.length; i += 2) {
          if (!h.has(args[i])) added++;
          h.set(args[i], args[i + 1]);
        }
        return added;
      }
      case 'HSETNX': {
        const h = this.hash(args[0], true);
        if (h.has(args[1])) return 0;
        h.set(args[1], args[2]);
        return 1;
      }
      case 'HDEL': {
        const h = this.hash(args[0]);
        if (!h) return 0;
        const n = args.slice(1).reduce((c, f) => c + (h.delete(f) ? 1 : 0), 0);
        if (h.size === 0) this.data.delete(args[0]);
        return n;
      }
      default: throw new Error(`메모리 저장소가 모르는 명령: ${name}`);
    }
  }

  async cmd(args) {
    const r = this.run(args);
    this.save();
    return r;
  }

  async pipeline(cmds) {
    return cmds.map((c) => this.run(c));
  }

  async multi(cmds) {
    const r = cmds.map((c) => this.run(c));
    this.save();
    return r;
  }
}

/** HGETALL 결과 [k, v, k, v] → { k: v } */
export function hashToObject(flat) {
  if (!flat) return {};
  if (!Array.isArray(flat)) return { ...flat };
  const out = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

let shared = null;

export function createStore(env = process.env, fetchImpl) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashStore(url, token, fetchImpl);
  return new MemoryStore(env.STORE_FILE);
}

export function getStore() {
  if (!shared) shared = createStore();
  return shared;
}

export function setStore(store) {
  shared = store;
}

export { MemoryStore, UpstashStore };
