// Bộ đọc tin nhắn ĐẶT PHÒNG của Lễ tân — phân tích bằng luật, không dùng AI.
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

// Thông tin khách đọc được từ tin nhắn — ghi vào bảng guests
export type ThongTinKhach = {
  ten: string | null;
  sdt: string | null;
  email: string | null;
  quoc_tich: string | null;
};

export type DongBooking = {
  unit_id: string | null;
  start_date: string | null;
  end_date: string | null;
  term_type: "dai_han" | "ngan_han";
  rent_amount: number | null;
  deposit_amount: number | null;
  deposit_status: string;
  security_deposit: number | null;
  security_deposit_status: string | null;
  is_free: boolean;
  status: string;
  channel: string | null;
  broker_name: string | null;
  commission_amount: number | null;
  note: string | null;
};

export type BanNhap = {
  can: Can | null;
  canUngVien: Can[];          // khớp nhiều căn → hỏi lại bằng nút
  thieu: string[];            // những thứ còn thiếu, để bot hỏi tiếp
  tenKhach: string | null;    // giữ cho tương thích; = khach.ten
  khach: ThongTinKhach;
  giaDem: number | null;      // giá một đêm (nếu nhắn "800k/đêm") — tổng tiền đã tính vào rent_amount
  otaXacNhan: boolean;        // kênh OTA → coi như đã thanh toán qua sàn
  row: DongBooking;
};

// ---------------- Phân loại: tin nhắn này có phải đặt phòng không? ----------------
//
// Luật (xét theo thứ tự, dừng ở luật đầu tiên khớp):
//   1. Câu mở đầu bằng động từ công việc (dọn, sửa, thay, kiểm tra…) → KHÔNG phải đặt phòng.
//      "dọn Củ Sả trước khi khách check in" là việc buồng phòng, không phải booking.
//   2. Có dấu hiệu đặt phòng RÕ (book, booking, đặt phòng, giữ chỗ, khách thuê…) → ĐẶT PHÒNG.
//   3. Có dấu hiệu MỜ (khách, nhận phòng, check in, trả phòng) + có mốc thời gian
//      hoặc số đêm/tháng → ĐẶT PHÒNG.
//   4. Còn lại → không phải (laTinDatPhong xét thêm: có tên căn + ngày thì vẫn là đặt phòng).

// Động từ công việc — nếu đứng đầu câu thì chắc chắn là việc
const DONG_TU_VIEC = /^(dọn|don|lau|giặt|giat|thay|sửa|sua|kiểm tra|kiem tra|gọi|goi|mua|lắp|lap|bảo trì|bao tri|vệ sinh|ve sinh|hút bụi|sơn|son|cắt|cat|tưới|tuoi|đổ|do|bơm|bom|xả|xa|tháo|thao|kê|ke|chuyển|chuyen|nhắc|nhac|hỏi|hoi|liên hệ|lien he)\b/i;

// Dấu hiệu đặt phòng rõ ràng
const DAU_HIEU_RO = [
  "đặt phòng", "đặt căn", "book", "booking", "giữ chỗ", "giu cho", "giữ phòng", "giữ căn",
  "khách thuê", "khach thue", "khách ở", "khach o", "gia hạn cho khách", "reservation", "khách mới",
  "nhận khách", "chốt phòng", "chốt căn", "chốt khách", "lên lịch cho khách",
];
// Dấu hiệu mờ — phải kèm mốc thời gian mới tính là đặt phòng
const DAU_HIEU_MO = [
  "khách", "khach", "nhận phòng", "nhan phong", "check in", "checkin", "check-in", "trả phòng", "tra phong",
  "check out", "checkout", "check-out", "guest", "thuê", "thue", "ở", "đêm",
];

// Động từ công việc xuất hiện ở BẤT KỲ đâu trong câu — dùng cho luật 3
const CO_VIEC = /(dọn|lau|giặt|thay ga|thay khăn|sửa|kiểm tra|gọi thợ|lắp|bảo trì|vệ sinh|hút bụi|sơn lại|thu tiền)/i;

const COC_THOI_GIAN = /\d{1,2}\s*[\/-]\s*\d{1,2}|\d{1,3}\s*(đêm|dem|ngày|ngay|hôm|tuần|tuan|thá?ng|nights?)(?![\p{L}])|hôm nay|ngày mai|ngày mốt|ngày kia|cuối tuần|tuần sau/iu;

