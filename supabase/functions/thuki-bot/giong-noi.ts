// Chuẩn hóa câu đọc bằng giọng nói trước khi đưa vào bộ đọc.
//
// Bàn phím điện thoại khi đọc chính tả sẽ cho ra chữ KHÔNG có dấu gạch chéo và
// thường viết số bằng chữ:
//   "đặt gừng cho anna từ ngày một tháng mười đến ngày một tháng mười hai hai mươi triệu"
// Bộ đọc cần thấy: "đặt gừng cho anna từ 1/10 đến 1/12 20000000"
import { vnToday } from "./parse.ts";

// ---------------- Số viết bằng chữ ----------------
const CHU_SO: Record<string, number> = {
  "không": 0, "một": 1, "mốt": 1, "hai": 2, "ba": 3, "bốn": 4, "tư": 4,
  "năm": 5, "lăm": 5, "nhăm": 5, "sáu": 6, "bảy": 7, "bẩy": 7, "tám": 8, "chín": 9,
};
const THANG_BAC: Record<string, number> = { "trăm": 100, "nghìn": 1000, "ngàn": 1000, "triệu": 1_000_000, "tỷ": 1_000_000_000, "tỉ": 1_000_000_000 };

const laTuSo = (w: string) =>
  w in CHU_SO || w in THANG_BAC || w === "mười" || w === "mươi" || w === "rưỡi" || w === "linh" || w === "lẻ";

// "hai mươi mốt" → 21 · "tám trăm nghìn" → 800000 · "một triệu rưỡi" → 1500000
export function soTuChu(tu: string[]): number | null {
  let tong = 0, hienTai = 0, coSo = false, bacCuoi = 1;
  for (const w of tu) {
    if (w === "mười") { hienTai = hienTai === 0 ? 10 : hienTai * 10; coSo = true; }
    else if (w === "mươi") { hienTai = hienTai * 10; coSo = true; }
    else if (w === "linh" || w === "lẻ") { /* "một trăm lẻ năm" — bỏ qua */ }
    else if (w === "rưỡi") { tong += bacCuoi / 2; }
    else if (w in THANG_BAC) {
      const bac = THANG_BAC[w];
      if (bac === 100) { hienTai = (hienTai || 1) * 100; }
      else { tong += (hienTai || 1) * bac; hienTai = 0; bacCuoi = bac; }
      coSo = true;
    }
    else if (w in CHU_SO) { hienTai += CHU_SO[w]; coSo = true; }
    else return null;
  }
  return coSo ? Math.round(tong + hienTai) : null;
}

// Đổi mọi cụm số viết bằng chữ trong câu thành chữ số
function doiSoTrongCau(raw: string): string {
  const tu = raw.split(/(\s+)/);          // giữ lại khoảng trắng để ghép lại y nguyên
  const ra: string[] = [];
  let dem: string[] = [];
  const xa = () => {
    if (!dem.length) return;
    const so = soTuChu(dem.map((x) => x.toLowerCase()));
    ra.push(so === null ? dem.join(" ") : String(so));
    dem = [];
  };
  for (const t of tu) {
    if (/^\s+$/.test(t)) { if (!dem.length) ra.push(t); continue; }
    if (laTuSo(t.toLowerCase())) { dem.push(t); continue; }
    xa();
    if (dem.length === 0 && ra.length && !/\s$/.test(ra[ra.length - 1])) ra.push(" ");
    ra.push(t);
  }
  xa();
  return ra.join("").replace(/\s{2,}/g, " ").trim();
}

// ---------------- Ngày đọc bằng lời ----------------
const dm = (d: Date) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;

export function chuanHoaGiongNoi(raw: string, today = vnToday()): string {
  let t = raw;

  // 1) Số bằng chữ → chữ số ("hai mươi triệu" → 20000000, "ba tháng" → 3 tháng).
  //    Giấu cụm "năm 2026" lại trước đã, vì "năm" cũng là một chữ số (5).
  t = t.replace(/\bnăm\s+(\d{4})\b/gi, "«nam»$1");
  t = doiSoTrongCau(t);
  t = t.replace(/«nam»(\d{4})/g, "năm $1");

  // 2) "ngày 1 tháng 10 năm 2026" / "mùng 1 tháng 10" → 1/10/2026
  // Cả cụm "năm 2026" phải nằm trong nhóm tùy chọn, nếu không regex nuốt luôn dấu cách
  // phía sau rồi dính vào chữ kế tiếp ("10/10cho anh Nam" → mất tên khách).
  t = t.replace(/\b(?:ngày|mùng|mồng)\s*(\d{1,2})\s*(?:tháng|thg)\s*(\d{1,2})(?:\s*(?:năm\s*)?(\d{4}))?/gi,
    (_m, d, thang, nam) => `${d}/${thang}${nam ? "/" + nam : ""}`);

  // 3) "từ 1 tháng 10", "đến 1 tháng 12", "vào 5 tháng 11" → 1/10 …
  //    Chỉ đổi khi có giới từ phía trước, để "3 tháng" (khoảng thời gian) không bị hiểu nhầm thành ngày.
  //    CHÚ Ý: không dùng \b trước "đến". Trong JavaScript, \b chỉ tính [A-Za-z0-9_]
  //    nên chữ "đ" không tạo ranh giới từ → "đến 1 tháng 12" sẽ không khớp.
  t = t.replace(/(^|[\s,.;(])(từ|đến|tới|vào|ra)\s+(\d{1,2})\s*(?:tháng|thg)\s*(\d{1,2})(?!\s*\d)/gi,
    (_m, dau, gt, d, thang) => `${dau}${gt} ${d}/${thang}`);

  // 4) Ngày tương đối
  const hnay = new Date(today.getTime()), mai = new Date(today.getTime() + 86400e3), mot = new Date(today.getTime() + 2 * 86400e3);
  t = t.replace(/\bhôm nay\b/gi, dm(hnay))
       .replace(/\bngày mai\b/gi, dm(mai))
       .replace(/\b(ngày kia|ngày mốt|mốt)\b/gi, dm(mot));

  // 5) Đọc chính tả hay nghe nhầm chữ "đặt"
  t = t.replace(/^(đặc|đạt|dặt|dat|đặt)\s+/i, "đặt ");

  return t;
}
