// BOT CONTENT (Mô House · Mô Bedding) — phần xử lý dùng chung cho 2 bot, content-api và bộ máy dự phòng.
// File này không import supabase-js: mọi thứ gọi mạng được truyền vào, để test chạy không cần mạng.
// Luật: bài là NHÁP (L1) — không có gì tự đăng ra mạng xã hội. Hàng đợi trống thì không tự nghĩ chủ đề.
import { congDanhTinh, moPhien, type MoPhienDeps, type Phien } from "../thuki-bot/danh-tinh.ts";

export type Brand = "house" | "bedding";
export const TEN: Record<Brand, string> = { house: "Mô House", bedding: "Mô Bedding" };
export const KENH: Record<Brand, string> = { house: "content-house", bedding: "content-bedding" };
export const GIO: Record<Brand, string> = { house: "08:00", bedding: "20:00" };
type Tg = (method: string, body: unknown) => Promise<any>;

// "/chude Buổi sáng ở An Bàng | caption IG" → { topic, format }
export function docChuDe(arg: string): { topic: string; format: string | null } | null {
  const [topic, ...fmt] = arg.split("|");
  const t = topic.trim();
  if (!t) return null;
  return { topic: t.slice(0, 500), format: fmt.join("|").trim().slice(0, 100) || null };
}

// Tin nhắn Telegram tối đa 4096 ký tự: cắt theo đoạn, không cắt giữa từ nếu tránh được
export function chiaTin(text: string, max = 3800): string[] {
  const ra: string[] = [];
  let con = text;
  while (con.length > max) {
    let cat = con.lastIndexOf("\n", max);
    if (cat < max / 2) cat = con.lastIndexOf(" ", max);
    if (cat < max / 2) cat = max;
    ra.push(con.slice(0, cat));
    con = con.slice(cat).replace(/^\s+/, "");
  }
  if (con) ra.push(con);
  return ra;
}

export type GoiNop = { post_id: number; brand: Brand; chu_de: string | null; dinh_dang: string | null; phien_ban: number; engine: string; body: string };

export function dauNhap(g: GoiNop): string {
  return [
    g.engine === "du_phong" ? "[BẢN DỰ PHÒNG]" : "",
    `${TEN[g.brand]} · bản ${g.phien_ban} · ${g.engine === "du_phong" ? "bộ máy dự phòng" : "Claude"}`,
    `Chủ đề: ${g.chu_de ?? "(chưa có)"}${g.dinh_dang ? ` · ${g.dinh_dang}` : ""}`,
    "──────────",
  ].filter(Boolean).join("\n");
}

export const nutNhap = (id: number) => ({
  inline_keyboard: [[
    { text: "✅ Duyệt", callback_data: `d:${id}` },
    { text: "✏️ Viết lại", callback_data: `r:${id}` },
    { text: "✖ Hủy", callback_data: `h:${id}` },
  ]],
});

// Gửi nháp cho mọi admin đã liên kết; trả id tin cuối (tin mang nút) của chat đầu tiên
export async function guiNhap(tg: Tg, chats: number[], g: GoiNop): Promise<number | null> {
  const phan = chiaTin(`${dauNhap(g)}\n${g.body}`);
  let idCuoi: number | null = null;
  for (const chat of chats) {
    for (let i = 0; i < phan.length; i++) {
      const cuoi = i === phan.length - 1;
      const r = await tg("sendMessage", { chat_id: chat, text: phan[i], disable_web_page_preview: true, ...(cuoi ? { reply_markup: nutNhap(g.post_id) } : {}) });
      if (cuoi && idCuoi === null) idCuoi = r?.result?.message_id ?? null;
    }
  }
  return idCuoi;
}

