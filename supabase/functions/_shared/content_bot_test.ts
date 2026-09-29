// Test bot Content: đọc lệnh, chia tin, gửi nháp, và luồng nút Duyệt / Viết lại / Hủy với database giả.
import { assert, assertEquals } from "jsr:@std/assert";
import { chiaTin, dauNhap, docChuDe, guiNhap, rutGonSkill, tachPhuongAn, taoLoiNhan, xuLyUpdate, type BotDeps } from "./content-bot.ts";

// ---------- Database giả: ghi lại mọi truy vấn, trả kết quả theo hàm xuLy ----------
type Q = { bang: string; loai: string; du_lieu?: any; loc: [string, string, any][]; head?: boolean };
function dbGia(xuLy: (q: Q) => any) {
  const nhatKy: Q[] = [];
  const db = {
    nhatKy,
    from(bang: string) {
      const q: Q = { bang, loai: "select", loc: [] };
      const chuoi: any = {
        select: (_c?: string, o?: any) => { if (q.loai === "select") q.head = o?.head; return chuoi; },
        insert: (d: any) => { q.loai = "insert"; q.du_lieu = d; return chuoi; },
        update: (d: any) => { q.loai = "update"; q.du_lieu = d; return chuoi; },
        upsert: (d: any) => { q.loai = "upsert"; q.du_lieu = d; return chuoi; },
        delete: () => { q.loai = "delete"; return chuoi; },
        eq: (c: string, v: any) => { q.loc.push(["eq", c, v]); return chuoi; },
        in: (c: string, v: any) => { q.loc.push(["in", c, v]); return chuoi; },
        is: (c: string, v: any) => { q.loc.push(["is", c, v]); return chuoi; },
        order: () => chuoi, limit: () => chuoi, maybeSingle: () => chuoi, single: () => chuoi,
        then: (ok: any, loi: any) => { nhatKy.push(q); return Promise.resolve(xuLy(q) ?? { data: null, error: null }).then(ok, loi); },
      };
      return chuoi;
    },
  };
  return db;
}
const TAM = { profile_id: "u1", email: "duy@mo.test", ten: "Duy", vai_tro: "admin" };
function deps(db: any, nguoi: any = TAM) {
  const tin: any[] = [];
  let header: Record<string, string> = {};
  const d: BotDeps = {
    brand: "house", hub: "https://hub", adminChat: "1",
    tg: (method, body: any) => { tin.push({ method, ...body }); return Promise.resolve({ result: { message_id: 100 + tin.length } }); },
    may: { rpc: (ten: string) => Promise.resolve(ten === "bot_nguoi_cua_chat" ? { data: nguoi ? [nguoi] : [], error: null } : { data: null, error: null }),
           auth: { admin: { generateLink: () => Promise.resolve({ data: { properties: { hashed_token: "h" } }, error: null }), signOut: () => Promise.resolve({}) } },
           from: () => { throw new Error("service role không được đọc bảng dữ liệu"); } },
    phienDeps: { may: null as any, xacThucMa: () => Promise.resolve({ access_token: "jwt" }), taoClient: (h) => { header = h; return db; } },
  };
  d.phienDeps.may = d.may;
  return { d, tin, header: () => header };
}
const tin = (text: string, chat = 555) => ({ message: { chat: { id: chat }, text } });
const nut = (data: string) => ({ callback_query: { id: "q", data, message: { chat: { id: 555 }, message_id: 9 } } });

Deno.test("đọc /chude, có và không có định dạng", () => {
  assertEquals(docChuDe("Buổi sáng An Bàng"), { topic: "Buổi sáng An Bàng", format: null });
  assertEquals(docChuDe(" Lụa tre mùa mưa | caption IG "), { topic: "Lụa tre mùa mưa", format: "caption IG" });
  assertEquals(docChuDe("   "), null);
  assertEquals(docChuDe("| chỉ có định dạng"), null);
});

