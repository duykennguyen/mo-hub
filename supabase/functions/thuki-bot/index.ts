// THƯ KÍ — bot Telegram ghi việc vào Mô Hub. Miễn phí: phân tích bằng luật, không dùng AI trả phí.
// Mỗi chat phải liên kết với một hồ sơ Mô Hub; mọi đọc/ghi chạy bằng phiên đăng nhập của
// chính người nhắn nên RLS áp dụng như trên web. Webhook bảo vệ bằng TELEGRAM_WEBHOOK_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";
import { iso, noAccent, parseTask, vnToday } from "./parse.ts";
import { guiBaoCao, lenhDat, lenhDoiNgay, lenhHuy, xuLyDatPhong, xuLyNutBooking, type Ctx } from "./booking-bot.ts";
import { chuanHoaGiongNoi } from "./giong-noi.ts";
import { congDanhTinh, khopBiMat, laLoiQuyen, moPhien, type Phien } from "./danh-tinh.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const URL_SB = env("SUPABASE_URL");
const KHONG_LUU = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
// Service role CHỈ dùng cho: tra chat → người, dùng mã liên kết, xin phiên đăng nhập, báo cáo sáng.
const may = createClient(URL_SB, env("SUPABASE_SERVICE_ROLE_KEY"), KHONG_LUU);
// Khóa công khai (như config.js của web) để gọi API bằng phiên của người nhắn
const KHOA_CONG_KHAI = (() => {
  try {
    const k = JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS"));
    const v = (typeof k === "string" ? [k] : Object.values(k)).find((x) => String(x).startsWith("sb_publishable_"));
    if (v) return String(v);
  } catch { /* không có thì dùng khóa anon cũ */ }
  return env("SUPABASE_ANON_KEY");
})();
const TG = `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}`;
const HUB = env("HUB_URL").replace(/\/$/, "");
// Lịch đặt phòng nằm ở site riêng Mô House Calendar
const LICH = (env("CALENDAR_URL") || "https://duykennguyen.github.io/mo-house-calendar/").replace(/\/$/, "");
const ADMIN_CHAT = env("ADMIN_CHAT_ID");

const tg = (method: string, body: unknown) =>
  fetch(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const depsPhien = {
  may,
  xacThucMa: async (tokenHash: string) => {
    const tam = createClient(URL_SB, KHOA_CONG_KHAI, KHONG_LUU);
    const { data, error } = await tam.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error) throw new Error(error.message);
    return data.session;
  },
  taoClient: (headers: Record<string, string>) => createClient(URL_SB, KHOA_CONG_KHAI, { ...KHONG_LUU, global: { headers } }),
};

// ---------------- Phân tích tin nhắn ----------------
const CAT_LABEL: Record<string, string> = { ky_thuat: "🔧 Kỹ thuật", buong_phong: "🧺 Buồng phòng", quan_ly: "📋 Quản lý", khac: "📌 Khác" };
const PRI_LABEL: Record<string, string> = { cao: "🔴 Gấp", thuong: "", thap: "⚪ Không gấp" };
const VAI_TRO: Record<string, string> = { admin: "quản trị", manager: "quản lý", staff: "nhân viên", viewer: "chỉ xem" };
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function summary(task: any, propName: string | null) {
  const due = task.due_date ? (() => { const d = new Date(task.due_date + "T00:00:00Z");
    return `⏰ ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} (${WD[d.getUTCDay()]})`; })() : "⏰ chưa có hạn";
  return [
    `✅ Đã ghi #${task.id}: ${task.title}`,
    [`🏠 ${propName ?? "Chung"}`, task.location ? `📍 ${task.location}` : "", CAT_LABEL[task.category], due, PRI_LABEL[task.priority]]
      .filter(Boolean).join("   "),
  ].join("\n");
}
// Nút "Hủy việc" chỉ hiện với quản trị viên: xóa việc là quyền riêng của admin (database cũng chặn)
const catButtons = (id: number, laAdmin: boolean) => ({
  inline_keyboard: [[
    { text: "🔧 Kỹ thuật", callback_data: `c:${id}:ky_thuat` },
    { text: "🧺 Buồng phòng", callback_data: `c:${id}:buong_phong` },
    { text: "📋 Quản lý", callback_data: `c:${id}:quan_ly` },
  ], ...(laAdmin ? [[{ text: "🗑 Hủy việc này", callback_data: `x:${id}` }]] : [])],
});

const KHONG_QUYEN_GHI = "🚫 Tài khoản của bạn không có quyền ghi việc này (chỉ xem, hoặc nhà không thuộc phạm vi được giao).";

