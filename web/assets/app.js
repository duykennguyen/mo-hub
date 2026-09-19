// Mô Hub — phần dùng chung: kết nối Supabase, cổng đăng nhập, tiện ích.
(function () {
  const C = window.MO_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
  const when = (ts) => new Date(ts).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Đã chép link"); }
    catch { prompt("Chép link này:", text); }
  }

  function renderGate(html) {
    $("#app").classList.add("hide");
    const g = $("#gate"); g.classList.remove("hide");
    g.innerHTML = `<div class="cong">${html}</div>`;
  }

  function loginScreen() {
    renderGate(`
      <h1>Mô Hub</h1>
      <p class="muted">Hệ thống vận hành nội bộ Mô Đi Phê. Nhập email, hệ thống gửi link đăng nhập vào hộp thư của bạn.</p>
      <label for="em">Email</label>
      <input id="em" type="email" autocomplete="email" placeholder="ten@gmail.com">
      <button class="btn chinh" id="send">Gửi link đăng nhập</button>
      <p class="muted" id="msg"></p>`);
    $("#send").onclick = async () => {
      const email = $("#em").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return ($("#msg").textContent = "Email chưa đúng định dạng.");
      $("#send").disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      $("#msg").textContent = error ? "Không gửi được: " + error.message
        : "Đã gửi. Mở email và bấm link — nên mở trên chính trình duyệt này.";
      $("#send").disabled = false;
    };
  }

  async function pendingScreen(p) {
    renderGate(`
      <h1>Đang chờ duyệt</h1>
      <p class="muted">Tài khoản <b>${esc(p.email)}</b> đã đăng ký. Quản trị viên sẽ duyệt trước khi bạn xem được dữ liệu.</p>
      <label for="nm">Tên của bạn (để quản trị viên nhận ra)</label>
      <input id="nm" value="${esc(p.full_name ?? "")}" placeholder="Ví dụ: Anh Tâm — kỹ thuật">
      <button class="btn chinh" id="req">Gửi yêu cầu duyệt</button>
      <button class="btn chu" id="out">Đăng xuất</button>
      <p class="muted" id="msg"></p>`);
    $("#out").onclick = () => sb.auth.signOut().then(() => location.reload());
    $("#req").onclick = async () => {
      const name = $("#nm").value.trim();
      if (!name) return ($("#msg").textContent = "Ghi tên trước khi gửi.");
      $("#req").disabled = true;
      await sb.rpc("set_my_name", { p_name: name });
      const { error } = await sb.functions.invoke("request-access");
      $("#msg").textContent = error ? "Chưa gửi được thông báo, thử lại sau ít phút." : "Đã báo quản trị viên. Tải lại trang này sau khi được duyệt.";
      $("#req").disabled = false;
    };
  }

  async function gate(onReady) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return loginScreen();
    let { data: p } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (!p) { await new Promise((r) => setTimeout(r, 1200)); ({ data: p } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle()); }
    if (!p) return renderGate(`<h1>Lỗi hồ sơ</h1><p class="muted">Không tìm thấy hồ sơ tài khoản. Báo quản trị viên.</p>`);
    if (p.status === "pending") return pendingScreen(p);
    if (p.status === "rejected") {
      renderGate(`<h1>Không có quyền truy cập</h1><p class="muted">Tài khoản ${esc(p.email)} chưa được cấp quyền.</p><button class="btn" id="out">Đăng xuất</button>`);
      return ($("#out").onclick = () => sb.auth.signOut().then(() => location.reload()));
    }
    $("#gate").classList.add("hide");
    $("#app").classList.remove("hide");
    const roleName = { admin: "Quản trị", manager: "Quản lý", staff: "Nhân viên", viewer: "Chỉ xem" }[p.role];
    $("#who").innerHTML = `${esc(p.full_name || p.email)} · ${roleName}<button class="btn chu" id="logout">Đăng xuất</button>`;
    $("#logout").onclick = () => sb.auth.signOut().then(() => location.reload());
    onReady({ ...p, canEdit: ["admin", "manager", "staff"].includes(p.role), isAdmin: p.role === "admin" });
  }

  window.Mo = { sb, C, esc, $, toast, copy, gate, vnToday, ddmm, when };
})();
