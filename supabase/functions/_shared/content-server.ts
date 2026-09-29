// Phần gọi mạng của hệ bot Content: tạo client, gọi Telegram, dựng handler cho từng Edge Function.
import { createClient } from "npm:@supabase/supabase-js@2";
import { khopBiMat } from "../thuki-bot/danh-tinh.ts";
import { guiNhap, nhacHangDoi, tachPhuongAn, taoLoiNhan, TEN, xuLyUpdate, type Brand, type GoiNop, type Viec } from "./content-bot.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const URL_SB = env("SUPABASE_URL");
const KHONG_LUU = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
// Service role CHỈ dùng cho: tra liên kết, xin phiên, và các hàm content_* tự giới hạn phạm vi (la_may_chu)
export const may = createClient(URL_SB, env("SUPABASE_SERVICE_ROLE_KEY"), KHONG_LUU);
const KHOA_CONG_KHAI = (() => {
  try {
    const k = JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS"));
    const v = (typeof k === "string" ? [k] : Object.values(k)).find((x) => String(x).startsWith("sb_publishable_"));
    if (v) return String(v);
  } catch { /* dùng khóa anon cũ */ }
  return env("SUPABASE_ANON_KEY");
})();
const HUB = env("HUB_URL").replace(/\/$/, "");
const TOKEN: Record<Brand, string> = { house: env("CONTENT_HOUSE_BOT_TOKEN"), bedding: env("CONTENT_BEDDING_BOT_TOKEN") };
const WEBHOOK: Record<Brand, string> = { house: env("CONTENT_HOUSE_WEBHOOK_SECRET"), bedding: env("CONTENT_BEDDING_WEBHOOK_SECRET") };

export const tgCua = (b: Brand) => async (method: string, body: unknown) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN[b]}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};

const phienDeps = {
  may,
  xacThucMa: async (tokenHash: string) => {
    const tam = createClient(URL_SB, KHOA_CONG_KHAI, KHONG_LUU);
    const { data, error } = await tam.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error) throw new Error(error.message);
    return data.session;
  },
  taoClient: (headers: Record<string, string>) => createClient(URL_SB, KHOA_CONG_KHAI, { ...KHONG_LUU, global: { headers } }),
};

const cronDung = (req: Request) => khopBiMat(req.headers.get("X-Mo-Cron-Secret") ?? "", env("CRON_SECRET"));