async function createTask(p: Phien, chat: number, row: any, propName: string | null) {
  const { data, error } = await p.db.from("tasks").insert(row).select().single();
  if (error) return tg("sendMessage", { chat_id: chat, text: laLoiQuyen(error) ? KHONG_QUYEN_GHI : "❌ Lỗi ghi việc: " + error.message });
  return tg("sendMessage", { chat_id: chat, text: summary(data, propName), reply_markup: catButtons(data.id, p.nguoi.vai_tro === "admin") });
}

async function listOpen(p: Phien, chat: number, arg: string, props: any[]) {
  // RLS đã lọc: người bị giới hạn theo nhà chỉ thấy việc của nhà được giao
  let q = p.db.from("tasks").select("id,title,due_date,priority,property_id,location")
    .eq("status", "open").is("deleted_at", null).order("due_date", { ascending: true, nullsFirst: false });
  let prop: any = null;
  if (arg) {
    const kw = noAccent(arg);
    prop = props.find((x) => [x.code, x.name, ...(x.aliases ?? [])].some((k) => noAccent(k) === kw || noAccent(k).includes(kw)));
    if (!prop) return tg("sendMessage", { chat_id: chat, text: `Không tìm thấy nhà "${arg}".` });
    q = q.eq("property_id", prop.id);
  }
  const { data } = await q.limit(40);
  if (!data?.length) return tg("sendMessage", { chat_id: chat, text: "🎉 Không còn việc nào đang mở." });
  const name = (id: string) => props.find((x) => x.id === id)?.name ?? "Chung";
  const today = iso(vnToday());
  const lines = data.map((t: any) =>
    `${t.priority === "cao" ? "🔴" : t.due_date && t.due_date < today ? "⚠️" : "•"} #${t.id} ${prop ? "" : `[${name(t.property_id)}] `}${t.title}${t.due_date ? ` — ${t.due_date.slice(8)}/${t.due_date.slice(5, 7)}` : ""}`);
  return tg("sendMessage", { chat_id: chat, text: `📋 Việc đang mở${prop ? " — " + prop.name : ""} (${data.length}):\n\n${lines.join("\n")}\n\n${HUB}/viec.html` });
}

const HELP = `Thư kí Mô Hub 🗂
Nhắn tự nhiên, có tên nhà, loại việc và hạn:
  "nhà Sen vòi sen phòng 2 rỉ nước, gọi thợ trước thứ 3"
  "dọn phòng + thay ga nhà Mây mai, gấp"

Tôi phân biệt hai loại tin nhắn:
• VIỆC — mở đầu bằng động từ: "dọn Củ Sả mai", "sửa máy lạnh Gừng"
• ĐẶT PHÒNG — có chữ đặt/book/giữ chỗ, hoặc có chữ "khách" kèm ngày:
  "khách book Củ Sả ngày mai, 2 đêm, a Duy"

Đặt phòng — nhắn có chữ "đặt" ở đầu:
  "đặt Gừng cho Anna từ 1/10 đến 1/12, 20tr, cọc 5tr"
  "đặt nhà Sen 5 đêm từ 10/10 cho anh Nam, airbnb"
Tôi luôn hiện bản xem trước, bấm nút xác nhận mới ghi vào lịch.

Lệnh việc:
/viec — mọi việc đang mở
/viec sen — việc của một nhà
/xong 12 — đánh dấu việc #12 đã xong
/xoa 12 — xóa việc #12 (chỉ quản trị)
/nha — danh sách nhà & bí danh

Lệnh lịch:
/lich — báo cáo hôm nay (ai đến, ai đi, ai đang ở)
/dat — booking sắp tới
/huy 12 — hủy booking #12
/doi 12 5/10 - 5/11 — đổi ngày booking #12

Tôi làm đúng theo quyền của tài khoản Mô Hub đã liên kết với chat này.`;

// ---------------- Lịch tự động (pg_cron) ----------------
// Header X-Mo-Cron-Secret phải khớp CRON_SECRET (bản sao nằm trong Supabase Vault để job đọc).
// Lớp bảo vệ thứ hai: tối đa 1 báo cáo / 6 giờ, chỉ gửi về ADMIN_CHAT_ID.
let daDongBoVault = false;
async function xuLyCron(req: Request): Promise<Response> {
  const biMat = env("CRON_SECRET");
  if (biMat && !daDongBoVault) {
    // Giữ bản trong Vault luôn khớp với Edge Function Secret (đổi secret thì Vault tự theo)
    const { error } = await may.rpc("dat_cron_secret", { p_secret: biMat });
    daDongBoVault = !error;
  }
  if (req.headers.get("X-Mo-Cron") !== "bao-cao-sang" || !biMat || !khopBiMat(req.headers.get("X-Mo-Cron-Secret") ?? "", biMat))
    return new Response("forbidden", { status: 403 });

  if (!ADMIN_CHAT || ADMIN_CHAT === "0") return new Response("chưa cấu hình ADMIN_CHAT_ID", { status: 200 });
  const { data: moc } = await may.from("app_settings").select("value").eq("key", "bao_cao_sang_lan_cuoi").maybeSingle();
  if (moc?.value && Date.now() - Number(moc.value) < 6 * 3600e3) return new Response("đã gửi gần đây");
  await may.from("app_settings").upsert({ key: "bao_cao_sang_lan_cuoi", value: String(Date.now()) });
  await guiBaoCao({ db: may, tg, HUB, LICH }, Number(ADMIN_CHAT));   // báo cáo hệ thống → chạy quyền máy chủ
  await may.rpc("don_nhap_booking_cu");
  return new Response("ok");
}

