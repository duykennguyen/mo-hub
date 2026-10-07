// Lễ tân — THỰC HIỆN thao tác trên booking đã có (đọc ở hanh-dong.ts).
// Nguyên tắc: tìm booking theo lời tả → nói rõ sẽ làm gì → BẤM XÁC NHẬN mới ghi.
// Chạy bằng phiên của người nhắn: RLS + trigger quyết định (vd chỉ admin xóa hẳn được).
import { chamDiem, chonBooking, soNgayDich, themVaoNgay, type BookingTom, type HanhDong } from "./hanh-dong.ts";
import { chuanHoaKhoangNgay, timCan, timNgay } from "./parse-booking.ts";
import { iso, vnToday } from "./parse.ts";
import { coQuyenDatPhong, layCan, lenhXem, type Ctx } from "./booking-bot.ts";

const dm = (s: string) => `${s.slice(8)}/${s.slice(5, 7)}`;
const soDem = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const congNgay = (d: string, n: number) => iso(new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3));
const tenB = (b: BookingTom) => `#${b.id} ${b.unit_name} — ${b.guest_name ?? "(chưa ghi tên)"} · ${dm(b.start_date)}→${dm(b.end_date)}`;

type KeHoach = { moTa: string; patch: Record<string, unknown> | null; loi?: string; choXoa?: boolean };

// ---------------- Lập kế hoạch cho một booking ----------------
export function lapKeHoach(hd: HanhDong, b: BookingTom, cans: { id: string; name: string; property_id: string; property_name?: string }[], today = vnToday()): KeHoach {
  const homNay = iso(today);
  const ngayDich = timNgay(chuanHoaKhoangNgay(hd.dich, today), today);
  switch (hd.loai) {
    case "huy":
      return { moTa: `Hủy booking ${tenB(b)}?\nCăn sẽ trống lại trên lịch.`, patch: { status: "huy" }, choXoa: true };

    case "doi_ngay": {
      const dich = soNgayDich(`${hd.timKiem} ${hd.dich}`);
      let a: string, z: string;
      if (dich !== null) { a = congNgay(b.start_date, dich); z = congNgay(b.end_date, dich); }
      else if (ngayDich.length >= 2) { [a, z] = ngayDich; }
      else if (ngayDich.length === 1) { a = ngayDich[0]; z = congNgay(a, soDem(b.start_date, b.end_date)); }   // giữ số đêm
      else return { moTa: "", patch: null, loi: `Dời ${tenB(b)} sang ngày nào? Ví dụ: "dời ${b.guest_name ?? "#" + b.id} sang 12-14/10" hoặc "lùi 2 ngày".` };
      if (z <= a) return { moTa: "", patch: null, loi: "Ngày trả phòng phải sau ngày nhận phòng." };
      return { moTa: `Đổi ngày ${tenB(b)}\n→ ${dm(a)} → ${dm(z)} (${soDem(a, z)} đêm)?`, patch: { start_date: a, end_date: z } };
    }

    case "gia_han": {
      let z: string | null = null;
      if (ngayDich.length) z = /hết\s*(ngày\s*)?\d/.test(hd.dich) ? congNgay(ngayDich[0], 1) : ngayDich[0];
      else z = themVaoNgay(b.end_date, hd.dich || hd.timKiem);
      if (!z) return { moTa: "", patch: null, loi: `Gia hạn ${tenB(b)} thêm bao lâu? Ví dụ: "thêm 2 đêm", "thêm 1 tháng", "đến 20/11".` };
      if (z <= b.end_date) return { moTa: "", patch: null, loi: `Ngày mới ${dm(z)} không sau ngày trả phòng hiện tại ${dm(b.end_date)}. Muốn về sớm thì nhắn "trả phòng sớm ngày …".` };
      return { moTa: `Gia hạn ${tenB(b)}\n→ trả phòng ${dm(z)} (thêm ${soDem(b.end_date, z)} đêm)?`, patch: { end_date: z } };
    }

    case "tra_som": {
      const z = ngayDich[0] ?? timNgay(chuanHoaKhoangNgay(hd.timKiem, today), today).find((d) => d > b.start_date) ?? homNay;
      if (z <= b.start_date) return { moTa: "", patch: null, loi: `Ngày trả phòng ${dm(z)} phải sau ngày nhận phòng ${dm(b.start_date)}. Khách không ở nữa thì nhắn "hủy booking ${b.id}".` };
      if (z > b.end_date) return { moTa: "", patch: null, loi: `${dm(z)} muộn hơn ngày trả phòng ${dm(b.end_date)} — đó là gia hạn, nhắn "gia hạn đến ${dm(z)}".` };
      const patch: Record<string, unknown> = { end_date: z };
      if (z <= homNay) patch.status = "ket_thuc";
      return { moTa: `Khách trả phòng ${tenB(b)}\n→ ngày ${dm(z)}${z < b.end_date ? ` (sớm ${soDem(z, b.end_date)} đêm)` : ""}${patch.status ? " · đánh dấu đã kết thúc" : ""}?`, patch };
    }

    case "nhan_phong": {
      const patch: Record<string, unknown> = { status: "dang_o" };
      if (b.start_date > homNay) patch.start_date = homNay;
      return { moTa: `Khách đã nhận phòng ${tenB(b)}?${patch.start_date ? `\n(Đến sớm: đổi ngày nhận phòng thành hôm nay ${dm(homNay)})` : ""}`, patch };
    }

    case "doi_can": {
      const { can, ungVien } = timCan(hd.dich || hd.timKiem, cans as any);
      const dich = can ?? (ungVien.length === 1 ? ungVien[0] : null);
      if (!dich) return { moTa: "", patch: null, loi: `Chuyển ${tenB(b)} sang căn nào? Ví dụ: "chuyển ${b.guest_name ?? "#" + b.id} sang căn Thơm".` };
      if (dich.id === b.unit_id) return { moTa: "", patch: null, loi: `Khách đang ở căn ${dich.name} rồi.` };
      return { moTa: `Chuyển ${tenB(b)}\n→ sang căn ${dich.name}${dich.property_name ? ` (${dich.property_name})` : ""}?`, patch: { unit_id: dich.id } };
    }
    default:
      return { moTa: "", patch: null };
  }
}