export const laViec = (raw: string) => {
  const t = raw.toLowerCase().trim();
  return DONG_TU_VIEC.test(t) || (has(t, "đặt cọc") && !has(t, "đặt phòng"));
};

export function laLenhDatPhong(raw: string): boolean {
  const t = raw.toLowerCase().trim();
  if (/^\/(dat|huy|doi)\b/.test(t)) return true;

  // "đặt cọc thợ sơn" là việc, không phải booking
  if (has(t, "đặt cọc") && !has(t, "đặt phòng")) return false;

  // 1. Mở đầu bằng động từ công việc → không phải đặt phòng
  if (DONG_TU_VIEC.test(t)) return false;

  // 2. Dấu hiệu rõ, hoặc câu mở đầu bằng "đặt"
  if (/^(đặt|dat)\b/.test(t)) return true;
  if (DAU_HIEU_RO.some((k) => has(t, k))) return true;

  // 3. Dấu hiệu mờ + mốc thời gian, nhưng trong câu không có động từ công việc nào.
  //    "khách trả phòng Gừng hôm nay, kiểm tra đồ đạc" là việc cần làm, không phải booking mới.
  if (DAU_HIEU_MO.some((k) => has(t, k)) && COC_THOI_GIAN.test(t) && !CO_VIEC.test(t)) return true;

  return false;
}

// Lễ tân chỉ lo booking nên nới thêm một luật: có tên căn/nhà + có ngày thì cũng là đặt phòng
// ("Gừng 1/10 - 5/10 Anna 0905123456"). Câu mở đầu bằng động từ việc vẫn bị loại.
export function laTinDatPhong(raw: string, units: Can[], today = vnToday()): boolean {
  if (laLenhDatPhong(raw)) return true;
  if (laViec(raw) || CO_VIEC.test(raw)) return false;
  const { con } = tachLienHe(raw);
  const { can, ungVien } = timCan(con, units);
  if (!can && !ungVien.length) return false;
  return timNgay(chuanHoaKhoangNgay(con), today).length > 0 || thangTron(con, today) !== null;
}

// ---------------- Liên hệ: số điện thoại, email ----------------
// Tách ra TRƯỚC khi đọc tiền và ngày: "0905.123.456" không được hiểu thành 905 triệu.
const RE_SDT = /(?<![\d\w])(?:\+84|0)(?:[\s.\-]?\d){8,10}(?!\d)|(?<![\d\w])\+(?!84)\d{1,3}(?:[\s.\-]?\d){6,12}(?!\d)/g;
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
// Mã giao dịch ngân hàng (FT26250342284785) không phải tiền
const RE_MA_GD = /\b(?:FT|MBVCB|TX)\d{6,}\b/gi;

export function tachLienHe(raw: string): { sdt: string | null; email: string | null; con: string } {
  let con = raw.replace(RE_MA_GD, " ");
  const email = con.match(RE_EMAIL)?.[0] ?? null;
  if (email) con = con.replace(email, " ");
  let sdt: string | null = null;
  con = con.replace(RE_SDT, (m) => {
    if (!sdt) sdt = m.replace(/[\s.\-]/g, "");
    return " ";
  });
  return { sdt, email: email?.toLowerCase() ?? null, con };
}

// Chỉ hiện một phần SĐT/email trong tin Telegram (Nghị định 13/2023): đủ để soát, không lộ hết
export const anSdt = (s: string | null | undefined) =>
  s ? (s.length > 6 ? s.slice(0, 4) + "•••" + s.slice(-3) : "•••") : "";
export const anEmail = (s: string | null | undefined) => {
  if (!s) return "";
  const [a, b] = s.split("@");
  return `${a.slice(0, 2)}•••@${b ?? ""}`;
};

// ---------------- Ngày ----------------
const THANG_TOI_DA = 31;
const laNgayHopLe = (d: number, m: number) => d >= 1 && d <= THANG_TOI_DA && m >= 1 && m <= 12;

// "10-15/10", "10 đến 15/10", "10→15/10" → "10/10 - 15/10"
export function chuanHoaKhoangNgay(raw: string): string {
  return raw.replace(
    /(?<![\d\/])(\d{1,2})\s*(?:-|–|->|→|~|đến|tới|den|toi)\s*(\d{1,2})\s*\/\s*(\d{1,2})((?:\s*\/\s*\d{2,4})?)(?![\d])/gi,
    (_m, a, b, thang, nam) => `${a}/${thang}${nam.replace(/\s/g, "")} - ${b}/${thang}${nam.replace(/\s/g, "")}`,
  );
}

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

