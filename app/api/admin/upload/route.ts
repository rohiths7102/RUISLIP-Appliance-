import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";

/**
 * Product image upload. Writes into public/uploads/ and returns the public path,
 * which the caller stores as the product's mainImage.
 *
 * NOTE: a local disk works here (and on any VM/dedicated host). On serverless
 * hosting, swap this for object storage (S3 / Supabase Storage / Vercel Blob) —
 * the route is deliberately the only place that knows where bytes land.
 */
const MAX_BYTES = 8 * 1024 * 1024;

// Allow-list by real MIME + extension. Never trust the client-supplied filename:
// it can contain "../" and traverse out of the uploads directory.
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 }); }

  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: `Unsupported type "${file.type}". Use JPG, PNG, WebP, AVIF or GIF.` }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `Image is ${(file.size / 1e6).toFixed(1)}MB — the limit is 8MB.` }, { status: 413 });
  if (file.size === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());

  // Verify the magic bytes match the declared type — a .exe renamed to .png is
  // still an .exe, and we're writing this into a public directory.
  if (!sniff(bytes, ext)) return NextResponse.json({ error: "That file isn't a valid image." }, { status: 415 });

  // Generated name: no user-controlled path segments at all.
  const name = `${randomUUID()}.${ext}`;
  const dir = join(process.cwd(), "public", "uploads");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
  } catch (e) {
    console.error("upload write failed", e);
    return NextResponse.json({ error: "Could not save the image." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, url: `/uploads/${name}`, bytes: file.size });
}

/** Magic-number check for the formats we accept. */
function sniff(b: Buffer, ext: string): boolean {
  if (b.length < 12) return false;
  switch (ext) {
    case "jpg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "png": return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case "gif": return b.subarray(0, 3).toString("ascii") === "GIF";
    case "webp": return b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
    case "avif": return b.subarray(4, 8).toString("ascii") === "ftyp";
    default: return false;
  }
}
