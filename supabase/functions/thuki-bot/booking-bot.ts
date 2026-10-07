// Lễ tân — phần ĐẶT PHÒNG: đọc tin nhắn, xem trước, chờ xác nhận rồi mới ghi.
// Lệnh tra cứu (/trong, /tim, /xem, /sua) và báo cáo 08:00 sáng cũng ở đây.
import {
  anEmail, anSdt, chuanHoaKhoangNgay, docChiTiet, laTinDatPhong, parseBooking, thangTron, timNgay,
  type BanNhap, type Can, type ThongTinKhach,
} from "./parse-booking.ts";
import { iso, vnToday } from "./parse.ts";
import { demChungTu, ganAnhSauKhiTao, xuLyNutAnh, type TepCho } from "./chung-tu.ts";

export type Ctx = {
  db: any;
  tg: (method: string, body: unknown) => Promise<Response>;
  HUB: string;
  LICH: string;               // địa chỉ Mô House Calendar
  taiFile?: (fileId: string) => Promise<{ bytes: Uint8Array }>;   // tải ảnh khách gửi từ Telegram
};

// Bản nháp đặt phòng có thể mang theo ảnh gửi kèm (hộ chiếu…) để gắn sau khi tạo booking
type NhapCoAnh = BanNhap & { anh?: TepCho[] };

const TT: Record<string, string> = {
  giu_cho: "🟡 Giữ chỗ", da_coc: "🟢 Đã cọc", dang_o: "🏠 Đang ở", ket_thuc: "⚪ Đã kết thúc", huy: "✖ Đã hủy",
};
const KENH: Record<string, string> = {
  truc_tiep: "trực tiếp", moi_gioi: "môi giới", airbnb: "Airbnb", booking: "Booking.com", agoda: "Agoda", khac: "khác",
};
const tien = (n: number | null | undefined) => (n ? Number(n).toLocaleString("vi-VN") + " đ" : "—");
const dm = (s: string | null | undefined) => (s ? `${s.slice(8)}/${s.slice(5, 7)}` : "—");
const soDem = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const homNay = () => iso(vnToday());

// Chặn sớm cho dễ hiểu; chặn thật vẫn là RLS (can_book) trong database.
const KHONG_QUYEN_DAT = "🚫 Tài khoản của bạn không có quyền đặt phòng hay xem booking qua Lễ tân.\n" +
  "Chỉ quản trị viên và quản lý làm được việc này.";
export async function coQuyenDatPhong(ctx: Ctx, chat: number): Promise<boolean> {
  const { data } = await ctx.db.rpc("can_book");
  if (data === true) return true;
  await ctx.tg("sendMessage", { chat_id: chat, text: KHONG_QUYEN_DAT });
  return false;
}

// ---------------- Lấy danh sách căn kèm tên nhà ----------------
export async function layCan(db: any): Promise<Can[]> {
  const { data } = await db.from("units")
    .select("id,name,property_id,list_rent_month,properties(name,aliases)")
    .eq("active", true).order("sort");
  return (data ?? []).map((u: any) => ({
    id: u.id, name: u.name, property_id: u.property_id,
    property_name: u.properties?.name ?? "",
    property_aliases: u.properties?.aliases ?? [],
    list_rent_month: u.list_rent_month,
  }));
}

// ---------------- Bản xem trước ----------------
function dongKhach(k: ThongTinKhach | undefined, ten: string | null): string {
  const phu = [k?.sdt ? `📞 ${anSdt(k.sdt)}` : "", k?.email ? `✉️ ${anEmail(k.email)}` : "", k?.quoc_tich ? `🌏 ${k.quoc_tich}` : ""]
    .filter(Boolean).join(" · ");
  return `👤 ${ten ?? "(chưa có tên khách)"}${phu ? "\n" + phu : ""}`;
}

