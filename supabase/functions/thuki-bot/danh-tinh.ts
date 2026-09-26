// Thư kí — DANH TÍNH NGƯỜI NHẮN.
// Mỗi chat Telegram gắn với 1 hồ sơ Mô Hub (bảng telegram_links). Với mỗi tin nhắn, bot xin
// Supabase cấp một phiên đăng nhập thật của người đó rồi gọi database bằng phiên ấy,
// nên RLS và các hàm can_*() tự áp dụng y như trên web. Service role chỉ dùng để tra
// liên kết và xin phiên, không đọc/ghi dữ liệu nghiệp vụ.
//
// File này không import supabase-js để test chạy được mà không cần mạng.

export type Nguoi = { profile_id: string; email: string; ten: string; vai_tro: string };

// Chat chưa liên kết chỉ được làm 2 việc: hỏi chat id, và liên kết bằng mã.
// "/start MÃ" là khi bấm link t.me/<bot>?start=MÃ trên Mô Hub.
export type LenhChuaLienKet = { loai: "id" } | { loai: "lienket"; ma: string } | { loai: "huong_dan" };

export function docLenhLienKet(text: string): LenhChuaLienKet {
  const [lenh, ...phan] = text.trim().split(/\s+/);
  const cmd = (lenh ?? "").toLowerCase().replace(/@\w+$/, "");   // "/lienket@ThuKiMo_bot" trong nhóm
  if (cmd === "/id") return { loai: "id" };
  if ((cmd === "/lienket" || cmd === "/start") && phan[0]) return { loai: "lienket", ma: phan[0] };
  return { loai: "huong_dan" };
}

export const LY_DO: Record<string, string> = {
  khong_dung: "Mã không đúng. Kiểm lại 8 ký tự trên Mô Hub nhé.",
  da_dung: "Mã này đã được dùng rồi. Lấy mã mới trên Mô Hub.",
  het_han: "Mã đã quá 10 phút. Lấy mã mới trên Mô Hub.",
  chua_duyet: "Tài khoản Mô Hub của bạn chưa được duyệt hoặc đã bị chặn.",
};

export function huongDanLienKet(hub: string, laAdmin: boolean): string {
  return [
    "Chat này chưa liên kết với Mô Hub nên tôi chưa làm gì được.",
    "",
    "Cách liên kết (1 lần):",
    `1. Mở ${hub || "Mô Hub"} và đăng nhập`,
    "2. Bấm “Kết nối Telegram” → bấm “Mở Telegram” (hoặc chép mã)",
    "3. Gửi cho tôi:  /lienket MÃ   (mã hết hạn sau 10 phút)",
    laAdmin ? "\nĐây là chat quản trị: báo cáo 8h sáng vẫn gửi về đây, nhưng muốn ra lệnh thì cũng phải liên kết." : "",
  ].join("\n").trim();
}

// So sánh bí mật không để lộ thời gian (tránh dò từng ký tự)
export function khopBiMat(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let khac = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) khac |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return khac === 0 && x.length > 0;
}

// Lỗi "không đủ quyền" của Postgres/PostgREST → câu dễ hiểu
export function laLoiQuyen(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42501" || /row-level security|permission denied|quyền/i.test(err.message ?? "");
}

// ---------------- Mở phiên của người nhắn ----------------
// may   : client service role (chỉ gọi auth.admin và rpc bot_*)
// taoClient(headers): tạo client mới gọi database kèm header cho sẵn
export type MoPhienDeps = {
  may: any;
  xacThucMa: (tokenHash: string) => Promise<{ access_token: string } | null>;
  taoClient: (headers: Record<string, string>) => any;
};
export type Phien = { db: any; nguoi: Nguoi; dong: () => Promise<void> };

export async function timNguoi(may: any, chat: number): Promise<Nguoi | null> {
  const { data, error } = await may.rpc("bot_nguoi_cua_chat", { p_chat: chat });
  if (error) throw new Error("Không tra được liên kết: " + error.message);
  return (data?.[0] as Nguoi) ?? null;
}

export async function moPhien(deps: MoPhienDeps, nguoi: Nguoi): Promise<Phien> {
  // Supabase ký JWT bằng khóa ES256 do Supabase giữ, bot không tự ký được.
  // Nên bot nhờ chính Supabase cấp phiên: tạo magic link (không gửi email) rồi đổi ngay lấy phiên.
  const { data, error } = await deps.may.auth.admin.generateLink({ type: "magiclink", email: nguoi.email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new Error("Không xin được phiên đăng nhập: " + (error?.message ?? "thiếu mã"));
  const phien = await deps.xacThucMa(hash);
  if (!phien?.access_token) throw new Error("Không đổi được mã lấy phiên đăng nhập");

  const db = deps.taoClient({ Authorization: `Bearer ${phien.access_token}`, "x-mo-kenh": "thu-ki" });
  return {
    db, nguoi,
    // Xong tin nhắn thì hủy phiên, không để phiên thừa sống tiếp
    dong: async () => { await deps.may.auth.admin.signOut(phien.access_token, "local").catch(() => {}); },
  };
}

// ---------------- Cổng danh tính (chạy trước mọi lệnh) ----------------
// Trả về người nhắn nếu chat đã liên kết; còn lại tự trả lời và trả về null.
// Chat chưa liên kết chỉ chạm tới 2 hàm máy chủ: bot_nguoi_cua_chat và bot_dung_ma_lien_ket.
export type CongDeps = {
  may: any;
  tg: (method: string, body: unknown) => Promise<unknown>;
  hub: string;
  adminChat: string;
};

export async function congDanhTinh(up: any, d: CongDeps): Promise<{ nguoi: Nguoi; chat: number } | null> {
  const cq = up.callback_query;
  const msg = up.message;
  const chat: number | undefined = cq?.message?.chat?.id ?? msg?.chat?.id;
  if (!chat) return null;

  // /id và /lienket dùng được cả khi đã liên kết (ví dụ đổi sang tài khoản khác)
  if (msg?.text) {
    const l = docLenhLienKet(msg.text);
    if (l.loai === "id") { await d.tg("sendMessage", { chat_id: chat, text: `Chat ID: ${chat}` }); return null; }
    if (l.loai === "lienket") {
      const { data: kq, error } = await d.may.rpc("bot_dung_ma_lien_ket", { p_chat: chat, p_ma: l.ma });
      await d.tg("sendMessage", { chat_id: chat, text: error ? "❌ Lỗi liên kết: " + error.message
        : kq?.ok ? `✅ Đã liên kết với tài khoản Mô Hub: ${kq.ten}.\nTừ giờ tôi làm theo đúng quyền của tài khoản này. Gõ /help để xem lệnh.`
        : "❌ " + (LY_DO[kq?.ly_do] ?? "Không liên kết được.") });
      return null;
    }
  }

  const nguoi = await timNguoi(d.may, chat);
  if (nguoi) return { nguoi, chat };
  // Chat chưa liên kết: không đọc, không ghi gì cả
  if (cq) await d.tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Chat này chưa liên kết với Mô Hub" });
  else await d.tg("sendMessage", { chat_id: chat, text: huongDanLienKet(d.hub, String(chat) === d.adminChat) });
  return null;
}
