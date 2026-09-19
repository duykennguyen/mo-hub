// THƯ KÍ — bot Telegram ghi việc vào Mô Hub. Miễn phí: phân tích bằng luật, không dùng AI trả phí.
// Chỉ nói chuyện với ADMIN_CHAT_ID. Webhook bảo vệ bằng TELEGRAM_WEBHOOK_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const TG = `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}`;
const HUB = env("HUB_URL").replace(/\/$/, "");

const tg = (method: string, body: unknown) =>
  fetch(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---------------- Phân tích tin nhắn ----------------
const CAT_LABEL: Record<string, string> = { ky_thuat: "🔧 Kỹ thuật", buong_phong: "🧺 Buồng phòng", quan_ly: "📋 Quản lý", khac: "📌 Khác" };
const PRI_LABEL: Record<string, string> = { cao: "🔴 Gấp", thuong: "", thap: "⚪ Không gấp" };
// Từ khóa có dấu để tránh trùng nghĩa (vd "mái" ≠ "mai", "đến" ≠ "đèn")
const CAT_WORDS: Record<string, string[]> = {
  quan_ly: ["khách", "hợp đồng", "thu tiền", "tiền cọc", "đặt cọc", "gia hạn", "chủ nhà", "giấy tờ", "hóa đơn", "hoá đơn",
    "tiền điện", "tiền nước", "check in", "check-in", "check out", "check-out", "bàn giao", "thanh toán", "báo giá", "mua"],
  buong_phong: ["dọn", "vệ sinh", "lau", "giặt", "thay ga", "ga giường", "drap", "chăn", "gối", "khăn", "hút bụi", "rác",
    "setup phòng", "set up phòng", "xà phòng", "giấy vệ sinh", "amenities", "bụi", "mạng nhện"],
  ky_thuat: ["sửa", "hỏng", "hư", "rỉ", "rò", "dột", "thấm", "điện", "đèn", "bóng đèn", "máy lạnh", "điều hòa", "điều hoà",
    "ống", "bơm", "khóa", "khoá", "cửa", "thợ", "sơn", "wifi", "mạng", "tắc", "nghẹt", "vòi", "bồn cầu", "máy giặt",
    "tủ lạnh", "nóng lạnh", "bình nóng", "công tắc", "ổ cắm", "mái", "quạt", "cầu dao", "aptomat"],
};
const B = "(?:^|[\\s,.;:!?()/\"'-])"; // ranh giới từ (Unicode-safe)
const E = "(?=$|[\\s,.;:!?()/\"'-])";
const has = (text: string, word: string) =>
  new RegExp(B + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + E, "i").test(text);
const noAccent = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

function vnToday() {
  const d = new Date(Date.now() + 7 * 3600e3); // giờ Việt Nam
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400e3);
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function parseDue(t: string): string | null {
  const today = vnToday();
  if (has(t, "hôm nay") || has(t, "hnay") || has(t, "trong ngày")) return iso(today);
  if (has(t, "ngày mai") || has(t, "mai")) return iso(addDays(today, 1));
  if (has(t, "ngày kia") || has(t, "ngày mốt") || has(t, "mốt")) return iso(addDays(today, 2));
  if (has(t, "cuối tuần")) return iso(addDays(today, (6 - today.getUTCDay() + 7) % 7 || 7));
  if (has(t, "tuần sau")) return iso(addDays(today, 7));
  // thứ 2..7, thứ hai..bảy, chủ nhật / cn
  const names: Record<string, number> = { "hai": 1, "ba": 2, "tư": 3, "bốn": 3, "năm": 4, "sáu": 5, "bảy": 6 };
  let wd: number | null = null;
  const m = t.match(/thứ\s*([2-7]|hai|ba|tư|bốn|năm|sáu|bảy)(?=$|[\s,.;:!?)])/i);
  if (m) wd = /\d/.test(m[1]) ? Number(m[1]) - 1 : names[m[1].toLowerCase()];
  else if (has(t, "chủ nhật") || has(t, "cn")) wd = 0;
  if (wd !== null) return iso(addDays(today, ((wd - today.getUTCDay() + 7) % 7) || 7));
  // dd/mm hoặc dd/mm/yyyy
  const d = t.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?=$|[\s,.;:!?)])/);
  if (d) {
    let y = d[3] ? Number(d[3].length === 2 ? "20" + d[3] : d[3]) : today.getUTCFullYear();
    let date = new Date(Date.UTC(y, Number(d[2]) - 1, Number(d[1])));
    if (!d[3] && date.getTime() < addDays(today, -30).getTime()) date = new Date(Date.UTC(++y, Number(d[2]) - 1, Number(d[1])));
    if (!isNaN(date.getTime())) return iso(date);
  }
  return null;
}