function xemTruoc(n: BanNhap): string {
  const r = n.row;
  const dem = r.start_date && r.end_date ? soDem(r.start_date, r.end_date) : 0;
  const doDai = r.term_type === "dai_han"
    ? `${(dem / 30).toFixed(dem % 30 === 0 ? 0 : 1)} tháng` : `${dem} đêm`;
  const giaTien = r.is_free ? "🎁 Miễn phí tiền phòng"
    : `💰 ${tien(r.rent_amount)}${r.term_type === "dai_han" ? "/tháng" : " tổng"}` +
      (n.giaDem && r.term_type === "ngan_han" ? ` (${tien(n.giaDem)} × ${dem} đêm)` : "");
  const tienPhu = [
    r.deposit_amount ? `trả trước ${tien(r.deposit_amount)}` : n.daThu ? "" : "chưa trả trước",
    r.security_deposit ? `🔒 cọc bảo đảm ${tien(r.security_deposit)}` : "",
  ].filter(Boolean).join(" · ");
  const HT: Record<string, string> = { tien_mat: "tiền mặt", chuyen_khoan: "chuyển khoản" };
  return [
    `📋 Kiểm lại giúp tôi trước khi ghi:`,
    ``,
    `🏠 ${n.can?.property_name ?? ""} — ${n.can?.name ?? "?"}`,
    dongKhach(n.khach, n.tenKhach),
    `📅 ${dm(r.start_date)} → ${dm(r.end_date)} · ${doDai}`,
    `${giaTien}${tienPhu ? " · " + tienPhu : ""}`,
    n.daThu ? `💵 Đã thu ${tien(n.daThu.so)}${n.daThu.hinhThuc ? " · " + HT[n.daThu.hinhThuc] : ""} · ngày ${dm(n.daThu.ngay ?? homNay())} → ghi vào lịch thu tiền` : null,
    n.cocLaBaoDam ? `ℹ️ Thuê tháng nên "cọc" ghi là cọc bảo đảm (hoàn lại cuối hợp đồng). Nếu là tiền trả trước, bấm ✖ rồi nhắn lại "trả trước ${tien(r.security_deposit)}".` : null,
    `📌 ${TT[r.status]}${n.otaXacNhan ? " (đã thanh toán qua sàn)" : ""}${r.channel ? ` · ${KENH[r.channel]}` : ""}` +
      (r.broker_name ? ` · môi giới ${r.broker_name}` : "") +
      (r.commission_amount ? ` · hoa hồng ${tien(r.commission_amount)}` : ""),
    r.note ? `📝 ${r.note}` : null,
  ].filter((x) => x !== null).join("\n");
}

// "Tôi hiểu: căn Tía Tô · khách Dominic · 20tr/tháng" — để người nhắn biết chỉ cần bổ sung phần thiếu
export function daHieu(n: BanNhap): string {
  const r = n.row;
  const phan = [
    n.can ? `căn ${n.can.name}` : n.canUngVien.length ? `nhà ${n.canUngVien[0].property_name}` : null,
    n.tenKhach ? `khách ${n.tenKhach}` : null,
    r.start_date ? `từ ${dm(r.start_date)}` : null,
    r.end_date ? `đến ${dm(r.end_date)}` : null,
    r.rent_amount ? `giá ${tien(r.rent_amount)}` : null,
  ].filter(Boolean);
  return phan.length ? `Tôi hiểu: ${phan.join(" · ")}.\n` : "";
}

const nutXacNhan = (id: number) => ({
  inline_keyboard: [[
    { text: "✅ Tạo booking", callback_data: `b:${id}` },
    { text: "✖ Bỏ", callback_data: `bx:${id}` },
  ]],
});

// ---------------- Khách: tìm hồ sơ cũ hoặc tạo mới ----------------
// Ưu tiên khớp theo SĐT (chắc chắn hơn tên). Hồ sơ cũ thiếu SĐT/email/quốc tịch thì bổ sung, không ghi đè.
async function layHoacTaoKhach(db: any, k: ThongTinKhach): Promise<string | null> {
  let cu: any = null;
  if (k.sdt) cu = (await db.from("guests").select("id,full_name,phone,email,nationality").eq("phone", k.sdt).limit(1)).data?.[0];
  if (!cu && k.ten) cu = (await db.from("guests").select("id,full_name,phone,email,nationality").ilike("full_name", k.ten).limit(1)).data?.[0];
  if (cu) {
    const bu: Record<string, string> = {};
    if (k.sdt && !cu.phone) bu.phone = k.sdt;
    if (k.email && !cu.email) bu.email = k.email;
    if (k.quoc_tich && !cu.nationality) bu.nationality = k.quoc_tich;
    if (Object.keys(bu).length) await db.from("guests").update(bu).eq("id", cu.id);
    return cu.id;
  }
  if (!k.ten && !k.sdt) return null;
  const { data: moi } = await db.from("guests").insert({
    full_name: k.ten ?? `Khách ${anSdt(k.sdt)}`, phone: k.sdt, email: k.email, nationality: k.quoc_tich,
  }).select("id").single();
  return moi?.id ?? null;
}

