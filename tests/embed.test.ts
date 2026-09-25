import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMBED_ENV, EMBED_SIZE, embedImages, embedWarning } from "../src/cli/embed.js";

const URL_A = "https://example.test/garments/a.png";
const URL_B = "https://example.test/garments/b.png";

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#373231" } }).png().toBuffer();
}

/** A fetch double serving PNGs by URL, counting requests. */
function fakeFetch(images: Record<string, Buffer>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = images[url];
    return body ? new Response(new Uint8Array(body), { status: 200 }) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

const card = (...urls: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg">${urls
    .map((u) => `<image href="${u}" x="0" y="0" width="200" height="200"/>`)
    .join("")}</svg>`;

describe("embedImages", () => {
  afterEach(() => {
    delete process.env[EMBED_ENV];
  });

  it("inlines each remote photo as a downscaled JPEG data URI, fetching each URL once", async () => {
    const { impl, calls } = fakeFetch({ [URL_A]: await png(1600, 1200), [URL_B]: await png(300, 300) });
    const result = await embedImages(card(URL_A, URL_B, URL_A), { fetch: impl });
    expect(result.notEmbedded).toEqual([]);
    expect(embedWarning(result)).toBeUndefined();
    const out = result.markup;
    expect(out).not.toContain("https://");
    const uris = [...out.matchAll(/href="data:image\/jpeg;base64,([^"]+)"/g)].map((m) => m[1]!);
    expect(uris).toHaveLength(3);
    expect(calls.sort()).toEqual([URL_A, URL_B]);

    const big = await sharp(Buffer.from(uris[0]!, "base64")).metadata();
    expect(big.format).toBe("jpeg");
    expect(Math.max(big.width!, big.height!)).toBe(EMBED_SIZE);
    const small = await sharp(Buffer.from(uris[1]!, "base64")).metadata();
    expect(small.width).toBe(300);
  });

  it("keeps the URL when a photo cannot be fetched or decoded, and says why", async () => {
    const { impl } = fakeFetch({ [URL_B]: Buffer.from("not an image") });
    const markup = card(URL_A, URL_B);
    const result = await embedImages(markup, { fetch: impl });
    expect(result.markup).toBe(markup);
    expect(result.notEmbedded.map((n) => n.url)).toEqual([URL_A, URL_B]);
    expect(result.notEmbedded[0]!.reason).toBe("fetching the photo returned HTTP 404");
    expect(result.notEmbedded[1]!.reason).toMatch(/could not be fetched or decoded/);
    expect(embedWarning(result)).toMatch(/^2 garment photos could not be embedded \(.*HTTP 404.*\).*broken-image icon\.$/);

    const throwing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const offline = await embedImages(card(URL_A), { fetch: throwing });
    expect(offline.markup).toBe(card(URL_A));
    expect(embedWarning(offline)).toMatch(/^1 garment photo could not be embedded \(.*offline.*\), so the card links it by URL/);
  });

  it("says sharp is missing when it cannot be loaded", async () => {
    vi.resetModules();
    vi.doMock("sharp", () => {
      throw new Error("Cannot find package 'sharp'");
    });
    try {
      const fresh = await import("../src/cli/embed.js");
      const { impl, calls } = fakeFetch({ [URL_A]: await png(10, 10) });
      const result = await fresh.embedImages(card(URL_A), { fetch: impl });
      expect(result.markup).toBe(card(URL_A));
      expect(result.notEmbedded[0]!.reason).toMatch(/^sharp is not installed/);
      expect(calls).toEqual([]);
    } finally {
      vi.doUnmock("sharp");
      vi.resetModules();
    }
  });

  it("leaves markup without remote photos alone, and skips embedding when turned off", async () => {
    const { impl, calls } = fakeFetch({ [URL_A]: await png(10, 10) });
    const plain = '<svg><rect width="1" height="1"/></svg>';
    expect(await embedImages(plain, { fetch: impl })).toEqual({ markup: plain, notEmbedded: [] });

    process.env[EMBED_ENV] = "0";
    const off = await embedImages(card(URL_A), { fetch: impl });
    expect(off.markup).toBe(card(URL_A));
    expect(off.notEmbedded).toEqual([{ url: URL_A, reason: `${EMBED_ENV}=0` }]);
    expect(calls).toEqual([]);
  });
});
