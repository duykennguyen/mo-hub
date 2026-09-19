// Xác nhận duyệt/từ chối người dùng. Được gọi bằng nút bấm trên trang duyet.html
// (không duyệt khi chỉ mở link — tránh việc Gmail tự quét link rồi duyệt nhầm).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const env = (k: string) => Deno.env.get(k) ?? "";
const ROLES = ["staff", "manager", "viewer", "reject"];

async function sign(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env("APPROVE_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Sai phương thức" }, 405);

  const { u, r, e, s } = await req.json().catch(() => ({}));
  if (!u || !ROLES.includes(r) || !e || !s) return json({ error: "Link không hợp lệ" }, 400);
  if (Date.now() > Number(e)) return json({ error: "Link đã hết hạn (quá 7 ngày). Duyệt trong mục Thành viên của Mô Hub." }, 400);
  if ((await sign(`${u}.${r}.${e}`)) !== s) return json({ error: "Chữ ký link không đúng" }, 400);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const patch = r === "reject" ? { status: "rejected" } : { status: "approved", role: r };
  const { data, error } = await db.from("profiles").update(patch).eq("id", u).select("email, full_name").single();
  if (error || !data) return json({ error: "Không tìm thấy người dùng" }, 404);
  return json({ ok: true, email: data.email, name: data.full_name, role: r });
});
