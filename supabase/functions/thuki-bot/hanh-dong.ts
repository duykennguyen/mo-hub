// Lễ tân — THAO TÁC trên booking đã có, nói bằng lời tự nhiên:
//   "xóa thông tin đặt phòng của Duy ở ngày mai đi"   → hủy/xóa booking của Duy nhận phòng ngày mai
//   "dời Duy sang 12-14/10" · "lùi khách Kim 2 ngày"  → đổi ngày
//   "Dominic gia hạn thêm 1 tháng" · "Kim ở thêm 2 đêm" → gia hạn
//   "Liat trả phòng sớm ngày 12/10" · "Liat đã trả phòng" → trả phòng sớm
//   "Anna đã nhận phòng"                                → đang ở
//   "chuyển Duy sang căn Thơm"                          → đổi căn
//   "ai đang ở Gừng" · "xem booking của Duy"            → tra cứu
// Booking được tìm theo TÊN KHÁCH + NGÀY + CĂN (không bắt nhớ số #). Chỉ dùng luật, không dùng AI.
// Phần này chỉ ĐỌC; thao tác thật nằm ở thao-tac.ts và luôn có bước bấm xác nhận.
import { chuanHoaKhoangNgay, timCan, timNgay, type Can } from "./parse-booking.ts";
import { iso, noAccent, vnToday } from "./parse.ts";

export type LoaiHD = "huy" | "doi_ngay" | "gia_han" | "tra_som" | "nhan_phong" | "doi_can" | "xem" | "ai_o";
export type HanhDong = {
  loai: LoaiHD;
  timKiem: string;   // phần câu dùng để TÌM booking (tên, ngày, căn hiện tại)
  dich: string;      // phần câu nói về KẾT QUẢ mong muốn (sau "sang/qua/thành/đến"…)
};

// Từ nối "đích": "dời Duy SANG 12/10", "gia hạn ĐẾN 20/10", "chuyển QUA căn Thơm"
const RE_DICH = /\s(?:sang|qua|thành|thanh|tới|toi|đến|den|lại thành|lại sang|->|→)\s/i;
const dau = (t: string) => t.split(/\s+/).slice(0, 5).join(" ");    // động từ phải nằm trong 5 chữ đầu

