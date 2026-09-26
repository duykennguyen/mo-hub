// Test cổng danh tính của Thư kí: chat chưa liên kết không được chạm vào dữ liệu,
// liên kết chỉ bằng mã, phiên của người nhắn mang đúng token + header kênh.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { congDanhTinh, docLenhLienKet, khopBiMat, laLoiQuyen, moPhien } from "./danh-tinh.ts";

// Client service role giả: ghi lại mọi lần gọi, và ném lỗi nếu có ai đọc/ghi bảng dữ liệu
function mayGia(lienKet: Record<number, any> = {}) {
  const goi: string[] = [];
  const may = {
    goi,
    rpc: (ten: string, thamSo: any) => {
      goi.push(ten);
      if (ten === "bot_nguoi_cua_chat") return Promise.resolve({ data: lienKet[thamSo.p_chat] ? [lienKet[thamSo.p_chat]] : [], error: null });
      if (ten === "bot_dung_ma_lien_ket")
        return Promise.resolve({ data: thamSo.p_ma === "ABCD2345" ? { ok: true, ten: "Anh Tâm" } : { ok: false, ly_do: "het_han" }, error: null });
      throw new Error("chat chưa liên kết gọi hàm không được phép: " + ten);
    },
    from: (bang: string) => { throw new Error("chat chưa liên kết chạm vào bảng " + bang); },
  };
  return may;
}
function tgGia() {
  const tin: any[] = [];
  return { tin, tg: (method: string, body: any) => { tin.push({ method, ...body }); return Promise.resolve(); } };
}
const TAM = { profile_id: "u-tam", email: "tam@mo.test", ten: "Anh Tâm", vai_tro: "staff" };
const tinNhan = (chat: number, text: string) => ({ message: { chat: { id: chat }, text } });

Deno.test("đọc lệnh liên kết", () => {
  assertEquals(docLenhLienKet("/id"), { loai: "id" });
  assertEquals(docLenhLienKet("/lienket ABCD2345"), { loai: "lienket", ma: "ABCD2345" });
  assertEquals(docLenhLienKet("  /lienket   abcd2345 "), { loai: "lienket", ma: "abcd2345" });
  assertEquals(docLenhLienKet("/start ABCD2345"), { loai: "lienket", ma: "ABCD2345" });   // bấm link t.me/...?start=
  assertEquals(docLenhLienKet("/lienket@ThuKiMo_bot ABCD2345"), { loai: "lienket", ma: "ABCD2345" });
  assertEquals(docLenhLienKet("/start"), { loai: "huong_dan" });
  assertEquals(docLenhLienKet("/lienket"), { loai: "huong_dan" });
  assertEquals(docLenhLienKet("/viec"), { loai: "huong_dan" });
  assertEquals(docLenhLienKet("dọn nhà Sen mai"), { loai: "huong_dan" });
});

Deno.test("chat chưa liên kết: /viec không đọc dữ liệu nào, chỉ nhận hướng dẫn", async () => {
  const may = mayGia(), t = tgGia();
  const kq = await congDanhTinh(tinNhan(555, "/viec"), { may, tg: t.tg, hub: "https://hub", adminChat: "1" });
  assertEquals(kq, null);
  assertEquals(may.goi, ["bot_nguoi_cua_chat"]);
  assertEquals(t.tin.length, 1);
  assert(t.tin[0].text.includes("chưa liên kết"));
  assert(t.tin[0].text.includes("/lienket"));
});

Deno.test("chat chưa liên kết: tin nhắn ghi việc / đặt phòng cũng bị chặn", async () => {
  for (const text of ["dọn Củ Sả mai", "đặt Gừng cho Anna từ 1/10 đến 1/12", "/lich", "/dat", "/xoa 12"]) {
    const may = mayGia(), t = tgGia();
    assertEquals(await congDanhTinh(tinNhan(555, text), { may, tg: t.tg, hub: "", adminChat: "1" }), null);
    assertEquals(may.goi, ["bot_nguoi_cua_chat"], text);
  }
});

Deno.test("chat chưa liên kết bấm nút cũ: chỉ báo, không làm gì", async () => {
  const may = mayGia(), t = tgGia();
  const up = { callback_query: { id: "q1", data: "x:12", message: { chat: { id: 555 }, message_id: 9 } } };
  assertEquals(await congDanhTinh(up, { may, tg: t.tg, hub: "", adminChat: "1" }), null);
  assertEquals(may.goi, ["bot_nguoi_cua_chat"]);
  assertEquals(t.tin[0].method, "answerCallbackQuery");
});