export function huongDan(b: Brand, hub: string): string {
  return `Bot Content ${TEN[b]} ✍️
Mỗi ngày ${GIO[b]} tôi gửi 1 bài NHÁP theo chủ đề trong hàng đợi. Tôi không tự đăng gì, và hàng đợi trống thì tôi không tự nghĩ chủ đề.

/chude <nội dung> — thêm chủ đề vào hàng đợi
/chude <nội dung> | <định dạng> — kèm định dạng, ví dụ: | caption IG
/hangdoi — xem các chủ đề đang chờ
/vietngay — viết ngay chủ đề kế tiếp (không chờ ${GIO[b]})
/kho — mở Kho Content

Dưới mỗi bài nháp có nút ✅ Duyệt · ✏️ Viết lại · ✖ Hủy.
Bấm Viết lại rồi nhắn yêu cầu sửa trong tin kế tiếp.
${hub ? hub + "/content.html" : ""}`;
}

// ---------------- Xử lý một update Telegram ----------------
export type BotDeps = {
  brand: Brand;
  may: any;                       // client service role: chỉ dùng tra liên kết + xin phiên
  tg: Tg;
  hub: string;
  adminChat: string;
  phienDeps: Omit<MoPhienDeps, "kenh">;
};

export async function xuLyUpdate(up: any, d: BotDeps): Promise<void> {
  const cong = await congDanhTinh(up, { may: d.may, tg: d.tg, hub: d.hub, adminChat: d.adminChat });
  if (!cong) return;
  const { nguoi, chat } = cong;
  const cq = up.callback_query;
  if (nguoi.vai_tro !== "admin") {
    const text = "Bot Content chỉ dành cho quản trị viên.";
    if (cq) await d.tg("answerCallbackQuery", { callback_query_id: cq.id, text });
    else await d.tg("sendMessage", { chat_id: chat, text });
    return;
  }
  let p: Phien;
  try { p = await moPhien({ ...d.phienDeps, kenh: KENH[d.brand] }, nguoi); }
  catch (e) { await d.tg("sendMessage", { chat_id: chat, text: "⚠️ Chưa mở được phiên làm việc, thử lại sau ít phút." }); return; }
  try {
    if (cq) await xuLyNut(p, d, cq, chat);
    else if (up.message?.text) await xuLyTin(p, d, up.message.text.trim(), chat);
  } finally {
    await p.dong();
  }
}

