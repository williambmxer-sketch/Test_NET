/// <reference types="@cloudflare/workers-types" />
/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

// Pre-allocate a 25MB buffer globally to avoid RAM exhaustion on high-speed concurrent tests
const DOWNLOAD_BUFFER = new Uint8Array(25_000_000);

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ping") {
      return new Response("pong", { headers: { "cache-control": "no-store", "server-timing": "edge;dur=0" } });
    }

    if (url.pathname === "/api/download") {
      const size = Math.min(Number(url.searchParams.get("bytes")) || 4_000_000, 25_000_000);
      const data = size === 25_000_000 ? DOWNLOAD_BUFFER : DOWNLOAD_BUFFER.subarray(0, size);
      return new Response(data, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store, no-transform", "content-length": String(size) } });
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      let received = 0;
      if (request.body) {
        const reader = request.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) received += value.byteLength;
        }
      }
      return Response.json({ received }, { headers: { "cache-control": "no-store, no-transform" } });
    }

    if (url.pathname === "/api/info") {
      const cf = (request as Request & { cf?: Record<string, unknown> }).cf || {};
      const ip = request.headers.get("cf-connecting-ip") || "Local";
      return Response.json({
        ip,
        provider: cf.asOrganization || (cf.asn ? `AS${cf.asn}` : "Conexão local"),
        city: cf.city,
        region: cf.region,
        country: cf.country,
        colo: cf.colo,
      }, { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