export function docHanhDong(raw: string): HanhDong | null {
  const t = raw.toLowerCase().trim();
  const tach = (re = RE_DICH): HanhDong["timKiem"][] => {
    const m = t.match(re);
    return m ? [t.slice(0, m.index), t.slice(m.index! + m[0].length)] : [t, ""];
  };
  const hd = (loai: LoaiHD, re?: RegExp): HanhDong => {
    const [timKiem, dich] = tach(re);
    return { loai, timKiem, dich };
  };

  // Tra cứu: "ai đang ở Gừng", "căn Gừng ai ở", "khách nào ở nhà Sen"
  if (/(^|\s)(ai|khách nào|người nào)\s+(đang\s+)?(ở|thuê)(\s|$)/.test(t) || /(căn|phòng|nhà)\s+\S+.*\s(có\s+)?ai\s+(đang\s+)?ở/.test(t))
    return { loai: "ai_o", timKiem: t, dich: "" };

  // Đã nhận phòng / đã đến
  if (/(đã|vừa|mới)\s+(nhận phòng|check[\s-]?in|đến nơi|tới nơi|vào ở|đến rồi|tới rồi|tới|đến)(?![\p{L}])|(nhận phòng|check[\s-]?in)\s+rồi/u.test(t)
      && !/(trả phòng|check[\s-]?out)/.test(t))
    return hd("nhan_phong");

  // Trả phòng sớm / đã trả phòng
  if (/trả phòng sớm|về sớm|rời sớm|đi sớm|check[\s-]?out sớm|(đã|vừa|mới)\s+(trả phòng|check[\s-]?out|rời đi|đi rồi|về rồi|dọn đi)|trả phòng rồi|check[\s-]?out rồi/.test(t))
    return hd("tra_som", /\s(?:ngày|vào|hôm|lúc)\s/i);

  // Gia hạn / ở thêm
  if (/gia hạn|gia han|ở thêm|o them|kéo dài|ở tiếp|thuê tiếp|thuê thêm|ở lại thêm|extend/.test(t))
    return hd("gia_han", /\s(?:thêm|đến|tới|den|toi|sang|qua|tiếp)\s/i);

  // Hủy / xóa
  if (/(^|\s)(hủy|huỷ|huy|xóa|xoá|xoa|cancel|bỏ)(?![\p{L}])/u.test(dau(t)) && !/xóa ảnh|xoá ảnh|bỏ qua|bỏ ghi chú/.test(t))
    return { loai: "huy", timKiem: t, dich: "" };

  // Đổi căn: "chuyển Duy sang căn Thơm", "đổi phòng cho Kim qua Gừng"
  if (/(chuyển|đổi|doi|chuyen)\s/.test(dau(t)) && /\s(sang|qua)\s+(căn|phòng|nhà)\s/.test(t))
    return hd("doi_can", /\s(?:sang|qua)\s+(?=căn|phòng|nhà)/i);
  if (/(chuyển|đổi)\s+(căn|phòng)/.test(t)) return hd("doi_can");

  // Đổi ngày: dời / lùi / hoãn / đổi ngày / sớm hơn
  if (/(^|\s)(dời|doi|lùi|lui|hoãn|hoan|đẩy|đổi ngày|đổi lịch|chuyển ngày|chuyển lịch|đến sớm|đến muộn|đến trễ)(?![\p{L}])/u.test(dau(t)) ||
      /(đổi|chuyển)\s+(?:\S+\s+){0,3}?(sang|qua)\s+(ngày\s+)?\d{1,2}\s*\//.test(t))
    return hd("doi_ngay");

  // Xem: "xem booking của Duy", "thông tin khách Kim"
  if (/^(xem|thông tin|thong tin|chi tiết|chi tiet|kiểm tra|check)\s+(booking|đặt phòng|khách|phòng của|của)/.test(t))
    return { loai: "xem", timKiem: t, dich: "" };
  return null;
}

// ---------------- Dịch ngày ----------------
// "lùi 2 ngày" → +2 · "sớm 1 ngày", "lên 1 ngày", "đến sớm 1 hôm" → -1 · "lùi 1 tuần" → +7
export function soNgayDich(t: string): number | null {
  const m = t.match(/(lùi|dời|hoãn|đẩy|muộn|trễ|sau|sớm|lên|trước)\s*(?:lại\s*)?(?:thêm\s*)?(\d{1,3})\s*(ngày|hôm|đêm|tuần)/i)
    ?? t.match(/(\d{1,3})\s*(ngày|hôm|đêm|tuần)\s*(sau|sớm hơn|muộn hơn|trước)/i);
  if (!m) {
    // "lùi Duy 2 ngày", "khách Kim đến sớm hơn 1 hôm" — tên khách xen giữa động từ và số ngày
    const dt = t.match(/(lùi|dời|hoãn|đẩy|muộn|trễ|sớm)(?![\p{L}])/iu);
    const sn = t.match(/(\d{1,3})\s*(ngày|hôm|đêm|tuần)(?![\p{L}])/iu);
    if (!dt || !sn || /\d{1,2}\s*\/\s*\d{1,2}/.test(t)) return null;
    const n = Number(sn[1]) * (/tuần/i.test(sn[2]) ? 7 : 1);
    return /sớm/i.test(dt[1]) ? -n : n;
  }
  const [chu, so, donVi] = /\d/.test(m[1]) ? [m[3], m[1], m[2]] : [m[1], m[2], m[3]];
  const n = Number(so) * (/tuần/i.test(donVi) ? 7 : 1);
  return /sớm|lên|trước/i.test(chu) ? -n : n;
}

// "thêm 2 đêm", "thêm 1 tháng", "thêm 1 tuần" → cộng vào ngày trả phòng
export function themVaoNgay(ngay: string, t: string): string | null {
  const d = new Date(ngay + "T00:00:00Z");
  const thang = t.match(/(\d{1,2})\s*thá?ng(?![\p{L}])/iu);
  if (thang) {
    const n = Number(thang[1]);
    const cuoi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), cuoi))));
  }
  const tuan = t.match(/(\d{1,2})\s*tuần/i);
  if (tuan) return iso(new Date(d.getTime() + Number(tuan[1]) * 7 * 86400e3));
  const dem = t.match(/(\d{1,3})\s*(?:đêm|ngày|hôm|nights?)(?![\p{L}])/iu);
  if (dem) return iso(new Date(d.getTime() + Number(dem[1]) * 86400e3));
  return null;
}