async function xuLyTin(p: Phien, d: BotDeps, text: string, chat: number) {
  const db = p.db, b = d.brand, gui = (t: string) => d.tg("sendMessage", { chat_id: chat, text: t, disable_web_page_preview: true });
  const [lenh, ...phan] = text.split(/\s+/);
  const cmd = lenh.toLowerCase().replace(/@\w+$/, "");
  const arg = text.slice(lenh.length).trim();

  if (cmd === "/start" || cmd === "/help") return gui(huongDan(b, d.hub));
  if (cmd === "/kho") return gui(`Kho Content: ${d.hub}/content.html`);

  if (cmd === "/chude") {
    const cd = docChuDe(arg);
    if (!cd) return gui("Cú pháp: /chude <nội dung> hoặc /chude <nội dung> | <định dạng>");
    const { error } = await db.from("content_topics").insert({ brand: b, topic: cd.topic, format: cd.format });
    if (error) return gui("❌ Không thêm được: " + error.message);
    const { count } = await db.from("content_topics").select("id", { count: "exact", head: true }).eq("brand", b).eq("status", "cho");
    return gui(`✅ Đã thêm vào hàng đợi ${TEN[b]} (đang có ${count ?? "?"} chủ đề chờ).`);
  }

  if (cmd === "/hangdoi") {
    const { data } = await db.from("content_topics").select("topic,format,priority").eq("brand", b).eq("status", "cho")
      .order("priority", { ascending: false }).order("created_at").limit(30);
    if (!data?.length) return gui(`Hàng đợi ${TEN[b]} trống. Khung ${GIO[b]} sẽ bỏ qua cho tới khi có chủ đề (/chude …).`);
    return gui(`📋 Hàng đợi ${TEN[b]} — viết theo thứ tự này:\n\n` +
      data.map((t: any, i: number) => `${i + 1}. ${t.topic}${t.format ? ` · ${t.format}` : ""}`).join("\n"));
  }

  if (cmd === "/vietngay") {
    const { data: dang } = await db.from("content_posts").select("id").eq("brand", b).eq("current_version", 0)
      .in("status", ["cho_viet", "dang_viet"]).is("deleted_at", null).limit(1);
    if (dang?.length) return gui("Đã có một yêu cầu viết đang chờ. Máy của anh sẽ viết trong vòng 10 phút khi đang bật.");
    const { count } = await db.from("content_topics").select("id", { count: "exact", head: true }).eq("brand", b).eq("status", "cho");
    if (!count) return gui(`Hàng đợi ${TEN[b]} trống — thêm chủ đề bằng /chude trước.`);
    const { error } = await db.from("content_posts").insert({ brand: b, status: "cho_viet" });
    if (error) return gui("❌ " + error.message);
    return gui("✍️ Đã nhận. Máy của anh sẽ viết chủ đề kế tiếp trong vòng 10 phút (khi máy đang bật).");
  }

  if (cmd.startsWith("/")) return gui("Không hiểu lệnh này. Gõ /help.");

  // Tin thường: nếu đang chờ yêu cầu sửa thì đây chính là yêu cầu sửa
  const { data: cho } = await db.from("content_cho_phan_hoi").select("post_id").eq("chat_id", chat).eq("brand", b).maybeSingle();
  if (!cho) return gui("Muốn sửa một bài: bấm ✏️ Viết lại dưới bài đó rồi nhắn yêu cầu. Gõ /help để xem lệnh.");
  const { data: sua, error } = await db.from("content_posts")
    .update({ status: "can_viet_lai", feedback_pending: text.slice(0, 2000) })
    .eq("id", cho.post_id).in("status", ["cho_duyet", "can_viet_lai"]).select("id").maybeSingle();
  await db.from("content_cho_phan_hoi").delete().eq("chat_id", chat).eq("brand", b);
  if (error || !sua) return gui("Bài này không còn ở trạng thái chờ duyệt, không viết lại được.");
  return gui(`📝 Đã ghi yêu cầu sửa cho bài #${cho.post_id}. Bản mới sẽ tới trong vòng 10 phút khi máy của anh đang bật.`);
}

