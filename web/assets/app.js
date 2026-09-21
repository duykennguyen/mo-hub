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

  const hopLe = (email) => /^\S+@\S+\.\S+$/.test(email);
  const veTrang = () => location.origin + location.pathname;
  // Tên người đăng ký: giữ tạm ở máy để sau khi bấm link trong email thì tự gửi yêu cầu duyệt
  const TEN_TAM = "mo_ten_dang_ky";
  const nhoTen = (v) => { try { v ? localStorage.setItem(TEN_TAM, v) : localStorage.removeItem(TEN_TAM); } catch { /* trình duyệt chặn thì bỏ qua */ } };
  const layTen = () => { try { return localStorage.getItem(TEN_TAM) || ""; } catch { return ""; } };

  // Nút Google: dùng chung cho cả Đăng nhập và Đăng ký.
  // Google trả về email đã xác minh; Supabase gộp vào tài khoản cùng email nên
  // người đã được duyệt không phải xin duyệt lại.
  const nutGoogle = `<button class="btn" id="gg">Tiếp tục bằng Google</button>
      <p class="muted">hoặc dùng email:</p>`;
  function ganNutGoogle() {
    const b = $("#gg");
    if (!b) return;
    b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: veTrang() },
      });
      if (error) {
        $("#msg").textContent = /provider is not enabled/i.test(error.message)
          ? "Đăng nhập Google chưa được bật cho hệ thống. Dùng email bên dưới, hoặc báo quản trị viên."
          : "Không mở được Google: " + error.message;
        b.disabled = false;
      }
    };
  }

  // Màn hình đầu: chọn Đăng nhập (đã có tài khoản) hay Đăng ký (lần đầu)
  function welcomeScreen() {
    renderGate(`
      <h1>Mô Hub</h1>
      <p class="muted">Hệ thống vận hành nội bộ Mô Đi Phê.</p>
      <button class="btn chinh" id="toLogin">Đăng nhập</button>
      <button class="btn" id="toReg">Đăng ký — lần đầu dùng</button>
      <p class="muted">Máy này sẽ nhớ bạn, những lần sau mở là vào thẳng.</p>`);
    $("#toLogin").onclick = loginScreen;
    $("#toReg").onclick = registerScreen;
  }

  function loginScreen() {
    renderGate(`
      <h1>Đăng nhập</h1>
      <p class="muted">Dùng tài khoản Google, hoặc nhận link đăng nhập qua email đã đăng ký.</p>
      ${nutGoogle}
      <label for="em">Email</label>
      <input id="em" type="email" autocomplete="email" placeholder="ten@gmail.com">
      <button class="btn chinh" id="send">Gửi link đăng nhập</button>
      <p class="muted" id="msg"></p>
      <button class="btn chu" id="back">← Quay lại</button>`);
    $("#back").onclick = welcomeScreen;
    ganNutGoogle();
    $("#send").onclick = async () => {
      const email = $("#em").value.trim();
      if (!hopLe(email)) return ($("#msg").textContent = "Email chưa đúng định dạng.");
      $("#send").disabled = true;
      // shouldCreateUser: false → email lạ thì báo luôn, không âm thầm tạo tài khoản mới
      const { error } = await sb.auth.signInWithOtp({
        email, options: { emailRedirectTo: veTrang(), shouldCreateUser: false },
      });
      if (error && (error.code === "otp_disabled" || /signups not allowed/i.test(error.message))) {
        $("#msg").innerHTML = `Email này chưa có tài khoản. Bấm <b>Đăng ký</b> để xin quyền truy cập.`;
        $("#send").disabled = false;
        return;
      }
      $("#msg").textContent = error ? "Không gửi được: " + error.message
        : "Đã gửi. Mở email và bấm link — nên mở trên chính trình duyệt này.";
      $("#send").disabled = false;
    };
  }

  function registerScreen() {
    renderGate(`
      <h1>Đăng ký</h1>
      <p class="muted">Ghi tên để quản trị viên biết bạn là ai, rồi chọn cách xác nhận.</p>
      <label for="nm">Tên của bạn</label>
      <input id="nm" value="${esc(layTen())}" placeholder="Ví dụ: Anh Tâm — kỹ thuật">
      ${nutGoogle}
      <label for="em">Email</label>
      <input id="em" type="email" autocomplete="email" placeholder="ten@gmail.com">
      <button class="btn chinh" id="send">Gửi yêu cầu</button>
      <p class="muted" id="msg"></p>
      <button class="btn chu" id="back">← Quay lại</button>`);
    $("#back").onclick = welcomeScreen;
    ganNutGoogle();
    // Bấm Google cũng phải nhớ tên đã gõ, để sau khi quay về thì tự gửi yêu cầu duyệt
    $("#nm").oninput = (e) => nhoTen(e.target.value.trim());
    $("#send").onclick = async () => {
      const name = $("#nm").value.trim();
      const email = $("#em").value.trim();
      if (!name) return ($("#msg").textContent = "Ghi tên trước đã.");
      if (!hopLe(email)) return ($("#msg").textContent = "Email chưa đúng định dạng.");
      $("#send").disabled = true;
      nhoTen(name);
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: veTrang() } });
      $("#msg").textContent = error ? "Không gửi được: " + error.message
        : "Đã gửi. Mở email và bấm link để xác nhận địa chỉ này là của bạn.";
      $("#send").disabled = false;
    };
  }

  async function pendingScreen(p) {
    const tenDaLuu = p.full_name || layTen();
    renderGate(`
      <h1>Đang chờ duyệt</h1>
      <p class="muted">Tài khoản <b>${esc(p.email)}</b> đã đăng ký. Quản trị viên duyệt xong là bạn dùng được.</p>
      <label for="nm">Tên của bạn (để quản trị viên nhận ra)</label>
      <input id="nm" value="${esc(tenDaLuu)}" placeholder="Ví dụ: Anh Tâm — kỹ thuật">
      <button class="btn chinh" id="req">Gửi yêu cầu duyệt</button>
      <button class="btn chu" id="out">Đăng xuất</button>
      <p class="muted" id="msg"></p>`);
    $("#out").onclick = () => { nhoTen(""); sb.auth.signOut().then(() => location.reload()); };

    const guiYeuCau = async (name) => {
      $("#req").disabled = true;
      await sb.rpc("set_my_name", { p_name: name });
      const { error } = await sb.functions.invoke("request-access");
      $("#msg").textContent = error
        ? "Chưa báo được quản trị viên, bấm lại sau ít phút."
        : "Đã báo quản trị viên. Được duyệt rồi thì tải lại trang này là vào.";
      $("#req").disabled = false;
    };
    $("#req").onclick = () => {
      const name = $("#nm").value.trim();
      if (!name) return ($("#msg").textContent = "Ghi tên trước khi gửi.");
      guiYeuCau(name);
    };
    // Đã khai tên ở bước Đăng ký → tự gửi luôn, người dùng không phải bấm thêm
    if (!p.full_name && layTen()) { nhoTen(""); await guiYeuCau(tenDaLuu); }
  }

  async function gate(onReady) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return welcomeScreen();
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