// ---------------- Tạo booking ----------------
async function ghiBooking(ctx: Ctx, chat: number, nhap: NhapCoAnh) {
  const { db, tg, LICH } = ctx;
  // Bản nháp cũ (trước khi có Lễ tân) không có trường khach
  const khach: ThongTinKhach = nhap.khach ?? { ten: nhap.tenKhach, sdt: null, email: null, quoc_tich: null };
  const guestId = await layHoacTaoKhach(db, khach);

  const { data, error } = await db.from("bookings")
    .insert({ ...nhap.row, guest_id: guestId })
    .select("id").single();

  if (error) {
    const loi = error.code === "23P01"
      ? `❌ Căn này đã có khách trong khoảng ${dm(nhap.row.start_date)} → ${dm(nhap.row.end_date)}.\n` +
        `Gõ /trong ${dm(nhap.row.start_date)} - ${dm(nhap.row.end_date)} để xem căn nào còn trống.`
      : `❌ Không ghi được: ${error.message}`;
    return tg("sendMessage", { chat_id: chat, text: loi });
  }

  let veThu = "";
  if (nhap.daThu) {
    const ngay = nhap.daThu.ngay ?? homNay();
    const { error: eThu } = await db.from("payments").insert({
      booking_id: data.id, kind: "tien_thue", period_label: "Thu ngày " + dm(ngay) + "/" + ngay.slice(0, 4),
      amount_due: nhap.daThu.so, amount_paid: nhap.daThu.so, due_date: ngay, paid_date: ngay,
      method: nhap.daThu.hinhThuc ?? "khac", note: "Ghi qua Lễ tân",
    });
    veThu = eThu ? `\n❌ Chưa ghi được khoản đã thu: ${eThu.message}` : `\n💵 Đã ghi khoản thu ${tien(nhap.daThu.so)} vào lịch thu tiền.`;
  }
  const veAnh = nhap.anh?.length ? await ganAnhSauKhiTao(ctx, data.id, nhap.anh) : "";
  return tg("sendMessage", {
    chat_id: chat,
    text: `✅ Đã tạo booking #${data.id}\n${xemTruoc(nhap).split("\n").slice(2).filter((x) => !x.startsWith("ℹ️")).join("\n")}${veThu}${veAnh}\n\n` +
      `Bổ sung sau: #${data.id} sđt 0905… · #${data.id} cọc 5tr · #${data.id} ghi chú: …\n` +
      `Ảnh hộ chiếu / ghi chú: gửi ảnh kèm chú thích "#${data.id} passport"\n${LICH}`,
    disable_web_page_preview: true,
  });
}

// ---------------- Xử lý tin nhắn đặt phòng ----------------
// tep: ảnh gửi kèm (chú thích của ảnh là nội dung booking) → lưu vào nháp, gắn sau khi bấm ✅
export async function xuLyDatPhong(ctx: Ctx, chat: number, text: string, teps: TepCho[] = []): Promise<boolean> {
  const { db, tg } = ctx;
  const cans = await layCan(db);
  if (!laTinDatPhong(text, cans)) return false;
  if (!(await coQuyenDatPhong(ctx, chat))) return true;   // là tin đặt phòng nhưng không có quyền → dừng ở đây

  if (!cans.length) {
    await tg("sendMessage", { chat_id: chat, text: "Chưa có căn nào trong hệ thống. Thêm căn ở Mô House Calendar trước đã." });
    return true;
  }

  const nhap: NhapCoAnh = parseBooking(text, cans);
  if (teps.length) nhap.anh = teps;

  // Thiếu ngày → nói rõ thiếu gì, không đoán
  if (!nhap.row.start_date || !nhap.row.end_date) {
    await tg("sendMessage", {
      chat_id: chat,
      text: `${daHieu(nhap)}Tôi chưa rõ ${nhap.thieu.filter((x) => x !== "căn").join(" và ")}.\n\nNhắn lại theo mẫu:\n` +
        `  đặt Gừng cho Anna từ 1/10 đến 1/12, 20tr, cọc 5tr\n` +
        `  Nhà Sen 10-15/10 anh Nam 0905123456 airbnb\n` +
        `  đặt Thơm 3 đêm từ 20/10, 800k/đêm`,
    });
    return true;
  }

  // Lưu nháp để bấm nút xác nhận mới ghi
  const { data: draft } = await db.from("bot_booking_drafts")
    .insert({ text, payload: nhap }).select("id").single();
  // Album nhiều ảnh: các ảnh không chú thích tìm tới nháp này rồi gắn theo khi bấm ✅
  for (const g of new Set(teps.map((t) => t.media_group_id).filter(Boolean)))
    await db.from("bot_booking_drafts").insert({ text: "album", payload: { kieu: "album", media_group_id: g, nhap_id: draft.id } });

  // Chưa rõ căn → hỏi lại bằng nút
  if (!nhap.can) {
    const dsCan = nhap.canUngVien.length ? nhap.canUngVien : cans;
    const hang: any[] = [];
    for (let i = 0; i < dsCan.length; i += 2) {
      hang.push(dsCan.slice(i, i + 2).map((c) => ({
        text: c.name, callback_data: `bu:${draft.id}:${c.id}`,
      })));
    }
    hang.push([{ text: "✖ Bỏ", callback_data: `bx:${draft.id}` }]);
    await tg("sendMessage", {
      chat_id: chat,
      text: `Căn nào vậy?\n📅 ${dm(nhap.row.start_date)} → ${dm(nhap.row.end_date)}` +
        (nhap.tenKhach ? `\n👤 ${nhap.tenKhach}` : ""),
      reply_markup: { inline_keyboard: hang },
    });
    return true;
  }

  await tg("sendMessage", {
    chat_id: chat,
    text: xemTruoc(nhap) + (nhap.anh?.length ? `\n📎 ${nhap.anh.length} ảnh sẽ được lưu kèm khi bấm ✅` : ""),
    reply_markup: nutXacNhan(draft.id),
  });
  return true;
}

