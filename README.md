# Gembok Bill - Sistem Manajemen ISP Terintegrasi

[![GitHub stars](https://img.shields.io/github/stars/alijayanet/gembok-bill)](https://github.com/alijayanet/gembok-bill/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/alijayanet/gembok-bill)](https://github.com/alijayanet/gembok-bill/network)
[![GitHub issues](https://img.shields.io/github/issues/alijayanet/gembok-bill)](https://github.com/alijayanet/gembok-bill/issues)
[![GitHub license](https://img.shields.io/github/license/alijayanet/gembok-bill)](https://github.com/alijayanet/gembok-bill/blob/main/LICENSE)

## 📋 Deskripsi Aplikasi

**Gembok Bill** adalah sistem manajemen ISP terintegrasi yang menggabungkan WhatsApp Gateway dengan portal admin web untuk mengelola layanan internet secara komprehensif. Aplikasi ini dirancang khusus untuk ISP (Internet Service Provider) yang membutuhkan solusi all-in-one untuk manajemen pelanggan, billing, monitoring, dan notifikasi.

### 🎯 Fitur Utama

- **🔧 WhatsApp Bot Gateway** - Interface perintah via WhatsApp
- **🌐 Web Portal Admin** - Dashboard admin yang lengkap
- **💳 Sistem Billing Terintegrasi** - Manajemen tagihan dan pembayaran
- **💳 Payment Gateway** - Integrasi Midtrans, Xendit, Tripay
- **📊 GenieACS Management** - Monitoring dan manajemen perangkat ONU/ONT
- **🛠️ Mikrotik Management** - Manajemen PPPoE dan Hotspot
- **📱 Portal Pelanggan** - Self-service untuk pelanggan
- **📈 Monitoring Real-time** - PPPoE, RX Power, dan sistem
- **🔔 Notifikasi Otomatis** - WhatsApp notifications
- **📋 Trouble Ticket System** - Manajemen gangguan

---

## 🚀 Instalasi

### Persyaratan Sistem

- **Node.js** v18+ (direkomendasikan v20+)
- **npm** atau yarn
- **GenieACS** API access
- **Mikrotik** API access
- **WhatsApp** number untuk bot
- **Database SQLite** (built-in)

### 1. Clone Repository

```bash
# Install git jika belum ada
apt install git curl -y

# Clone repository
git clone https://github.com/alijayanet/gembok-bill
cd gembok-bill
```

### 2. Install Dependencies

```bash
# Install semua dependencies
npm install
```

### 3. Konfigurasi Settings

Edit file `settings.json` dengan pengaturan yang sesuai:

```json
{
  "admins.0": "6281947215703",
  "admin_enabled": "true",
  "admin_username": "admin",
  "admin_password": "admin",
  "genieacs_url": "http://192.168.8.89:7557",
  "genieacs_username": "admin",
  "genieacs_password": "admin",
  "mikrotik_host": "192.168.8.1",
  "mikrotik_port": "8728",
  "mikrotik_user": "admin",
  "mikrotik_password": "admin",
  "main_interface": "ether1-ISP",
  "pppoe_monitor_enable": "true",
  "technician_numbers.0": "6283807665111",
  "technician_numbers.1": "6282218094111",
  "technician_group_id": "120363029715729111@g.us",
  "whatsapp_session_path": "./whatsapp-session",
  "whatsapp_keep_alive": "true",
  "whatsapp_restart_on_error": "true",
  "whatsapp_log_level": "silent",
  "pppoe_monitor_interval": "60000",
  "rx_power_warning": "-40",
  "rx_power_critical": "-45",
  "rx_power_notification_enable": "true",
  "rx_power_notification_interval": "300000",
  "company_header": "🏢 ALIJAYA DIGITAL NETWORK 🏢",
  "footer_info": "Juragan Pulsa Wifi Hotspot",
  "customerPortalOtp": "false",
  "otp_length": "4",
  "otp_expiry_minutes": "5",
  "server_port": "3003",
  "server_host": "localhost",
  "pppoe_notifications.enabled": "true",
  "pppoe_notifications.loginNotifications": "true",
  "pppoe_notifications.logoutNotifications": "true",
  "pppoe_notifications.includeOfflineList": "true",
  "pppoe_notifications.maxOfflineListCount": "20",
  "pppoe_notifications.monitorInterval": "60000",
  "secret_key": "alijaya-digital-network",
  "reconnect_interval": "5000",
  "log_level": "info",
  "logo_filename": "logo.png",
  "payment_gateway": {
    "active": "midtrans",
    "midtrans": {
      "enabled": true,
      "production": false,
      "merchant_id": "G123456789",
      "client_key": "SB-Mid-client-123456789",
      "server_key": "SB-Mid-server-123456789"
    },
    "xendit": {
      "enabled": false,
      "production": false,
      "api_key": "xnd_public_development_123456789",
      "callback_token": "xnd_callback_token_123456789"
    },
    "tripay": {
      "enabled": false,
      "production": false,
      "api_key": "DEV-123456789",
      "private_key": "private_key_123456789",
      "merchant_code": "T12345"
    }
  },
  "payment_accounts": {
    "bank_transfer": {
      "bank_name": "Bank BRI",
      "account_number": "1234-5678-9012-3456",
      "account_name": "ALIJAYA DIGITAL NETWORK"
    },
    "cash": {
      "office_address": "Jl. Contoh No. 123, Kota, Provinsi",
      "office_hours": "08:00 - 17:00 WIB"
    }
  }
}
```

### 4. Setup Database

```bash
# Jalankan script untuk setup database billing
node scripts/add-payment-gateway-tables.js
```

### 5. Menjalankan Aplikasi

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

**Dengan PM2:**
```bash
# Install PM2 jika belum ada
npm install -g pm2

# Start aplikasi
pm2 start app.js --name gembok-bill

# Monitor aplikasi
pm2 monit

# View logs
pm2 logs gembok-bill
```

### 6. Setup WhatsApp Bot

1. **Siapkan 2 nomor WhatsApp:**
   - 1 nomor untuk bot (akan scan QR code)
   - 1 nomor untuk admin (untuk mengirim perintah)

2. **Scan QR Code** yang muncul di terminal untuk login WhatsApp bot

3. **Test dengan perintah**: `status` atau `menu`

---

## 🌐 Akses Web Portal

- **Portal Pelanggan**: `http://ipserver:3003`
- **Admin Dashboard**: `http://ipserver:3003/admin/login`
- **Login Admin**: Username dan password yang dikonfigurasi di `settings.json`

---

## 💳 Sistem Billing

### Fitur Billing

- **📊 Dashboard Billing** - Statistik real-time
- **👥 Manajemen Pelanggan** - CRUD pelanggan dengan PPPoE username
- **📦 Manajemen Paket** - Paket internet dengan harga
- **📄 Manajemen Invoice** - Buat, edit, hapus tagihan
- **💰 Manajemen Pembayaran** - Tracking pembayaran
- **🔄 Auto Invoice** - Generate tagihan otomatis
- **💳 Payment Gateway** - Integrasi Midtrans, Xendit, Tripay
- **📱 WhatsApp Notifications** - Notifikasi tagihan dan pembayaran

### Payment Gateway

Aplikasi mendukung 3 payment gateway populer di Indonesia:

1. **Midtrans** - Payment gateway terpopuler
2. **Xendit** - Payment gateway enterprise
3. **Tripay** - Payment gateway lokal

**Setup Payment Gateway:**
1. Akses `/admin/billing/payment-settings`
2. Pilih gateway yang aktif
3. Masukkan API keys
4. Test koneksi
5. Aktifkan production mode

---

## 🔧 WhatsApp Bot Commands

### Perintah untuk Pelanggan
- `menu` - Menampilkan menu bantuan
- `status` - Cek status perangkat
- `refresh` - Refresh data perangkat
- `gantiwifi [nama]` - Ganti nama WiFi
- `gantipass [password]` - Ganti password WiFi
- `info` - Informasi layanan
- `speedtest` - Test kecepatan internet

### Perintah untuk Admin

#### GenieACS Commands
- `devices` - Daftar perangkat
- `cekall` - Cek semua perangkat
- `cek [nomor]` - Cek status ONU
- `cekstatus [nomor]` - Cek status pelanggan
- `admincheck [nomor]` - Cek perangkat admin
- `gantissid [nomor] [ssid]` - Ubah SSID
- `gantipass [nomor] [pass]` - Ubah password
- `reboot [nomor]` - Restart ONU
- `factory reset [nomor]` - Reset factory
- `refresh` - Refresh data perangkat
- `tag [nomor] [tag]` - Tambah tag pelanggan
- `untag [nomor] [tag]` - Hapus tag
- `tags [nomor]` - Lihat tags
- `addtag [device_id] [nomor]` - Tambah tag perangkat
- `addppoe_tag [pppoe_id] [nomor]` - Tambah tag dengan id pppoe
- `adminssid [nomor] [ssid]` - Admin ubah SSID
- `adminrestart [nomor]` - Admin restart ONU
- `adminfactory [nomor]` - Admin factory reset
- `confirm admin factory reset [nomor]` - Konfirmasi factory reset

#### Mikrotik Commands
- `interfaces` - Daftar interface
- `interface [nama]` - Detail interface
- `enableif [nama]` - Aktifkan interface
- `disableif [nama]` - Nonaktifkan interface
- `ipaddress` - Alamat IP
- `routes` - Tabel routing
- `dhcp` - DHCP leases
- `ping [ip] [count]` - Test ping
- `logs [topics] [count]` - Log Mikrotik
- `firewall [chain]` - Status firewall
- `users` - Daftar semua user
- `profiles [type]` - Daftar profile
- `identity [nama]` - Info router
- `clock` - Waktu router
- `resource` - Info resource
- `reboot` - Restart router
- `confirm restart` - Konfirmasi restart

#### Hotspot & PPPoE Management
- `vcr [user] [profile] [nomor]` - Buat voucher
- `hotspot` - User hotspot aktif
- `pppoe` - User PPPoE aktif
- `offline` - User PPPoE offline
- `addhotspot [user] [pass] [profile]` - Tambah user
- `addpppoe [user] [pass] [profile] [ip]` - Tambah PPPoE
- `setprofile [user] [profile]` - Ubah profile
- `delhotspot [username]` - Hapus user hotspot
- `delpppoe [username]` - Hapus user PPPoE
- `addpppoe_tag [user] [nomor]` - Tambah tag PPPoE
- `member [username] [profile] [nomor]` - Tambah member
- `list` - Daftar semua user
- `remove [username]` - Hapus user (generic)
- `addadmin [nomor]` - Tambah nomor admin
- `removeadmin [nomor]` - Hapus nomor admin

#### Sistem & Admin
- `otp [nomor]` - Kirim OTP
- `status` - Status sistem
- `logs` - Log aplikasi
- `restart` - Restart aplikasi
- `debug resource` - Debug resource
- `checkgroup` - Cek status group
- `setadmin [nomor]` - Set nomor admin
- `settechnician [nomor]` - Set nomor teknisi
- `setheader [teks]` - Set header pesan
- `setfooter [teks]` - Set footer pesan
- `setgenieacs [url] [user] [pass]` - Set GenieACS
- `setmikrotik [host] [port] [user] [pass]` - Set Mikrotik
- `admin` - Menu admin
- `help` - Bantuan perintah
- `ya/iya/yes` - Konfirmasi ya
- `tidak/no/batal` - Konfirmasi tidak
- `addwan [interface]` - Tambah WAN

#### WiFi & Layanan
- `info wifi` - Info WiFi pelanggan
- `info` - Info layanan
- `gantiwifi [ssid]` - Ganti nama WiFi
- `gantipass [password]` - Ganti password WiFi
- `speedtest` - Test kecepatan
- `diagnostic` - Diagnostik perangkat
- `history` - Riwayat perangkat
- `menu` - Menu utama
- `factory reset` - Reset factory (pelanggan)
- `confirm factory reset` - Konfirmasi factory reset

---

## 🛠️ Troubleshooting

### Masalah Group dan Nomor Teknisi

Jika ada error seperti:
```
Error sending message: Error: item-not-found
warn: Skipping invalid WhatsApp number: 6283807665111
```

**Solusi:**

1. **Jalankan Script Perbaikan Otomatis:**
   ```bash
   node scripts/fix-technician-config.js
   ```

2. **Cek Status Group:**
   - Kirim perintah WhatsApp: `checkgroup`
   - Akan menampilkan status group dan nomor teknisi

3. **Perbaiki Manual:**
   - Buka Admin Settings
   - Update nomor teknisi dengan format: `628xxxxxxxxxx`
   - Pastikan group ID berformat: `120363029715729111@g.us`
   - Tambahkan bot ke group teknisi

### Format Nomor yang Benar
- ✅ `628xxxxxxxxxx`
- ❌ `08xxxxxxxxxx`
- ❌ `+628xxxxxxxxxx`

### Format Group ID yang Benar
- ✅ `120363029715729111@g.us`
- ❌ `120363029715729111`
- ❌ `group-120363029715729111`

### Masalah Payment Gateway

1. **Invalid API Key:**
   - Pastikan API key benar dan aktif
   - Cek status akun di dashboard payment gateway
   - Test koneksi di `/admin/billing/payment-settings`

2. **Webhook Error:**
   - Pastikan URL webhook benar
   - Cek firewall dan port
   - Verifikasi signature di webhook handler

---

## 📁 Struktur Aplikasi

```
gembok-bill/
├── app.js                 # File utama aplikasi
├── package.json           # Dependencies dan scripts
├── settings.json          # Konfigurasi aplikasi
├── config/               # Modul konfigurasi
│   ├── whatsapp.js       # WhatsApp bot handler
│   ├── genieacs.js       # GenieACS API
│   ├── mikrotik.js       # Mikrotik API
│   ├── billing.js        # Billing system
│   ├── paymentGateway.js # Payment gateway manager
│   ├── logger.js         # Logging system
│   └── settingsManager.js # Settings management
├── routes/               # Express routes
│   ├── adminAuth.js      # Admin authentication
│   ├── adminDashboard.js # Dashboard routes
│   ├── adminBilling.js   # Billing management
│   ├── adminGenieacs.js  # GenieACS management
│   ├── adminMikrotik.js  # Mikrotik management
│   ├── adminHotspot.js   # Hotspot management
│   ├── adminSetting.js   # Settings management
│   ├── customerPortal.js # Customer portal
│   ├── payment.js        # Payment gateway routes
│   └── troubleReport.js  # Trouble ticket system
├── views/                # EJS templates
│   ├── admin/           # Admin views
│   │   ├── billing/     # Billing pages
│   │   └── ...
│   ├── customer/        # Customer views
│   └── partials/        # Shared components
├── public/               # Static files
│   ├── css/
│   ├── js/
│   └── img/
├── data/                 # Database files
├── logs/                 # Log files
├── scripts/              # Utility scripts
└── whatsapp-session/     # WhatsApp session files
```

---

## 🤝 Kontribusi

Untuk berkontribusi pada proyek ini:

1. Fork repository
2. Buat branch fitur baru (`git checkout -b feature/AmazingFeature`)
3. Commit perubahan (`git commit -m 'Add some AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Buat Pull Request

### Development Guidelines

- Gunakan ESLint untuk code formatting
- Tulis unit tests untuk fitur baru
- Update dokumentasi untuk perubahan
- Ikuti conventional commits

---

## 📄 Lisensi

Distributed under the ISC License. See `LICENSE` for more information.

---

## 🆘 Support

- **📱 Telegram Group**: [https://t.me/alijayaNetAcs](https://t.me/alijayaNetAcs)
- **📢 Telegram Channel**: [https://t.me/alijayaNetwork](https://t.me/alijayaNetwork)
- **📺 YouTube**: [https://www.youtube.com/shorts/qYJFQY7egFw](https://www.youtube.com/shorts/qYJFQY7egFw)
- **💬 Issues**: [GitHub Issues](https://github.com/alijayanet/gembok-bill/issues)

---

## 🙏 Donasi

Rekening Donasi Untuk Pembangunan Masjid:
- **Bank**: BRI
- **No. Rekening**: 4206 01 003953 531
- **Atas Nama**: WARJAYA
- **Info**: 08194215703 ALIJAYA

---

## ⚠️ Disclaimer

**Jangan lupa untuk mengkonfigurasi file `settings.json` terlebih dahulu sebelum menjalankan aplikasi!**

Aplikasi ini dikembangkan untuk keperluan ISP dan membutuhkan konfigurasi yang tepat untuk berfungsi dengan baik. Pastikan semua kredensial API dan pengaturan sudah benar sebelum deployment ke production.

---

**Made with ❤️ by [Ali Jaya](https://github.com/alijayanet)**
