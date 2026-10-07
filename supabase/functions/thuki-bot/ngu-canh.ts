// Lễ tân — NGỮ CẢNH hội thoại: hiểu tin nhắn TRẢ LỜI (reply) và yêu cầu "làm lại".
// Ví dụ thật 07/10/2026: anh Duy trả lời album ảnh hộ chiếu "Làm lại thao tác này cho tôi,
// ảnh là của khách này luôn" — bot phải lấy lại nội dung + ảnh của tin được trả lời.
// Chỉ dùng luật, không dùng AI.

// Câu ra lệnh làm lại / xác nhận — bản thân câu này KHÔNG chứa thông tin booking
const RE_LAM_LAI = /(làm lại|thử lại|ghi lại|tạo lại|nhập lại|lưu lại|đặt lại|xử lý lại|xu ly lai|lam lai|thu lai|ghi lai|tao lai|nhap lai|luu lai|dat lai|làm giúp|làm giùm|làm đi|tạo đi|ghi đi|lưu đi|ok tạo|đúng rồi|chuẩn rồi|ảnh (?:là|này) của|ảnh của khách|của khách này)/i;

export const laYeuCauLamLai = (t: string) => RE_LAM_LAI.test(t);

// Ghép tin cũ (được trả lời) với tin mới. Tin mới chỉ là lời ra lệnh thì bỏ đi, để những chữ
// như "khách này" không bị đọc thành tên khách; tin mới có thêm thông tin thì nối vào sau.
export function ghepNguCanh(cu: string, moi: string): string {
  if (!cu.trim()) return moi;
  if (laYeuCauLamLai(moi)) {
    // "làm lại, sđt 0905123456" → vẫn giữ phần thông tin sau lời ra lệnh
    const conLai = moi.replace(RE_LAM_LAI, " ").replace(/(?<![\p{L}])(cho tôi|giúp tôi|giùm|luôn|nhé|nha|với|này|thao tác)(?![\p{L}])/giu, " ")
      .replace(/^[\s,.;:!-]+|[\s,.;:!-]+$/g, "");
    return /\d|@/.test(conLai) ? `${cu}\n${conLai}` : cu;
  }
  return `${cu}\n${moi}`;
}

// Số booking trong tin của bot ("✅ Đã tạo booking #12", "📄 Booking #12", "Bổ sung booking #12")
export function soBookingTuTinBot(text: string | undefined | null): number | null {
  const m = (text ?? "").match(/booking\s*#\s?(\d{1,7})|#(\d{1,7})/i);
  return m ? Number(m[1] ?? m[2]) : null;
}
