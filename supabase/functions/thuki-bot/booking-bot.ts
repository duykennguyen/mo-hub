// Thư kí — phần ĐẶT PHÒNG: đọc tin nhắn, xem trước, chờ xác nhận rồi mới ghi.
// Báo cáo 08:00 sáng cũng ở đây.
import { laLenhDatPhong, parseBooking, timNgay, type BanNhap, type Can } from "./parse-booking.ts";
import { vnToday } from "./parse.ts";

export type Ctx = {
  db: any;
  tg: (method: string, body: unknown) => Promise<Response>;
  HUB: string;
  LICH: string;               // địa chỉ Mô House Calendar
};

const TT: Record<string, string> = {
  giu_cho: "🟡 Giữ chỗ", da_coc: "🟢 Đã cọc", dang_o: "🏠 Đang ở", ket_thuc: "⚪ Đã kết thúc", huy: "✖ Đã hủy",
};
const KENH: Record<string, string> = {
  truc_tiep: "trực tiếp", moi_gioi: "môi giới", airbnb: "Airbnb", booking: "Booking.com", agoda: "Agoda", khac: "khác",
};
const tien = (n: number | null | undefined) => (n ? Number(n).toLocaleString("vi-VN") + " đ" : "—");
const dm = (s: string | null | undefined) => (s ? `${s.slice(8)}/${s.slice(5, 7)}` : "—");
const soDem = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

// Chặn sớm cho dễ hiểu; chặn thật vẫn là RLS (can_book) trong database.
const KHONG_QUYEN_DAT = "🚫 Tài khoản của bạn không có quyền đặt phòng hay xem booking qua Thư kí.\n" +
  "Chỉ quản trị viên và quản lý làm được việc này.";
