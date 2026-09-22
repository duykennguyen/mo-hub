// Test bộ đọc lệnh đặt phòng. Chạy: deno test supabase/functions/thuki-bot/
import { assertEquals } from "jsr:@std/assert@1";
import { doiTien, laLenhDatPhong, parseBooking, timNgay } from "./parse-booking.ts";

// Căn thật của Mô, rút gọn cho test
const CAN = [
  { id: "gung", name: "Gừng", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf", "cam f"], list_rent_month: 20000000 },
  { id: "tiato", name: "Tía Tô", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"], list_rent_month: 25000000 },
  { id: "thom", name: "Thơm", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"], list_rent_month: 50000000 },
  { id: "tren", name: "Tầng trên", property_id: "trau", property_name: "Nhà Trầu", property_aliases: ["nhà trầu", "trầu"], list_rent_month: 20000000 },
  { id: "duoi", name: "Tầng dưới", property_id: "trau", property_name: "Nhà Trầu", property_aliases: ["nhà trầu", "trầu"], list_rent_month: 35000000 },
  { id: "sen", name: "Nhà Sen (nguyên căn)", property_id: "sen", property_name: "Nhà Sen", property_aliases: ["nhà sen", "căn sen"], list_rent_month: 55000000 },
  { id: "bien", name: "Nhà Biển (nguyên căn)", property_id: "bien", property_name: "Nhà Biển", property_aliases: ["nhà biển", "beach house"], list_rent_month: 60000000 },
];

// Mốc cố định: thứ Ba 22/09/2026
const HOM_NAY = new Date(Date.UTC(2026, 8, 22));
const doc = (s: string) => parseBooking(s, CAN, HOM_NAY);

Deno.test("nhận ra đây là lệnh đặt phòng", () => {
  for (const s of ["đặt Gừng cho Anna 1/10 đến 1/12", "book nhà Sen 5 đêm từ 1/10", "đặt phòng cho khách lẻ"]) {
    assertEquals(laLenhDatPhong(s), true, s);
  }
});

Deno.test("không nhầm việc thành đặt phòng", () => {
  for (const s of ["nhà Sen vòi sen rỉ nước", "đặt cọc thợ sơn 2tr", "dọn phòng CamF mai"]) {
    assertEquals(laLenhDatPhong(s), false, s);
  }
});

Deno.test("đổi tiền kiểu Việt", () => {
  assertEquals(doiTien("20tr"), 20000000);
  assertEquals(doiTien("1,5tr"), 1500000);
  assertEquals(doiTien("800k"), 800000);
  assertEquals(doiTien("20.000.000"), 20000000);
  assertEquals(doiTien("55 triệu"), 55000000);
});

Deno.test("tìm ngày: bỏ qua số tiền có dấu chấm", () => {
  assertEquals(timNgay("giá 1.5tr từ 1/10 đến 1/12", HOM_NAY), ["2026-10-01", "2026-12-01"]);
});

Deno.test("ngày đã qua xa thì hiểu là năm sau", () => {
  assertEquals(timNgay("từ 5/1 đến 5/3", HOM_NAY), ["2027-01-05", "2027-03-05"]);
});

Deno.test("đặt dài hạn đầy đủ thông tin", () => {
  const r = doc("đặt Gừng cho Anna Müller từ 1/10 đến 1/12, giá 20tr, cọc 5tr");
  assertEquals(r.can?.id, "gung");
  assertEquals(r.tenKhach, "Anna Müller");
  assertEquals(r.thieu, []);
  assertEquals(r.row.start_date, "2026-10-01");
  assertEquals(r.row.end_date, "2026-12-01");
  assertEquals(r.row.term_type, "dai_han");
  assertEquals(r.row.rent_amount, 20000000);
  assertEquals(r.row.deposit_amount, 5000000);
  assertEquals(r.row.status, "da_coc");
});

Deno.test("đặt theo số tháng, tự lấy giá niêm yết của căn", () => {
  const r = doc("đặt Tía Tô 3 tháng từ 1/11 cho chị Mai");
  assertEquals(r.can?.id, "tiato");
  assertEquals(r.row.start_date, "2026-11-01");
  assertEquals(r.row.end_date, "2027-02-01");
  assertEquals(r.row.term_type, "dai_han");
  assertEquals(r.row.rent_amount, 25000000);      // lấy từ list_rent_month
});

Deno.test("đặt ngắn ngày theo số đêm", () => {
  const r = doc("đặt nhà Sen 5 đêm từ 10/10 cho anh Nam, airbnb, 9tr");
  assertEquals(r.can?.id, "sen");                  // nhà 1 căn → suy ra luôn
  assertEquals(r.row.start_date, "2026-10-10");
  assertEquals(r.row.end_date, "2026-10-15");
  assertEquals(r.row.term_type, "ngan_han");
  assertEquals(r.row.channel, "airbnb");
  assertEquals(r.row.rent_amount, 9000000);
});

Deno.test("tên căn là duy nhất thì nhận ra ngay, không cần tên nhà", () => {
  // Chỉ Nhà Trầu có căn tên "Tầng trên"
  assertEquals(doc("đặt tầng trên 1/10 đến 1/11").can?.id, "tren");

  const r = doc("đặt Trầu tầng dưới từ 1/10 đến 1/11 cho gia đình Lê");
  assertEquals(r.can?.id, "duoi");
  assertEquals(r.tenKhach, "gia đình Lê");
});

Deno.test("hai nhà có căn trùng tên thì phải nói rõ nhà nào", () => {
  // Giả lập: CamF cũng có một căn tên "Tầng trên"
  const canTrungTen = [
    ...CAN,
    { id: "camf_tren", name: "Tầng trên", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"], list_rent_month: 30000000 },
  ];
  const mo = parseBooking("đặt tầng trên 1/10 đến 1/11", canTrungTen, HOM_NAY);
  assertEquals(mo.can, null);
  assertEquals(mo.canUngVien.map((c) => c.id).sort(), ["camf_tren", "tren"]);
  assertEquals(mo.thieu.includes("căn"), true);

  // Có tên nhà thì hết mơ hồ
  const ro = parseBooking("đặt Trầu tầng trên 1/10 đến 1/11", canTrungTen, HOM_NAY);
  assertEquals(ro.can?.id, "tren");
});

Deno.test("nhà nhiều căn mà không nói rõ căn → hỏi lại", () => {
  const r = doc("đặt CamF từ 1/10 đến 1/11");
  assertEquals(r.can, null);
  assertEquals(r.canUngVien.length, 3);            // Gừng, Tía Tô, Thơm
  assertEquals(r.thieu.includes("căn"), true);
});

Deno.test("thiếu ngày trả phòng thì báo thiếu, không tự đoán", () => {
  const r = doc("đặt Thơm từ 1/10 cho khách Kim");
  assertEquals(r.can?.id, "thom");
  assertEquals(r.row.start_date, "2026-10-01");
  assertEquals(r.row.end_date, null);
  assertEquals(r.thieu, ["ngày trả phòng"]);
});

Deno.test("chưa cọc thì để trạng thái giữ chỗ", () => {
  const r = doc("đặt Nhà Biển 20/12 đến 27/12 cho khách Lan, giữ chỗ");
  assertEquals(r.can?.id, "bien");
  assertEquals(r.row.status, "giu_cho");
  assertEquals(r.row.deposit_amount, null);
  assertEquals(r.row.deposit_status, "chua_nhan");
});

Deno.test("nhận ra kênh Booking.com viết tắt", () => {
  assertEquals(doc("đặt Gừng 1/10 - 5/10 bkk").row.channel, "booking");
  assertEquals(doc("đặt Gừng 1/10 - 5/10 qua page").row.channel, "truc_tiep");
});