// ---------------- Xử lý webhook ----------------
Deno.serve(async (req) => {
  if (req.headers.has("X-Mo-Cron")) return xuLyCron(req);

  if (!khopBiMat(req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", env("TELEGRAM_WEBHOOK_SECRET")))
    return new Response("forbidden", { status: 403 });
  const up = await req.json();
  const cong = await congDanhTinh(up, { may, tg, hub: HUB, adminChat: ADMIN_CHAT });
  if (!cong) return new Response("ok");
  const { nguoi, chat } = cong;
  const cq = up.callback_query;
  const msg = up.message;

  let phien: Phien;
  try { phien = await moPhien(depsPhien, nguoi); }
  catch (e) {
    await tg("sendMessage", { chat_id: chat, text: "⚠️ Chưa mở được phiên làm việc, thử lại sau ít phút.\n(" + (e as Error).message + ")" });
    return new Response("ok");
  }
  try {
    const ctx: Ctx = { db: phien.db, tg, HUB, LICH };
    if (cq) await xuLyNut(phien, ctx, cq, chat);
    else if (msg) await xuLyTinNhan(phien, ctx, msg, chat);
  } finally {
    await phien.dong();
  }
  return new Response("ok");
});

// ---------------- Bấm nút ----------------
async function xuLyNut(p: Phien, ctx: Ctx, cq: any, chat: number) {
  const db = p.db;
  // Nút của phần đặt phòng xử lý riêng
  const ghiChuBooking = await xuLyNutBooking(ctx, cq);
  if (ghiChuBooking !== null) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: ghiChuBooking });
    return;
  }
  const [kind, a, b] = String(cq.data).split(":");
  let note = "Đã cập nhật";
  if (kind === "c") {
    const { data: t } = await db.from("tasks").update({ category: b }).eq("id", a).select("*, properties(name)").maybeSingle();
    if (t) await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: summary(t, t.properties?.name ?? null), reply_markup: catButtons(t.id, p.nguoi.vai_tro === "admin") });
    else note = "Không đổi được (không có quyền sửa việc này)";
  } else if (kind === "x") {
    const { error } = await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", a);
    if (error) note = "Chỉ quản trị viên được xóa việc";
    else { await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: `🗑 Đã hủy việc #${a}.` }); note = "Đã hủy"; }
  } else if (kind === "p") { // chọn nhà cho bản nháp (RLS: chỉ thấy nháp của chính mình)
    const { data: draft } = await db.from("bot_drafts").select("*").eq("id", a).maybeSingle();
    if (draft) {
      const { data: props } = await db.from("properties").select("*").eq("active", true);
      const parsed = parseTask(draft.text, []);
      const prop = props?.find((x: any) => x.id === b) ?? null;
      parsed.row.property_id = prop?.id ?? null;
      await db.from("bot_drafts").delete().eq("id", a);
      await tg("deleteMessage", { chat_id: chat, message_id: cq.message.message_id });
      await createTask(p, chat, parsed.row, prop?.name ?? null);
      note = "Đã ghi";
    } else note = "Bản nháp không còn";
  }
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: note });
}

