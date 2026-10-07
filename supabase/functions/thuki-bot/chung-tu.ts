// Lễ tân — CHỨNG TỪ: ảnh hộ chiếu / CCCD / ảnh ghi chú gửi qua Telegram → kho riêng tư
// 'chung-tu-khach' + bảng booking_files, gắn vào booking. Chạy bằng phiên của người nhắn
// nên RLS (can_book) quyết định ai lưu được. Lịch Mô House hiện ảnh trong phần Ghi chú.
import type { Ctx } from "./booking-bot.ts";
import { iso, vnToday } from "./parse.ts";

export const KHO = "chung-tu-khach";
const TOI_DA = 10 * 1024 * 1024;     // khớp file_size_limit của kho
const MIME_NHAN = /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/;

export type TepCho = {
  file_id: string;
  mime: string;
  size: number | null;
  kind: "passport" | "cccd" | "ghi_chu" | "khac";
  caption: string | null;
  so_giay_to: string | null;      // "passport C1234567" → ghi vào guests.id_doc_no
  media_group_id: string | null;
};

export const TEN_LOAI: Record<string, string> = { passport: "hộ chiếu", cccd: "CCCD", ghi_chu: "ghi chú", khac: "ảnh" };

// ---------------- Đọc tin nhắn có ảnh / file ----------------
export function layTep(msg: any): TepCho | null | "khong_nhan" {
  const capt: string = (msg.caption ?? "").trim();
  let file_id: string, mime: string, size: number | null;
  if (msg.photo?.length) {
    const lon = msg.photo[msg.photo.length - 1];   // Telegram gửi nhiều cỡ, cỡ cuối là lớn nhất
    file_id = lon.file_id; mime = "image/jpeg"; size = lon.file_size ?? null;
  } else if (msg.document) {
    file_id = msg.document.file_id; mime = msg.document.mime_type ?? ""; size = msg.document.file_size ?? null;
    if (!MIME_NHAN.test(mime)) return "khong_nhan";
  } else return null;
  return { file_id, mime, size, ...docChuThich(capt), media_group_id: msg.media_group_id ?? null };
}

// "#12 passport C1234567" · "hộ chiếu chị Lan" · "ghi chú yêu cầu" · "cccd"
export function docChuThich(capt: string) {
  const t = capt.toLowerCase();
  const kind: TepCho["kind"] = /passport|hộ chiếu|ho chieu|\bpp\b|visa/.test(t) ? "passport"
    : /cccd|căn cước|can cuoc|cmnd|chứng minh/.test(t) ? "cccd"
    : /ghi chú|ghi chu|note|lưu ý|yêu cầu/.test(t) ? "ghi_chu"
    : "khac";
  // Số hộ chiếu: 1–2 chữ cái + 6–8 số; CCCD: 9 hoặc 12 số
  const so = capt.match(/\b([A-Z]{1,2}\d{6,8})\b/)?.[1] ??
    (kind === "cccd" ? capt.match(/(?<!\d)(\d{12}|\d{9})(?!\d)/)?.[1] : undefined) ?? null;
  return { kind, caption: capt || null, so_giay_to: so };
}