// "thuê cả tháng 11", "ở trọn tháng 12/2026" → [1/11, 1/12)
export function thangTron(raw: string, today = vnToday()): [string, string] | null {
  const m = raw.match(/(?:cả|nguyên|trọn|thuê|ở|trong|book|đặt)\s+tháng\s+(\d{1,2})(?:\s*\/\s*(\d{4}))?(?!\s*\/\s*\d{1,2}(?!\d))/i);
  if (!m) return null;
  const thang = Number(m[1]);
  if (thang < 1 || thang > 12) return null;
  let y = m[2] ? Number(m[2]) : today.getUTCFullYear();
  if (!m[2] && Date.UTC(y, thang, 0) < today.getTime()) y += 1;   // tháng đã qua → năm sau
  return [iso(new Date(Date.UTC(y, thang - 1, 1))), iso(new Date(Date.UTC(y, thang, 1)))];
}

// "3 tháng", "5 đêm", "2 tuần", "4 hôm" → cộng vào ngày bắt đầu
function themKhoang(batDau: string, raw: string): string | null {
  const d = new Date(batDau + "T00:00:00Z");
  const thang = raw.match(/(\d{1,2})\s*thá?ng(?![\p{L}])(?!\s*\d)/iu);
  if (thang) {
    const n = Number(thang[1]);
    const cuoi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), cuoi))));
  }
  const tuan = raw.match(/(\d{1,2})\s*(?:tuần|tuan|weeks?)(?![\p{L}])/iu);
  if (tuan) return iso(new Date(d.getTime() + Number(tuan[1]) * 7 * 86400e3));
  const dem = raw.match(/(\d{1,3})\s*(?:đêm|dem|ngày|ngay|hôm|hom|nights?)(?![\p{L}])/iu);
  if (dem) return iso(new Date(d.getTime() + Number(dem[1]) * 86400e3));
  return null;
}

// ---------------- Tiền ----------------
// "20tr" = 20.000.000 · "1tr2" = 1.200.000 · "15 củ" = 15.000.000 · "800k" = 800.000
// "20.000.000" hoặc "20000000" giữ nguyên
export function doiTien(chuoi: string): number | null {
  const s = chuoi.trim().toLowerCase();
  let m = s.match(/^(\d+)(?:tr|triệu|trieu)(\d{1,3})$/);
  if (m) return Number(m[1]) * 1_000_000 + Math.round(Number(m[2]) * 1_000_000 / 10 ** m[2].length);
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|củ|cu|m)$/);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 1_000_000);
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*(k|nghìn|nghin|ngàn|ngan)$/);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 1_000);
  const so = Number(s.replace(/[.,\s]/g, ""));
  return Number.isFinite(so) && so > 0 ? so : null;
}

const RE_TIEN = /(\d+(?:tr|triệu|trieu)\d{1,3})(?![\d\p{L}])|(\d+(?:[.,]\d+)?)\s*(?:tr|triệu|trieu|củ|cu|k|nghìn|nghin|ngàn|ngan)(?![\p{L}\d])|(\d[\d.,]{5,}\d)/giu;

const KW_HOA_HONG = /(hoa hồng|hoa hong|\bhh\b|commission|\bcom\b)/i;
const KW_COC_BAO_DAM = /(bảo đảm|đảm bảo|bao dam|dam bao|cọc an ninh|cọc giữ đồ|cọc hư hỏng|cọc tài sản|security)/i;
const KW_TRA_TRUOC = /(cọc|coc|trả trước|tra truoc|đặt trước|dat truoc|ck trước|chuyển khoản trước|chuyển trước|đã ck|đã chuyển|ứng trước|thanh toán trước)/i;

export type Tien = {
  gia: number | null;         // giá thuê (dài hạn: /tháng · ngắn hạn: tổng)
  giaDem: number | null;      // giá một đêm
  coc: number | null;         // trả trước (doanh thu)
  cocBaoDam: number | null;   // cọc bảo đảm (hoàn lại)
  hoaHong: number | null;
};