// ---------------- Bấm nút ----------------
export async function xuLyNutBooking(ctx: Ctx, cq: any): Promise<string | null> {
  const { db, tg } = ctx;
  const chat = cq.message.chat.id;
  const [loai, a, b] = String(cq.data).split(":");

  if (loai === "bx") {
    await db.from("bot_booking_drafts").delete().eq("id", a);
    await db.from("bot_booking_drafts").delete().eq("payload->>kieu", "album").eq("payload->>nhap_id", a);
    await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: "Đã bỏ, chưa ghi gì cả." });
    return "Đã bỏ";
  }

  if (loai === "b" || loai === "bu") {
    const { data: draft } = await db.from("bot_booking_drafts").select("*").eq("id", a).maybeSingle();
    if (!draft) return "Bản nháp đã hết hạn";
    const nhap: BanNhap = draft.payload;

    if (loai === "bu") {                       // chọn căn rồi mới xem trước
      const cans = await layCan(db);
      const can = cans.find((c) => c.id === b) ?? null;
      if (!can) return "Không tìm thấy căn";
      nhap.can = can;
      nhap.row.unit_id = can.id;
      if (!nhap.row.rent_amount && nhap.row.term_type === "dai_han" && !nhap.row.is_free) nhap.row.rent_amount = can.list_rent_month ?? null;
      await db.from("bot_booking_drafts").update({ payload: nhap }).eq("id", a);
      await tg("editMessageText", {
        chat_id: chat, message_id: cq.message.message_id,
        text: xemTruoc(nhap), reply_markup: nutXacNhan(Number(a)),
      });
      return "Đã chọn căn";
    }

    await db.from("bot_booking_drafts").delete().eq("id", a);
    await tg("deleteMessage", { chat_id: chat, message_id: cq.message.message_id });
    await ghiBooking(ctx, chat, nhap);
    return "Đã ghi";
  }

  if (loai === "ba") return xuLyNutAnh(ctx, cq, a, Number(b));   // chọn booking cho ảnh vừa gửi

  if (loai === "bs") {                          // xác nhận bổ sung thông tin (/sua)
    const { data: draft } = await db.from("bot_booking_drafts").select("*").eq("id", a).maybeSingle();
    if (!draft) return "Bản nháp đã hết hạn";
    await db.from("bot_booking_drafts").delete().eq("id", a);
    const ketQua = await apDungSua(ctx, draft.payload);
    await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: ketQua });
    return "Đã cập nhật";
  }

  if (loai === "hb") {                          // xác nhận hủy booking
    const { data } = await db.from("bookings").update({ status: "huy" }).eq("id", a)
      .select("id, units(name)").maybeSingle();
    await tg("editMessageText", {
      chat_id: chat, message_id: cq.message.message_id,
      text: data ? `✖ Đã hủy booking #${a} (${data.units?.name ?? ""}). Căn này trống trở lại.` : `Không tìm thấy booking #${a}.`,
    });
    return "Đã hủy";
  }

  return null;                                   // không phải nút của phần đặt phòng
}

// ---------------- Lệnh ----------------
const COT_BOOKING = "id,start_date,end_date,status,term_type,rent_amount,deposit_amount,security_deposit,is_free," +
  "channel,broker_name,commission_amount,note,guest_id,units(name,properties(name)),guests(full_name,phone,email,nationality)";

function dongNgan(b: any): string {
  return `${TT[b.status]} #${b.id} ${b.units?.name ?? ""} — ${b.guests?.full_name ?? "(chưa ghi tên)"}\n` +
    `    ${dm(b.start_date)} → ${dm(b.end_date)} · ${soDem(b.start_date, b.end_date)} đêm`;
}

// /dat — sắp tới có ai
export async function lenhDat(ctx: Ctx, chat: number) {
  const { db, tg, LICH } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const { data } = await db.from("bookings")
    .select(COT_BOOKING)
    .is("deleted_at", null).neq("status", "huy")
    .gte("end_date", homNay()).order("start_date").limit(30);

  if (!data?.length) {
    return tg("sendMessage", { chat_id: chat, text: "Chưa có booking nào sắp tới." });
  }
  return tg("sendMessage", {
    chat_id: chat, disable_web_page_preview: true,
    text: `📖 Booking sắp tới (${data.length}):\n\n${data.map(dongNgan).join("\n")}\n\nXem chi tiết: /xem <số>\n${LICH}`,
  });
}

