// LỄ TÂN (trước đây là Thư kí) — bot Telegram ghi và tra booking các nhà của Mô.
// Miễn phí: phân tích bằng luật, không dùng AI trả phí.
// Mỗi chat phải liên kết với một hồ sơ Mô Hub; mọi đọc/ghi chạy bằng phiên đăng nhập của
// chính người nhắn nên RLS áp dụng như trên web. Webhook bảo vệ bằng TELEGRAM_WEBHOOK_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  daHieu, guiBaoCao, layCan, lenhDat, lenhDoiNgay, lenhHuy, lenhSua, lenhTim, lenhTrong, lenhXem, xuLyDatPhong, xuLyNutBooking, type Ctx,
} from "./booking-bot.ts";
import { laViec, parseBooking } from "./parse-booking.ts";
import { docYDinh } from "./y-dinh.ts";
import { ghiNhanTep, KHO, layTep, soBookingTrong, tepCuaTin, tepCungAlbum, xuLyAnh, type TepCho } from "./chung-tu.ts";
import { ghepNguCanh, laYeuCauLamLai, soBookingTuTinBot } from "./ngu-canh.ts";
import { chuanHoaGiongNoi } from "./giong-noi.ts";
import { congDanhTinh, khopBiMat, moPhien, type Phien } from "./danh-tinh.ts";

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

// Tải ảnh/file người nhắn gửi lên (Bot API cho tải tối đa 20 MB)
async function taiFile(fileId: string): Promise<{ bytes: Uint8Array }> {
  const r = await (await tg("getFile", { file_id: fileId })).json();
  if (!r.ok) throw new Error(r.description ?? "getFile lỗi");
  const res = await fetch(`https://api.telegram.org/file/bot${env("TELEGRAM_BOT_TOKEN")}/${r.result.file_path}`);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return { bytes: new Uint8Array(await res.arrayBuffer()) };
}

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

// ---------------- Lễ tân ----------------
// 10/2026: chủ dự án bỏ phần GIAO VIỆC khỏi bot, bot đổi tên Thư kí → Lễ tân và chỉ lo booking.
// Code đọc việc vẫn còn ở parse.ts (parseTask) để bật lại khi cần; việc thì ghi trên Mô Hub.
const VAI_TRO: Record<string, string> = { admin: "quản trị", manager: "quản lý", staff: "nhân viên", viewer: "chỉ xem" };
const TEN_BOT = "Lễ tân Mô";