export function timTien(raw: string): Tien {
  const out: Tien = { gia: null, giaDem: null, coc: null, cocBaoDam: null, hoaHong: null };
  const t = raw.toLowerCase();
  let m: RegExpExecArray | null;
  let cuoi = 0;
  RE_TIEN.lastIndex = 0;
  while ((m = RE_TIEN.exec(t))) {
    const soTien = doiTien(m[0]);
    if (!soTien) continue;
    // Chỉ nhìn đoạn từ khoản tiền trước tới khoản này (tối đa 30 ký tự):
    // "cọc 5tr giá 20tr" — chữ "cọc" thuộc về 5tr, không thuộc về 20tr
    const truoc = t.slice(Math.max(cuoi, m.index - 30), m.index);
    const sau = t.slice(m.index + m[0].length, m.index + m[0].length + 14);
    cuoi = m.index + m[0].length;
    if (KW_HOA_HONG.test(truoc)) out.hoaHong = soTien;
    else if (KW_COC_BAO_DAM.test(truoc)) out.cocBaoDam = soTien;
    else if (KW_TRA_TRUOC.test(truoc)) out.coc = soTien;
    else if (/^\s*(?:\/|một|1|mỗi|per|a)\s*(?:đêm|dem|ngày|ngay|night)/.test(sau) ||
             /(?:mỗi|một|1)\s*(?:đêm|ngày)\s*(?:giá\s*)?$/.test(truoc)) out.giaDem ??= soTien;
    else if (out.gia === null) out.gia = soTien;
  }
  return out;
}

// ---------------- Kênh ----------------
const OTA_KHAC: [RegExp, string][] = [
  [/traveloka/i, "Traveloka"], [/trip\.com|tripcom|ctrip/i, "Trip.com"], [/expedia/i, "Expedia"],
  [/hotels\.com/i, "Hotels.com"], [/vrbo/i, "Vrbo"],
];
export function timKenh(t: string): { kenh: string | null; tenKenh: string | null } {
  if (/airbnb|air bnb|\bbnb\b|\babnb\b/i.test(t)) return { kenh: "airbnb", tenKenh: null };
  if (/booking\.com|\bbkk\b|booking com|\bbcom\b/i.test(t)) return { kenh: "booking", tenKenh: null };
  if (/agoda/i.test(t)) return { kenh: "agoda", tenKenh: null };
  for (const [re, ten] of OTA_KHAC) if (re.test(t)) return { kenh: "khac", tenKenh: ten };
  if (/môi giới|moi gioi|broker|\bsale\b|đại lý|dai ly|agency|công ty du lịch|\bcò\b/i.test(t)) return { kenh: "moi_gioi", tenKenh: null };
  if (/trực tiếp|truc tiep|\bpage\b|\bfb\b|facebook|zalo|khách quen|khách cũ|quay lại|giới thiệu|gioi thieu|người quen|bạn bè|instagram|\big\b|tiktok|website|\bweb\b|hotline|walk[\s-]?in/i.test(t))
    return { kenh: "truc_tiep", tenKenh: null };
  return { kenh: null, tenKenh: null };
}
const LA_OTA = new Set(["airbnb", "booking", "agoda"]);

// "môi giới chị Hoa", "sale anh Tuấn" → tên người môi giới (tách ra trước khi tìm tên khách)
const RE_MOI_GIOI = /(?:môi giới|moi gioi|broker|sale|đại lý|dai ly)\s*(?:là|:)?\s*((?:a|anh|chị|chi|c|em|e|cô|chú|bác|mr\.?|ms\.?)\s+\p{Lu}[\p{L}]*(?:\s+\p{Lu}[\p{L}]*){0,2})/u;