// Đọc khoảng ngày cho /trong: "10/10 - 15/10", "10-15/10", "20/12 3 đêm", "tháng 11"; trống → đêm nay
export function docKhoang(thamSo: string, today = vnToday()): [string, string] | null {
  const t = chuanHoaKhoangNgay(thamSo);
  const ngay = timNgay(t, today);
  if (ngay.length >= 2) return ngay[1] > ngay[0] ? [ngay[0], ngay[1]] : null;
  if (ngay.length === 1) {
    const dem = t.match(/(\d{1,3})\s*(?:đêm|dem|ngày|ngay|hôm|nights?)(?![\p{L}])/iu);
    const n = dem ? Number(dem[1]) : 1;
    return [ngay[0], iso(new Date(Date.parse(ngay[0]) + n * 86400e3))];
  }
  const thang = thangTron("trong " + t.replace(/^(?:cả|nguyên|trọn)\s+/i, ""), today);
  if (thang) return thang;
  if (!t.trim()) return [iso(today), iso(new Date(today.getTime() + 86400e3))];
  return null;
}

// /trong 10/10 - 15/10 — căn nào còn trống
export async function lenhTrong(ctx: Ctx, chat: number, thamSo: string) {
  const { db, tg } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const khoang = docKhoang(thamSo);
  if (!khoang) {
    return tg("sendMessage", { chat_id: chat, text: "Cú pháp: /trong 10/10 - 15/10 · /trong 20/12 3 đêm · /trong tháng 11 · /trong (đêm nay)" });
  }
  const [tu, den] = khoang;
  const cans = await layCan(db);
  const { data: ban } = await db.from("bookings")
    .select("unit_id,start_date,end_date,guests(full_name)")
    .is("deleted_at", null).neq("status", "huy")
    .lt("start_date", den).gt("end_date", tu);
  const banTheoCan = new Map<string, any[]>();
  for (const b of ban ?? []) banTheoCan.set(b.unit_id, [...(banTheoCan.get(b.unit_id) ?? []), b]);

  const trong = cans.filter((c) => !banTheoCan.has(c.id));
  const kin = cans.filter((c) => banTheoCan.has(c.id));
  const nhom = (ds: Can[], dong: (c: Can) => string) => {
    const theoNha = new Map<string, string[]>();
    for (const c of ds) theoNha.set(c.property_name ?? "", [...(theoNha.get(c.property_name ?? "") ?? []), dong(c)]);
    return [...theoNha].map(([nha, d]) => `${nha}: ${d.join(", ")}`).join("\n");
  };
  const phan = [`🔑 ${dm(tu)} → ${dm(den)} (${soDem(tu, den)} đêm)`, ""];
  phan.push(trong.length ? `✅ Còn trống (${trong.length}):\n${nhom(trong, (c) => c.name)}` : "✅ Còn trống: không căn nào");
  if (kin.length) {
    phan.push("", `⛔ Đã có khách (${kin.length}):\n` + nhom(kin, (c) => {
      const b = banTheoCan.get(c.id)!.sort((x, y) => x.start_date.localeCompare(y.start_date));
      return `${c.name} (${b.map((x) => `${dm(x.start_date)}→${dm(x.end_date)}`).join("; ")})`;
    }));
  }
  if (trong.length) phan.push("", `Đặt luôn: đặt ${trong[0].name} ${dm(tu)} - ${dm(den)} cho …`);
  return tg("sendMessage", { chat_id: chat, text: phan.join("\n") });
}

