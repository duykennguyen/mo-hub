// Test bộ đọc tin nhắn Thư kí. Chạy: deno test supabase/functions/thuki-bot/
// Nhà dưới đây là nhà GIẢ để test — không phải dữ liệu thật.
import { assertEquals } from "jsr:@std/assert@1";
import { parseDue, parseTask } from "./parse.ts";

const PROPS = [
  { id: "sen", code: "SEN", name: "Nhà Sen", aliases: ["nhà sen", "căn sen", "sen house"] },
  { id: "may", code: "MAY", name: "Nhà Mây", aliases: ["nhà mây", "căn mây", "mây"] },
  { id: "ab", code: "ANB", name: "Tòa An Bàng", aliases: ["an bàng"] },
  { id: "abb", code: "ABB", name: "Villa An Bàng Biển", aliases: ["an bàng biển"] },
];

// Mốc cố định: thứ Tư 16/09/2026
const TODAY = new Date(Date.UTC(2026, 8, 16));
const parse = (text: string) => {
  const { property, row } = parseTask(text, PROPS, TODAY);
  return { nha: property?.id ?? null, ...row };
};

type Expect = Partial<ReturnType<typeof parse>>;
const CASES: [string, Expect][] = [
  // --- Câu mẫu trong hướng dẫn ---
  ["nhà Sen vòi sen phòng 2 rỉ nước, gọi thợ trước thứ 3",
    { nha: "sen", category: "ky_thuat", location: "P2", due_date: "2026-09-22", priority: "thuong" }],
  ["dọn phòng + thay ga nhà Mây mai, gấp",
    { nha: "may", category: "buong_phong", due_date: "2026-09-17", priority: "cao" }],

  // --- Nhận ra nhà ---
  ["căn sen hỏng khóa cửa", { nha: "sen", category: "ky_thuat" }],
  ["an bàng biển hỏng bơm nước", { nha: "abb", category: "ky_thuat" }], // ưu tiên cụm dài nhất
  ["an bàng thay bóng đèn hành lang", { nha: "ab", category: "ky_thuat" }],
  ["nha may hong dieu hoa", { nha: "may", category: "khac" }], // bỏ dấu vẫn nhận ra nhà (≥ 5 ký tự), loại việc thì không
  ["sửa máy giặt phòng 3", { nha: null, category: "ky_thuat", location: "P3" }], // "máy" không bị hiểu là nhà Mây
  ["SEN hỏng khóa", { nha: null }], // mã nhà không dùng để khớp tin nhắn tự do
  ["gọi thợ sửa quạt", { nha: null, category: "ky_thuat", due_date: null }],

  // --- Loại việc ---
  ["thu tiền phòng khách P4 cuối tháng", { category: "quan_ly", location: "P4", due_date: null }],
  ["thu tiền điện nước nhà mây", { nha: "may", category: "quan_ly" }], // 2 từ quản lý > 1 từ kỹ thuật
  ["nhà sen giặt chăn gối, hút bụi sofa", { nha: "sen", category: "buong_phong" }],
  ["nhà sen gửi hợp đồng gia hạn cho khách", { nha: "sen", category: "quan_ly" }],

  // --- Hạn ---
  ["nhà sen dọn rác hôm nay", { due_date: "2026-09-16" }],
  ["nhà sen lau kính ngày kia", { due_date: "2026-09-18" }],
  ["nhà sen lau kính mốt", { due_date: "2026-09-18" }],
  ["nhà sen tổng vệ sinh cuối tuần", { due_date: "2026-09-19" }],
  ["nhà sen sơn lại cổng tuần sau", { due_date: "2026-09-23" }],
  ["nhà sen gọi thợ thứ hai", { due_date: "2026-09-21" }],
  ["nhà sen gọi thợ thứ 4", { due_date: "2026-09-23" }], // hôm nay là thứ Tư → thứ Tư tuần sau
  ["nhà sen kiểm tra mái chủ nhật", { due_date: "2026-09-20", category: "ky_thuat" }], // "mái" ≠ "mai"
  ["nhà sen bàn giao nhà 25/9", { due_date: "2026-09-25", category: "quan_ly" }],
  ["nhà sen bàn giao nhà 3/10/2026", { due_date: "2026-10-03" }],
  ["nhà sen gia hạn hợp đồng 5/1", { due_date: "2027-01-05" }], // ngày đã qua xa → năm sau
  ["nhà sen thanh toán hóa đơn 10/9", { due_date: "2026-09-10" }], // mới qua vài ngày → vẫn năm nay (quá hạn)

  // --- Mức độ & vị trí ---
  ["nhà sen thay khăn P5, không gấp", { priority: "thap", location: "P5", category: "buong_phong" }],
  ["nhà sen dột mái khẩn", { priority: "cao" }],
  ["nhà sen sơn cửa khi rảnh", { priority: "thap" }],
  ["nhà sen p.7 tắc bồn cầu ưu tiên", { priority: "cao", location: "P7", category: "ky_thuat" }],

  // --- Tiêu đề & chi tiết ---
  ["nhà sen thay bóng đèn\nbóng ở hành lang tầng 2",
    { title: "Nhà sen thay bóng đèn", detail: "bóng ở hành lang tầng 2", source: "telegram", property_id: "sen" }],
];

for (const [text, expect] of CASES) {
  Deno.test(`parseTask: ${text.split("\n")[0]}`, () => {
    const got = parse(text);
    const picked = Object.fromEntries(Object.keys(expect).map((k) => [k, got[k as keyof typeof got]]));
    assertEquals(picked, expect);
  });
}

Deno.test("parseTask: tiêu đề quá 140 ký tự bị cắt, bản đầy đủ nằm ở chi tiết", () => {
  const long = "nhà sen " + "kiểm tra ".repeat(20);
  const { row } = parseTask(long, PROPS, TODAY);
  assertEquals(row.title.length, 138);
  assertEquals(row.title.endsWith("…"), true);
  assertEquals(row.detail, long.trim());
});

Deno.test("parseDue: không có hạn → null", () => {
  assertEquals(parseDue("nhà sen thay ga", TODAY), null);
});