// ---------------- Quốc tịch ----------------
// Tên dài / tiếng Anh: nhận ở bất cứ đâu
const QT_DAI: [RegExp, string][] = [
  [/hàn quốc|south korea|korean|\bkorea\b/i, "Hàn Quốc"], [/nhật bản|japanese|\bjapan\b/i, "Nhật Bản"],
  [/trung quốc|chinese|\bchina\b/i, "Trung Quốc"], [/đài loan|taiwan/i, "Đài Loan"],
  [/hồng kông|hong kong/i, "Hồng Kông"], [/singapore/i, "Singapore"], [/malaysia/i, "Malaysia"],
  [/thái lan|thailand|\bthai\b/i, "Thái Lan"], [/ấn độ|indian|\bindia\b/i, "Ấn Độ"],
  [/philippines|filipino/i, "Philippines"], [/indonesia/i, "Indonesia"],
  [/tây ban nha|spanish|\bspain\b/i, "Tây Ban Nha"], [/hà lan|dutch|netherlands/i, "Hà Lan"],
  [/australia|australian|\baussie\b/i, "Úc"], [/new zealand/i, "New Zealand"], [/canada|canadian/i, "Canada"],
  [/france|french/i, "Pháp"], [/germany|german/i, "Đức"], [/russia|russian/i, "Nga"],
  [/italy|italian/i, "Ý"], [/anh quốc|\buk\b|england|british/i, "Anh"],
  [/\busa\b|american|hoa kỳ/i, "Mỹ"], [/việt kiều|viet kieu/i, "Việt kiều"], [/israel/i, "Israel"],
];
// Tên ngắn tiếng Việt: chỉ nhận khi có "khách / người / quốc tịch" đứng trước ("khách Hàn")
const QT_NGAN: Record<string, string> = {
  "hàn": "Hàn Quốc", "nhật": "Nhật Bản", "trung": "Trung Quốc", "tàu": "Trung Quốc", "mỹ": "Mỹ", "úc": "Úc",
  "pháp": "Pháp", "đức": "Đức", "nga": "Nga", "thái": "Thái Lan", "ý": "Ý", "anh": "Anh", "việt": "Việt Nam",
  "vn": "Việt Nam", "ấn": "Ấn Độ", "tây": "nước ngoài", "nước ngoài": "nước ngoài",
};
const RE_QT_NGAN = /(?:khách|người|quốc tịch|qt)\s*:?\s+(nước ngoài|hàn|nhật|trung|tàu|mỹ|úc|pháp|đức|nga|thái|ý|anh|việt|vn|ấn|tây)(?![\p{L}])/giu;

export function timQuocTich(raw: string): string | null {
  for (const [re, v] of QT_DAI) if (re.test(raw)) return v;
  RE_QT_NGAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_QT_NGAN.exec(raw))) {
    const tu = m[1];
    // "khách anh Nam": "anh" viết thường + tên viết hoa phía sau là cách xưng hô, không phải nước Anh
    if (tu.toLowerCase() === "anh") {
      const sau = raw.slice(m.index + m[0].length).trimStart();
      if (tu === "anh" || /^\p{Lu}/u.test(sau)) continue;
    }
    // "khách Tây Ban Nha" đã khớp ở QT_DAI; "khách tây" còn lại là khách nước ngoài chung chung
    return QT_NGAN[tu.toLowerCase()] ?? null;
  }
  return null;
}
const LA_TU_QUOC_TICH = new Set(Object.keys(QT_NGAN).concat(["nước", "quốc"]));

// ---------------- Số khách, giờ đến, yêu cầu riêng ----------------
export function timSoKhach(raw: string): string | null {
  const nl = raw.match(/(\d{1,2})\s*(?:người lớn|nguoi lon|nl|adults?)(?![\p{L}])/iu);
  const te = raw.match(/(\d{1,2})\s*(?:trẻ em|tre em|trẻ nhỏ|em bé|bé|trẻ|kids?|children|child|te)(?![\p{L}])/iu);
  if (nl || te) return [nl ? `${nl[1]} người lớn` : "", te ? `${te[1]} trẻ em` : ""].filter(Boolean).join(", ");
  const tong = raw.match(/(\d{1,2})\s*(?:người|nguoi|khách|khach|pax|guests?|ng)(?![\p{L}])/iu);
  return tong ? `${tong[1]} khách` : null;
}

export function timGioDen(raw: string): string | null {
  const m = raw.match(/(?<![\d\/])(\d{1,2})\s*(?:h|giờ|g)\s*(\d{2})?(?![\p{L}\d])(?:\s*(sáng|trưa|chiều|tối|đêm)(?![\p{L}]))?|(?<![\d\/])(\d{1,2}):(\d{2})(?!\d)/iu);
  if (!m) return null;
  const gio = Number(m[1] ?? m[4]);
  if (gio > 23) return null;
  const phut = m[2] ?? m[5];
  return `${gio}h${phut ?? ""}${m[3] ? " " + m[3] : ""}`;
}