Deno.test("chia tin dài không vượt giới hạn Telegram, không mất chữ", () => {
  const dai = ("Đoạn văn tiếng Việt khá dài. ".repeat(40) + "\n").repeat(10);
  const phan = chiaTin(dai, 3800);
  assert(phan.length > 1);
  assert(phan.every((p) => p.length <= 3800));
  assertEquals(phan.join("").replace(/\s/g, ""), dai.replace(/\s/g, ""));
});

Deno.test("đầu nháp: bản dự phòng có nhãn [BẢN DỰ PHÒNG]", () => {
  const g = { post_id: 1, brand: "bedding" as const, chu_de: "Lụa tre", dinh_dang: null, phien_ban: 1, engine: "du_phong", body: "x" };
  assert(dauNhap(g).startsWith("[BẢN DỰ PHÒNG]"));
  assert(dauNhap({ ...g, engine: "claude" }).includes("Mô Bedding · bản 1 · Claude"));
});

Deno.test("gửi nháp: nút chỉ ở tin cuối, gửi cho mọi admin", async () => {
  const gui: any[] = [];
  const tg = (_m: string, b: any) => { gui.push(b); return Promise.resolve({ result: { message_id: gui.length } }); };
  const id = await guiNhap(tg, [11, 22], { post_id: 7, brand: "house", chu_de: "A", dinh_dang: null, phien_ban: 2, engine: "claude", body: "x".repeat(5000) });
  assertEquals(gui.length, 4);                       // 2 phần × 2 admin
  assert(!gui[0].reply_markup && gui[1].reply_markup);
  assertEquals(gui[1].reply_markup.inline_keyboard[0].map((n: any) => n.callback_data), ["d:7", "r:7", "h:7"]);
  assertEquals(id, 2);
});

Deno.test("lời nhắn cho bộ máy viết có bản trước và yêu cầu sửa khi viết lại", () => {
  const s = taoLoiNhan("SKILL", { post_id: 1, loai: "viet_lai", brand: "house", chu_de: "Hồ bơi", dinh_dang: null, ghi_chu: null,
    phien_ban_moi: 2, yeu_cau_sua: "Ngắn hơn", ban_truoc: "Bản cũ" });
  assert(s.startsWith("SKILL") && s.includes("Bản cũ") && s.includes("Ngắn hơn") && s.includes("Không bịa số liệu"));
});

Deno.test("chat chưa liên kết: không mở phiên, không đọc gì", async () => {
  const db = dbGia(() => { throw new Error("không được truy vấn"); });
  const { d, tin: t } = deps(db, null);
  await xuLyUpdate(tin("/hangdoi"), d);
  assertEquals(db.nhatKy.length, 0);
  assert(t[0].text.includes("chưa liên kết"));
});

Deno.test("không phải admin: bị từ chối", async () => {
  const db = dbGia(() => { throw new Error("không được truy vấn"); });
  const { d, tin: t } = deps(db, { ...TAM, vai_tro: "manager" });
  await xuLyUpdate(tin("/chude abc"), d);
  assertEquals(db.nhatKy.length, 0);
  assert(t[0].text.includes("chỉ dành cho quản trị viên"));
});

Deno.test("/chude ghi đúng thương hiệu, bằng phiên của Duy qua kênh content-house", async () => {
  const db = dbGia((q) => q.head ? { count: 3, error: null } : { data: null, error: null });
  const { d, tin: t, header } = deps(db);
  await xuLyUpdate(tin("/chude Hoàng hôn Nhà Biển | caption IG"), d);
  const ins = db.nhatKy.find((q) => q.loai === "insert")!;
  assertEquals(ins.bang, "content_topics");
  assertEquals(ins.du_lieu, { brand: "house", topic: "Hoàng hôn Nhà Biển", format: "caption IG" });
  assertEquals(header()["x-mo-kenh"], "content-house");
  assert(t.at(-1).text.includes("3 chủ đề chờ"));
});

Deno.test("/vietngay khi hàng đợi trống: không tạo yêu cầu", async () => {
  const db = dbGia((q) => q.head ? { count: 0, error: null } : { data: [], error: null });
  const { d, tin: t } = deps(db);
  await xuLyUpdate(tin("/vietngay"), d);
  assert(!db.nhatKy.some((q) => q.loai === "insert"));
  assert(t.at(-1).text.includes("trống"));
});

