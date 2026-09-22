// Bộ đọc tin nhắn ĐẶT PHÒNG của Thư kí — phân tích bằng luật, không dùng AI.
// Nguyên tắc: đọc được gì nói nấy, thiếu gì hỏi lại, KHÔNG BAO GIỜ tự đoán rồi ghi thẳng.
// Bot luôn hiện bản xem trước và chờ bấm nút xác nhận mới ghi vào database.
import { has, iso, noAccent, vnToday } from "./parse.ts";

export type Can = {
  id: string;
  name: string;
  property_id: string;
  property_name?: string;
  property_aliases?: string[];
  list_rent_month?: number | null;
};

export type BanNhap = {
  can: Can | null;
  canUngVien: Can[];          // khớp nhiều căn → hỏi lại bằng nút
  thieu: string[];            // những thứ còn thiếu, để bot hỏi tiếp
  tenKhach: string | null;
  row: {
    unit_id: string | null;
    start_date: string | null;
    end_date: string | null;
    term_type: "dai_han" | "ngan_han";
    rent_amount: number | null;
    deposit_amount: number | null;
    deposit_status: string;
    status: string;
    channel: string | null;
    note: string | null;
  };
};

// ---------------- Phân loại: đây là đặt phòng hay giao việc? ----------------
//
// Luật (xét theo thứ tự, dừng ở luật đầu tiên khớp):
//   1. Câu mở đầu bằng động từ công việc (dọn, sửa, thay, kiểm tra…) → VIỆC.
//      "dọn Củ Sả trước khi khách check in" là việc buồng phòng, không phải booking.
//   2. Có dấu hiệu đặt phòng RÕ (book, booking, đặt phòng, giữ chỗ, khách thuê…) → ĐẶT PHÒNG.
//   3. Có dấu hiệu MỜ (khách, nhận phòng, check in, trả phòng) + có mốc thời gian
//      hoặc số đêm/tháng → ĐẶT PHÒNG.
//   4. Còn lại → VIỆC (mặc định an toàn: việc ghi nhầm thì xóa dễ, booking ghi nhầm thì kẹt lịch).

// Động từ công việc — nếu đứng đầu câu thì chắc chắn là việc
const DONG_TU_VIEC = /^(dọn|don|lau|giặt|giat|thay|sửa|sua|kiểm tra|kiem tra|gọi|goi|mua|lắp|lap|bảo trì|bao tri|vệ sinh|ve sinh|hút bụi|sơn|son|cắt|cat|tưới|tuoi|đổ|do|bơm|bom|xả|xa|tháo|thao|kê|ke|chuyển|chuyen|nhắc|nhac|hỏi|hoi|liên hệ|lien he)\b/i;

// Dấu hiệu đặt phòng rõ ràng
const DAU_HIEU_RO = [
  "đặt phòng", "đặt căn", "book", "booking", "giữ chỗ", "giu cho",
  "khách thuê", "khach thue", "khách ở", "khach o", "gia hạn cho khách",
];
// Dấu hiệu mờ — phải kèm mốc thời gian mới tính là đặt phòng
const DAU_HIEU_MO = ["khách", "khach", "nhận phòng", "nhan phong", "check in", "checkin", "trả phòng", "tra phong", "guest"];

// Động từ công việc xuất hiện ở BẤT KỲ đâu trong câu — dùng cho luật 3
const CO_VIEC = /(dọn|lau|giặt|thay ga|thay khăn|sửa|kiểm tra|gọi thợ|lắp|bảo trì|vệ sinh|hút bụi|sơn lại|thu tiền)/i;

const COC_THOI_GIAN = /\d{1,2}\s*[\/-]\s*\d{1,2}|\d{1,3}\s*(đêm|dem|ngày|ngay|tuần|tuan|thá?ng)\b|hôm nay|ngày mai|ngày mốt|ngày kia|cuối tuần|tuần sau/i;