const YEU_CAU: [RegExp, string][] = [
  [/đón sân bay|đón ở sân bay|đưa đón|airport|pick ?up|xe đón/i, "đưa/đón sân bay"],
  [/thuê xe|xe máy|motorbike|scooter/i, "thuê xe máy"],
  [/nôi|cũi|baby cot|\bcrib\b/i, "nôi/cũi em bé"],
  [/giường phụ|thêm giường|extra bed/i, "giường phụ"],
  [/thú cưng|\bchó\b|\bmèo\b|\bpets?\b|\bdogs?\b|\bcats?\b/i, "mang thú cưng"],
  [/ăn sáng|breakfast/i, "ăn sáng"],
  [/sinh nhật|birthday/i, "sinh nhật"], [/trăng mật|honeymoon|kỷ niệm|anniversary/i, "kỷ niệm/trăng mật"],
  [/nhận phòng sớm|vào sớm|check[\s-]?in sớm|early check/i, "nhận phòng sớm"],
  [/trả phòng muộn|ra muộn|check[\s-]?out muộn|late check/i, "trả phòng muộn"],
  [/xuất hóa đơn|xuất hoá đơn|hóa đơn đỏ|\bvat\b/i, "xuất hóa đơn VAT"],
  [/hút thuốc|smoking/i, "hút thuốc"],
  [/làm việc|work ?from|bàn làm việc|wifi mạnh/i, "cần chỗ làm việc"],
];
export function timYeuCau(raw: string): string[] {
  return YEU_CAU.filter(([re]) => re.test(raw)).map(([, v]) => v);
}

// "ghi chú: khách ăn chay" → phần sau chữ ghi chú là ghi chú nguyên văn, không đọc tiền/ngày trong đó
const RE_GHI_CHU = /(?:^|[\s,.;])(?:ghi chú|ghi chu|note|lưu ý|luu y|gc)\s*[:\-]\s*([\s\S]+)$/i;
export function tachGhiChu(raw: string): { chinh: string; ghiChu: string | null } {
  const m = raw.match(RE_GHI_CHU);
  if (!m) return { chinh: raw, ghiChu: null };
  return { chinh: raw.slice(0, m.index), ghiChu: m[1].trim() || null };
}

// ---------------- Tên khách ----------------
// Lấy cụm sau "cho" / "tên" / "khách" hoặc xưng hô + tên viết hoa, dừng lại khi gặp số, ngày, từ khóa khác.
// Từ dừng CÓ DẤU — không đưa dạng không dấu vào đây, kẻo "gia đình Lê" bị cắt còn rỗng
const DUNG = /^(từ|đến|tới|ngày|giá|cọc|thuê|trong|lúc|vào|qua|check|sđt|đt|số|phone|tel|email|mail|bên|kênh|đã|chưa|giữ|hoa|bay|người|quốc|pax|ở|nhận|trả|giờ|khách|book|đặt|ghi|lưu|note|tầm|khoảng|đón|cần|muốn|có|không|thêm|và|với|cọc|tháng|đêm|tuần|miễn|free|môi|sale|nhà|căn|phòng|tại|hôm|mai|chuyển|ck|thanh)$/i;
const DUNG_KHONG_DAU = new Set([
  "tu", "den", "toi", "ngay", "thue", "coc", "check", "airbnb", "booking", "agoda", "bkk", "bnb", "sdt", "dt",
  "so", "phone", "tel", "email", "mail", "qua", "ben", "kenh", "da", "chua", "giu", "hoa", "gio", "pax", "nguoi",
  "quoc", "khach", "book", "dat", "note", "free", "nha", "can", "phong", "va", "voi", "ck", "traveloka", "expedia",
]);
// Sau "khách" thường là động từ chứ không phải tên: "khách book Củ Sả", "khách thuê 3 tháng"
const SAU_KHACH_KHONG_PHAI_TEN = new Set([
  "book", "booking", "đặt", "dat", "thuê", "thue", "ở", "o", "nhận", "nhan", "trả", "tra",
  "check", "checkin", "muốn", "muon", "hỏi", "hoi", "cần", "can", "sẽ", "se", "đã", "da", "mới", "moi",
  "tên", "ten", "quen", "cũ", "lẻ", "đoàn", "vip", "của", "bên", "qua", "từ", "người", "nước",
]);

function catTen(phan: string): string | null {
  const tu: string[] = [];
  for (const w of phan.split(/\s+/)) {
    const sach = w.replace(/[,.;:!?)]+$/, "");
    if (!sach) break;
    if (/\d|@/.test(sach) || /^[/\-,.(]/.test(sach)) break;
    if (DUNG.test(sach)) break;
    // Từ dừng không dấu chỉ áp cho chữ vốn không dấu, để không cắt nhầm tên có dấu
    if (sach === noAccent(sach) && DUNG_KHONG_DAU.has(sach.toLowerCase())) break;
    tu.push(sach);
    if (/[,.;:!?)]$/.test(w) || tu.length >= 4) break;
  }
  const ten = tu.join(" ").trim();
  return ten.length >= 2 ? ten : null;
}