export const soBookingTrong = (capt: string | null) => {
  const m = (capt ?? "").match(/#\s?(\d{1,7})\b|(?:booking|bk)\s*(\d{1,7})\b/i);
  return m ? Number(m[1] ?? m[2]) : null;
};

// ---------------- Nhật ký ảnh đã nhận ----------------
// Mỗi ảnh gửi tới đều ghi một dòng nháp kieu "tep_nhan" (tự dọn sau 1 ngày cùng các nháp khác).
// Nhờ vậy: album nhiều ảnh gom được về một booking, và trả lời (reply) tin nhắn ảnh cũ
// "làm lại cho tôi" vẫn tìm lại được đủ ảnh.
export async function ghiNhanTep(ctx: Ctx, tep: TepCho, messageId: number) {
  await ctx.db.from("bot_booking_drafts").insert({ text: "tep", payload: { kieu: "tep_nhan", tep, message_id: messageId } });
}

// Mọi ảnh cùng album (media_group_id), không trùng file
export async function tepCungAlbum(ctx: Ctx, nhom: string[], daCo: TepCho[] = []): Promise<TepCho[]> {
  const out = [...daCo];
  const thay = new Set(out.map((t) => t.file_id));
  for (const g of nhom) {
    const { data } = await ctx.db.from("bot_booking_drafts").select("payload")
      .eq("payload->>kieu", "tep_nhan").eq("payload->tep->>media_group_id", g).order("id");
    for (const x of data ?? []) {
      const t: TepCho = x.payload.tep;
      if (!thay.has(t.file_id)) { thay.add(t.file_id); out.push(t); }
    }
  }
  return out;
}

// Ảnh của một tin nhắn cụ thể (theo message_id) — dùng khi trả lời tin ảnh cũ
export async function tepCuaTin(ctx: Ctx, messageId: number): Promise<TepCho[]> {
  const { data } = await ctx.db.from("bot_booking_drafts").select("payload")
    .eq("payload->>kieu", "tep_nhan").eq("payload->>message_id", String(messageId)).limit(1);
  return (data ?? []).map((x: any) => x.payload.tep);
}

// ---------------- Lưu một tệp vào booking ----------------
export async function luuChungTu(ctx: Ctx, bookingId: number, tep: TepCho): Promise<string | null> {
  const { db } = ctx;
  if (!ctx.taiFile) return "bot chưa cấu hình tải file";
  if (tep.size && tep.size > TOI_DA) return "file lớn hơn 10 MB";
  let bytes: Uint8Array;
  try { ({ bytes } = await ctx.taiFile(tep.file_id)); }
  catch (e) { return "không tải được ảnh từ Telegram (" + (e as Error).message + ")"; }
  if (bytes.byteLength > TOI_DA) return "file lớn hơn 10 MB";
  const duoi = tep.mime === "application/pdf" ? "pdf" : (tep.mime.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
  const path = `${bookingId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${tep.kind}.${duoi}`;
  const { error: e1 } = await db.storage.from(KHO).upload(path, bytes, { contentType: tep.mime, upsert: false });
  if (e1) return e1.message;
  const { error: e2 } = await db.from("booking_files").insert({
    booking_id: bookingId, path, kind: tep.kind, caption: tep.caption, mime: tep.mime, size_bytes: bytes.byteLength,
  });
  if (e2) {
    await db.storage.from(KHO).remove([path]);   // không để file mồ côi
    return e2.message;
  }
  // Có số giấy tờ trong chú thích → ghi vào hồ sơ khách nếu hồ sơ còn trống
  if (tep.so_giay_to && (tep.kind === "passport" || tep.kind === "cccd")) {
    const { data: b } = await db.from("bookings").select("guest_id").eq("id", bookingId).maybeSingle();
    if (b?.guest_id) {
      const { data: g } = await db.from("guests").select("id_doc_no").eq("id", b.guest_id).maybeSingle();
      if (g && !g.id_doc_no) await db.from("guests").update({ id_doc_type: tep.kind, id_doc_no: tep.so_giay_to }).eq("id", b.guest_id);
    }
  }
  return null;
}

async function demChungTu(ctx: Ctx, bookingId: number): Promise<string> {
  const { data } = await ctx.db.from("booking_files").select("kind").eq("booking_id", bookingId).is("deleted_at", null);
  const dem = new Map<string, number>();
  for (const f of data ?? []) dem.set(f.kind, (dem.get(f.kind) ?? 0) + 1);
  return [...dem].map(([k, n]) => `${TEN_LOAI[k]} ×${n}`).join(", ");
}

async function moTaBooking(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from("bookings").select("id,start_date,end_date,units(name),guests(full_name)")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  return data;
}
const dm = (s: string) => `${s.slice(8)}/${s.slice(5, 7)}`;

async function ganVaBao(ctx: Ctx, chat: number, bookingId: number, tep: TepCho) {
  const b = await moTaBooking(ctx, bookingId);
  if (!b) return ctx.tg("sendMessage", { chat_id: chat, text: `Không có booking #${bookingId}. Gửi lại ảnh với chú thích đúng số, vd #12.` });
  const loi = await luuChungTu(ctx, bookingId, tep);
  if (loi) return ctx.tg("sendMessage", { chat_id: chat, text: `❌ Chưa lưu được ảnh vào #${bookingId}: ${loi}` });
  return ctx.tg("sendMessage", {
    chat_id: chat,
    text: `📎 Đã lưu ${TEN_LOAI[tep.kind]} vào booking #${bookingId} (${b.units?.name ?? ""} — ${b.guests?.full_name ?? "chưa ghi tên"}).\n` +
      `Đang có: ${await demChungTu(ctx, bookingId)}` +
      (tep.so_giay_to && (tep.kind === "passport" || tep.kind === "cccd") ? `\nSố giấy tờ đã ghi vào hồ sơ khách (nếu hồ sơ còn trống).` : ""),
  });
}

// ---------------- Xử lý tin nhắn có ảnh ----------------
// Có "#12" trong chú thích → lưu thẳng. Không có → hỏi booking nào bằng nút.
// Gửi nhiều ảnh một lượt (album): chỉ ảnh đầu có chú thích, các ảnh sau đi theo booking của ảnh đầu.
export async function xuLyAnh(ctx: Ctx, chat: number, tep: TepCho) {
  const { db, tg } = ctx;
  const { data: quyen } = await db.rpc("can_book");
  if (quyen !== true) return tg("sendMessage", { chat_id: chat, text: "🚫 Chỉ quản trị viên và quản lý được lưu giấy tờ khách." });

  let id = soBookingTrong(tep.caption);
  if (id && tep.media_group_id) {
    await db.from("bot_booking_drafts").insert({ text: "album", payload: { kieu: "album", media_group_id: tep.media_group_id, booking_id: id } });
  }
  if (!id && tep.media_group_id) {
    // Telegram gửi các ảnh của album gần như cùng lúc: chờ tối đa ~4 giây cho ảnh đầu (có chú thích)
    for (let lan = 0; lan < 4 && !id; lan++) {
      const { data: album } = await db.from("bot_booking_drafts").select("payload")
        .eq("payload->>kieu", "album").eq("payload->>media_group_id", tep.media_group_id).limit(1);
      const a = album?.[0]?.payload;
      if (a?.booking_id) id = a.booking_id;
      else if (a?.nhap_id) return;            // ảnh đầu là tin đặt phòng đang chờ ✅ — ảnh này sẽ gắn theo khi tạo
      else if (lan < 3) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (id) return ganVaBao(ctx, chat, id, tep);

  // Chưa biết booking nào → lưu nháp, hỏi bằng nút (album thì chỉ hỏi một lần)
  const { data: nhap } = await db.from("bot_booking_drafts")
    .insert({ text: tep.caption ?? "ảnh", payload: { kieu: "anh", tep } }).select("id").single();
  if (tep.media_group_id) {
    const { data: cung } = await db.from("bot_booking_drafts").select("id")
      .eq("payload->>kieu", "anh").eq("payload->tep->>media_group_id", tep.media_group_id).order("id").limit(1);
    if (cung?.[0]?.id !== nhap.id) return;      // ảnh đầu của album đã hỏi rồi
  }
  const ds = await bookingGanDay(ctx);
  if (!ds.length) return tg("sendMessage", { chat_id: chat, text: "Chưa có booking nào gần đây. Gửi lại ảnh với chú thích số booking, vd #12." });
  const hang = ds.map((b: any) => [{
    text: `#${b.id} ${b.units?.name ?? ""} · ${b.guests?.full_name ?? "?"} · ${dm(b.start_date)}`.slice(0, 60),
    callback_data: `ba:${nhap.id}:${b.id}`,
  }]);
  hang.push([{ text: "✖ Bỏ", callback_data: `bx:${nhap.id}` }]);
  return tg("sendMessage", {
    chat_id: chat,
    text: `📎 ${TEN_LOAI[tep.kind] === "ảnh" ? "Ảnh" : "Ảnh " + TEN_LOAI[tep.kind]} này của booking nào?\n` +
      `(Lần sau ghi chú thích "#12" khi gửi ảnh là tôi lưu luôn.)`,
    reply_markup: { inline_keyboard: hang },
  });
}

// Booking để chọn: khách đang ở / sắp đến trong 14 ngày / vừa tạo gần nhất
async function bookingGanDay(ctx: Ctx) {
  const homNay = iso(vnToday());
  const toi = iso(new Date(vnToday().getTime() + 14 * 86400e3));
  const cot = "id,start_date,end_date,created_at,units(name),guests(full_name)";
  const [{ data: gan }, { data: moi }] = await Promise.all([
    ctx.db.from("bookings").select(cot).is("deleted_at", null).neq("status", "huy")
      .gte("end_date", homNay).lte("start_date", toi).order("start_date").limit(8),
    ctx.db.from("bookings").select(cot).is("deleted_at", null).neq("status", "huy")
      .order("created_at", { ascending: false }).limit(3),
  ]);
  const thay = new Map<number, any>();
  for (const b of [...(moi ?? []), ...(gan ?? [])]) thay.set(b.id, b);
  return [...thay.values()].slice(0, 10);
}

// Nút "ba:<nháp>:<booking>" — lưu ảnh của nháp (và mọi ảnh cùng album) vào booking đã chọn
export async function xuLyNutAnh(ctx: Ctx, cq: any, nhapId: string, bookingId: number): Promise<string> {
  const { db, tg } = ctx;
  const chat = cq.message.chat.id;
  const { data: nhap } = await db.from("bot_booking_drafts").select("*").eq("id", nhapId).maybeSingle();
  if (!nhap) return "Bản nháp đã hết hạn";
  const tep: TepCho = nhap.payload.tep;
  const dsTep = tep.media_group_id ? await tepCungAlbum(ctx, [tep.media_group_id], [tep]) : [tep];
  if (tep.media_group_id) {
    await db.from("bot_booking_drafts").delete().eq("payload->>kieu", "anh").eq("payload->tep->>media_group_id", tep.media_group_id);
    await db.from("bot_booking_drafts").insert({ text: "album", payload: { kieu: "album", media_group_id: tep.media_group_id, booking_id: bookingId } });
  } else await db.from("bot_booking_drafts").delete().eq("id", nhap.id);
  let ok = 0;
  const loi: string[] = [];
  for (const t of dsTep) {
    const l = await luuChungTu(ctx, bookingId, t);
    if (l) loi.push(l); else ok++;
  }
  const b = await moTaBooking(ctx, bookingId);
  await tg("editMessageText", {
    chat_id: chat, message_id: cq.message.message_id,
    text: (ok ? `📎 Đã lưu ${ok} ảnh vào booking #${bookingId} (${b?.units?.name ?? ""} — ${b?.guests?.full_name ?? "chưa ghi tên"}).\n` +
      `Đang có: ${await demChungTu(ctx, bookingId)}` : "") + (loi.length ? `\n❌ ${loi.length} ảnh lỗi: ${loi[0]}` : ""),
  });
  return ok ? "Đã lưu" : "Lỗi";
}

// Ảnh gửi kèm tin đặt phòng (chú thích là nội dung booking) → gắn sau khi bấm ✅ Tạo booking
export async function ganAnhSauKhiTao(ctx: Ctx, bookingId: number, dsTepGoc: TepCho[]): Promise<string> {
  const nhom = [...new Set(dsTepGoc.map((t) => t.media_group_id).filter(Boolean))] as string[];
  const dsTep = await tepCungAlbum(ctx, nhom, dsTepGoc);
  // Ảnh album đến muộn (sau khi bấm ✅) đi thẳng vào booking này
  for (const g of nhom) {
    await ctx.db.from("bot_booking_drafts").delete().eq("payload->>kieu", "album").eq("payload->>media_group_id", g);
    await ctx.db.from("bot_booking_drafts").insert({ text: "album", payload: { kieu: "album", media_group_id: g, booking_id: bookingId } });
  }
  let ok = 0;
  for (const tep of dsTep) if (!(await luuChungTu(ctx, bookingId, tep))) ok++;
  return ok ? `\n📎 Đã lưu ${ok} ảnh kèm theo.` : dsTep.length ? "\n❌ Chưa lưu được ảnh kèm theo — gửi lại ảnh với chú thích #" + bookingId : "";
}

export { demChungTu };