Deno.test("nút Duyệt chỉ đổi bài đang chờ duyệt", async () => {
  const db = dbGia((q) => q.loai === "update" ? { data: { id: 7 }, error: null } : null);
  const { d } = deps(db);
  await xuLyUpdate(nut("d:7"), d);
  const up = db.nhatKy.find((q) => q.loai === "update")!;
  assertEquals(up.du_lieu.status, "da_duyet");
  assert(up.loc.some(([k, c, v]) => k === "eq" && c === "status" && v === "cho_duyet"));
  assert(up.loc.some(([k, c, v]) => k === "eq" && c === "brand" && v === "house"));
});

Deno.test("Viết lại: bấm nút rồi nhắn → bài chuyển can_viet_lai với yêu cầu sửa", async () => {
  // bước 1: bấm nút
  const db1 = dbGia((q) => q.bang === "content_posts" ? { data: { status: "cho_duyet" }, error: null } : { data: null, error: null });
  const a = deps(db1);
  await xuLyUpdate(nut("r:7"), a.d);
  const ups = db1.nhatKy.find((q) => q.loai === "upsert")!;
  assertEquals(ups.du_lieu, { chat_id: 555, brand: "house", post_id: 7 });
  // bước 2: tin nhắn kế tiếp
  const db2 = dbGia((q) => q.bang === "content_cho_phan_hoi" && q.loai === "select" ? { data: { post_id: 7 }, error: null }
    : q.bang === "content_posts" && q.loai === "update" ? { data: { id: 7 }, error: null } : { data: null, error: null });
  const b = deps(db2);
  await xuLyUpdate(tin("Ngắn hơn, bỏ emoji"), b.d);
  const up = db2.nhatKy.find((q) => q.bang === "content_posts" && q.loai === "update")!;
  assertEquals(up.du_lieu, { status: "can_viet_lai", feedback_pending: "Ngắn hơn, bỏ emoji" });
  assert(db2.nhatKy.some((q) => q.bang === "content_cho_phan_hoi" && q.loai === "delete"));
});

Deno.test("Hủy + trả chủ đề về hàng đợi", async () => {
  const db = dbGia((q) => q.bang === "content_posts" && q.loai === "update" ? { data: { topic_id: 42 }, error: null } : { data: null, error: null });
  const { d } = deps(db);
  await xuLyUpdate(nut("hq:7:1"), d);
  assertEquals(db.nhatKy.find((q) => q.bang === "content_posts")!.du_lieu, { status: "huy" });
  const tp = db.nhatKy.find((q) => q.bang === "content_topics")!;
  assertEquals(tp.du_lieu, { status: "cho" });
  assert(tp.loc.some(([_, c, v]) => c === "id" && v === 42));
});

// ---------- 3 phương án ----------
const BA = `=== PHƯƠNG ÁN 1 · Kể chuyện ===
Sáng nay nắng vàng.

Chăn phơi trên lan can.
=== PHƯƠNG ÁN 2 · Ngắn, tinh nghịch ===
Sun . Bed . Now
=== PHƯƠNG ÁN 3 · Thơ ===
nắng ghé qua gối`;

Deno.test("tách 3 phương án: tên phong cách và nội dung nhiều đoạn", () => {
  const pa = tachPhuongAn(BA)!;
  assertEquals(pa.map((x) => [x.so, x.phong_cach]), [[1, "Kể chuyện"], [2, "Ngắn, tinh nghịch"], [3, "Thơ"]]);
  assertEquals(pa[0].body, "Sáng nay nắng vàng.\n\nChăn phơi trên lan can.");
});

Deno.test("tách 3 phương án: chịu được markdown đậm, dấu gạch, chữ thường, lời dẫn phía trước", () => {
  const s = "Đây là 3 phương án:\n**Phương án 1 – Mềm mại**\nA\n## PHƯƠNG ÁN 2: Tinh nghịch\nB\nphương án 3\nC";
  const pa = tachPhuongAn(s)!;
  assertEquals(pa.map((x) => x.phong_cach), ["Mềm mại", "Tinh nghịch", ""]);
  assertEquals(pa.map((x) => x.body), ["A", "B", "C"]);
});