// /tim Anna · /tim 0905123456 — tra khách cũ và các lượt ở
export async function lenhTim(ctx: Ctx, chat: number, q: string) {
  const { db, tg } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  q = q.trim().replace(/^#/, "");
  if (!q) return tg("sendMessage", { chat_id: chat, text: "Cú pháp: /tim Anna · /tim 0905123456 · /tim 12 (số booking)" });

  // Số ngắn = số booking
  if (/^\d{1,6}$/.test(q)) return lenhXem(ctx, chat, Number(q));

  const so = q.replace(/[\s.\-+]/g, "");
  const { data: khach } = /^\d{6,}$/.test(so)
    ? await db.from("guests").select("id,full_name,phone,nationality").ilike("phone", `%${so.slice(-9)}%`).limit(5)
    : await db.from("guests").select("id,full_name,phone,nationality").ilike("full_name", `%${q}%`).limit(5);
  if (!khach?.length) {
    return tg("sendMessage", { chat_id: chat, text: `Không thấy khách nào khớp "${q}". Thử gõ một phần tên, hoặc 6 số cuối SĐT.` });
  }
  const { data: dsBooking } = await db.from("bookings").select(COT_BOOKING)
    .in("guest_id", khach.map((k: any) => k.id)).is("deleted_at", null)
    .order("start_date", { ascending: false }).limit(20);
  const phan = khach.map((k: any) => {
    const cua = (dsBooking ?? []).filter((b: any) => b.guest_id === k.id).slice(0, 4);
    return `👤 ${k.full_name}${k.phone ? ` · 📞 ${anSdt(k.phone)}` : ""}${k.nationality ? ` · 🌏 ${k.nationality}` : ""}\n` +
      (cua.length ? cua.map(dongNgan).join("\n") : "    (chưa có booking)");
  });
  return tg("sendMessage", { chat_id: chat, text: `🔎 Kết quả cho "${q}":\n\n${phan.join("\n\n")}\n\nXem chi tiết: /xem <số>` });
}

// /xem 12 — toàn bộ thông tin một booking
export async function lenhXem(ctx: Ctx, chat: number, id: number) {
  const { db, tg, LICH } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const { data: b } = await db.from("bookings").select(COT_BOOKING).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!b) return tg("sendMessage", { chat_id: chat, text: `Không có booking #${id}.` });
  const g = b.guests;
  const dem = soDem(b.start_date, b.end_date);
  return tg("sendMessage", {
    chat_id: chat, disable_web_page_preview: true,
    text: [
      `📄 Booking #${b.id} · ${TT[b.status]}`,
      `🏠 ${b.units?.properties?.name ?? ""} — ${b.units?.name ?? ""}`,
      dongKhach(g ? { ten: g.full_name, sdt: g.phone, email: g.email, quoc_tich: g.nationality } : undefined, g?.full_name ?? null),
      `📅 ${dm(b.start_date)} → ${dm(b.end_date)} · ${b.term_type === "dai_han" ? `${(dem / 30).toFixed(1)} tháng` : `${dem} đêm`}`,
      b.is_free ? "🎁 Miễn phí tiền phòng"
        : `💰 ${tien(b.rent_amount)}${b.term_type === "dai_han" ? "/tháng" : " tổng"} · trả trước ${tien(b.deposit_amount)}`,
      b.security_deposit ? `🔒 Cọc bảo đảm ${tien(b.security_deposit)}` : null,
      `📌 ${b.channel ? KENH[b.channel] ?? b.channel : "chưa rõ kênh"}${b.broker_name ? ` · môi giới ${b.broker_name}` : ""}` +
        (b.commission_amount ? ` · hoa hồng ${tien(b.commission_amount)}` : ""),
      b.note ? `📝 ${b.note}` : null,
      await (async () => { const c = await demChungTu(ctx, b.id); return c ? `📎 Giấy tờ / ảnh: ${c} (xem trên lịch)` : null; })(),
      "",
      `Bổ sung: #${b.id} sđt … · #${b.id} cọc … · #${b.id} ghi chú: …`,
      `Đổi ngày: /doi ${b.id} 5/11 - 8/11 · Hủy: /huy ${b.id}`,
      LICH,
    ].filter((x) => x !== null).join("\n"),
  });
}

