// THƯ KÍ — bot Telegram ghi việc vào Mô Hub. Miễn phí: phân tích bằng luật, không dùng AI trả phí.
// Chỉ nói chuyện với ADMIN_CHAT_ID. Webhook bảo vệ bằng TELEGRAM_WEBHOOK_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";
import { iso, noAccent, parseTask, vnToday } from "./parse.ts";
import { guiBaoCao, lenhDat, lenhDoiNgay, lenhHuy, xuLyDatPhong, xuLyNutBooking, type Ctx } from "./booking-bot.ts";
import { chuanHoaGiongNoi } from "./giong-noi.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const TG = `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}`;
const HUB = env("HUB_URL").replace(/\/$/, "");
// Lịch đặt phòng nằm ở site riêng Mô House Calendar
const LICH = (env("CALENDAR_URL") || "https://duykennguyen.github.io/mo-house-calendar/").replace(/\/$/, "");

const tg = (method: string, body: unknown) =>
  fetch(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const ctx: Ctx = { db, tg, HUB, LICH };

// ---------------- Phân tích tin nhắn ----------------
const CAT_LABEL: Record<string, string> = { ky_thuat: "🔧 Kỹ thuật", buong_phong: "🧺 Buồng phòng", quan_ly: "📋 Quản lý", khac: "📌 Khác" };
const PRI_LABEL: Record<string, string> = { cao: "🔴 Gấp", thuong: "", thap: "⚪ Không gấp" };
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
const catButtons = (id: number) => ({
  inline_keyboard: [[
    { text: "🔧 Kỹ thuật", callback_data: `c:${id}:ky_thuat` },
    { text: "🧺 Buồng phòng", callback_data: `c:${id}:buong_phong` },
    { text: "📋 Quản lý", callback_data: `c:${id}:quan_ly` },
  ], [{ text: "🗑 Hủy việc này", callback_data: `x:${id}` }]],
});

async function createTask(chat: number, row: any, propName: string | null) {
  const { data, error } = await db.from("tasks").insert(row).select().single();
  if (error) return tg("sendMessage", { chat_id: chat, text: "❌ Lỗi ghi việc: " + error.message });
  return tg("sendMessage", { chat_id: chat, text: summary(data, propName), reply_markup: catButtons(data.id) });
}

async function listOpen(chat: number, arg: string, props: any[]) {
  let q = db.from("tasks").select("id,title,due_date,priority,property_id,location")
    .eq("status", "open").is("deleted_at", null).order("due_date", { ascending: true, nullsFirst: false });
  let prop: any = null;
  if (arg) {
    const kw = noAccent(arg);
    prop = props.find((p) => [p.code, p.name, ...(p.aliases ?? [])].some((k) => noAccent(k) === kw || noAccent(k).includes(kw)));
    if (!prop) return tg("sendMessage", { chat_id: chat, text: `Không tìm thấy nhà "${arg}".` });
    q = q.eq("property_id", prop.id);
  }
  const { data } = await q.limit(40);
  if (!data?.length) return tg("sendMessage", { chat_id: chat, text: "🎉 Không còn việc nào đang mở." });
  const name = (id: string) => props.find((p) => p.id === id)?.name ?? "Chung";
  const today = iso(vnToday());
  const lines = data.map((t) =>
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
/xoa 12 — xóa việc #12
/nha — danh sách nhà & bí danh

Lệnh lịch:
/lich — báo cáo hôm nay (ai đến, ai đi, ai đang ở)
/dat — booking sắp tới
/huy 12 — hủy booking #12
/doi 12 5/10 - 5/11 — đổi ngày booking #12`;

// ---------------- Xử lý webhook ----------------
Deno.serve(async (req) => {
  // Lịch tự động (pg_cron) gọi báo cáo sáng. Không có secret Telegram nên chặn spam
  // bằng cách chỉ gửi 1 lần mỗi 6 giờ, và chỉ gửi về đúng máy của quản trị viên.
  if (req.headers.get("X-Mo-Cron") === "bao-cao-sang") {
    const admin = env("ADMIN_CHAT_ID");
    if (!admin || admin === "0") return new Response("chưa cấu hình ADMIN_CHAT_ID", { status: 200 });
    const { data: moc } = await db.from("app_settings").select("value").eq("key", "bao_cao_sang_lan_cuoi").maybeSingle();
    if (moc?.value && Date.now() - Number(moc.value) < 6 * 3600e3) return new Response("đã gửi gần đây");
    await db.from("app_settings").upsert({ key: "bao_cao_sang_lan_cuoi", value: String(Date.now()) });
    await guiBaoCao(ctx, Number(admin));
    await db.rpc("don_nhap_booking_cu");
    return new Response("ok");
  }

  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env("TELEGRAM_WEBHOOK_SECRET"))
    return new Response("forbidden", { status: 403 });
  const up = await req.json();
  const admin = env("ADMIN_CHAT_ID");

  // Bấm nút
  if (up.callback_query) {
    const cq = up.callback_query;
    const chat = cq.message.chat.id;
    if (String(chat) !== admin) return new Response("ok");
    // Nút của phần đặt phòng xử lý riêng
    const ghiChuBooking = await xuLyNutBooking(ctx, cq);
    if (ghiChuBooking !== null) {
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: ghiChuBooking });
      return new Response("ok");
    }
    const [kind, a, b] = String(cq.data).split(":");
    let note = "Đã cập nhật";
    if (kind === "c") {
      await db.from("tasks").update({ category: b }).eq("id", a);
      const { data: t } = await db.from("tasks").select("*, properties(name)").eq("id", a).single();
      if (t) await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: summary(t, t.properties?.name ?? null), reply_markup: catButtons(t.id) });
    } else if (kind === "x") {
      await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", a);
      await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: `🗑 Đã hủy việc #${a}.` });
      note = "Đã hủy";
    } else if (kind === "p") { // chọn nhà cho bản nháp
      const { data: draft } = await db.from("bot_drafts").select("*").eq("id", a).single();
      if (draft) {
        const { data: props } = await db.from("properties").select("*").eq("active", true);
        const parsed = parseTask(draft.text, []);
        const prop = props?.find((p) => p.id === b) ?? null;
        parsed.row.property_id = prop?.id ?? null;
        await db.from("bot_drafts").delete().eq("id", a);
        await tg("deleteMessage", { chat_id: chat, message_id: cq.message.message_id });
        await createTask(chat, parsed.row, prop?.name ?? null);
      }
      note = "Đã ghi";
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: note });
    return new Response("ok");
  }

  const msg = up.message;

  // Tin nhắn thoại / ghi âm: Thư kí không nghe được (không dùng dịch vụ nhận dạng trả phí).
  // Trả lời hướng dẫn thay vì im lặng cho người gửi khỏi tưởng bot hỏng.
  if (msg && (msg.voice || msg.audio || msg.video_note)) {
    if (String(msg.chat.id) === admin) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "🎙 Tôi chưa nghe được tin nhắn thoại.\n\n" +
          "Cách nhanh nhất: bấm biểu tượng micro trên BÀN PHÍM (không phải nút ghi âm của Telegram) " +
          "rồi đọc bình thường — chữ hiện ra thì gửi. Tôi hiểu cả cách đọc kiểu " +
          "\"đặt Gừng cho Anna từ ngày một tháng mười đến ngày một tháng mười hai hai mươi triệu\".",
      });
    }
    return new Response("ok");
  }

  if (!msg?.text) return new Response("ok");
  const chat = msg.chat.id;
  // Chuẩn hóa câu đọc bằng giọng nói: số viết bằng chữ, "ngày 1 tháng 10" → 1/10
  const text: string = chuanHoaGiongNoi(msg.text.trim());

  if (text === "/id") { await tg("sendMessage", { chat_id: chat, text: `Chat ID: ${chat}` }); return new Response("ok"); }
  if (String(chat) !== admin) return new Response("ok"); // bỏ qua người lạ

  const props = (await db.from("properties").select("*").eq("active", true).order("sort")).data ?? [];
  // Tên căn cũng là một cách gọi nhà: nhắn "Củ Sả" thì việc phải vào CamF, không phải nhà khác.
  // Không có bước này thì bộ đọc việc chỉ biết tên nhà và dễ khớp nhầm sang nhà gần giống.
  const dsCan = (await db.from("units").select("name,property_id").eq("active", true)).data ?? [];
  for (const u of dsCan) {
    const p = props.find((x: any) => x.id === u.property_id);
    if (p && u.name) p.aliases = [...(p.aliases ?? []), u.name];
  }
  const [cmd, ...args] = text.split(/\s+/);
  const arg = args.join(" ");

  if (cmd === "/start" || cmd === "/help") await tg("sendMessage", { chat_id: chat, text: HELP });
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
  else if (cmd === "/nha") await tg("sendMessage", { chat_id: chat, text: props!.length
    ? props!.map((p) => `• ${p.name} (${p.code}) — ${(p.aliases ?? []).join(", ") || "chưa có bí danh"}`).join("\n")
    : "Chưa có nhà nào. Thêm trong Supabase > Table Editor > properties." });
  else if (cmd === "/viec") await listOpen(chat, arg, props!);
  else if (cmd === "/xong" || cmd === "/xoa") {
    const id = Number(args[0]);
    if (!id) await tg("sendMessage", { chat_id: chat, text: `Cú pháp: ${cmd} 12` });
    else {
      const patch = cmd === "/xong" ? { status: "done" } : { deleted_at: new Date().toISOString() };
      const { data } = await db.from("tasks").update(patch).eq("id", id).select("id,title").maybeSingle();
      await tg("sendMessage", { chat_id: chat, text: data ? `${cmd === "/xong" ? "✅ Xong" : "🗑 Đã xóa"} #${id}: ${data.title}` : `Không có việc #${id}.` });
    }
  } else if (cmd.startsWith("/")) await tg("sendMessage", { chat_id: chat, text: "Không hiểu lệnh này. Gõ /help." });
  else if (await xuLyDatPhong(ctx, chat, text)) {
    // tin nhắn đặt phòng đã được xử lý
  }
  else {
    const parsed = parseTask(text, props!);
    if (parsed.property || !props!.length) await createTask(chat, parsed.row, parsed.property?.name ?? null);
    else {
      // Không nhận ra nhà → hỏi lại bằng nút, không đoán
      const { data: draft } = await db.from("bot_drafts").insert({ text }).select().single();
      const rows = [];
      for (let i = 0; i < props!.length; i += 3)
        rows.push(props!.slice(i, i + 3).map((p) => ({ text: p.name, callback_data: `p:${draft!.id}:${p.id}` })));
      rows.push([{ text: "Không thuộc nhà nào", callback_data: `p:${draft!.id}:none` }]);
      await tg("sendMessage", { chat_id: chat, text: `Việc này của nhà nào?\n“${text}”`, reply_markup: { inline_keyboard: rows } });
    }
  }
  return new Response("ok");
});