// Xưng hô viết thường lẫn viết hoa đầu ("Mr John", "Chị Lan") — không dùng cờ i vì \p{Lu} cần phân biệt hoa/thường
const XUNG_HO = ["a", "anh", "chị", "chi", "c", "em", "e", "ông", "bà", "cô", "chú", "bác", "mr\\.?", "mrs\\.?", "ms\\.?", "miss", "bạn"]
  .flatMap((w) => [w, w[0].toUpperCase() + w.slice(1)]).join("|");
const RE_XUNG_HO_TEN = new RegExp(`(?:^|[\\s,(])((?:${XUNG_HO})\\s+\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*){0,3})`, "u");

export function timTenKhach(raw: string, tenCan?: string | null): string | null {
  // 1) Sau chữ "cho" — đáng tin nhất ("cho khách Hàn" thì bỏ, đó không phải tên)
  const mCho = raw.match(/(?:^|\s)cho\s+(.{2,60})/i);
  if (mCho) { const t = catTen(mCho[1]); if (t) return t; }

  // 2) "tên Anna", "khách tên là Kim"
  const mTen = raw.match(/(?:^|\s)tên\s+(?:là\s+|:\s*)?(.{2,60})/i);
  if (mTen) { const t = catTen(mTen[1]); if (t) return t; }

  // 3) Xưng hô + tên viết hoa ở bất cứ đâu: "anh Nam", "chị Lan Anh", "Mr John"
  const mXh = raw.match(RE_XUNG_HO_TEN);
  if (mXh) {
    const t = catTen(mXh[1]);
    if (t && t.split(/\s+/).length >= 2) return t;
  }

  // 4) Sau chữ "khách", nhưng bỏ qua nếu ngay sau là động từ ("khách book …") hay quốc tịch ("khách Hàn")
  const mKhach = raw.match(/(?:^|\s)(?:khách|khach)\s+(.{2,60})/i);
  if (mKhach) {
    const tuDau = mKhach[1].split(/\s+/)[0].replace(/[,.;:]+$/, "").toLowerCase();
    if (!SAU_KHACH_KHONG_PHAI_TEN.has(tuDau) && !LA_TU_QUOC_TICH.has(tuDau)) {
      const t = catTen(mKhach[1]);
      if (t) return t;
    }
  }

  // 5) Cụm cuối cùng sau dấu phẩy: "… ngày mai, 2 đêm, a Duy"
  //    Chỉ nhận nếu ngắn, không có số, và không trùng tên căn vừa nhận ra.
  const manh = raw.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  if (manh.length >= 2) {
    const cuoi = manh[manh.length - 1];
    const soTu = cuoi.split(/\s+/).length;
    const trungTenCan = tenCan ? noAccent(cuoi).includes(noAccent(tenCan)) : false;
    if (soTu <= 4 && !/\d/.test(cuoi) && !trungTenCan && !timKenh(cuoi).kenh && !timYeuCau(cuoi).length) {
      const t = catTen(cuoi);
      if (t) return t;
    }
  }
  return null;
}