// /sua 12 sđt 0905… cọc 5tr ghi chú: … — bổ sung thông tin, xem trước rồi mới ghi
export async function lenhSua(ctx: Ctx, chat: number, id: number, phanCon: string) {
  const { db, tg } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const { data: b } = await db.from("bookings").select(COT_BOOKING).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!b) return tg("sendMessage", { chat_id: chat, text: `Không có booking #${id}.` });

  const ct = docChiTiet(phanCon, b.units?.name);
  const patch: Record<string, unknown> = {};
  const doi: string[] = [];
  const dem = soDem(b.start_date, b.end_date);
  const { gia, giaDem, coc, cocBaoDam, hoaHong } = ct.tien;
  if (gia !== null) { patch.rent_amount = gia; doi.push(`💰 tiền phòng → ${tien(gia)}`); }
  else if (giaDem !== null && b.term_type === "ngan_han") {
    patch.rent_amount = giaDem * dem; doi.push(`💰 tiền phòng → ${tien(giaDem * dem)} (${tien(giaDem)} × ${dem} đêm)`);
  }
  if (coc !== null) { patch.deposit_amount = coc; patch.deposit_status = "da_nhan"; doi.push(`trả trước → ${tien(coc)}`); }
  if (cocBaoDam !== null) { patch.security_deposit = cocBaoDam; patch.security_deposit_status = "dang_giu"; doi.push(`🔒 cọc bảo đảm → ${tien(cocBaoDam)}`); }
  if (hoaHong !== null) { patch.commission_amount = hoaHong; doi.push(`hoa hồng → ${tien(hoaHong)}`); }
  if (ct.kenh) { patch.channel = ct.kenh; doi.push(`📌 kênh → ${KENH[ct.kenh]}`); }
  if (ct.moiGioi) { patch.broker_name = ct.moiGioi; doi.push(`môi giới → ${ct.moiGioi}`); }
  if (ct.mienPhi) { patch.is_free = true; patch.rent_amount = 0; doi.push("🎁 miễn phí tiền phòng"); }
  const trangThai = ct.trangThai ?? (coc !== null && b.status === "giu_cho" ? "da_coc" : null);
  if (trangThai && trangThai !== b.status && ["giu_cho", "da_coc"].includes(b.status)) {
    patch.status = trangThai; doi.push(`trạng thái → ${TT[trangThai]}`);
  }
  if (ct.ghiChu) {
    patch.note = b.note ? `${b.note} · ${ct.ghiChu}` : ct.ghiChu;
    doi.push(`📝 thêm ghi chú: ${ct.ghiChu}`);
  }
  const k = ct.khach;
  const khach: Record<string, string> = {};
  if (k.sdt) { khach.phone = k.sdt; doi.push(`📞 SĐT → ${anSdt(k.sdt)}`); }
  if (k.email) { khach.email = k.email; doi.push(`✉️ email → ${anEmail(k.email)}`); }
  if (k.quoc_tich) { khach.nationality = k.quoc_tich; doi.push(`🌏 quốc tịch → ${k.quoc_tich}`); }
  // Chỉ đổi tên khi nói rõ "tên …", tránh lấy nhầm cụm chữ khác làm tên
  const tenMoi = /(?:^|\s)tên\s/i.test(phanCon) ? k.ten : null;
  if (tenMoi) { khach.full_name = tenMoi; doi.push(`👤 tên khách → ${tenMoi}`); }

  if (!doi.length) {
    return tg("sendMessage", {
      chat_id: chat,
      text: `Tôi chưa thấy thông tin nào để bổ sung cho #${id}.\nVí dụ:\n  #${id} sđt 0905123456\n  #${id} cọc 5tr, cọc bảo đảm 3tr\n` +
        `  #${id} khách Hàn, 2 người lớn 1 trẻ em, đón sân bay\n  #${id} tên Kim Min-ji\n  #${id} ghi chú: ăn chay\nĐổi ngày dùng /doi ${id} 5/11 - 8/11.`,
    });
  }
  const payload = { kieu: "sua", id, guest_id: b.guest_id, patch, khach };
  const { data: draft } = await db.from("bot_booking_drafts").insert({ text: phanCon, payload }).select("id").single();
  return tg("sendMessage", {
    chat_id: chat,
    text: `✏️ Bổ sung booking #${id} (${b.units?.name ?? ""} — ${b.guests?.full_name ?? "chưa ghi tên"}):\n\n${doi.map((d) => "• " + d).join("\n")}`,
    reply_markup: { inline_keyboard: [[
      { text: "✅ Lưu thay đổi", callback_data: `bs:${draft.id}` },
      { text: "✖ Bỏ", callback_data: `bx:${draft.id}` },
    ]] },
  });
}

async function apDungSua(ctx: Ctx, p: any): Promise<string> {
  const { db } = ctx;
  if (Object.keys(p.patch ?? {}).length) {
    const { error } = await db.from("bookings").update(p.patch).eq("id", p.id);
    if (error) return `❌ Không cập nhật được #${p.id}: ${error.message}`;
  }
  const khach = p.khach ?? {};
  if (Object.keys(khach).length) {
    if (p.guest_id) {
      const { error } = await db.from("guests").update(khach).eq("id", p.guest_id);
      if (error) return `❌ Đã lưu booking nhưng chưa lưu được thông tin khách: ${error.message}`;
    } else {
      // Booking chưa gắn khách → tạo hồ sơ khách rồi gắn vào
      const gid = await layHoacTaoKhach(db, {
        ten: khach.full_name ?? null, sdt: khach.phone ?? null, email: khach.email ?? null, quoc_tich: khach.nationality ?? null,
      });
      if (gid) await db.from("bookings").update({ guest_id: gid }).eq("id", p.id);
    }
  }
  return `✅ Đã cập nhật booking #${p.id}. Xem lại: /xem ${p.id}`;
}

// /huy 12 — hỏi lại rồi mới hủy
export async function lenhHuy(ctx: Ctx, chat: number, id: number) {
  const { db, tg } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const { data: b } = await db.from("bookings")
    .select("id,start_date,end_date,status,units(name),guests(full_name)")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  if (!b) return tg("sendMessage", { chat_id: chat, text: `Không có booking #${id}.` });
  return tg("sendMessage", {
    chat_id: chat,
    text: `Hủy booking này?\n\n#${b.id} ${b.units?.name ?? ""} — ${b.guests?.full_name ?? "(chưa ghi tên)"}\n` +
      `📅 ${dm(b.start_date)} → ${dm(b.end_date)} · ${TT[b.status]}`,
    reply_markup: { inline_keyboard: [[
      { text: "✖ Hủy booking", callback_data: `hb:${b.id}` },
      { text: "Giữ nguyên", callback_data: `bx:0` },
    ]] },
  });
}