// ---------- Bot Telegram của một thương hiệu ----------
export function botContent(b: Brand) {
  return async (req: Request): Promise<Response> => {
    // pg_cron 07:30 / 19:30: nhắc khi hàng đợi trống
    if (req.headers.has("X-Mo-Cron")) {
      if (req.headers.get("X-Mo-Cron") !== "nhac-hang-doi" || !cronDung(req)) return new Response("forbidden", { status: 403 });
      return new Response(await nhacHangDoi(may, tgCua(b), b));
    }
    if (!TOKEN[b] || !khopBiMat(req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", WEBHOOK[b]))
      return new Response("forbidden", { status: 403 });
    const up = await req.json();
    await xuLyUpdate(up, { brand: b, may, tg: tgCua(b), hub: HUB, adminChat: env("ADMIN_CHAT_ID"), phienDeps });
    return new Response("ok");
  };
}

// ---------- Nộp bài rồi gửi nháp cho admin ----------
// Tách được 3 phương án thì lưu có cấu trúc và gửi từng phương án; không tách được thì gửi nguyên bài như cũ.
export async function nopVaGui(postId: number, ai: string, body: string, engine: "claude" | "du_phong"): Promise<GoiNop> {
  const options = tachPhuongAn(body);
  const { data, error } = await may.rpc("content_nop_bai", { p_post: postId, p_ai: ai, p_body: body, p_engine: engine, p_options: options });
  if (error) throw new Error(error.message);
  const g: GoiNop = { post_id: data.post_id, brand: data.brand, chu_de: data.chu_de, dinh_dang: data.dinh_dang,
    phien_ban: data.phien_ban, engine: data.engine, body: data.body, options: data.options };
  const { data: chats } = await may.rpc("content_chat_admin");
  const msg = await guiNhap(tgCua(g.brand), chats ?? [], g);
  if (msg) await may.rpc("content_gan_tin", { p_post: postId, p_msg: msg });
  return g;
}

// ---------- content-api: cửa duy nhất cho runner trên máy Duy ----------
export async function contentApi(req: Request): Promise<Response> {
  if (req.method !== "POST" || !khopBiMat(req.headers.get("X-Content-Secret") ?? "", env("CONTENT_RUNNER_SECRET")))
    return new Response("forbidden", { status: 403 });
  const j = await req.json().catch(() => ({}));
  const tra = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
  try {
    switch (j.action) {
      case "nhan": {       // runner luôn là 'may-duy'; không cho runner xưng là bộ máy dự phòng
        // "cho": giây chờ việc (hỏi-chờ, tối đa 25) — có việc là trả ngay, nên bài bắt đầu viết chỉ vài giây sau khi Duy nhắn
        const het = Date.now() + Math.min(Math.max(Number(j.cho) || 0, 0), 25) * 1000;
        for (;;) {
          const { data, error } = await may.rpc("content_nhan_viec", { p_ai: "may-duy", p_chi_khung_gio: false, p_brand: null });
          if (error) throw error;
          if (data || Date.now() + 2000 > het) return tra({ viec: data });
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      case "nop": {
        const body = String(j.body ?? "").trim();
        if (!body) return tra({ loi: "bài rỗng" }, 400);
        const g = await nopVaGui(Number(j.post_id), "may-duy", body.slice(0, 20000), "claude");
        return tra({ ok: true, phien_ban: g.phien_ban });
      }
      case "nha": {
        const { error } = await may.rpc("content_nha_viec", { p_post: Number(j.post_id), p_ai: "may-duy" });
        if (error) throw error;
        return tra({ ok: true });
      }
      case "skill": {
        if (!["house", "bedding"].includes(j.brand)) return tra({ loi: "brand sai" }, 400);
        const { error } = await may.rpc("content_luu_skill", { p_brand: j.brand, p_noi_dung: String(j.noi_dung ?? "").slice(0, 30000), p_hash: String(j.hash ?? "") });
        if (error) throw error;
        return tra({ ok: true });
      }
      case "skill_hash": {
        const { data } = await may.rpc("content_lay_skill", { p_brand: j.brand });
        return tra({ hash: data?.hash ?? null });
      }
      default: return tra({ loi: "action không hợp lệ" }, 400);
    }
  } catch (e) {
    return tra({ loi: (e as Error).message ?? String(e) }, 500);
  }
}

// ---------- content-fallback: bộ máy dự phòng (API AI gói miễn phí) ----------
// Chỉ gửi tri thức thương hiệu CÔNG KHAI (bản rút gọn skill) + chủ đề. Không gửi dữ liệu khách hay nội bộ.
export async function contentFallback(req: Request): Promise<Response> {
  if (req.headers.get("X-Mo-Cron") !== "du-phong" || !cronDung(req)) return new Response("forbidden", { status: 403 });
  const { brand } = await req.json().catch(() => ({}));
  if (!["house", "bedding"].includes(brand)) return new Response("brand sai", { status: 400 });
  if (!env("FALLBACK_API_KEY") || !env("FALLBACK_API_URL") || !env("FALLBACK_MODEL")) return new Response("chưa cấu hình bộ máy dự phòng");

  const { data: viec, error } = await may.rpc("content_nhan_viec", { p_ai: "du-phong", p_chi_khung_gio: true, p_brand: brand });
  if (error) return new Response("lỗi: " + error.message, { status: 500 });
  if (!viec) return new Response("không có việc (khung đã có bài hoặc hàng đợi trống)");
  try {
    const { data: sk } = await may.rpc("content_lay_skill", { p_brand: brand });
    if (!sk?.noi_dung) throw new Error(`chưa có bản rút gọn skill ${TEN[brand as Brand]} (runner trên máy Duy tải lên)`);
    const r = await fetch(env("FALLBACK_API_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("FALLBACK_API_KEY")}` },
      body: JSON.stringify({ model: env("FALLBACK_MODEL"), temperature: 0.7,
        messages: [{ role: "user", content: taoLoiNhan(sk.noi_dung, viec as Viec) }] }),
    });
    const j = await r.json();
    const body = j?.choices?.[0]?.message?.content?.trim();
    if (!r.ok || !body) throw new Error("API dự phòng lỗi " + r.status + ": " + JSON.stringify(j).slice(0, 300));
    await nopVaGui(viec.post_id, "du-phong", body, "du_phong");
    return new Response("đã viết bản dự phòng #" + viec.post_id);
  } catch (e) {
    await may.rpc("content_nha_viec", { p_post: viec.post_id, p_ai: "du-phong" });
    return new Response("lỗi: " + (e as Error).message, { status: 500 });
  }
}