function parseTask(raw: string, props: any[]) {
  const t = raw.toLowerCase();
  const plain = noAccent(raw);
  // Nhà: khớp mã, tên hoặc bí danh (không phân biệt dấu); ưu tiên cụm dài nhất
  // Lượt 1 khớp có dấu (chính xác); lượt 2 bỏ dấu, chỉ chạy khi lượt 1 không ra
  let prop: any = null, best = 0;
  for (const fold of [(x: string) => x.toLowerCase(), noAccent]) {
    const hay = fold === noAccent ? plain : t;
    for (const p of props) {
      for (const k of [p.name, ...(p.aliases ?? [])].filter(Boolean)) {
        const kw = fold(k);
        if (fold === noAccent && kw.length < 5) continue; // bỏ dấu + quá ngắn dễ trùng ("may" ≈ "máy")
        if (kw.length > best && has(hay, kw)) { prop = p; best = kw.length; }
      }
    }
    if (prop) break;
  }
  // Loại việc: đếm từ khóa, nhiều nhất thắng
  let category = "khac", top = 0;
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    const n = words.filter((w) => has(t, w)).length;
    if (n > top) { category = cat; top = n; }
  }
  const priority = /không gấp|khi rảnh|từ từ|thong thả/.test(t) ? "thap"
    : /gấp|khẩn|ngay lập tức|ưu tiên|urgent/.test(t) ? "cao" : "thuong";
  const loc = raw.match(/(?:^|\s)(?:phòng|p\.?)\s?(\d{1,3})(?=$|[\s,.;:!?)])/i);
  const [first, ...rest] = raw.trim().split("\n");
  const title = first.length > 140 ? first.slice(0, 137) + "…" : first;
  return {
    property: prop,
    row: {
      property_id: prop?.id ?? null,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      detail: [first.length > 140 ? first : "", rest.join("\n")].filter(Boolean).join("\n") || null,
      location: loc ? "P" + loc[1] : null,
      category, priority, due_date: parseDue(t), source: "telegram",
    },
  };
}

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

Lệnh:
/viec — mọi việc đang mở
/viec sen — việc của một nhà
/xong 12 — đánh dấu việc #12 đã xong
/xoa 12 — xóa việc #12
/nha — danh sách nhà & bí danh`;

// ---------------- Xử lý webhook ----------------
Deno.serve(async (req) => {
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env("TELEGRAM_WEBHOOK_SECRET"))
    return new Response("forbidden", { status: 403 });
  const up = await req.json();
  const admin = env("ADMIN_CHAT_ID");

  // Bấm nút
  if (up.callback_query) {
    const cq = up.callback_query;
    const chat = cq.message.chat.id;
    if (String(chat) !== admin) return new Response("ok");
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
  if (!msg?.text) return new Response("ok");
  const chat = msg.chat.id;
  const text: string = msg.text.trim();

  if (text === "/id") { await tg("sendMessage", { chat_id: chat, text: `Chat ID: ${chat}` }); return new Response("ok"); }
  if (String(chat) !== admin) return new Response("ok"); // bỏ qua người lạ

  const props = (await db.from("properties").select("*").eq("active", true).order("sort")).data ?? [];
  const [cmd, ...args] = text.split(/\s+/);
  const arg = args.join(" ");

  if (cmd === "/start" || cmd === "/help") await tg("sendMessage", { chat_id: chat, text: HELP });
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