const HELP = `Lễ tân Mô 🛎 — sắp xếp booking các nhà của Mô
Nhắn tự nhiên, càng đủ càng tốt (không cần đúng thứ tự):

ĐẶT PHÒNG — có tên căn/nhà + ngày là tôi hiểu:
  đặt Gừng cho Anna từ 1/10 đến 1/12, 20tr/tháng, cọc 5tr
  Nhà Sen 10-15/10 anh Nam 0905123456 airbnb
  book Củ Sả 20/10 3 đêm 800k/đêm, khách Hàn 2 người lớn 1 trẻ em, bay tới 14h, đón sân bay
  khách thuê Thơm cả tháng 12, chị Hoa, môi giới chị Lan hoa hồng 2tr
Tôi luôn hiện bản xem trước, bấm ✅ mới ghi vào lịch.

Tôi đọc được: tên khách (cho / tên / anh / chị / Mr…), SĐT, email, quốc tịch,
số khách, giờ đến, giá (tổng · /tháng · /đêm), trả trước, cọc bảo đảm,
hoa hồng, kênh (Airbnb, Booking, Agoda, Traveloka, môi giới, trực tiếp…),
miễn phí, yêu cầu riêng (đón sân bay, nôi em bé, giường phụ…)
và "ghi chú: …" (giữ nguyên văn).

BỔ SUNG cho booking đã có:
  #12 sđt 0905123456 · #12 cọc 5tr · #12 khách Nhật, 3 người
  #12 tên Kim Min-ji · #12 ghi chú: đến muộn

HỎI NHANH (gõ lời hoặc lệnh):
  căn nào trống 10-15/10 → /trong 10/10 - 15/10
  tìm Anna · tra 0905123456 → /tim
  xem #12 → /xem 12
  ai đang ở · hôm nay → /lich
  booking sắp tới → /dat
  dời 12 sang 5-8/11 → /doi 12 5/11 - 8/11
  hủy booking 12 → /huy 12
  /nha — danh sách nhà & tên căn

ẢNH HỘ CHIẾU / CCCD / GHI CHÚ — gửi ảnh (hoặc file PDF) kèm chú thích:
  #12 passport C1234567   → lưu vào booking #12, ghi số hộ chiếu vào hồ sơ khách
  #12 ghi chú             → ảnh ghi chú của booking #12
  Không ghi số booking thì tôi hỏi lại bằng nút. Gửi nhiều ảnh một lượt: chú thích ở ảnh đầu là đủ.
  Ảnh chỉ quản trị và quản lý xem được, hiện trong phần Ghi chú của booking trên lịch,
  tự xóa khi đã lưu 3 tháng và khách đã trả phòng.

NHẮN BỔ SUNG / LÀM LẠI: bấm giữ tin cũ → Trả lời (Reply), nhắn thêm thông tin hoặc "làm lại".
  Trả lời tin "Đã tạo booking #12" của tôi = bổ sung cho #12.

Tin nhắn thoại: bấm micro trên BÀN PHÍM rồi đọc, tôi hiểu cả "ngày một tháng mười".
Tôi làm đúng theo quyền của tài khoản Mô Hub đã liên kết với chat này.`;

const LENH_MENU = [
  { command: "trong", description: "Căn nào còn trống (vd /trong 10/10 - 15/10)" },
  { command: "tim", description: "Tìm khách theo tên hoặc SĐT" },
  { command: "xem", description: "Xem chi tiết booking (vd /xem 12)" },
  { command: "dat", description: "Booking sắp tới" },
  { command: "lich", description: "Báo cáo hôm nay: ai đến, ai đi, ai đang ở" },
  { command: "sua", description: "Bổ sung thông tin booking (vd /sua 12 sđt 0905…)" },
  { command: "doi", description: "Đổi ngày booking (vd /doi 12 5/11 - 8/11)" },
  { command: "huy", description: "Hủy booking (vd /huy 12)" },
  { command: "nha", description: "Danh sách nhà và tên căn" },
  { command: "help", description: "Hướng dẫn nhắn tin cho Lễ tân" },
];

// Đổi tên hiển thị + menu lệnh trên Telegram. Chạy một lần mỗi lần function khởi động,
// chỉ gọi set… khi tên còn khác (Telegram giới hạn số lần đổi tên).
let daCaiBot = false;
async function caiDatBot() {
  if (daCaiBot) return;
  daCaiBot = true;
  try {
    const ten = await (await tg("getMyName", {})).json();
    if (ten?.result?.name === TEN_BOT) return;
    await tg("setMyName", { name: TEN_BOT });
    await tg("setMyCommands", { commands: LENH_MENU });
    await tg("setMyShortDescription", { short_description: "Lễ tân Mô Đi Phê — ghi và tra booking các nhà của Mô." });
    await tg("setMyDescription", { description: "Nhắn booking tự nhiên (căn, ngày, tên khách, SĐT, giá…), tôi hiện bản xem trước rồi mới ghi vào lịch Mô House." });
  } catch { /* lỗi mạng thì để lần khởi động sau */ }
}

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
  // Ảnh giấy tờ khách: lưu đủ 3 tháng và khách đã trả phòng → xóa file trong kho rồi xóa dòng (Nghị định 13/2023)
  const { data: hetHan } = await may.rpc("chung_tu_qua_han");
  if (hetHan?.length) {
    const { error } = await may.storage.from(KHO).remove(hetHan.map((x: any) => x.path));
    if (!error) {
      await may.from("booking_files").delete().in("id", hetHan.map((x: any) => x.id));
      await tg("sendMessage", { chat_id: Number(ADMIN_CHAT), text: `🗑 Đã tự xóa ${hetHan.length} ảnh giấy tờ khách (lưu quá 3 tháng, khách đã trả phòng).` });
    }
  }
  return new Response("ok");
}