async function xuLyNut(p: Phien, d: BotDeps, cq: any, chat: number) {
  const db = p.db, b = d.brand;
  const [loai, a, c] = String(cq.data).split(":");
  const id = Number(a);
  const dap = (text: string) => d.tg("answerCallbackQuery", { callback_query_id: cq.id, text });
  const boNut = () => d.tg("editMessageReplyMarkup", { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  if (!id) return dap("Nút không hợp lệ");

  if (loai === "d") {
    const { data } = await db.from("content_posts").update({ status: "da_duyet", approved_at: new Date().toISOString() })
      .eq("id", id).eq("brand", b).eq("status", "cho_duyet").select("id").maybeSingle();
    if (!data) return dap("Bài không còn chờ duyệt");
    await boNut();
    await d.tg("sendMessage", { chat_id: chat, text: `✅ Đã vào kho (#${id}). Đăng xong nhớ bấm "Đã đăng" trên Kho Content.` });
    return dap("Đã vào kho");
  }
  if (loai === "r") {
    const { data: bai } = await db.from("content_posts").select("status").eq("id", id).eq("brand", b).maybeSingle();
    if (bai?.status !== "cho_duyet") return dap("Bài không còn chờ duyệt");
    const { error } = await db.from("content_cho_phan_hoi").upsert({ chat_id: chat, brand: b, post_id: id });
    if (error) return dap("Lỗi: " + error.message);
    await d.tg("sendMessage", { chat_id: chat, text: `Anh muốn sửa gì ở bài #${id}? Nhắn yêu cầu trong tin kế tiếp.` });
    return dap("Đang chờ yêu cầu sửa");
  }
  if (loai === "h") {
    await d.tg("sendMessage", { chat_id: chat, text: `Hủy bài #${id}. Trả chủ đề về hàng đợi để viết lại sau?`, reply_markup: { inline_keyboard: [[
      { text: "Trả về hàng đợi", callback_data: `hq:${id}:1` }, { text: "Bỏ luôn chủ đề", callback_data: `hq:${id}:0` }]] } });
    return dap("Chọn cách hủy");
  }
  if (loai === "hq") {
    const { data } = await db.from("content_posts").update({ status: "huy" }).eq("id", id).eq("brand", b)
      .in("status", ["cho_duyet", "can_viet_lai", "cho_viet"]).select("topic_id").maybeSingle();
    if (!data) return dap("Bài không hủy được (đã duyệt, đã đăng hoặc đang viết)");
    if (c === "1" && data.topic_id) await db.from("content_topics").update({ status: "cho" }).eq("id", data.topic_id);
    await boNut();
    await d.tg("sendMessage", { chat_id: chat, text: `✖ Đã hủy bài #${id}${c === "1" ? ", chủ đề đã về hàng đợi" : ""}.` });
    return dap("Đã hủy");
  }
  return dap("Nút không hợp lệ");
}

// ---------------- Nhắc 07:30 / 19:30 khi hàng đợi trống ----------------
export async function nhacHangDoi(may: any, tg: Tg, b: Brand): Promise<string> {
  const { data: n, error } = await may.rpc("content_dem_hang_doi", { p_brand: b });
  if (error) return "lỗi: " + error.message;
  if (n > 0) return "hàng đợi còn " + n;
  const { data: chats } = await may.rpc("content_chat_admin");
  for (const c of chats ?? []) {
    await tg("sendMessage", { chat_id: c, text: `⏰ Hàng đợi ${TEN[b]} trống — khung ${GIO[b]} tới sẽ bỏ qua.\nThêm chủ đề: /chude <nội dung>` });
  }
  return "đã nhắc";
}

// Bản rút gọn SKILL.md cho bộ máy dự phòng: chỉ phần giọng văn công khai —
// bỏ phần đầu (frontmatter) và mục "Tri thức tham chiếu" trở đi (tri thức nội bộ không gửi ra API miễn phí).
export function rutGonSkill(md: string): string {
  return md.replace(/^---[\s\S]*?---\s*/, "").split(/^## Tri thức tham chiếu/m)[0].trim();
}

// ---------------- Lời nhắn gửi bộ máy viết (runner Claude và bộ máy dự phòng dùng chung) ----------------
export type Viec = { post_id: number; loai: string; brand: Brand; chu_de: string | null; dinh_dang: string | null;
  ghi_chu: string | null; phien_ban_moi: number; yeu_cau_sua: string | null; ban_truoc: string | null };

export function taoLoiNhan(skill: string, v: Viec): string {
  return [
    skill.trim(),
    "",
    "=== NHIỆM VỤ ===",
    `Thương hiệu: ${TEN[v.brand]}`,
    `Chủ đề: ${v.chu_de ?? ""}`,
    `Định dạng: ${v.dinh_dang || "theo định dạng mặc định trong hướng dẫn ở trên"}`,
    v.ghi_chu ? `Ghi chú của Duy: ${v.ghi_chu}` : "",
    v.ban_truoc ? `\n=== BẢN TRƯỚC (bản ${v.phien_ban_moi - 1}) ===\n${v.ban_truoc}` : "",
    v.yeu_cau_sua ? `\n=== YÊU CẦU SỬA CỦA DUY ===\n${v.yeu_cau_sua}\nViết lại bài theo yêu cầu này, giữ những gì không bị yêu cầu đổi.` : "",
    "",
    "Chỉ trả về nội dung bài viết hoàn chỉnh bằng tiếng Việt (markdown thuần), không lời dẫn, không giải thích, không hỏi lại.",
    "Không bịa số liệu, giá, giải thưởng hay lời khách. Không có thông tin nào về khách, số điện thoại, giấy tờ, pháp lý.",
  ].filter((x) => x !== "").join("\n");
}