export function laLenhDatPhong(raw: string): boolean {
  const t = raw.toLowerCase().trim();
  if (/^\/(dat|huy|doi)\b/.test(t)) return true;

  // "đặt cọc thợ sơn" là việc, không phải booking
  if (has(t, "đặt cọc") && !has(t, "đặt phòng")) return false;

  // 1. Mở đầu bằng động từ công việc → luôn là việc
  if (DONG_TU_VIEC.test(t)) return false;

  // 2. Dấu hiệu rõ, hoặc câu mở đầu bằng "đặt"
  if (/^(đặt|dat)\b/.test(t)) return true;
  if (DAU_HIEU_RO.some((k) => has(t, k))) return true;

  // 3. Dấu hiệu mờ + mốc thời gian, nhưng trong câu không có động từ công việc nào.
  //    "khách trả phòng Gừng hôm nay, kiểm tra đồ đạc" là việc cần làm, không phải booking mới.
  if (DAU_HIEU_MO.some((k) => has(t, k)) && COC_THOI_GIAN.test(t) && !CO_VIEC.test(t)) return true;

  return false;
}

// ---------------- Ngày ----------------
const THANG_TOI_DA = 31;
const laNgayHopLe = (d: number, m: number) => d >= 1 && d <= THANG_TOI_DA && m >= 1 && m <= 12;

// Tìm mọi mốc ngày dạng d/m hoặc d/m/yyyy trong câu, theo đúng thứ tự xuất hiện.
// Chỉ nhận dấu "/" và "-" làm phân cách — dấu "." bị loại vì "1.5tr" không phải ngày.
export function timNgay(raw: string, today = vnToday()): string[] {
  const out: string[] = [];
  const re = /(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const d = Number(m[1]), thang = Number(m[2]);
    if (!laNgayHopLe(d, thang)) { re.lastIndex = m.index + 1; continue; }
    let y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : today.getUTCFullYear();
    let ngay = new Date(Date.UTC(y, thang - 1, d));
    // Không ghi năm mà ngày đã lùi quá 30 ngày → hiểu là năm sau
    if (!m[3] && ngay.getTime() < today.getTime() - 30 * 86400e3) {
      y += 1; ngay = new Date(Date.UTC(y, thang - 1, d));
    }
    if (ngay.getUTCDate() === d && ngay.getUTCMonth() === thang - 1) out.push(iso(ngay));
  }
  return out;
}

// "3 tháng", "5 đêm", "2 tuần" → cộng vào ngày bắt đầu
function themKhoang(batDau: string, raw: string): string | null {
  const d = new Date(batDau + "T00:00:00Z");
  const thang = raw.match(/(\d{1,2})\s*thá?ng/i);
  if (thang) {
    const n = Number(thang[1]);
    const cuoi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), cuoi))));
  }
  const tuan = raw.match(/(\d{1,2})\s*tuần/i);
  if (tuan) return iso(new Date(d.getTime() + Number(tuan[1]) * 7 * 86400e3));
  const dem = raw.match(/(\d{1,3})\s*(đêm|dem|ngày|ngay)\b/i);
  if (dem) return iso(new Date(d.getTime() + Number(dem[1]) * 86400e3));
  return null;
}

// ---------------- Tiền ----------------
// "20tr" = 20.000.000 · "800k" = 800.000 · "20.000.000" hoặc "20000000" giữ nguyên
export function doiTien(chuoi: string): number | null {
  const s = chuoi.trim().toLowerCase();
  let m = s.match(/^(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|m)$/);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 1_000_000);
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*(k|nghìn|nghin|ngàn|ngan)$/);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 1_000);
  const so = Number(s.replace(/[.,\s]/g, ""));
  return Number.isFinite(so) && so > 0 ? so : null;
}

const RE_TIEN = /(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|k|nghìn|nghin|ngàn|ngan)\b|(\d[\d.,]{5,})/gi;

function timTien(raw: string) {
  let coc: number | null = null, gia: number | null = null;
  const t = raw.toLowerCase();
  let m: RegExpExecArray | null;
  RE_TIEN.lastIndex = 0;
  while ((m = RE_TIEN.exec(t))) {
    const soTien = doiTien(m[0]);
    if (!soTien) continue;
    // Nhìn 20 ký tự phía trước để biết đây là cọc hay tiền thuê
    const truoc = t.slice(Math.max(0, m.index - 20), m.index);
    if (/cọc|coc|trả trước|tra truoc|đặt trước/.test(truoc)) coc = soTien;
    else if (gia === null) gia = soTien;
  }
  return { gia, coc };
}

