// Bộ đọc tin nhắn của Thư kí — phân tích bằng luật từ khóa, không dùng AI.
// Tách riêng khỏi index.ts để chạy test: deno test supabase/functions/thuki-bot/

// Từ khóa có dấu để tránh trùng nghĩa (vd "mái" ≠ "mai", "đến" ≠ "đèn")
export const CAT_WORDS: Record<string, string[]> = {
  quan_ly: ["khách", "hợp đồng", "thu tiền", "tiền cọc", "đặt cọc", "gia hạn", "chủ nhà", "giấy tờ", "hóa đơn", "hoá đơn",
    "tiền điện", "tiền nước", "check in", "check-in", "check out", "check-out", "bàn giao", "thanh toán", "báo giá", "mua"],
  buong_phong: ["dọn", "vệ sinh", "lau", "giặt", "thay ga", "ga giường", "drap", "chăn", "gối", "khăn", "hút bụi", "rác",
    "setup phòng", "set up phòng", "xà phòng", "giấy vệ sinh", "amenities", "bụi", "mạng nhện"],
  ky_thuat: ["sửa", "hỏng", "hư", "rỉ", "rò", "dột", "thấm", "điện", "đèn", "bóng đèn", "máy lạnh", "điều hòa", "điều hoà",
    "ống", "bơm", "khóa", "khoá", "cửa", "thợ", "sơn", "wifi", "mạng", "tắc", "nghẹt", "vòi", "bồn cầu", "máy giặt",
    "tủ lạnh", "nóng lạnh", "bình nóng", "công tắc", "ổ cắm", "mái", "quạt", "cầu dao", "aptomat"],
};
const B = "(?:^|[\\s,.;:!?()/\"'-])"; // ranh giới từ (Unicode-safe)
const E = "(?=$|[\\s,.;:!?()/\"'-])";
export const has = (text: string, word: string) =>
  new RegExp(B + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + E, "i").test(text);
export const noAccent = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

export function vnToday() {
  const d = new Date(Date.now() + 7 * 3600e3); // giờ Việt Nam
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400e3);

// today: truyền vào khi test; mặc định là hôm nay theo giờ Việt Nam
export function parseDue(t: string, today = vnToday()): string | null {
  if (has(t, "hôm nay") || has(t, "hnay") || has(t, "trong ngày")) return iso(today);
  if (has(t, "ngày mai") || has(t, "mai")) return iso(addDays(today, 1));
  if (has(t, "ngày kia") || has(t, "ngày mốt") || has(t, "mốt")) return iso(addDays(today, 2));
  if (has(t, "cuối tuần")) return iso(addDays(today, (6 - today.getUTCDay() + 7) % 7 || 7));
  if (has(t, "tuần sau")) return iso(addDays(today, 7));
  // thứ 2..7, thứ hai..bảy, chủ nhật / cn
  const names: Record<string, number> = { "hai": 1, "ba": 2, "tư": 3, "bốn": 3, "năm": 4, "sáu": 5, "bảy": 6 };
  let wd: number | null = null;
  const m = t.match(/thứ\s*([2-7]|hai|ba|tư|bốn|năm|sáu|bảy)(?=$|[\s,.;:!?)])/i);
  if (m) wd = /\d/.test(m[1]) ? Number(m[1]) - 1 : names[m[1].toLowerCase()];
  else if (has(t, "chủ nhật") || has(t, "cn")) wd = 0;
  if (wd !== null) return iso(addDays(today, ((wd - today.getUTCDay() + 7) % 7) || 7));
  // dd/mm hoặc dd/mm/yyyy
  const d = t.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?=$|[\s,.;:!?)])/);
  if (d) {
    let y = d[3] ? Number(d[3].length === 2 ? "20" + d[3] : d[3]) : today.getUTCFullYear();
    let date = new Date(Date.UTC(y, Number(d[2]) - 1, Number(d[1])));
    if (!d[3] && date.getTime() < addDays(today, -30).getTime()) date = new Date(Date.UTC(++y, Number(d[2]) - 1, Number(d[1])));
    if (!isNaN(date.getTime())) return iso(date);
  }
  return null;
}

export function parseTask(raw: string, props: any[], today = vnToday()) {
  const t = raw.toLowerCase();
  const plain = noAccent(raw);
  // Nhà: khớp mã, tên hoặc bí danh (không phân biệt dấu); ưu tiên cụm dài nhất
  // Lượt 1 khớp có dấu (chính xác); lượt 2 bỏ dấu, chỉ chạy khi lượt 1 không ra
  let prop: any = null, best = 0;
  for (const fold of [(x: string) => x.toLowerCase(), noAccent]) {
    const hay = fold === noAccent ? plain : t;
    for (const p of props) {
      for (const k of [p.name, ...(p.aliases ?? [])].filter(Boolean)) {
        const kw = fold(k);
        if (fold === noAccent && kw.length < 5) continue; // bỏ dấu + quá ngắn dễ trùng ("may" ≈ "máy")
        if (kw.length > best && has(hay, kw)) { prop = p; best = kw.length; }
      }
    }
    if (prop) break;
  }
  // Loại việc: đếm từ khóa, nhiều nhất thắng
  let category = "khac", top = 0;
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    const n = words.filter((w) => has(t, w)).length;
    if (n > top) { category = cat; top = n; }
  }
  const priority = /không gấp|khi rảnh|từ từ|thong thả/.test(t) ? "thap"
    : /gấp|khẩn|ngay lập tức|ưu tiên|urgent/.test(t) ? "cao" : "thuong";
  const loc = raw.match(/(?:^|\s)(?:phòng|p\.?)\s?(\d{1,3})(?=$|[\s,.;:!?)])/i);
  const [first, ...rest] = raw.trim().split("\n");
  const title = first.length > 140 ? first.slice(0, 137) + "…" : first;
  return {
    property: prop,
    row: {
      property_id: prop?.id ?? null,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      detail: [first.length > 140 ? first : "", rest.join("\n")].filter(Boolean).join("\n") || null,
      location: loc ? "P" + loc[1] : null,
      category, priority, due_date: parseDue(t, today), source: "telegram",
    },
  };
}