// ---------------- Xử lý webhook ----------------
Deno.serve(async (req) => {
  if (req.headers.has("X-Mo-Cron")) return xuLyCron(req);

  if (!khopBiMat(req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", env("TELEGRAM_WEBHOOK_SECRET")))
    return new Response("forbidden", { status: 403 });
  const up = await req.json();
  await caiDatBot();
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
    const ctx: Ctx = { db: phien.db, tg, HUB, LICH, taiFile };
    if (cq) await xuLyNut(ctx, cq);
    else if (msg) await xuLyTinNhan(phien, ctx, msg, chat);
  } finally {
    await phien.dong();
  }
  return new Response("ok");
});

// ---------------- Bấm nút ----------------
async function xuLyNut(ctx: Ctx, cq: any) {
  const ghiChu = await xuLyNutBooking(ctx, cq);
  // Nút việc (c:/x:/p:) trên các tin nhắn cũ của Thư kí: phần giao việc đã tắt
  await tg("answerCallbackQuery", {
    callback_query_id: cq.id,
    text: ghiChu ?? "Lễ tân không còn xử lý việc. Sửa việc trên Mô Hub nhé.",
  });
}

// ---------------- Tin nhắn ----------------
async function xuLyTinNhan(p: Phien, ctx: Ctx, msg: any, chat: number) {
  const db = p.db;
  // Tin nhắn thoại / ghi âm: Lễ tân không nghe được (không dùng dịch vụ nhận dạng trả phí).
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
  // Ảnh / file (hộ chiếu, CCCD, ảnh ghi chú) → lưu vào booking. Chú thích "#12" thì lưu thẳng;
  // chú thích là nội dung đặt phòng thì tạo booking rồi gắn ảnh; không rõ thì hỏi booking nào.
  const tep = layTep(msg);
  if (tep === "khong_nhan") {
    await tg("sendMessage", { chat_id: chat, text: "Tôi chỉ lưu được ảnh (JPG, PNG, WEBP, HEIC) và PDF." });
    return;
  }
  const rep = msg.reply_to_message;
  // Trả lời (reply) tin của bot có "booking #12" → ảnh / thông tin mới thuộc booking #12
  const idTuBot = rep?.from?.is_bot ? soBookingTuTinBot(rep.text ?? rep.caption) : null;

  if (tep) {
    await ghiNhanTep(ctx, tep, msg.message_id);
    if (idTuBot && !soBookingTrong(tep.caption)) tep.caption = `#${idTuBot} ${tep.caption ?? ""}`.trim();
    const chuThich = chuanHoaGiongNoi(tep.caption ?? "");
    const laGiayTo = tep.kind === "passport" || tep.kind === "cccd";
    if (chuThich && !soBookingTrong(chuThich)) await nhoTinCuoi(ctx, chuThich, [tep]);
    if (chuThich && !soBookingTrong(chuThich) && !laGiayTo && await xuLyDatPhong(ctx, chat, chuThich, [tep])) return;
    await xuLyAnh(ctx, chat, tep);
    return;
  }
  const goc: string | undefined = msg.text;
  if (!goc) return;
  // Chuẩn hóa câu đọc bằng giọng nói: số viết bằng chữ, "ngày 1 tháng 10" → 1/10
  const text: string = chuanHoaGiongNoi(goc.trim());

  // ---- Ngữ cảnh: trả lời tin cũ, hoặc "làm lại" ----
  if (!text.startsWith("/")) {
    // Trả lời tin của bot về booking #12 → coi như bổ sung cho #12 (trừ khi là câu hỏi/lệnh khác)
    if (idTuBot && !docYDinh(text) && !laYeuCauLamLai(text)) {
      await lenhSua(ctx, chat, idTuBot, text);
      return;
    }
    // Trả lời tin CỦA MÌNH (vd album ảnh hộ chiếu + nội dung booking) → làm lại với nội dung đó
    let cu: { text: string; teps: TepCho[] } | null = null;
    if (rep && !rep.from?.is_bot && !docYDinh(text)) {
      const tepRep = layTep(rep);
      let teps: TepCho[] = await tepCuaTin(ctx, rep.message_id);
      if (!teps.length && tepRep && tepRep !== "khong_nhan") teps = [tepRep];
      if (rep.media_group_id) teps = await tepCungAlbum(ctx, [rep.media_group_id], teps);
      cu = { text: chuanHoaGiongNoi((rep.text ?? rep.caption ?? "").trim()), teps };
    } else if (laYeuCauLamLai(text) && !docYDinh(text)) {
      cu = await layTinCuoi(ctx);
      if (!cu) {
        await tg("sendMessage", { chat_id: chat, text: "Bạn muốn làm lại tin nào? Bấm giữ tin đó → Trả lời (Reply), rồi nhắn \"làm lại\"." });
        return;
      }
    }
    if (cu) {
      const ghep = ghepNguCanh(cu.text, text);
      if (await xuLyDatPhong(ctx, chat, ghep, cu.teps)) return;
      if (cu.teps.length) { await xuLyAnh(ctx, chat, { ...cu.teps[0], caption: cu.teps[0].caption ?? ghep }); return; }
      // Không phải booking → xử lý tin mới như bình thường ở dưới
    }
  }

  // "căn nào trống 10/10", "tìm Anna", "#12 sđt …" → quy về lệnh tương ứng
  const yd = text.startsWith("/") ? null : docYDinh(text);
  const [lenhGoc, ...args] = yd ? [`/${yd.lenh}`, ...yd.thamSo.split(/\s+/).filter(Boolean)] : text.split(/\s+/);
  const cmd = lenhGoc.toLowerCase().replace(/@\w+$/, "");   // "/trong@ThuKiMo_bot" khi gõ trong nhóm
  const arg = args.join(" ");
  const so = (x?: string) => Number((x ?? "").replace(/^#/, ""));

  if (cmd === "/start" || cmd === "/help")
    await tg("sendMessage", { chat_id: chat, text: `👤 ${p.nguoi.ten} (${VAI_TRO[p.nguoi.vai_tro] ?? p.nguoi.vai_tro})\n\n${HELP}` });
  else if (cmd === "/lich") await guiBaoCao(ctx, chat);
  else if (cmd === "/dat") await lenhDat(ctx, chat);
  else if (cmd === "/trong") await lenhTrong(ctx, chat, arg);
  else if (cmd === "/tim") await lenhTim(ctx, chat, arg);
  else if (cmd === "/xem") {
    if (!so(args[0])) await tg("sendMessage", { chat_id: chat, text: "Cú pháp: /xem 12" });
    else await lenhXem(ctx, chat, so(args[0]));
  }
  else if (cmd === "/sua") {
    if (!so(args[0])) await tg("sendMessage", { chat_id: chat, text: "Cú pháp: /sua 12 sđt 0905123456 cọc 5tr" });
    else await lenhSua(ctx, chat, so(args[0]), args.slice(1).join(" "));
  }
  else if (cmd === "/huy") {
    if (!so(args[0])) await tg("sendMessage", { chat_id: chat, text: "Cú pháp: /huy 12" });
    else await lenhHuy(ctx, chat, so(args[0]));
  }
  else if (cmd === "/doi") {
    if (!so(args[0])) await tg("sendMessage", { chat_id: chat, text: "Cú pháp: /doi 12 5/10 - 5/11" });
    else await lenhDoiNgay(ctx, chat, so(args[0]), args.slice(1).join(" "));
  }
  else if (cmd === "/nha") {
    // RLS lọc sẵn: người bị giới hạn chỉ thấy nhà và căn được giao
    const props = (await db.from("properties").select("id,name,code,aliases").eq("active", true).order("sort")).data ?? [];
    const dsCan = (await db.from("units").select("name,property_id").eq("active", true).order("sort")).data ?? [];
    await tg("sendMessage", {
      chat_id: chat,
      text: props.length
        ? props.map((x: any) => {
          const can = dsCan.filter((u: any) => u.property_id === x.id).map((u: any) => u.name);
          return `🏠 ${x.name} (${x.code})\n   căn: ${can.join(", ") || "—"}\n   gọi tắt: ${(x.aliases ?? []).join(", ") || "—"}`;
        }).join("\n")
        : "Bạn chưa được giao nhà nào, hoặc hệ thống chưa có nhà.",
    });
  }
  else if (["/viec", "/xong", "/xoa"].includes(cmd))
    await tg("sendMessage", { chat_id: chat, text: `Lễ tân không còn ghi/sửa việc. Việc cần làm xem trên Mô Hub:\n${HUB}/viec.html` });
  else if (cmd.startsWith("/")) await tg("sendMessage", { chat_id: chat, text: "Không hiểu lệnh này. Gõ /help." });
  else if (await (async () => { await nhoTinCuoi(ctx, text, []); return xuLyDatPhong(ctx, chat, text); })()) {
    // tin nhắn đặt phòng đã được xử lý (kể cả khi bị từ chối vì không có quyền)
  }
  else if (laViec(text))
    await tg("sendMessage", { chat_id: chat, text: `Đây có vẻ là việc cần làm. Lễ tân chỉ lo booking — việc ghi trên Mô Hub nhé:\n${HUB}/viec.html` });
  else {
    const hieu = daHieu(parseBooking(text, await layCan(db)));
    await tg("sendMessage", {
      chat_id: chat,
      text: (hieu ? `${hieu}Còn thiếu ${hieu.includes("căn ") || hieu.includes("nhà ") ? "ngày ở" : "tên căn và ngày ở"} nên tôi chưa tạo booking.\n\n`
        : "Tôi chưa thấy tên căn và ngày trong tin này.\n") +
        "Ví dụ:\n  Gừng 10-12/10 anh Nam 0905123456\n  căn nào trống 20/10 3 đêm\n  tìm Anna\n" +
        "Nhắn bổ sung bằng cách Trả lời (Reply) tin cũ, tôi sẽ ghép lại. Gõ /help để xem đủ cách nhắn.",
    });
  }
}

// ---------------- Tin cuối: để "làm lại" khi không trả lời tin nào ----------------
async function nhoTinCuoi(ctx: Ctx, text: string, teps: TepCho[]) {
  await ctx.db.from("bot_booking_drafts").delete().eq("payload->>kieu", "tin_cuoi");   // RLS: chỉ nháp của chính người nhắn
  await ctx.db.from("bot_booking_drafts").insert({ text, payload: { kieu: "tin_cuoi", text, teps } });
}
async function layTinCuoi(ctx: Ctx): Promise<{ text: string; teps: TepCho[] } | null> {
  const { data } = await ctx.db.from("bot_booking_drafts").select("payload")
    .eq("payload->>kieu", "tin_cuoi").order("id", { ascending: false }).limit(1);
  const p = data?.[0]?.payload;
  if (!p) return null;
  const nhom = [...new Set((p.teps ?? []).map((t: TepCho) => t.media_group_id).filter(Boolean))] as string[];
  return { text: p.text, teps: nhom.length ? await tepCungAlbum(ctx, nhom, p.teps) : (p.teps ?? []) };
}
