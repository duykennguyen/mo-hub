// CẤU HÌNH MÔ HUB — điền 2 giá trị từ Supabase > Project Settings > API.
// Anon key được phép công khai: dữ liệu đã khóa bằng phân quyền (RLS) trong database.
// TUYỆT ĐỐI không dán service_role key vào đây.
window.MO_CONFIG = {
  SUPABASE_URL: "https://ggxgwbfrmndqslgprcpt.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_m091X2O-FEBQbb_M_TxD2w_jVPw4rHV",
  PUBLIC_SITES: [
    { name: "Mô House", url: "https://duykennguyen.github.io/mo-house/", note: "Danh mục nhà cho thuê — gửi khách, môi giới" },
    { name: "Mô Bedding", url: "https://duykennguyen.github.io/mo-bedding/", note: "Chăn ga gối eco — catalog cho khách" },
  ],
};