// ---------------- Căn ----------------
// Ưu tiên tên căn (cụm dài nhất). Tên trùng nhau giữa các nhà (ví dụ "Tầng trên")
// thì phải có thêm tên nhà mới xác định được, không thì trả về danh sách để hỏi lại.
export function timCan(raw: string, units: Can[]): { can: Can | null; ungVien: Can[] } {
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

// ---------------- Các chi tiết phụ (dùng chung cho đặt mới và /sua) ----------------
export type ChiTiet = {
  khach: ThongTinKhach;
  tien: Tien;
  kenh: string | null;
  tenKenh: string | null;
  moiGioi: string | null;
  trangThai: "giu_cho" | "da_coc" | null;   // null = tin nhắn không nói
  mienPhi: boolean;
  ghiChu: string | null;                     // ghép: số khách · giờ đến · yêu cầu · ghi chú
};

export function docChiTiet(raw: string, tenCan?: string | null): ChiTiet {
  const { chinh, ghiChu } = tachGhiChu(raw);
  const { sdt, email, con: sachLienHe } = tachLienHe(chinh);
  const moiGioi = sachLienHe.match(RE_MOI_GIOI)?.[1] ?? null;
  const con = moiGioi ? sachLienHe.replace(moiGioi, " ") : sachLienHe;
  const t = con.toLowerCase();
  const { kenh, tenKenh } = timKenh(con);
  const mienPhi = /miễn phí|mien phi|\bfree\b|không tính tiền|khong tinh tien|khách mời|ở nhờ|0 đồng/i.test(t);
  const trangThai = /giữ chỗ|giu cho|giữ phòng|chưa cọc|chua coc|chưa chuyển|chưa thanh toán|chưa ck/.test(t) ? "giu_cho"
    : /đã cọc|da coc|cọc rồi|đã thanh toán|thanh toán đủ|đã trả đủ|đã trả hết|đã ck|đã chuyển khoản|\bpaid\b|đã nhận tiền/.test(t) ? "da_coc"
    : null;

  const gioDen = timGioDen(con);
  const phan = [
    timSoKhach(con),
    gioDen ? `giờ đến ~${gioDen}` : null,
    ...timYeuCau(con),
    tenKenh ? `kênh ${tenKenh}` : null,
    ghiChu,
  ].filter(Boolean) as string[];

  return {
    khach: { ten: timTenKhach(con, tenCan), sdt, email, quoc_tich: timQuocTich(con) },
    tien: timTien(con),
    kenh, tenKenh, moiGioi, trangThai, mienPhi,
    ghiChu: phan.length ? phan.join(" · ") : null,
  };
}

// ---------------- Đọc cả câu ----------------
export function parseBooking(raw: string, units: Can[], today = vnToday()): BanNhap {
  const { chinh } = tachGhiChu(raw);
  const { con: sach } = tachLienHe(chinh);
  const chuan = chuanHoaKhoangNgay(sach);
  const { can, ungVien } = timCan(sach, units);
  const ct = docChiTiet(raw, null);
  const ngay = timNgay(chuan, today);

  let batDau: string | null = ngay[0] ?? null;
  let ketThuc: string | null = ngay[1] ?? null;
  if (!batDau) {
    const thang = thangTron(sach, today);
    if (thang) [batDau, ketThuc] = thang;
  }
  if (batDau && !ketThuc) ketThuc = themKhoang(batDau, chuan);
  // Ngày trả trước ngày vào → hiểu là sang năm sau
  if (batDau && ketThuc && ketThuc <= batDau) {
    const d = new Date(ketThuc + "T00:00:00Z");
    ketThuc = iso(new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())));
  }

  const soDem = batDau && ketThuc ? Math.round((Date.parse(ketThuc) - Date.parse(batDau)) / 86400e3) : 0;
  const daiHan = /thá?ng(?![\p{L}])/iu.test(sach) && !ct.tien.giaDem ? true : soDem >= 28;

  // Tiền thuê: "800k/đêm" × số đêm; dài hạn không ghi giá thì lấy giá niêm yết của căn
  const { gia, giaDem, coc, cocBaoDam, hoaHong } = ct.tien;
  let tienThue = gia ?? (giaDem && soDem && !daiHan ? giaDem * soDem : null);
  if (tienThue === null && daiHan && !ct.mienPhi) tienThue = can?.list_rent_month ?? null;
  if (ct.mienPhi) tienThue = 0;

  // Kênh OTA (Airbnb, Booking, Agoda) thì khách đã thanh toán qua sàn → coi như đã chốt,
  // trừ khi tin nhắn nói rõ "giữ chỗ / chưa cọc"
  const otaXacNhan = !!ct.kenh && LA_OTA.has(ct.kenh) && ct.trangThai !== "giu_cho";
  const status = ct.trangThai ?? (coc || otaXacNhan || ct.mienPhi ? "da_coc" : "giu_cho");

  const thieu: string[] = [];
  if (!can) thieu.push("căn");
  if (!batDau) thieu.push("ngày vào");
  if (!ketThuc) thieu.push("ngày trả phòng");

  const tenKhach = ct.khach.ten && can && noAccent(ct.khach.ten) === noAccent(can.name) ? null : ct.khach.ten;
  const khach = { ...ct.khach, ten: tenKhach };

  return {
    can,
    canUngVien: ungVien,
    thieu,
    tenKhach,
    khach,
    giaDem,
    otaXacNhan,
    row: {
      unit_id: can?.id ?? null,
      start_date: batDau,
      end_date: ketThuc,
      term_type: daiHan ? "dai_han" : "ngan_han",
      rent_amount: tienThue,
      deposit_amount: coc,
      deposit_status: coc ? "da_nhan" : "chua_nhan",
      security_deposit: cocBaoDam,
      security_deposit_status: cocBaoDam ? "dang_giu" : null,
      is_free: ct.mienPhi,
      status,
      channel: ct.kenh,
      broker_name: ct.moiGioi,
      commission_amount: hoaHong,
      note: ct.ghiChu,
    },
  };
}