Deno.test("tách 3 phương án: thiếu, trùng số hoặc rỗng → null (gửi nguyên bài)", () => {
  assertEquals(tachPhuongAn("Một bài bình thường, không chia phương án."), null);
  assertEquals(tachPhuongAn("=== PHƯƠNG ÁN 1 ===\nA\n=== PHƯƠNG ÁN 2 ===\nB"), null);
  assertEquals(tachPhuongAn("=== PHƯƠNG ÁN 1 ===\nA\n=== PHƯƠNG ÁN 1 ===\nB\n=== PHƯƠNG ÁN 3 ===\nC"), null);
  assertEquals(tachPhuongAn("=== PHƯƠNG ÁN 1 ===\nA\n=== PHƯƠNG ÁN 2 ===\n\n=== PHƯƠNG ÁN 3 ===\nC"), null);
});

Deno.test("gửi 3 phương án: mỗi phương án 1 tin có nút Chọn riêng, tin cuối có Viết lại / Hủy", async () => {
  const gui: any[] = [];
  const tg = (_m: string, b: any) => { gui.push(b); return Promise.resolve({ result: { message_id: gui.length } }); };
  const id = await guiNhap(tg, [11], { post_id: 7, brand: "bedding", chu_de: "Phơi chăn", dinh_dang: null, phien_ban: 1,
    engine: "claude", body: BA, options: tachPhuongAn(BA) });
  assertEquals(gui.length, 5);                        // đầu + 3 phương án + cuối
  assertEquals(gui.slice(1, 4).map((b) => b.reply_markup.inline_keyboard[0][0].callback_data), ["d:7:1", "d:7:2", "d:7:3"]);
  assert(gui[2].text.startsWith("▸ Phương án 2 · Ngắn, tinh nghịch"));
  assertEquals(gui[4].reply_markup.inline_keyboard[0].map((n: any) => n.callback_data), ["r:7", "h:7"]);
  assertEquals(id, 5);
});

Deno.test("bấm Chọn phương án 2: duyệt bài và ghi chosen_option = 2", async () => {
  const db = dbGia((q) => q.loai === "update" ? { data: { id: 7 }, error: null } : null);
  const { d, tin: t } = deps(db);
  await xuLyUpdate(nut("d:7:2"), d);
  const up = db.nhatKy.find((q) => q.loai === "update")!;
  assertEquals(up.du_lieu.status, "da_duyet");
  assertEquals(up.du_lieu.chosen_option, 2);
  assert(t.some((x) => x.text?.includes("phương án 2")));
});

Deno.test("nút Chọn với số phương án lạ: không ghi gì", async () => {
  const db = dbGia(() => { throw new Error("không được truy vấn"); });
  const { d } = deps(db);
  await xuLyUpdate(nut("d:7:9"), d);
  assertEquals(db.nhatKy.length, 0);
});

Deno.test("lời nhắn yêu cầu đúng khuôn 3 phương án", () => {
  const s = taoLoiNhan("SKILL", { post_id: 1, loai: "viet_ngay", brand: "bedding", chu_de: "Phơi chăn", dinh_dang: null, ghi_chu: null,
    phien_ban_moi: 1, yeu_cau_sua: null, ban_truoc: null });
  assert(s.includes("3 PHƯƠNG ÁN") && s.includes("=== PHƯƠNG ÁN 3 · <tên phong cách> ==="));
});

Deno.test("bản rút gọn skill bỏ phần đầu và phần tri thức nội bộ", () => {
  const md = "---\nname: x\ntrang_thai: nháp\n---\n\n# Giọng\nMềm, ấm.\n\n## Luật\nKhông bịa.\n\n## Tri thức tham chiếu (chỉ máy Duy)\nknowledge/dinh-vi.md";
  const r = rutGonSkill(md);
  assert(r.startsWith("# Giọng") && r.includes("Không bịa"));
  assert(!r.includes("name: x") && !r.includes("dinh-vi"));
});