// ---------------- Tìm booking theo lời tả ----------------
export type BookingTom = {
  id: number; start_date: string; end_date: string; status: string;
  unit_id: string; unit_name: string; property_name: string; guest_name: string | null;
};

// Chữ không phải tên người — bỏ khi so tên khách
const KHONG_PHAI_TEN = new Set([
  "khach", "dat", "phong", "cua", "o", "ngay", "mai", "hom", "nay", "di", "nhe", "thong", "tin", "booking", "can", "nha",
  "anh", "chi", "a", "c", "em", "e", "ong", "ba", "co", "chu", "bac", "mr", "ms", "mrs", "ban", "gia", "dinh", "doan",
  "huy", "xoa", "doi", "doi", "sang", "qua", "them", "tra", "nhan", "da", "vua", "len", "lui", "dem", "thang", "tuan",
  "cho", "toi", "minh", "va", "voi", "la", "lai", "som", "muon", "tre", "ve", "ra", "vao", "het",
]);
const tuTen = (ten: string) => noAccent(ten).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !KHONG_PHAI_TEN.has(w));

export function chamDiem(moTa: string, ds: BookingTom[], units: Can[], today = vnToday()): { b: BookingTom; diem: number }[] {
  const t = moTa.toLowerCase();
  const plain = " " + noAccent(moTa).replace(/[^a-z0-9#/]+/g, " ") + " ";
  const id = moTa.match(/#\s?(\d{1,7})/)?.[1];
  const ngay = timNgay(chuanHoaKhoangNgay(moTa, today), today);
  const homNay = iso(today);
  const { can, ungVien } = timCan(moTa, units);
  const canIds = new Set(can ? [can.id] : ungVien.map((u) => u.id));
  const out: { b: BookingTom; diem: number }[] = [];
  for (const b of ds) {
    if (id) { if (String(b.id) === id) out.push({ b, diem: 100 }); continue; }
    let diem = 0;
    // Tên khách: mỗi chữ đặc trưng của tên xuất hiện nguyên chữ trong câu
    const tu = tuTen(b.guest_name ?? "");
    const trung = tu.filter((w) => plain.includes(` ${w} `)).length;
    if (trung) diem += 4 + 2 * (trung - 1);
    // Căn
    if (canIds.has(b.unit_id)) diem += can ? 4 : 2;
    // Ngày: trùng ngày nhận phòng là chắc nhất, rơi vào giữa kỳ ở cũng tính
    for (const d of ngay) {
      if (d === b.start_date) diem += 4;
      else if (d === b.end_date) diem += 2;
      else if (d > b.start_date && d < b.end_date) diem += 1;
    }
    // "đang ở" / "hôm nay" → booking đang diễn ra
    if (/đang ở|hiện tại|bây giờ/.test(t) && b.start_date <= homNay && b.end_date > homNay) diem += 2;
    if (diem > 0) out.push({ b, diem });
  }
  return out.sort((x, y) => y.diem - x.diem || x.b.start_date.localeCompare(y.b.start_date));
}

// Kết luận: 1 booking rõ ràng, nhiều booking ngang điểm (hỏi lại), hay không thấy
export function chonBooking(ketQua: { b: BookingTom; diem: number }[]): { chac: BookingTom | null; ungVien: BookingTom[] } {
  if (!ketQua.length) return { chac: null, ungVien: [] };
  const cao = ketQua[0].diem;
  const ngang = ketQua.filter((x) => x.diem === cao).map((x) => x.b);
  // Chỉ khớp yếu (một ngày rơi giữa kỳ ở) thì không dám chắc
  if (ngang.length === 1 && cao >= 3) return { chac: ngang[0], ungVien: [] };
  return { chac: null, ungVien: ketQua.slice(0, 6).map((x) => x.b) };
}

