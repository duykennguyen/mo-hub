// Test đọc ảnh / chú thích ảnh gửi cho Lễ tân. Chạy: deno test supabase/functions/thuki-bot/
import { assertEquals } from "jsr:@std/assert@1";
import { docChuThich, layTep, soBookingTrong } from "./chung-tu.ts";

Deno.test("số booking trong chú thích", () => {
  assertEquals(soBookingTrong("#12 passport"), 12);
  assertEquals(soBookingTrong("# 12"), 12);
  assertEquals(soBookingTrong("booking 345 ghi chú"), 345);
  assertEquals(soBookingTrong("hộ chiếu chị Lan"), null);
  assertEquals(soBookingTrong(null), null);
});

Deno.test("loại giấy tờ + số giấy tờ trong chú thích", () => {
  assertEquals(docChuThich("#12 passport C1234567"), { kind: "passport", caption: "#12 passport C1234567", so_giay_to: "C1234567" });
  assertEquals(docChuThich("hộ chiếu Kim, M12345678").so_giay_to, "M12345678");
  assertEquals(docChuThich("#3 cccd 048123456789"), { kind: "cccd", caption: "#3 cccd 048123456789", so_giay_to: "048123456789" });
  assertEquals(docChuThich("#3 ghi chú khách dặn").kind, "ghi_chu");
  assertEquals(docChuThich("").kind, "khac");
  // Số điện thoại không bị lấy làm số CCCD khi không nói là cccd
  assertEquals(docChuThich("#3 0905123456").so_giay_to, null);
});

Deno.test("lấy ảnh cỡ lớn nhất, nhận PDF, từ chối file lạ", () => {
  const anh = layTep({ photo: [{ file_id: "nho", file_size: 1 }, { file_id: "lon", file_size: 9 }], caption: "#7 passport", media_group_id: "g1" });
  assertEquals(anh && anh !== "khong_nhan" ? [anh.file_id, anh.mime, anh.kind, anh.media_group_id] : null, ["lon", "image/jpeg", "passport", "g1"]);
  const pdf = layTep({ document: { file_id: "p", mime_type: "application/pdf", file_size: 5 } });
  assertEquals(pdf && pdf !== "khong_nhan" ? pdf.mime : null, "application/pdf");
  assertEquals(layTep({ document: { file_id: "z", mime_type: "application/zip" } }), "khong_nhan");
  assertEquals(layTep({ text: "chào" }), null);
});
