// Test thao tác trên booking đã có, nói bằng lời. Chạy: deno test supabase/functions/thuki-bot/
import { assertEquals } from "jsr:@std/assert@1";
import { chamDiem, chonBooking, docHanhDong, soNgayDich, themVaoNgay, type BookingTom } from "./hanh-dong.ts";
import { chuanHoaGiongNoi } from "./giong-noi.ts";

const HOM_NAY = new Date(Date.UTC(2026, 9, 7));   // 07/10/2026
const CAN = [
  { id: "gung", name: "Gừng", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"] },
  { id: "tiato", name: "Tía Tô", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"] },
  { id: "cusa", name: "Củ Sả", property_id: "camf", property_name: "CamF — CamFusion House", property_aliases: ["camf"] },
];
const B = (id: number, unit_id: string, unit_name: string, guest: string | null, a: string, b: string): BookingTom =>
  ({ id, unit_id, unit_name, property_name: "CamF", guest_name: guest, start_date: a, end_date: b, status: "giu_cho" });
const DS = [
  B(120, "gung", "Gừng", "DUy đặt phòng gừng", "2026-10-08", "2026-10-11"),
  B(121, "tiato", "Tía Tô", "Dominic", "2026-10-06", "2026-11-06"),
  B(122, "cusa", "Củ Sả", "Liat", "2026-10-01", "2026-10-15"),
  B(123, "gung", "Gừng", "anh Duy", "2026-11-20", "2026-11-22"),
];
const tim = (s: string) => chonBooking(chamDiem(chuanHoaGiongNoi(s, HOM_NAY), DS, CAN, HOM_NAY));

// ---------------- Đọc thao tác ----------------
const BANG: [string, string | null][] = [
  ["xóa thông tin đặt phòng của Duy ở ngày mai đi", "huy"],
  ["hủy phòng Gừng của Duy", "huy"],
  ["khách Duy hủy rồi", "huy"],
  ["dời Duy sang 12-14/10", "doi_ngay"],
  ["lùi khách Liat 2 ngày", "doi_ngay"],
  ["đổi ngày Dominic sang 7/10 - 7/11", "doi_ngay"],
  ["Dominic gia hạn thêm 1 tháng", "gia_han"],
  ["Liat ở thêm 2 đêm", "gia_han"],
  ["Liat trả phòng sớm ngày 12/10", "tra_som"],
  ["Liat đã trả phòng", "tra_som"],
  ["Dominic đã nhận phòng", "nhan_phong"],
  ["chuyển Duy sang căn Củ Sả", "doi_can"],
  ["ai đang ở Gừng", "ai_o"],
  ["căn Tía Tô có ai ở không", "ai_o"],
  ["xem booking của Duy", "xem"],
  // Không phải thao tác — tin đặt phòng mới hoặc câu khác
  ["đặt Gừng cho Anna 10/10 - 12/10", null],
  ["Gừng 10-12/10 anh Nam, nhận phòng 10/10 trả phòng 12/10", null],
  ["khách Dominic, ở căn tía tô 6/10 đến 6/11, đặt cọc 20tr", null],
];
for (const [cau, loai] of BANG) {
  Deno.test(`thao tác (${loai}): ${cau}`, () => assertEquals(docHanhDong(cau)?.loai ?? null, loai));
}

Deno.test("tách phần tìm booking và phần đích", () => {
  const h = docHanhDong("dời Duy ngày mai sang 12-14/10")!;
  assertEquals([h.timKiem.trim(), h.dich.trim()], ["dời duy ngày mai", "12-14/10"]);
  const c = docHanhDong("chuyển Duy sang căn Củ Sả")!;
  assertEquals(c.dich.trim(), "căn củ sả");
});

Deno.test("dịch ngày và cộng thêm", () => {
  assertEquals(soNgayDich("lùi 2 ngày"), 2);
  assertEquals(soNgayDich("đến sớm 1 hôm"), -1);
  assertEquals(soNgayDich("hoãn 1 tuần"), 7);
  assertEquals(soNgayDich("dời sang 12/10"), null);
  assertEquals(themVaoNgay("2026-11-06", "thêm 1 tháng"), "2026-12-06");
  assertEquals(themVaoNgay("2026-10-15", "thêm 2 đêm"), "2026-10-17");
});

// ---------------- Tìm booking theo lời tả ----------------
Deno.test("tin nhắn thật: 'xóa thông tin đặt phòng của Duy ở ngày mai đi' → booking #120", () => {
  assertEquals(tim("xóa thông tin đặt phòng của Duy ở ngày mai đi").chac?.id, 120);
});
Deno.test("hai booking tên Duy: có ngày thì chọn đúng, không có ngày thì hỏi lại", () => {
  assertEquals(tim("hủy booking của Duy 20/11").chac?.id, 123);
  const r = tim("hủy booking của Duy");
  assertEquals([r.chac, r.ungVien.map((b) => b.id).sort()], [null, [120, 123]]);
});
Deno.test("tìm theo căn hoặc số booking", () => {
  assertEquals(tim("Liat ở thêm 2 đêm").chac?.id, 122);
  assertEquals(tim("khách ở Tía Tô gia hạn").chac?.id, 121);
  assertEquals(tim("hủy #122").chac?.id, 122);
  assertEquals(tim("hủy booking của Peter").chac, null);
});

// ---------------- Kế hoạch thay đổi (chưa ghi gì, chỉ tính) ----------------
import { lapKeHoach } from "./thao-tac.ts";
import { docYDinh } from "./y-dinh.ts";
const keHoach = (cau: string, id: number) => {
  const hd = docHanhDong(chuanHoaGiongNoi(cau, HOM_NAY))!;
  return lapKeHoach(hd, DS.find((b) => b.id === id)!, CAN, HOM_NAY);
};

Deno.test("kế hoạch: hủy / dời theo ngày mới / lùi N ngày", () => {
  assertEquals(keHoach("xóa thông tin đặt phòng của Duy ở ngày mai đi", 120).patch, { status: "huy" });
  assertEquals(keHoach("dời Duy sang 12-14/10", 120).patch, { start_date: "2026-10-12", end_date: "2026-10-14" });
  assertEquals(keHoach("dời Duy sang 15/10", 120).patch, { start_date: "2026-10-15", end_date: "2026-10-18" });  // giữ 3 đêm
  assertEquals(keHoach("lùi Duy 2 ngày", 120).patch, { start_date: "2026-10-10", end_date: "2026-10-13" });
  assertEquals(keHoach("dời Duy", 120).patch, null);                                                         // thiếu ngày → hỏi lại
});

Deno.test("kế hoạch: gia hạn / trả phòng sớm / đã nhận phòng / đổi căn", () => {
  assertEquals(keHoach("Dominic gia hạn thêm 1 tháng", 121).patch, { end_date: "2026-12-06" });
  assertEquals(keHoach("Liat ở thêm 2 đêm", 122).patch, { end_date: "2026-10-17" });
  assertEquals(keHoach("gia hạn Liat đến hết 20/10", 122).patch, { end_date: "2026-10-21" });
  assertEquals(keHoach("Liat trả phòng sớm ngày 12/10", 122).patch, { end_date: "2026-10-12" });
  assertEquals(keHoach("Liat đã trả phòng", 122).patch, { end_date: "2026-10-07", status: "ket_thuc" });
  assertEquals(keHoach("Duy đã nhận phòng", 120).patch, { status: "dang_o", start_date: "2026-10-07" });  // đến sớm 1 ngày
  assertEquals(keHoach("chuyển Duy sang căn Củ Sả", 120).patch, { unit_id: "cusa" });
  assertEquals(keHoach("chuyển Duy sang căn Gừng", 120).patch, null);                                      // đang ở Gừng rồi
});

Deno.test("'ai đang ở' trơn là báo cáo, 'ai đang ở Gừng' là tra theo căn", () => {
  assertEquals(docYDinh("ai đang ở")?.lenh, "lich");
  assertEquals(docYDinh("ai đang ở Gừng"), null);
  assertEquals(docHanhDong("ai đang ở Gừng")?.loai, "ai_o");
});
