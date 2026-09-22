// Test phần chuẩn hóa câu đọc bằng giọng nói.
import { assertEquals } from "jsr:@std/assert@1";
import { chuanHoaGiongNoi, soTuChu } from "./giong-noi.ts";
import { parseBooking } from "./parse-booking.ts";

const HOM_NAY = new Date(Date.UTC(2026, 8, 22));            // thứ Ba 22/09/2026
const ch = (s: string) => chuanHoaGiongNoi(s, HOM_NAY);

Deno.test("số viết bằng chữ", () => {
  assertEquals(soTuChu(["hai", "mươi", "triệu"]), 20_000_000);
  assertEquals(soTuChu(["tám", "trăm", "nghìn"]), 800_000);
  assertEquals(soTuChu(["một", "triệu", "rưỡi"]), 1_500_000);
  assertEquals(soTuChu(["hai", "mươi", "mốt"]), 21);
  assertEquals(soTuChu(["mười", "lăm"]), 15);
  assertEquals(soTuChu(["năm"]), 5);
  assertEquals(soTuChu(["ba", "mươi", "lăm", "triệu"]), 35_000_000);
});

Deno.test("ngày đọc thành lời", () => {
  assertEquals(ch("từ ngày một tháng mười đến ngày một tháng mười hai"), "từ 1/10 đến 1/12");
  assertEquals(ch("mùng 5 tháng 11 năm 2026"), "5/11/2026");
  assertEquals(ch("từ 1 tháng 10 đến 1 tháng 12"), "từ 1/10 đến 1/12");
});

Deno.test("không nhầm khoảng thời gian thành ngày", () => {
  // "ba tháng" là độ dài thuê, không phải ngày 3 tháng nào đó
  assertEquals(ch("đặt tía tô ba tháng từ ngày một tháng mười một"), "đặt tía tô 3 tháng từ 1/11");
});

Deno.test("ngày tương đối", () => {
  assertEquals(ch("nhận phòng hôm nay"), "nhận phòng 22/9");
  assertEquals(ch("khách đến ngày mai"), "khách đến 23/9");
});

Deno.test("nghe nhầm chữ đặt", () => {
  assertEquals(ch("đặc gừng cho anna").startsWith("đặt "), true);
});

// ---------------- Chạy thẳng qua bộ đọc booking ----------------
const CAN = [
  { id: "gung", name: "Gừng", property_id: "camf", property_name: "CamF", property_aliases: ["camf"], list_rent_month: 20000000 },
  { id: "tiato", name: "Tía Tô", property_id: "camf", property_name: "CamF", property_aliases: ["camf"], list_rent_month: 25000000 },
  { id: "sen", name: "Nhà Sen (nguyên căn)", property_id: "sen", property_name: "Nhà Sen", property_aliases: ["nhà sen"], list_rent_month: 55000000 },
];

Deno.test("câu đọc bằng giọng nói: đặt dài hạn", () => {
  const cau = ch("đặt gừng cho Anna từ ngày một tháng mười đến ngày một tháng mười hai giá hai mươi triệu cọc năm triệu");
  const r = parseBooking(cau, CAN, HOM_NAY);
  assertEquals(r.can?.id, "gung");
  assertEquals(r.tenKhach, "Anna");
  assertEquals(r.row.start_date, "2026-10-01");
  assertEquals(r.row.end_date, "2026-12-01");
  assertEquals(r.row.rent_amount, 20_000_000);
  assertEquals(r.row.deposit_amount, 5_000_000);
});

Deno.test("câu đọc bằng giọng nói: ngắn ngày, không có dấu chấm câu", () => {
  const cau = ch("đặt nhà sen năm đêm từ ngày mười tháng mười cho anh Nam airbnb chín triệu");
  const r = parseBooking(cau, CAN, HOM_NAY);
  assertEquals(r.can?.id, "sen");
  assertEquals(r.row.start_date, "2026-10-10");
  assertEquals(r.row.end_date, "2026-10-15");
  assertEquals(r.row.term_type, "ngan_han");
  assertEquals(r.row.channel, "airbnb");
  assertEquals(r.row.rent_amount, 9_000_000);
  assertEquals(r.tenKhach, "anh Nam");
});

Deno.test("câu đọc bằng giọng nói: theo số tháng", () => {
  const cau = ch("đặt tía tô ba tháng từ ngày một tháng mười một cho chị Mai");
  const r = parseBooking(cau, CAN, HOM_NAY);
  assertEquals(r.can?.id, "tiato");
  assertEquals(r.row.start_date, "2026-11-01");
  assertEquals(r.row.end_date, "2027-02-01");
  assertEquals(r.row.rent_amount, 25_000_000);
});