// /doi 12 5/10 - 5/11 — đổi ngày (nhận cả "5-8/11", "5/11 3 đêm")
export async function lenhDoiNgay(ctx: Ctx, chat: number, id: number, phanCon: string) {
  const { db, tg } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const ngay = timNgay(chuanHoaKhoangNgay(phanCon));
  let khoang: [string, string] | null = ngay.length >= 2 ? [ngay[0], ngay[1]] : null;
  if (!khoang && ngay.length === 1 && /đêm|ngày|hôm|tháng/i.test(phanCon)) khoang = docKhoang(phanCon);
  if (!khoang) {
    return tg("sendMessage", { chat_id: chat, text: `Cú pháp: /doi ${id || 12} 5/10 - 5/11 · /doi ${id || 12} 5-8/11` });
  }
  const { data: doi, error } = await db.from("bookings")
    .update({ start_date: khoang[0], end_date: khoang[1] }).eq("id", id).is("deleted_at", null).select("id");
  if (!error && !doi?.length) return tg("sendMessage", { chat_id: chat, text: `Không có booking #${id}.` });
  if (error) {
    return tg("sendMessage", {
      chat_id: chat,
      text: error.code === "23P01"
        ? `❌ Khoảng ${dm(khoang[0])} → ${dm(khoang[1])} đã có khách khác ở căn này. Gõ /trong ${dm(khoang[0])} - ${dm(khoang[1])} để xem căn trống.`
        : `❌ Không đổi được: ${error.message}`,
    });
  }
  return tg("sendMessage", { chat_id: chat, text: `✅ Booking #${id} đổi thành ${dm(khoang[0])} → ${dm(khoang[1])}.` });
}

// ---------------- Báo cáo sáng ----------------
export async function soanBaoCao(db: any, LICH: string): Promise<string> {
  const { data: bc, error } = await db.rpc("bao_cao_ngay");
  if (error && /quyền/.test(error.message ?? "")) return "🚫 Tài khoản của bạn không có quyền xem lịch đặt phòng.";
  if (error || !bc) return "Không lấy được số liệu lịch: " + (error?.message ?? "rỗng");

  const d = new Date(bc.ngay + "T00:00:00Z");
  const THU = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"];
  const phan: string[] = [`🌅 Lễ tân báo cáo ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} (${THU[d.getUTCDay()]})`];

  const nhan = bc.nhan_phong ?? [], tra = bc.tra_phong ?? [], dangO = bc.dang_o ?? [], mai = bc.mai_nhan ?? [];

  phan.push(`\n🟢 Nhận phòng hôm nay (${nhan.length})`);
  phan.push(nhan.length
    ? nhan.map((k: any) => `• ${k.can} — ${k.khach}${k.sdt ? ` · ${k.sdt}` : ""}\n    tới ${dm(k.den_ngay)}${k.trang_thai === "giu_cho" ? " · ⚠️ chưa cọc" : ""}`).join("\n")
    : "• không có");

  phan.push(`\n🔴 Trả phòng hôm nay (${tra.length})`);
  phan.push(tra.length
    ? tra.map((k: any) => `• ${k.can} — ${k.khach}` +
        (k.trang_thai_coc === "da_nhan" && k.coc ? `\n    💰 còn giữ cọc ${tien(k.coc)}` : "")).join("\n")
    : "• không có");

  phan.push(`\n🏠 Đang ở (${dangO.length})`);
  phan.push(dangO.length
    ? dangO.map((k: any) => `• ${k.can} — ${k.khach} · còn ${k.con_lai} ngày`).join("\n")
    : "• không có");

  phan.push(`\n🔜 Ngày mai nhận phòng (${mai.length})`);
  phan.push(mai.length
    ? mai.map((k: any) => `• ${k.can} — ${k.khach} · tới ${dm(k.den_ngay)}`).join("\n")
    : "• không có");

  const trong = bc.con_trong ?? [];
  if (trong.length) phan.push(`\n🔑 Căn trống: ${trong.join(", ")}`);

  const chuY: string[] = [];
  if (bc.qua_han?.so_khoan) chuY.push(`• ${bc.qua_han.so_khoan} khoản thu quá hạn — tổng ${tien(bc.qua_han.tong)}`);
  for (const h of bc.sap_het_han ?? []) chuY.push(`• ${h.can} (${h.khach}) hết hạn ${dm(h.den_ngay)}`);
  if (chuY.length) phan.push(`\n⚠️ Cần chú ý\n${chuY.join("\n")}`);

  phan.push(`\n${LICH}`);
  return phan.join("\n");
}

export async function guiBaoCao(ctx: Ctx, chat: number) {
  return ctx.tg("sendMessage", { chat_id: chat, text: await soanBaoCao(ctx.db, ctx.LICH), disable_web_page_preview: true });
}