Deno.test("chat quản trị chưa liên kết: vẫn bị chặn, có lời nhắc riêng", async () => {
  const may = mayGia(), t = tgGia();
  assertEquals(await congDanhTinh(tinNhan(1, "/lich"), { may, tg: t.tg, hub: "", adminChat: "1" }), null);
  assert(t.tin[0].text.includes("chat quản trị"));
});

Deno.test("/id trả chat id cho bất kỳ ai, không tra database", async () => {
  const may = mayGia(), t = tgGia();
  assertEquals(await congDanhTinh(tinNhan(777, "/id"), { may, tg: t.tg, hub: "", adminChat: "1" }), null);
  assertEquals(may.goi, []);
  assertEquals(t.tin[0].text, "Chat ID: 777");
});

Deno.test("/lienket: mã đúng thì liên kết, mã hết hạn thì từ chối", async () => {
  let may = mayGia(), t = tgGia();
  await congDanhTinh(tinNhan(555, "/lienket ABCD2345"), { may, tg: t.tg, hub: "", adminChat: "1" });
  assertEquals(may.goi, ["bot_dung_ma_lien_ket"]);
  assert(t.tin[0].text.startsWith("✅") && t.tin[0].text.includes("Anh Tâm"));

  may = mayGia(); t = tgGia();
  await congDanhTinh(tinNhan(555, "/lienket ZZZZ9999"), { may, tg: t.tg, hub: "", adminChat: "1" });
  assert(t.tin[0].text.startsWith("❌") && t.tin[0].text.includes("10 phút"));
});

Deno.test("chat đã liên kết: trả về đúng người để mở phiên", async () => {
  const may = mayGia({ 555: TAM }), t = tgGia();
  const kq = await congDanhTinh(tinNhan(555, "/viec"), { may, tg: t.tg, hub: "", adminChat: "1" });
  assertEquals(kq, { nguoi: TAM, chat: 555 });
  assertEquals(t.tin.length, 0);
});

Deno.test("mở phiên: dùng token của người nhắn + header kênh Thư kí, xong thì hủy phiên", async () => {
  const signOut: string[] = [];
  let header: Record<string, string> = {};
  const deps = {
    may: { auth: { admin: {
      generateLink: (o: any) => Promise.resolve({ data: { properties: { hashed_token: "hash-" + o.email } }, error: null }),
      signOut: (jwt: string) => { signOut.push(jwt); return Promise.resolve({ error: null }); },
    } } },
    xacThucMa: (h: string) => Promise.resolve(h === "hash-tam@mo.test" ? { access_token: "jwt-cua-tam" } : null),
    taoClient: (h: Record<string, string>) => { header = h; return { la: "client-cua-tam" }; },
  };
  const p = await moPhien(deps, TAM);
  assertEquals(header, { Authorization: "Bearer jwt-cua-tam", "x-mo-kenh": "thu-ki" });
  assertEquals(p.db, { la: "client-cua-tam" });
  await p.dong();
  assertEquals(signOut, ["jwt-cua-tam"]);
});

Deno.test("mở phiên thất bại thì báo lỗi, không lùi về service role", async () => {
  const deps = {
    may: { auth: { admin: { generateLink: () => Promise.resolve({ data: null, error: { message: "rate limit" } }) } } },
    xacThucMa: () => Promise.resolve(null),
    taoClient: () => { throw new Error("không được tạo client"); },
  };
  await assertRejects(() => moPhien(deps, TAM), Error, "rate limit");
});

Deno.test("so bí mật", () => {
  assert(khopBiMat("abc123", "abc123"));
  assert(!khopBiMat("abc123", "abc124"));
  assert(!khopBiMat("abc", "abc123"));
  assert(!khopBiMat("", ""));          // chưa cấu hình secret thì không bao giờ khớp
});

Deno.test("nhận ra lỗi thiếu quyền", () => {
  assert(laLoiQuyen({ code: "42501", message: "new row violates row-level security policy" }));
  assert(laLoiQuyen({ message: "Chỉ quản trị viên được xóa hoặc khôi phục việc" }) === false);
  assert(!laLoiQuyen(null));
});
