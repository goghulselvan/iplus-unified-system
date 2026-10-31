import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { uploadWithProgress } from "../uploadWithProgress";

class FakeXHR {
  static last: FakeXHR | null = null;
  static count = 0;
  upload: { onprogress: ((e: any) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sent: unknown = null;
  aborted = false;
  constructor() { FakeXHR.last = this; FakeXHR.count++; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  throwOnSend = false;
  send(b: unknown) { if (FakeXHR.throwOnSend) throw new Error("boom"); this.sent = b; }
  static throwOnSend = false;
  abort() { this.aborted = true; this.onabort?.(); }
  progress(loaded: number, total = 100) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
}

const file = (name: string, size = 10) => {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("uploadWithProgress", () => {
  const presign = vi.fn();
  beforeEach(() => {
    FakeXHR.last = null; FakeXHR.count = 0; FakeXHR.throwOnSend = false;
    presign.mockReset();
    presign.mockResolvedValue({ data: { url: "https://r2.example/put", expiresIn: 900 }, error: null });
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports 25/50/100 and sends signed Content-Type", async () => {
    const seen: number[] = [];
    const p = uploadWithProgress(file("a.pdf"), "k/papers/1.pdf", (n) => seen.push(n), undefined, ["pdf"], { presign });
    await flush();
    const x = FakeXHR.last!;
    expect(presign).toHaveBeenCalledWith({ action: "upload", key: "k/papers/1.pdf", contentType: "application/pdf" });
    expect(x.method).toBe("PUT");
    expect(x.headers["Content-Type"]).toBe("application/pdf");
    x.progress(25); x.progress(50); x.progress(40); x.progress(100);
    x.onload!();
    await p;
    expect(seen.filter((n, i) => i === 0 || n !== seen[i - 1])).toEqual([25, 50, 100]);
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("calls onProgress(100) on success even without a final event", async () => {
    const seen: number[] = [];
    const p = uploadWithProgress(file("a.pdf"), "k", (n) => seen.push(n), undefined, ["pdf"], { presign });
    await flush();
    FakeXHR.last!.progress(30);
    FakeXHR.last!.onload!();
    await p;
    expect(seen).toEqual([30, 100]);
  });

  it("maps abort to Upload cancelled", async () => {
    const ac = new AbortController();
    const p = uploadWithProgress(file("a.pdf"), "k", () => {}, ac.signal, ["pdf"], { presign });
    await flush();
    ac.abort();
    await expect(p).rejects.toThrow("Upload cancelled");
    expect(FakeXHR.last!.aborted).toBe(true);
  });

  it("rejects as cancelled if already aborted, with no request", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, ac.signal, ["pdf"], { presign })).rejects.toThrow("Upload cancelled");
    expect(presign).not.toHaveBeenCalled();
  });

  it("rejects a 51 MB file before any request", async () => {
    await expect(uploadWithProgress(file("a.pdf", 51 * 1024 * 1024), "k", () => {}, undefined, ["pdf"], { presign }))
      .rejects.toThrow("The file is larger than 50 MB");
    expect(presign).not.toHaveBeenCalled();
    expect(FakeXHR.count).toBe(0);
  });

  it("accepts exactly 50 MB", async () => {
    const p = uploadWithProgress(file("a.pdf", 50 * 1024 * 1024), "k", () => {}, undefined, ["pdf"], { presign });
    await flush();
    FakeXHR.last!.onload!();
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects a .docx", async () => {
    await expect(uploadWithProgress(file("a.docx"), "k", () => {}, undefined, ["pdf"], { presign }))
      .rejects.toThrow("Only PDF files can be uploaded here");
    expect(presign).not.toHaveBeenCalled();
  });

  it("derives type from extension for csv and zip, ignoring file.type", async () => {
    const f = new File(["x"], "r.CSV", { type: "application/vnd.ms-excel" });
    const p = uploadWithProgress(f, "k", () => {}, undefined, ["csv"], { presign });
    await flush();
    expect(presign).toHaveBeenCalledWith({ action: "upload", key: "k", contentType: "text/csv" });
    expect(FakeXHR.last!.headers["Content-Type"]).toBe("text/csv");
    FakeXHR.last!.onload!();
    await p;
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, undefined, ["csv"], { presign }))
      .rejects.toThrow("Only CSV files can be uploaded here");
    await expect(uploadWithProgress(file("a.csv"), "k", () => {}, undefined, ["pdf", "zip"], { presign }))
      .rejects.toThrow("Only PDF or ZIP files can be uploaded here");
  });

  it("maps a 500 response to Upload failed", async () => {
    const p = uploadWithProgress(file("a.pdf"), "k", () => {}, undefined, ["pdf"], { presign });
    await flush();
    FakeXHR.last!.status = 500;
    FakeXHR.last!.onload!();
    await expect(p).rejects.toThrow("Upload failed — check the internet connection and try again");
  });

  it("maps a network error to Upload failed", async () => {
    const p = uploadWithProgress(file("a.pdf"), "k", () => {}, undefined, ["pdf"], { presign });
    await flush();
    FakeXHR.last!.onerror!();
    await expect(p).rejects.toThrow("Upload failed — check the internet connection and try again");
  });

  it("surfaces a plain-English presign message from data.error", async () => {
    presign.mockResolvedValue({ data: { error: "You don't have permission to manage results files." }, error: null });
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, undefined, ["pdf"], { presign }))
      .rejects.toThrow("You don't have permission to manage results files.");
  });

  it("uses generic message for a transport error from invoke", async () => {
    presign.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code" } });
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, undefined, ["pdf"], { presign }))
      .rejects.toThrow("Upload failed — check the internet connection and try again");
  });

  it("uses generic message when no url is returned", async () => {
    presign.mockResolvedValue({ data: {}, error: null });
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, undefined, ["pdf"], { presign }))
      .rejects.toThrow("Upload failed");
  });

  it("maps a rejected presign call to Upload failed (no raw text)", async () => {
    presign.mockRejectedValue(new Error("TypeError: Failed to fetch"));
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, undefined, ["pdf"], { presign }))
      .rejects.toThrow("Upload failed — check the internet connection and try again");
  });

  it("maps a rejected presign to Upload cancelled when aborted", async () => {
    const ac = new AbortController();
    presign.mockImplementation(async () => { ac.abort(); throw new Error("net"); });
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, ac.signal, ["pdf"], { presign }))
      .rejects.toThrow("Upload cancelled");
  });

  it("maps a synchronous xhr.send throw to Upload failed and removes the abort listener", async () => {
    FakeXHR.throwOnSend = true;
    const ac = new AbortController();
    const remove = vi.spyOn(ac.signal, "removeEventListener");
    await expect(uploadWithProgress(file("a.pdf"), "k", () => {}, ac.signal, ["pdf"], { presign }))
      .rejects.toThrow("Upload failed — check the internet connection and try again");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("caps progress at 99 until onload, then reports 100", async () => {
    const seen: number[] = [];
    const p = uploadWithProgress(file("a.pdf"), "k", (n) => seen.push(n), undefined, ["pdf"], { presign });
    await flush();
    FakeXHR.last!.progress(100, 100);
    expect(seen).toEqual([99]);
    FakeXHR.last!.onload!();
    await p;
    expect(seen).toEqual([99, 100]);
  });
});
