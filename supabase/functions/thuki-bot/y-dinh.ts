// Lễ tân — đọc Ý ĐỊNH của câu hỏi bằng lời ("căn nào trống 10/10", "tìm Anna", "#12 sđt …")
// rồi quy về đúng lệnh gạch chéo tương ứng. Chỉ dùng luật, không dùng AI.
export type YDinh = { lenh: "trong" | "tim" | "lich" | "dat" | "xem" | "huy" | "doi" | "sua"; thamSo: string };

const LUAT: [RegExp, YDinh["lenh"], (m: RegExpMatchArray) => string][] = [
  // "#12 sđt 0905…" — bổ sung thông tin cho booking #12
  [/^#(\d+)\s+([\s\S]+)$/, "sua", (m) => `${m[1]} ${m[2].trim()}`],
  [/^(?:sửa|sua|cập nhật|cap nhat|bổ sung|bo sung|thêm|them)\s+(?:booking\s+)?#?(\d+)\s+([\s\S]+)$/i, "sua", (m) => `${m[1]} ${m[2].trim()}`],
  [/^(?:hủy|huỷ|huy)\s+(?:booking\s+)?#?(\d+)\s*$/i, "huy", (m) => m[1]],
  [/^(?:đổi|dời|doi|lùi|chuyển)\s+(?:ngày\s+)?(?:booking\s+)?#?(\d+)\s+(?:sang\s+|thành\s+|qua\s+)?([\s\S]+)$/i, "doi", (m) => `${m[1]} ${m[2].trim()}`],
  [/^(?:xem|chi tiết|chi tiet|thông tin)\s+(?:booking\s+)?#?(\d+)\s*$/i, "xem", (m) => m[1]],
  [/^(?:tìm|tim|tra cứu|tra cuu|tra|search)\s+(?:khách\s+)?([\s\S]+)$/i, "tim", (m) => m[1].trim()],
  [/^(?:(?:căn|phòng|nhà)\s+nào\s+)?(?:còn\s+)?(?:trống|còn phòng|còn căn|available|free)\b\s*(?:không\s*)?(?:ngày\s+|từ\s+)?([\s\S]*)$/i, "trong", (m) => m[1].trim()],
  [/^(?:hôm nay|báo cáo|bao cao|lịch hôm nay|lich hom nay|ai đang ở|ai đến|ai đi|ai nhận phòng|ai trả phòng|tình hình)/i, "lich", () => ""],
  [/^(?:booking sắp tới|sắp tới|danh sách booking|ds booking|lịch sắp tới)/i, "dat", () => ""],
];

export function docYDinh(raw: string): YDinh | null {
  const t = raw.trim();
  for (const [re, lenh, lay] of LUAT) {
    const m = t.match(re);
    if (m) return { lenh, thamSo: lay(m) };
  }
  return null;
}