// ---------------- Tin nhắn ----------------
async function xuLyTinNhan(p: Phien, ctx: Ctx, msg: any, chat: number) {
  const db = p.db;
  // Tin nhắn thoại / ghi âm: Thư kí không nghe được (không dùng dịch vụ nhận dạng trả phí).
  // Trả lời hướng dẫn thay vì im lặng cho người gửi khỏi tưởng bot hỏng.
  if (msg.voice || msg.audio || msg.video_note) {
    await tg("sendMessage", {
      chat_id: chat,
      text: "🎙 Tôi chưa nghe được tin nhắn thoại.\n\n" +
        "Cách nhanh nhất: bấm biểu tượng micro trên BÀN PHÍM (không phải nút ghi âm của Telegram) " +
        "rồi đọc bình thường — chữ hiện ra thì gửi. Tôi hiểu cả cách đọc kiểu " +
        "\"đặt Gừng cho Anna từ ngày một tháng mười đến ngày một tháng mười hai hai mươi triệu\".",
    });
    return;
  }
  if (!msg.text) return;
  // Chuẩn hóa câu đọc bằng giọng nói: số viết bằng chữ, "ngày 1 tháng 10" → 1/10
  const text: string = chuanHoaGiongNoi(msg.text.trim());

  // RLS lọc sẵn: người bị giới hạn chỉ thấy nhà và căn được giao
  const props = (await db.from("properties").select("*").eq("active", true).order("sort")).data ?? [];
  // Tên căn cũng là một cách gọi nhà: nhắn "Củ Sả" thì việc phải vào CamF, không phải nhà khác.
  // Không có bước này thì bộ đọc việc chỉ biết tên nhà và dễ khớp nhầm sang nhà gần giống.
  const dsCan = (await db.from("units").select("name,property_id").eq("active", true)).data ?? [];
  for (const u of dsCan) {
    const x = props.find((y: any) => y.id === u.property_id);
    if (x && u.name) x.aliases = [...(x.aliases ?? []), u.name];
  }
  const [cmd, ...args] = text.split(/\s+/);
  const arg = args.join(" ");

  if (cmd === "/start" || cmd === "/help")
    await tg("sendMessage", { chat_id: chat, text: `👤 ${p.nguoi.ten} (${VAI_TRO[p.nguoi.vai_tro] ?? p.nguoi.vai_tro})\n\n${HELP}` });
  else if (cmd === "/lich") await guiBaoCao(ctx, chat);
  else if (cmd === "/dat") await lenhDat(ctx, chat);
  else if (cmd === "/huy") {
    const id = Number(args[0]);
    if (!id) await tg("sendMessage", { chat_id: chat, text: "Cú pháp: /huy 12" });
    else await lenhHuy(ctx, chat, id);
  }
  else if (cmd === "/doi") {
    const id = Number(args[0]);
    if (!id) await tg("sendMessage", { chat_id: chat, text: "Cú pháp: /doi 12 5/10 - 5/11" });
    else await lenhDoiNgay(ctx, chat, id, args.slice(1).join(" "));
  }
  else if (cmd === "/nha") await tg("sendMessage", { chat_id: chat, text: props.length
    ? props.map((x: any) => `• ${x.name} (${x.code}) — ${(x.aliases ?? []).join(", ") || "chưa có bí danh"}`).join("\n")
    : "Bạn chưa được giao nhà nào, hoặc hệ thống chưa có nhà." });
  else if (cmd === "/viec") await listOpen(p, chat, arg, props);
  else if (cmd === "/xong" || cmd === "/xoa") {
    const id = Number(args[0]);
    if (!id) await tg("sendMessage", { chat_id: chat, text: `Cú pháp: ${cmd} 12` });
    else {
      const patch = cmd === "/xong" ? { status: "done" } : { deleted_at: new Date().toISOString() };
      const { data, error } = await db.from("tasks").update(patch).eq("id", id).select("id,title").maybeSingle();
      await tg("sendMessage", { chat_id: chat, text: data ? `${cmd === "/xong" ? "✅ Xong" : "🗑 Đã xóa"} #${id}: ${data.title}`
        : error && cmd === "/xoa" ? "🚫 Chỉ quản trị viên được xóa việc."
        : `Không có việc #${id}, hoặc bạn không có quyền sửa việc này.` });
    }
  } else if (cmd.startsWith("/")) await tg("sendMessage", { chat_id: chat, text: "Không hiểu lệnh này. Gõ /help." });
  else if (await xuLyDatPhong(ctx, chat, text)) {
    // tin nhắn đặt phòng đã được xử lý (kể cả khi bị từ chối vì không có quyền)
  }
  else {
    const parsed = parseTask(text, props);
    if (parsed.property || !props.length) await createTask(p, chat, parsed.row, parsed.property?.name ?? null);
    else {
      // Không nhận ra nhà → hỏi lại bằng nút, không đoán
      const { data: draft, error } = await db.from("bot_drafts").insert({ text }).select().single();
      if (error || !draft) { await tg("sendMessage", { chat_id: chat, text: laLoiQuyen(error) ? KHONG_QUYEN_GHI : "❌ Lỗi: " + error?.message }); return; }
      const rows = [];
      for (let i = 0; i < props.length; i += 3)
        rows.push(props.slice(i, i + 3).map((x: any) => ({ text: x.name, callback_data: `p:${draft.id}:${x.id}` })));
      rows.push([{ text: "Không thuộc nhà nào", callback_data: `p:${draft.id}:none` }]);
      await tg("sendMessage", { chat_id: chat, text: `Việc này của nhà nào?\n“${text}”`, reply_markup: { inline_keyboard: rows } });
    }
  }
}
