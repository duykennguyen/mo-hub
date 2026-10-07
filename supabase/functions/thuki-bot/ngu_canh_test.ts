// Test ngữ cảnh hội thoại của Lễ tân (trả lời tin cũ, "làm lại"). Chạy: deno test supabase/functions/thuki-bot/
import { assertEquals } from "jsr:@std/assert@1";
import { ghepNguCanh, laYeuCauLamLai, soBookingTuTinBot } from "./ngu-canh.ts";

const CU = "Khách Dominic , ở căn tía tô 6/10 đến 6/11. Giá 20tr / tháng";

Deno.test("nhận ra lời yêu cầu làm lại", () => {
  for (const s of ["Làm lại thao tác này cho tôi, ảnh là của khách này luôn", "thử lại", "tạo lại giúp", "ok tạo đi", "đúng rồi, ghi đi"])
    assertEquals(laYeuCauLamLai(s), true, s);
  for (const s of ["sđt 0905123456", "đặt Gừng 10/10 - 12/10", "tìm Anna"]) assertEquals(laYeuCauLamLai(s), false, s);
});

Deno.test("ghép tin được trả lời với tin mới", () => {
  // Chỉ là lời ra lệnh → dùng nguyên tin cũ, không nối "khách này" vào (kẻo thành tên khách)
  assertEquals(ghepNguCanh(CU, "Làm lại thao tác này cho tôi, ảnh là của khách này luôn"), CU);
  // Có thêm thông tin → nối vào
  assertEquals(ghepNguCanh(CU, "sđt 0905123456"), CU + "\nsđt 0905123456");
  assertEquals(ghepNguCanh(CU, "làm lại, sđt 0905123456"), CU + "\nsđt 0905123456");
});

Deno.test("đọc số booking trong tin của bot", () => {
  assertEquals(soBookingTuTinBot("✅ Đã tạo booking #12\n🏠 CamF — Tía Tô"), 12);
  assertEquals(soBookingTuTinBot("📄 Booking #345 · 🟢 Đã cọc"), 345);
  assertEquals(soBookingTuTinBot("Tôi chưa thấy tên căn"), null);
});