// ---------------- Kênh ----------------
function timKenh(t: string): string | null {
  if (/airbnb|air bnb|\bbnb\b/i.test(t)) return "airbnb";
  if (/booking\.com|\bbkk\b|booking com/i.test(t)) return "booking";
  if (/agoda/i.test(t)) return "agoda";
  if (/môi giới|moi gioi|broker/i.test(t)) return "moi_gioi";
  if (/trực tiếp|truc tiep|\bpage\b|\bfb\b|facebook|zalo|khách quen/i.test(t)) return "truc_tiep";
  return null;
}

// ---------------- Tên khách ----------------
// Lấy cụm sau "cho" hoặc "khách", dừng lại khi gặp số, ngày, hoặc từ khóa khác.
// Từ dừng CÓ DẤU — không đưa dạng không dấu vào đây, kẻo "gia đình Lê" bị cắt còn rỗng
const DUNG = /^(từ|đến|tới|ngày|giá|cọc|thuê|trong|lúc|vào|qua|check)$/i;
const DUNG_KHONG_DAU = new Set(["tu", "den", "toi", "ngay", "thue", "coc", "check", "airbnb", "booking", "agoda", "bkk", "bnb"]);
// Sau "khách" thường là động từ chứ không phải tên: "khách book Củ Sả", "khách thuê 3 tháng"
const SAU_KHACH_KHONG_PHAI_TEN = new Set([
  "book", "booking", "đặt", "dat", "thuê", "thue", "ở", "o", "nhận", "nhan", "trả", "tra",
  "check", "checkin", "muốn", "muon", "hỏi", "hoi", "cần", "can", "sẽ", "se", "đã", "da", "mới", "moi",
]);

function catTen(phan: string): string | null {
  const tu: string[] = [];
  for (const w of phan.split(/\s+/)) {
    const sach = w.replace(/[,.;]+$/, "");
    if (!sach) break;
    if (/\d/.test(sach) || /^[/\-,.]/.test(sach)) break;
    if (DUNG.test(sach)) break;
    // Từ dừng không dấu chỉ áp cho chữ vốn không dấu, để không cắt nhầm tên có dấu
    if (sach === noAccent(sach) && DUNG_KHONG_DAU.has(sach.toLowerCase())) break;
    tu.push(sach);
    if (tu.length >= 4) break;
  }
  const ten = tu.join(" ").trim();
  return ten.length >= 2 ? ten : null;
}

function timTenKhach(raw: string, tenCan?: string | null): string | null {
  // 1) Sau chữ "cho" — đáng tin nhất
  const mCho = raw.match(/\bcho\s+(.{2,60})/i);
  if (mCho) { const t = catTen(mCho[1]); if (t) return t; }

  // 2) Sau chữ "khách", nhưng bỏ qua nếu ngay sau là động từ ("khách book …")
  const mKhach = raw.match(/\b(?:khách|khach)\s+(.{2,60})/i);
  if (mKhach) {
    const tuDau = mKhach[1].split(/\s+/)[0].replace(/[,.;]+$/, "").toLowerCase();
    if (!SAU_KHACH_KHONG_PHAI_TEN.has(tuDau)) {
      const t = catTen(mKhach[1]);
      if (t) return t;
    }
  }

  // 3) Cụm cuối cùng sau dấu phẩy: "… ngày mai, 2 đêm, a Duy"
  //    Chỉ nhận nếu ngắn, không có số, và không trùng tên căn vừa nhận ra.
  const manh = raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (manh.length >= 2) {
    const cuoi = manh[manh.length - 1];
    const soTu = cuoi.split(/\s+/).length;
    const trungTenCan = tenCan ? noAccent(cuoi).includes(noAccent(tenCan)) : false;
    if (soTu <= 4 && !/\d/.test(cuoi) && !trungTenCan && !DUNG.test(cuoi.split(/\s+/)[0])) {
      const t = catTen(cuoi);
      if (t) return t;
    }
  }
  return null;
}

