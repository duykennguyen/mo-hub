// Gửi thông báo "có người xin truy cập" về email admin (Resend) + Telegram.
// Gọi từ trang web sau khi người dùng đăng nhập mà chưa được duyệt.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const env = (k: string) => Deno.env.get(k) ?? "";

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

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return json({ error: "Chưa đăng nhập" }, 401);

  const { data: p } = await db.from("profiles").select("*").eq("id", user.id).single();
  if (!p || p.status !== "pending") return json({ ok: true, skipped: "không ở trạng thái chờ" });
  // Chống spam: mỗi người chỉ báo 1 lần / 6 giờ
  if (p.notified_at && Date.now() - new Date(p.notified_at).getTime() < 6 * 3600e3)
    return json({ ok: true, skipped: "đã báo gần đây" });

  const exp = Date.now() + 7 * 24 * 3600e3; // link hiệu lực 7 ngày
  const hub = env("HUB_URL").replace(/\/$/, "");
  const choices = [
    ["staff", "Duyệt: Nhân viên (sửa & xác nhận việc)"],
    ["manager", "Duyệt: Quản lý"],
    ["viewer", "Duyệt: Chỉ xem"],
    ["reject", "Từ chối"],
  ];
  const links = await Promise.all(choices.map(async ([role, label]) => {
    const s = await sign(`${user.id}.${role}.${exp}`);
    return { label, url: `${hub}/duyet.html?u=${user.id}&r=${role}&e=${exp}&s=${s}` };
  }));
  const who = `${p.full_name ?? "(chưa ghi tên)"} — ${p.email}`;

  // 1) Email qua Resend (gói miễn phí, gửi về chính email đăng ký Resend)
  if (env("RESEND_API_KEY")) {
    const html = `<div style="font-family:Georgia,serif;color:#2b2622">
      <p><b>${who}</b> xin truy cập Mô Hub.</p>
      ${links.map((l) => `<p><a href="${l.url}">${l.label}</a></p>`).join("")}
      <p style="color:#77815C;font-size:13px">Bấm link sẽ mở trang xác nhận — chưa có gì thay đổi cho tới khi anh bấm nút ở đó.</p></div>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Mô Hub <onboarding@resend.dev>",
        to: [env("ADMIN_EMAIL")],
        subject: `[Mô Hub] ${p.email} xin truy cập`,
        html,
      }),
    });
  }

  // 2) Telegram cho admin (nếu đã cấu hình Thư kí)
  if (env("TELEGRAM_BOT_TOKEN") && env("ADMIN_CHAT_ID")) {
    await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env("ADMIN_CHAT_ID"),
        text: `🔑 ${who} xin truy cập Mô Hub.`,
        reply_markup: { inline_keyboard: links.map((l) => [{ text: l.label, url: l.url }]) },
      }),
    });
  }

  await db.from("profiles").update({ notified_at: new Date().toISOString() }).eq("id", user.id);
  return json({ ok: true });
});