// ---------------- Kho booking để tìm ----------------
async function layBookingTom(ctx: Ctx): Promise<BookingTom[]> {
  const tu = iso(new Date(vnToday().getTime() - 60 * 86400e3));
  const { data } = await ctx.db.from("bookings")
    .select("id,start_date,end_date,status,unit_id,units(name,properties(name)),guests(full_name)")
    .is("deleted_at", null).neq("status", "huy").gte("end_date", tu).order("start_date").limit(500);
  return (data ?? []).map((x: any) => ({
    id: x.id, start_date: x.start_date, end_date: x.end_date, status: x.status, unit_id: x.unit_id,
    unit_name: x.units?.name ?? "", property_name: x.units?.properties?.name ?? "", guest_name: x.guests?.full_name ?? null,
  }));
}

// ---------------- Xử lý tin nhắn thao tác ----------------
export async function xuLyHanhDong(ctx: Ctx, chat: number, hd: HanhDong, laAdmin: boolean) {
  const { db, tg } = ctx;
  if (!(await coQuyenDatPhong(ctx, chat))) return;
  const [ds, cans] = await Promise.all([layBookingTom(ctx), layCan(db)]);

  if (hd.loai === "ai_o") return aiO(ctx, chat, hd, ds, cans);

  const { chac, ungVien } = chonBooking(chamDiem(hd.timKiem, ds, cans));
  if (!chac && !ungVien.length) {
    return tg("sendMessage", {
      chat_id: chat,
      text: `Tôi không tìm thấy booking nào khớp "${hd.timKiem.trim()}".\nNhắn kèm tên khách, căn hoặc ngày nhận phòng (vd "hủy booking của Duy ở Gừng 8/10"), hoặc gõ /dat để xem danh sách.`,
    });
  }
  if (hd.loai === "xem" && chac) return lenhXem(ctx, chat, chac.id);

  const { data: nhap } = await db.from("bot_booking_drafts").insert({ text: hd.timKiem, payload: { kieu: "hd", hd } }).select("id").single();
  if (!chac) {
    // Nhiều booking giống nhau → hỏi lại bằng nút
    return tg("sendMessage", {
      chat_id: chat,
      text: "Booking nào vậy?",
      reply_markup: { inline_keyboard: [...ungVien.map((b) => [{ text: tenB(b).slice(0, 60), callback_data: `hc:${nhap.id}:${b.id}` }]),
        [{ text: "✖ Bỏ", callback_data: `bx:${nhap.id}` }]] },
    });
  }
  return guiXacNhan(ctx, chat, nhap.id, hd, chac, cans, laAdmin, null);
}