// ---------------- Căn ----------------
// Ưu tiên tên căn (cụm dài nhất). Tên trùng nhau giữa các nhà (ví dụ "Tầng trên")
// thì phải có thêm tên nhà mới xác định được, không thì trả về danh sách để hỏi lại.
function timCan(raw: string, units: Can[]): { can: Can | null; ungVien: Can[] } {
  const t = raw.toLowerCase();
  const plain = noAccent(raw);
  const khop = (kw: string) => has(t, kw.toLowerCase()) || (noAccent(kw).length >= 5 && has(plain, noAccent(kw)));

  // 1) Khớp theo tên căn
  let dai = 0, theoTen: Can[] = [];
  for (const u of units) {
    if (!u.name) continue;
    if (khop(u.name)) {
      if (u.name.length > dai) { dai = u.name.length; theoTen = [u]; }
      else if (u.name.length === dai) theoTen.push(u);
    }
  }
  // Khớp nhiều căn cùng tên → lọc tiếp bằng tên nhà
  if (theoTen.length > 1) {
    const locTheoNha = theoTen.filter((u) => khopNha(raw, u));
    if (locTheoNha.length === 1) return { can: locTheoNha[0], ungVien: [] };
    return { can: null, ungVien: theoTen };
  }
  if (theoTen.length === 1) return { can: theoTen[0], ungVien: [] };

  // 2) Không thấy tên căn → khớp theo nhà. Nhà chỉ có 1 căn thì suy ra luôn.
  const trongNha = units.filter((u) => khopNha(raw, u));
  if (!trongNha.length) return { can: null, ungVien: [] };
  const nhaIds = new Set(trongNha.map((u) => u.property_id));
  if (nhaIds.size === 1 && trongNha.length === 1) return { can: trongNha[0], ungVien: [] };
  return { can: null, ungVien: trongNha };
}

function khopNha(raw: string, u: Can): boolean {
  const t = raw.toLowerCase(), plain = noAccent(raw);
  const ten = [u.property_name ?? "", ...(u.property_aliases ?? [])].filter(Boolean);
  return ten.some((k) => has(t, k.toLowerCase()) || (noAccent(k).length >= 5 && has(plain, noAccent(k))));
}

// ---------------- Đọc cả câu ----------------
export function parseBooking(raw: string, units: Can[], today = vnToday()): BanNhap {
  const t = raw.toLowerCase();
  const { can, ungVien } = timCan(raw, units);
  const ngay = timNgay(raw, today);

  let batDau: string | null = ngay[0] ?? null;
  let ketThuc: string | null = ngay[1] ?? null;
  if (batDau && !ketThuc) ketThuc = themKhoang(batDau, raw);
  // Ngày trả trước ngày vào → hiểu là sang năm sau
  if (batDau && ketThuc && ketThuc <= batDau) {
    const d = new Date(ketThuc + "T00:00:00Z");
    ketThuc = iso(new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())));
  }

  const { gia, coc } = timTien(raw);
  const soDem = batDau && ketThuc ? Math.round((Date.parse(ketThuc) - Date.parse(batDau)) / 86400e3) : 0;
  const daiHan = /thá?ng/i.test(raw) ? true : soDem >= 28;

  const thieu: string[] = [];
  if (!can) thieu.push("căn");
  if (!batDau) thieu.push("ngày vào");
  if (!ketThuc) thieu.push("ngày trả phòng");

  return {
    can,
    canUngVien: ungVien,
    thieu,
    tenKhach: timTenKhach(raw, can?.name),
    row: {
      unit_id: can?.id ?? null,
      start_date: batDau,
      end_date: ketThuc,
      term_type: daiHan ? "dai_han" : "ngan_han",
      rent_amount: gia ?? (daiHan ? can?.list_rent_month ?? null : null),
      deposit_amount: coc,
      deposit_status: coc ? "da_nhan" : "chua_nhan",
      status: /giữ chỗ|giu cho|chưa cọc|chua coc/.test(t) ? "giu_cho" : coc ? "da_coc" : "giu_cho",
      channel: timKenh(raw),
      note: null,
    },
  };
}
