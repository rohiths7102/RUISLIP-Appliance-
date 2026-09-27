/**
 * Browser side of Admin photo uploads (Products editor + Quick add).
 *
 * Vercel refuses any request body over 4.5 MB before our route runs, and a
 * phone photo is often 3–12 MB, so large photos never arrived (Sachin, Sept
 * 2026). Anything over ~3.5 MB, or in a format the route won't take, is redrawn
 * here at up to 2000 px as a JPEG (typically 300–900 KB) before it is sent.
 * iPhone HEIC photos decode only where the browser can (Safari); elsewhere the
 * owner gets told exactly how to get a JPG instead of a vague failure.
 */
const SENDABLE = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];

async function prepare(file: File): Promise<File> {
  if (file.size <= 3_500_000 && SENDABLE.includes(file.type)) return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(/hei[cf]/i.test(`${file.type} ${file.name}`)
      ? "This is an iPhone HEIC photo, which this browser can't open. On the iPhone choose Settings → Camera → Formats → Most Compatible (or share the photo as a JPG), then upload it again."
      : "This file couldn't be read as a photo. Please use a JPG or PNG.");
  }
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // product shots sit on white; a transparent PNG must not turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't prepare the photo — please try another."))), "image/jpeg", 0.85));
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
}

/** Upload one photo; resolves to its public URL, or throws a message fit to show the owner. */
export async function uploadPhoto(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", await prepare(file));
  const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status === 413 ? "That photo is too large to upload — please try a smaller one." : "Upload failed — please try again."));
  return j.url as string;
}