async function coQuyenDatPhong(ctx: Ctx, chat: number): Promise<boolean> {
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
function xemTruoc(n: BanNhap): string {
  const r = n.row;
  const dem = r.start_date && r.end_date ? soDem(r.start_date, r.end_date) : 0;
  const doDai = r.term_type === "dai_han"
    ? `${(dem / 30).toFixed(dem % 30 === 0 ? 0 : 1)} tháng` : `${dem} đêm`;
  return [
    `📋 Kiểm lại giúp tôi trước khi ghi:`,
    ``,
    `🏠 ${n.can?.property_name ?? ""} — ${n.can?.name ?? "?"}`,
    `👤 ${n.tenKhach ?? "(chưa có tên khách)"}`,
    `📅 ${dm(r.start_date)} → ${dm(r.end_date)} · ${doDai}`,
    `💰 ${tien(r.rent_amount)}${r.term_type === "dai_han" ? "/tháng" : " tổng"}` +
      (r.deposit_amount ? ` · cọc ${tien(r.deposit_amount)}` : " · chưa cọc"),
    `📌 ${TT[r.status]}${r.channel ? ` · ${KENH[r.channel]}` : ""}`,
  ].join("\n");
}

const nutXacNhan = (id: number) => ({
  inline_keyboard: [[
    { text: "✅ Tạo booking", callback_data: `b:${id}` },
    { text: "✖ Bỏ", callback_data: `bx:${id}` },
  ]],
});

// ---------------- Tạo booking ----------------
async function ghiBooking(ctx: Ctx, chat: number, nhap: BanNhap) {
  const { db, tg, LICH } = ctx;
  let guestId: string | null = null;

  if (nhap.tenKhach) {
    // Khách trùng tên thì dùng lại hồ sơ cũ, tránh sinh trùng lặp
    const { data: cu } = await db.from("guests").select("id").ilike("full_name", nhap.tenKhach).limit(1);
    if (cu?.length) guestId = cu[0].id;
    else {
      const { data: moi } = await db.from("guests").insert({ full_name: nhap.tenKhach }).select("id").single();
      guestId = moi?.id ?? null;
    }
  }

  const { data, error } = await db.from("bookings")
    .insert({ ...nhap.row, guest_id: guestId })
    .select("id").single();

  if (error) {
    const loi = error.code === "23P01"
      ? `❌ Căn này đã có khách trong khoảng ${dm(nhap.row.start_date)} → ${dm(nhap.row.end_date)}.\nChọn ngày khác hoặc căn khác nhé.`
      : `❌ Không ghi được: ${error.message}`;
    return tg("sendMessage", { chat_id: chat, text: loi });
  }

  return tg("sendMessage", {
    chat_id: chat,
    text: `✅ Đã tạo booking #${data.id}\n${xemTruoc(nhap).split("\n").slice(2).join("\n")}\n\n${LICH}`,
  });
}

// ---------------- Xử lý tin nhắn đặt phòng ----------------
export async function xuLyDatPhong(ctx: Ctx, chat: number, text: string): Promise<boolean> {
  const { db, tg } = ctx;
  if (!laLenhDatPhong(text)) return false;
  if (!(await coQuyenDatPhong(ctx, chat))) return true;   // là tin đặt phòng nhưng không có quyền → dừng ở đây

  const cans = await layCan(db);
  if (!cans.length) {
    await tg("sendMessage", { chat_id: chat, text: "Chưa có căn nào trong hệ thống. Thêm căn ở Mô House Calendar trước đã." });
    return true;
  }

  const nhap = parseBooking(text, cans);

  // Thiếu ngày → nói rõ thiếu gì, không đoán
  if (!nhap.row.start_date || !nhap.row.end_date) {
    await tg("sendMessage", {
      chat_id: chat,
      text: `Tôi chưa rõ ${nhap.thieu.join(" và ")}.\n\nNhắn lại theo mẫu:\n` +
        `  đặt Gừng cho Anna từ 1/10 đến 1/12, 20tr, cọc 5tr\n` +
        `  đặt nhà Sen 5 đêm từ 10/10 cho anh Nam`,
    });
    return true;
  }

  // Lưu nháp để bấm nút xác nhận mới ghi
  const { data: draft } = await db.from("bot_booking_drafts")
    .insert({ text, payload: nhap }).select("id").single();

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

  await tg("sendMessage", { chat_id: chat, text: xemTruoc(nhap), reply_markup: nutXacNhan(draft.id) });
  return true;
}

// ---------------- Bấm nút ----------------
export async function xuLyNutBooking(ctx: Ctx, cq: any): Promise<string | null> {
  const { db, tg } = ctx;
  const chat = cq.message.chat.id;
  const [loai, a, b] = String(cq.data).split(":");

  if (loai === "bx") {
    await db.from("bot_booking_drafts").delete().eq("id", a);
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
      if (!nhap.row.rent_amount && nhap.row.term_type === "dai_han") nhap.row.rent_amount = can.list_rent_month ?? null;
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
// /dat — sắp tới có ai
export async function lenhDat(ctx: Ctx, chat: number) {
  const { db, tg, LICH } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const homNay = vnToday().toISOString().slice(0, 10);
  const { data } = await db.from("bookings")
    .select("id,start_date,end_date,status,units(name),guests(full_name)")
    .is("deleted_at", null).neq("status", "huy")
    .gte("end_date", homNay).order("start_date").limit(30);

  if (!data?.length) {
    return tg("sendMessage", { chat_id: chat, text: "Chưa có booking nào sắp tới." });
  }
  const dong = data.map((b: any) =>
    `${TT[b.status]} #${b.id} ${b.units?.name ?? ""} — ${b.guests?.full_name ?? "(chưa ghi tên)"}\n` +
    `    ${dm(b.start_date)} → ${dm(b.end_date)}`);
  return tg("sendMessage", { chat_id: chat, text: `📖 Booking sắp tới (${data.length}):\n\n${dong.join("\n")}\n\n${LICH}` });
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

// /doi 12 5/10 - 5/11 — đổi ngày
export async function lenhDoiNgay(ctx: Ctx, chat: number, id: number, phanCon: string) {
  const { db, tg } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const ngay = timNgay(phanCon);
  if (ngay.length < 2) {
    return tg("sendMessage", { chat_id: chat, text: `Cú pháp: /doi ${id || 12} 5/10 - 5/11` });
  }
  const { data: doi, error } = await db.from("bookings")
    .update({ start_date: ngay[0], end_date: ngay[1] }).eq("id", id).is("deleted_at", null).select("id");
  if (!error && !doi?.length) return tg("sendMessage", { chat_id: chat, text: `Không có booking #${id}.` });
  if (error) {
    return tg("sendMessage", {
      chat_id: chat,
      text: error.code === "23P01"
        ? `❌ Khoảng ${dm(ngay[0])} → ${dm(ngay[1])} đã có khách khác ở căn này.`
        : `❌ Không đổi được: ${error.message}`,
    });
  }
  return tg("sendMessage", { chat_id: chat, text: `✅ Booking #${id} đổi thành ${dm(ngay[0])} → ${dm(ngay[1])}.` });
}

// ---------------- Báo cáo sáng ----------------
export async function soanBaoCao(db: any, LICH: string): Promise<string> {
  const { data: bc, error } = await db.rpc("bao_cao_ngay");
  if (error && /quyền/.test(error.message ?? "")) return "🚫 Tài khoản của bạn không có quyền xem lịch đặt phòng.";
  if (error || !bc) return "Không lấy được số liệu lịch: " + (error?.message ?? "rỗng");

  const d = new Date(bc.ngay + "T00:00:00Z");
  const THU = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"];
  const phan: string[] = [`🌅 Báo cáo ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} (${THU[d.getUTCDay()]})`];

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
