// Test các ngữ cảnh / từ khóa mới của Lễ tân (10/2026). Chạy: deno test supabase/functions/thuki-bot/
import { assertEquals } from "jsr:@std/assert@1";
import {
  anSdt, chuanHoaKhoangNgay, docChiTiet, doiTien, laTinDatPhong, parseBooking, tachLienHe, thangTron,
  timGioDen, timKenh, timQuocTich, timSoKhach, timTien,
} from "./parse-booking.ts";
import { docYDinh } from "./y-dinh.ts";

const CAN = [
  { id: "gung", name: "Gừng", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf", "cam f"], list_rent_month: 20000000 },
  { id: "cusa", name: "Củ Sả", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"], list_rent_month: 22000000 },
  { id: "thom", name: "Thơm", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"], list_rent_month: 50000000 },
  { id: "tren", name: "Tầng trên", property_id: "trau", property_name: "Nhà Trầu", property_aliases: ["nhà trầu", "trầu"], list_rent_month: 20000000 },
  { id: "sen", name: "Nhà Sen (nguyên căn)", property_id: "sen", property_name: "Nhà Sen", property_aliases: ["nhà sen", "căn sen"], list_rent_month: 55000000 },
  { id: "bien", name: "Nhà Biển (nguyên căn)", property_id: "bien", property_name: "Nhà Biển", property_aliases: ["nhà biển", "beach house"], list_rent_month: 60000000 },
];
// Mốc cố định: thứ Tư 07/10/2026
const HOM_NAY = new Date(Date.UTC(2026, 9, 7));
const doc = (s: string) => parseBooking(s, CAN, HOM_NAY);

// ---------------- Liên hệ ----------------
Deno.test("tách SĐT Việt Nam nhiều kiểu viết, không hiểu nhầm thành tiền", () => {
  for (const [s, sdt] of [
    ["đặt Gừng 10/10 - 12/10 anh Nam 0905123456", "0905123456"],
    ["sđt 0905.123.456", "0905123456"],
    ["sdt 090 512 3456", "0905123456"],
    ["phone +84 905 123 456", "+84905123456"],
    ["Kim +82 10 1234 5678", "+821012345678"],
  ]) assertEquals(tachLienHe(s).sdt, sdt, s);
  const r = doc("đặt Gừng 10/10 - 12/10 anh Nam 0905.123.456");
  assertEquals(r.row.rent_amount, null);        // 0905.123.456 không phải 905 triệu
  assertEquals(r.khach.sdt, "0905123456");
});

Deno.test("tách email, bỏ mã giao dịch ngân hàng", () => {
  const r = tachLienHe("email Anna.M@gmail.com, ck FT26250342284785");
  assertEquals(r.email, "anna.m@gmail.com");
  assertEquals(timTien(r.con).gia, null);
});

Deno.test("che bớt SĐT khi hiện lên Telegram", () => {
  assertEquals(anSdt("0905123456"), "0905•••456");
});

// ---------------- Ngày ----------------
Deno.test("khoảng ngày viết gọn: 10-15/10, 10 đến 15/10", () => {
  assertEquals(chuanHoaKhoangNgay("từ 10-15/10"), "từ 10/10 - 15/10");
  assertEquals(chuanHoaKhoangNgay("10 đến 15/10/2026"), "10/10/2026 - 15/10/2026");
  assertEquals(chuanHoaKhoangNgay("1/10 - 5/10"), "1/10 - 5/10");        // đã đủ thì giữ nguyên
  const r = doc("đặt Gừng 20-23/10 cho Kim");
  assertEquals([r.row.start_date, r.row.end_date], ["2026-10-20", "2026-10-23"]);
});

Deno.test("thuê trọn tháng", () => {
  assertEquals(thangTron("thuê cả tháng 11", HOM_NAY), ["2026-11-01", "2026-12-01"]);
  assertEquals(thangTron("ở tháng 3", HOM_NAY), ["2027-03-01", "2027-04-01"]);   // tháng 3 đã qua → năm sau
  const r = doc("khách thuê Thơm cả tháng 12, chị Hoa");
  assertEquals([r.row.start_date, r.row.end_date, r.row.term_type], ["2026-12-01", "2027-01-01", "dai_han"]);
});

Deno.test("số đêm viết kiểu 'hôm' và 'nights'", () => {
  assertEquals(doc("đặt Gừng từ 10/10 ở 3 hôm").row.end_date, "2026-10-13");
  assertEquals(doc("book Gừng 10/10 2 nights").row.end_date, "2026-10-12");
});

// ---------------- Tiền ----------------
Deno.test("tiền kiểu nói: 1tr2, 15 củ", () => {
  assertEquals(doiTien("1tr2"), 1200000);
  assertEquals(doiTien("1tr25"), 1250000);
  assertEquals(doiTien("15 củ"), 15000000);
});

Deno.test("giá theo đêm nhân số đêm thành tổng tiền", () => {
  const r = doc("đặt Củ Sả 10/10 - 13/10 giá 800k/đêm cho Kim");
  assertEquals(r.giaDem, 800000);
  assertEquals(r.row.rent_amount, 2400000);
  assertEquals(r.row.term_type, "ngan_han");
  // "1tr2/đêm" — kiểu viết tắt hay gặp nhất
  const r2 = doc("Củ Sả 15/10 3 đêm 1tr2/đêm khách Hàn tên Park Ji, đã ck");
  assertEquals([r2.giaDem, r2.row.rent_amount, r2.row.status], [1200000, 3600000, "da_coc"]);
  assertEquals([r2.tenKhach, r2.khach.quoc_tich], ["Park Ji", "Hàn Quốc"]);
});

Deno.test("cọc đứng trước giá không làm lẫn hai khoản", () => {
  const t = timTien("cọc 5tr giá 20tr");
  assertEquals([t.coc, t.gia], [5000000, 20000000]);
});

Deno.test("phân biệt trả trước, cọc bảo đảm, hoa hồng", () => {
  const r = doc("đặt Thơm 1/11 - 1/2 giá 50tr/tháng, trả trước 50tr, cọc bảo đảm 10tr, môi giới chị Hoa hoa hồng 5tr");
  assertEquals(r.row.rent_amount, 50000000);
  assertEquals(r.row.deposit_amount, 50000000);
  assertEquals(r.row.security_deposit, 10000000);
  assertEquals(r.row.security_deposit_status, "dang_giu");
  assertEquals(r.row.commission_amount, 5000000);
  assertEquals(r.row.channel, "moi_gioi");
  assertEquals(r.row.broker_name, "chị Hoa");
  assertEquals(r.tenKhach, null);              // chị Hoa là môi giới, không phải khách
});

Deno.test("miễn phí tiền phòng", () => {
  const r = doc("đặt Gừng 10/10 - 12/10 cho anh Bình, khách mời miễn phí");
  assertEquals(r.row.is_free, true);
  assertEquals(r.row.rent_amount, 0);
});

// ---------------- Kênh, trạng thái ----------------
Deno.test("kênh OTA khác và kênh trực tiếp mới", () => {
  assertEquals(timKenh("qua traveloka"), { kenh: "khac", tenKenh: "Traveloka" });
  assertEquals(timKenh("khách quay lại").kenh, "truc_tiep");
  assertEquals(timKenh("bạn bè giới thiệu").kenh, "truc_tiep");
  assertEquals(timKenh("đại lý du lịch").kenh, "moi_gioi");
  assertEquals(doc("book Gừng 10/10 - 12/10 traveloka").row.note, "kênh Traveloka");
});

Deno.test("Airbnb/Booking/Agoda coi như đã chốt, trừ khi nói giữ chỗ", () => {
  const a = doc("book Gừng 10/10 - 12/10 airbnb, Kim");
  assertEquals([a.row.status, a.otaXacNhan], ["da_coc", true]);
  const b = doc("book Gừng 10/10 - 12/10 airbnb giữ chỗ");
  assertEquals(b.row.status, "giu_cho");
});

Deno.test("đã thanh toán / đã ck mà không ghi số tiền vẫn là đã chốt", () => {
  assertEquals(doc("đặt Gừng 10/10 - 12/10 anh Nam đã ck").row.status, "da_coc");
  assertEquals(doc("đặt Gừng 10/10 - 12/10 anh Nam chưa cọc").row.status, "giu_cho");
});

// ---------------- Khách ----------------
Deno.test("quốc tịch", () => {
  assertEquals(timQuocTich("khách Hàn 2 người"), "Hàn Quốc");
  assertEquals(timQuocTich("guest from Germany"), "Đức");
  assertEquals(timQuocTich("người Pháp"), "Pháp");
  assertEquals(timQuocTich("khách anh Nam"), null);           // xưng hô, không phải nước Anh
  assertEquals(timQuocTich("khách Anh"), "Anh");
  assertEquals(timQuocTich("khách tây ban nha"), "Tây Ban Nha");
});

Deno.test("khách Hàn không bị lấy làm tên khách", () => {
  const r = doc("book Gừng 10/10 - 12/10 khách Hàn, chị Kim Min");
  assertEquals(r.khach.quoc_tich, "Hàn Quốc");
  assertEquals(r.tenKhach, "chị Kim Min");
});

Deno.test("tên khách: 'tên …', xưng hô + tên viết hoa ở giữa câu", () => {
  assertEquals(doc("book Gừng 10/10 - 12/10 khách tên Anna Müller").tenKhach, "Anna Müller");
  assertEquals(doc("Gừng 10/10 - 12/10 anh Nam 0905123456 airbnb").tenKhach, "anh Nam");
  assertEquals(doc("đặt Thơm 1/11 - 5/11 Mr John Smith, 2 người lớn").tenKhach, "Mr John Smith");
});

Deno.test("số khách", () => {
  assertEquals(timSoKhach("2 người lớn 1 trẻ em"), "2 người lớn, 1 trẻ em");
  assertEquals(timSoKhach("4 pax"), "4 khách");
  assertEquals(timSoKhach("gia đình 5 người"), "5 khách");
  assertEquals(timSoKhach("2nl 1 bé"), "2 người lớn, 1 trẻ em");
});

Deno.test("giờ đến", () => {
  assertEquals(timGioDen("bay tới khoảng 14h"), "14h");
  assertEquals(timGioDen("check in 21h30 tối"), "21h30 tối");
  assertEquals(timGioDen("đến lúc 9:15"), "9h15");
  assertEquals(timGioDen("đặt Gừng 10/10 - 12/10"), null);
});

Deno.test("ghi chú gom số khách, giờ đến, yêu cầu riêng và ghi chú nguyên văn", () => {
  const r = doc("đặt Nhà Biển 20/12 - 27/12 cho chị Lan, 2 người lớn 2 trẻ em, bay tới 15h, cần đón sân bay và nôi em bé, ghi chú: ăn chay, dị ứng hải sản 5tr");
  assertEquals(r.can?.id, "bien");
  assertEquals(r.tenKhach, "chị Lan");
  assertEquals(r.row.note, "2 người lớn, 2 trẻ em · giờ đến ~15h · đưa/đón sân bay · nôi/cũi em bé · ăn chay, dị ứng hải sản 5tr");
  assertEquals(r.row.rent_amount, null);       // "5tr" nằm trong ghi chú nguyên văn, không phải giá
});

Deno.test("docChiTiet dùng cho /sua: chỉ trả về những gì tin nhắn có nói", () => {
  const c = docChiTiet("sđt 0905123456 khách Nhật cọc 2tr");
  assertEquals(c.khach.sdt, "0905123456");
  assertEquals(c.khach.quoc_tich, "Nhật Bản");
  assertEquals(c.tien.coc, 2000000);
  assertEquals(c.kenh, null);
  assertEquals(c.trangThai, null);
});

// ---------------- Nhận diện tin đặt phòng ----------------
const DAT_PHONG: [string, boolean][] = [
  ["Gừng 10/10 - 12/10 anh Nam 0905123456", true],          // có tên căn + ngày, không cần chữ "đặt"
  ["Nhà Sen 20-25/12 chị Lan airbnb", true],
  ["giữ phòng Thơm 1/11 cho chị Hoa", true],
  ["chốt Củ Sả 15/10 - 18/10", true],
  ["reservation Gừng 1/11 - 3/11", true],
  ["dọn Gừng 10/10", false],                                   // việc buồng phòng
  ["Gừng hỏng máy lạnh, sửa trước 10/10", false],
  ["chào em", false],
];
for (const [cau, ket] of DAT_PHONG) {
  Deno.test(`nhận diện đặt phòng (${ket}): ${cau}`, () => {
    assertEquals(laTinDatPhong(cau, CAN, HOM_NAY), ket);
  });
}

// ---------------- Ý định hỏi/tra cứu bằng lời ----------------
const Y_DINH: [string, string | null, string?][] = [
  ["căn nào trống 10/10 - 15/10", "trong", "10/10 - 15/10"],
  ["còn phòng 20/12 không", "trong", "20/12 không"],
  ["tìm Anna", "tim", "Anna"],
  ["tra 0905123456", "tim", "0905123456"],
  ["ai đang ở", "lich"],
  ["báo cáo hôm nay", "lich"],
  ["booking sắp tới", "dat"],
  ["xem #12", "xem", "12"],
  ["chi tiết booking 12", "xem", "12"],
  ["hủy booking 12", "huy", "12"],
  ["dời 12 sang 5/11 - 8/11", "doi", "12 5/11 - 8/11"],
  ["#12 sđt 0905123456", "sua", "12 sđt 0905123456"],
  ["sửa 12 cọc 5tr", "sua", "12 cọc 5tr"],
  ["đặt Gừng 10/10 - 12/10", null],
];
for (const [cau, lenh, thamSo] of Y_DINH) {
  Deno.test(`ý định: ${cau}`, () => {
    const y = docYDinh(cau);
    assertEquals(y?.lenh ?? null, lenh);
    if (thamSo !== undefined) assertEquals(y?.thamSo, thamSo);
  });
}

// ---------------- Tin nhắn thật 07/10/2026 bị hiểu sai (khách Dominic) ----------------
const CAN2 = [...CAN, { id: "tiato", name: "Tía Tô", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"], list_rent_month: 25000000 }];
const DOMINIC = "Khách Dominic , ở căn tía tô 6/10 đến 6/11. Giá 20tr / tháng ( đã thu tiền mặt ngày 7/10) , đặt cọc tiền nhà 20tr ( tiền mặt,  7/10). Số công tơ điện đầu kì 11247";

Deno.test("Dominic: 'đặt cọc' trong tin có căn + ngày vẫn là đặt phòng", () => {
  assertEquals(laTinDatPhong(DOMINIC, CAN2, HOM_NAY), true);
});

Deno.test("Dominic: đọc đủ căn, khách, ngày, tiền thuê đã thu, cọc bảo đảm, công tơ", () => {
  const r = parseBooking(DOMINIC, CAN2, HOM_NAY);
  assertEquals(r.can?.id, "tiato");
  assertEquals(r.tenKhach, "Dominic");
  assertEquals([r.row.start_date, r.row.end_date, r.row.term_type], ["2026-10-06", "2026-11-06", "dai_han"]);
  assertEquals(r.row.rent_amount, 20000000);
  assertEquals(r.daThu, { so: 20000000, ngay: "2026-10-07", hinhThuc: "tien_mat" });
  assertEquals([r.row.security_deposit, r.row.security_deposit_status, r.cocLaBaoDam], [20000000, "dang_giu", true]);
  assertEquals(r.row.deposit_amount, null);
  assertEquals(r.row.status, "da_coc");
  assertEquals(r.row.note, "công tơ điện đầu kỳ: 11247");
});

Deno.test("ngày trong ngoặc / ngày thu tiền không bị lấy làm ngày trả phòng", () => {
  const r = doc("đặt Gừng cho Kim từ 10/10 3 tháng, giá 20tr (đã ck 9/10)");
  assertEquals([r.row.start_date, r.row.end_date], ["2026-10-10", "2027-01-10"]);
  assertEquals(r.daThu?.hinhThuc, "chuyen_khoan");
});

Deno.test("thuê ĐÊM: 'cọc' là tiền giữ phòng (trả trước)", () => {
  const r = doc("đặt Gừng 10/10 - 12/10 anh Nam, cọc 500k");
  assertEquals([r.row.deposit_amount, r.row.security_deposit, r.cocLaBaoDam], [500000, null, false]);
});

Deno.test("ngày viết kiểu 6.10 - 6.11, 6 tháng 10, từ mai", () => {
  assertEquals(chuanHoaKhoangNgay("6.10 - 6.11", HOM_NAY), "6/10 - 6/11");
  assertEquals(chuanHoaKhoangNgay("từ 6.10 đến 6.11", HOM_NAY), "từ 6/10 đến 6/11");
  assertEquals(chuanHoaKhoangNgay("giá 6.5tr", HOM_NAY), "giá 6.5tr");                 // tiền giữ nguyên
  assertEquals(chuanHoaKhoangNgay("6 tháng 10 đến 6 tháng 11", HOM_NAY), "6/10 đến 6/11");
  assertEquals(chuanHoaKhoangNgay("thuê 3 tháng 20tr", HOM_NAY), "thuê 3 tháng 20tr");  // độ dài + giá
  assertEquals(chuanHoaKhoangNgay("3 tháng 2 người", HOM_NAY), "3 tháng 2 người");
  assertEquals(chuanHoaKhoangNgay("nhận phòng từ mai", HOM_NAY), "nhận phòng từ 8/10");
});

Deno.test("tên khách: 'khách là X', 'tên khách: X'", () => {
  assertEquals(doc("book Gừng 10/10 - 12/10 khách là Peter").tenKhach, "Peter");
  assertEquals(doc("book Gừng 10/10 - 12/10, tên khách: Lê Hoa").tenKhach, "Lê Hoa");
});

Deno.test("công tơ nước, không lẫn với số điện thoại", () => {
  const r = doc("đặt Gừng 10/10 - 12/10 anh Nam, chỉ số nước 345, số điện thoại 0905123456");
  assertEquals(r.row.note, "công tơ nước: 345");
  assertEquals(r.khach.sdt, "0905123456");
});