async function guiXacNhan(ctx: Ctx, chat: number, nhapId: number, hd: HanhDong, b: BookingTom, cans: any[], laAdmin: boolean, suaTin: number | null) {
  const { db, tg } = ctx;
  if (hd.loai === "xem") { await db.from("bot_booking_drafts").delete().eq("id", nhapId); return lenhXem(ctx, chat, b.id); }
  const kh = lapKeHoach(hd, b, cans);
  if (kh.loi || !kh.patch) {
    await db.from("bot_booking_drafts").delete().eq("id", nhapId);
    const body = { chat_id: chat, text: kh.loi ?? "Tôi chưa hiểu cần làm gì với booking này." };
    return suaTin ? tg("editMessageText", { ...body, message_id: suaTin }) : tg("sendMessage", body);
  }
  await db.from("bot_booking_drafts").update({ payload: { kieu: "hd", hd, booking_id: b.id, patch: kh.patch, moTa: kh.moTa } }).eq("id", nhapId);
  const nut = [[{ text: hd.loai === "huy" ? "✖ Hủy booking" : "✅ Đồng ý", callback_data: `hd:${nhapId}:ok` },
                { text: "Giữ nguyên", callback_data: `bx:${nhapId}` }]];
  if (kh.choXoa && laAdmin) nut.push([{ text: "🗑 Xóa hẳn khỏi lịch (nhập nhầm)", callback_data: `hd:${nhapId}:xoa` }]);
  const body = { chat_id: chat, text: kh.moTa, reply_markup: { inline_keyboard: nut } };
  return suaTin ? tg("editMessageText", { ...body, message_id: suaTin }) : tg("sendMessage", body);
}

// "ai đang ở Gừng" — khách hiện tại và sắp tới của một căn (hoặc cả nhà)
async function aiO(ctx: Ctx, chat: number, hd: HanhDong, ds: BookingTom[], cans: any[]) {
  const { can, ungVien } = timCan(hd.timKiem, cans);
  const ids = new Set(can ? [can.id] : ungVien.map((u: any) => u.id));
  if (!ids.size) return ctx.tg("sendMessage", { chat_id: chat, text: "Căn nào vậy? Ví dụ: \"ai đang ở Gừng\". Xem cả lịch hôm nay: /lich" });
  const homNay = iso(vnToday());
  const dong = cans.filter((c: any) => ids.has(c.id)).map((c: any) => {
    const cua = ds.filter((b) => b.unit_id === c.id && b.end_date > homNay).slice(0, 3);
    const dang = cua.find((b) => b.start_date <= homNay);
    return `🏠 ${c.name}: ${dang ? `${dang.guest_name ?? "(chưa ghi tên)"} đang ở, trả phòng ${dm(dang.end_date)} (#${dang.id})` : "đang trống"}` +
      cua.filter((b) => b !== dang).map((b) => `\n   sắp tới: ${b.guest_name ?? "?"} ${dm(b.start_date)}→${dm(b.end_date)} (#${b.id})`).join("");
  });
  return ctx.tg("sendMessage", { chat_id: chat, text: dong.join("\n") });
}

// ---------------- Nút bấm ----------------
// hc:<nháp>:<booking> — chọn booking khi có nhiều booking giống nhau
// hd:<nháp>:ok|xoa   — xác nhận thao tác
export async function xuLyNutHanhDong(ctx: Ctx, cq: any, laAdmin: boolean): Promise<string | null> {
  const { db, tg } = ctx;
  const chat = cq.message.chat.id;
  const [loai, a, b] = String(cq.data).split(":");
  if (loai !== "hc" && loai !== "hd") return null;
  const { data: nhap } = await db.from("bot_booking_drafts").select("*").eq("id", a).maybeSingle();
  if (!nhap) return "Yêu cầu đã hết hạn, nhắn lại giúp tôi";

  if (loai === "hc") {
    const ds = await layBookingTom(ctx);
    const bk = ds.find((x) => String(x.id) === b);
    if (!bk) return "Không còn booking này";
    await guiXacNhan(ctx, chat, nhap.id, nhap.payload.hd, bk, await layCan(db), laAdmin, cq.message.message_id);
    return "Đã chọn";
  }

  const p = nhap.payload;
  const patch = b === "xoa" ? { deleted_at: new Date().toISOString() } : p.patch;
  const { data, error } = await db.from("bookings").update(patch).eq("id", p.booking_id).is("deleted_at", null).select("id");
  await db.from("bot_booking_drafts").delete().eq("id", nhap.id);
  let ket: string;
  if (error) {
    ket = error.code === "23P01" ? "❌ Không được: căn này đã có khách khác trong khoảng ngày đó. Gõ /trong <ngày> để xem căn trống."
      : /quản trị/.test(error.message) ? "🚫 Chỉ quản trị viên được xóa hẳn booking. Bấm \"Hủy booking\" là đủ để trống lịch."
      : `❌ Không làm được: ${error.message}`;
  } else if (!data?.length) ket = `Không còn booking #${p.booking_id} (có thể đã bị xóa).`;
  else ket = b === "xoa" ? `🗑 Đã xóa booking #${p.booking_id} khỏi lịch.`
    : `✅ Xong — ${p.moTa.replace(/\?$/, "").replace(/\?\n/, "\n")}\nXem lại: /xem ${p.booking_id}`;
  await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: ket });
  return error ? "Lỗi" : "Đã xong";
}
