const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const multer = require('multer');
const { getSettingsWithCache } = require('../config/settingsManager');
const logger = require('../config/logger');

// Konfigurasi penyimpanan file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/img'));
    },
    filename: function (req, file, cb) {
        // Selalu gunakan nama 'logo' dengan ekstensi file asli
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'logo' + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB
    },
    fileFilter: function (req, file, cb) {
        // Hanya izinkan file gambar dan SVG
        if (file.mimetype.startsWith('image/') || file.originalname.toLowerCase().endsWith('.svg')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan'), false);
        }
    }
});

const settingsPath = path.join(__dirname, '../settings.json');

// GET: Render halaman Setting
router.get('/', (req, res) => {
    const settings = getSettingsWithCache();
    res.render('adminSetting', { settings });
});

// GET: Ambil semua setting
router.get('/data', (req, res) => {
    fs.readFile(settingsPath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Gagal membaca settings.json' });
        try {
            res.json(JSON.parse(data));
        } catch (e) {
            res.status(500).json({ error: 'Format settings.json tidak valid' });
        }
    });
});

// POST: Simpan perubahan setting
router.post('/save', (req, res) => {
    try {
        const newSettings = req.body;
        
        // Validasi input
        if (!newSettings || typeof newSettings !== 'object') {
            return res.status(400).json({ 
                success: false, 
                error: 'Data pengaturan tidak valid' 
            });
        }

        // Baca settings lama
        let oldSettings = {};
        try {
            const settingsData = fs.readFileSync(settingsPath, 'utf8');
            oldSettings = JSON.parse(settingsData);
        } catch (e) {
            console.warn('Gagal membaca settings.json lama, menggunakan default:', e.message);
            // Jika file tidak ada atau corrupt, gunakan default
            oldSettings = {
                user_auth_mode: 'mikrotik',
                logo_filename: 'logo.png'
            };
        }

        // Merge: field baru overwrite field lama, field lama yang tidak ada di form tetap dipertahankan
        const mergedSettings = { ...oldSettings, ...newSettings };
        
        // Pastikan user_auth_mode selalu ada
        if (!('user_auth_mode' in mergedSettings)) {
            mergedSettings.user_auth_mode = 'mikrotik';
        }

        // Validasi dan sanitasi data sebelum simpan
        const sanitizedSettings = {};
        for (const [key, value] of Object.entries(mergedSettings)) {
            // Skip field yang tidak valid
            if (key === null || key === undefined || key === '') {
                continue;
            }
            
            // Konversi boolean string ke boolean
            if (typeof value === 'string') {
                if (value === 'true') {
                    sanitizedSettings[key] = true;
                } else if (value === 'false') {
                    sanitizedSettings[key] = false;
                } else {
                    sanitizedSettings[key] = value;
                }
            } else {
                sanitizedSettings[key] = value;
            }
        }

        // Tulis ke file dengan error handling yang proper
        fs.writeFile(settingsPath, JSON.stringify(sanitizedSettings, null, 2), 'utf8', (err) => {
            if (err) {
                console.error('Error menyimpan settings.json:', err);
                return res.status(500).json({ 
                    success: false,
                    error: 'Gagal menyimpan pengaturan: ' + err.message 
                });
            }

            // Cek field yang hilang (ada di oldSettings tapi tidak di mergedSettings)
            const oldKeys = Object.keys(oldSettings);
            const newKeys = Object.keys(sanitizedSettings);
            const missing = oldKeys.filter(k => !newKeys.includes(k));
            
            if (missing.length > 0) {
                console.warn('Field yang hilang dari settings.json setelah simpan:', missing);
            }

            // Log aktivitas
            console.log('Settings berhasil disimpan:', Object.keys(newSettings));

            res.json({ 
                success: true, 
                message: 'Pengaturan berhasil disimpan',
                missingFields: missing 
            });
        });

    } catch (error) {
        console.error('Error dalam route /save:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Terjadi kesalahan saat menyimpan pengaturan: ' + error.message 
        });
    }
});

// POST: Upload Logo
router.post('/upload-logo', upload.single('logo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tidak ada file yang diupload' 
            });
        }

        // Dapatkan nama file yang sudah disimpan (akan selalu 'logo' + ekstensi)
        const filename = req.file.filename;
        const filePath = req.file.path;

        // Verifikasi file berhasil disimpan
        if (!fs.existsSync(filePath)) {
            return res.status(500).json({ 
                success: false, 
                error: 'File gagal disimpan' 
            });
        }

        // Baca settings.json
        let settings = {};
        
        try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (err) {
            console.error('Gagal membaca settings.json:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Gagal membaca pengaturan' 
            });
        }

        // Hapus file logo lama jika ada
        if (settings.logo_filename && settings.logo_filename !== filename) {
            const oldLogoPath = path.join(__dirname, '../public/img', settings.logo_filename);
            if (fs.existsSync(oldLogoPath)) {
                try {
                    fs.unlinkSync(oldLogoPath);
                    console.log('Logo lama dihapus:', oldLogoPath);
                } catch (err) {
                    console.error('Gagal menghapus logo lama:', err);
                    // Lanjutkan meskipun gagal hapus file lama
                }
            }
        }

        // Update settings.json
        settings.logo_filename = filename;
        
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            console.log('Settings.json berhasil diupdate dengan logo baru:', filename);
        } catch (err) {
            console.error('Gagal menyimpan settings.json:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Gagal menyimpan pengaturan' 
            });
        }

        res.json({ 
            success: true, 
            filename: filename,
            message: 'Logo berhasil diupload dan disimpan'
        });

    } catch (error) {
        console.error('Error saat upload logo:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Terjadi kesalahan saat mengupload logo: ' + error.message 
        });
    }
});

// Error handler untuk multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                success: false, 
                error: 'Ukuran file terlalu besar. Maksimal 2MB.' 
            });
        }
        return res.status(400).json({ 
            success: false, 
            error: 'Error upload file: ' + error.message 
        });
    }
    
    if (error) {
        return res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
    
    next();
});

// GET: Status WhatsApp
router.get('/wa-status', async (req, res) => {
    try {
        const { getWhatsAppStatus } = require('../config/whatsapp');
        const status = getWhatsAppStatus();
        
        // Pastikan QR code dalam format yang benar
        let qrCode = null;
        if (status.qrCode) {
            qrCode = status.qrCode;
        } else if (status.qr) {
            qrCode = status.qr;
        }
        
        res.json({
            connected: status.connected || false,
            qr: qrCode,
            phoneNumber: status.phoneNumber || null,
            status: status.status || 'disconnected',
            connectedSince: status.connectedSince || null
        });
    } catch (e) {
        console.error('Error getting WhatsApp status:', e);
        res.status(500).json({ 
            connected: false, 
            qr: null, 
            error: e.message 
        });
    }
});

// POST: Refresh QR WhatsApp
router.post('/wa-refresh', async (req, res) => {
    try {
        const { deleteWhatsAppSession } = require('../config/whatsapp');
        await deleteWhatsAppSession();
        
        // Tunggu sebentar sebelum memeriksa status baru
        setTimeout(() => {
            res.json({ success: true, message: 'Sesi WhatsApp telah direset. Silakan pindai QR code baru.' });
        }, 1000);
    } catch (e) {
        console.error('Error refreshing WhatsApp session:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// POST: Hapus sesi WhatsApp
router.post('/wa-delete', async (req, res) => {
    try {
        const { deleteWhatsAppSession } = require('../config/whatsapp');
        await deleteWhatsAppSession();
        res.json({ 
            success: true, 
            message: 'Sesi WhatsApp telah dihapus. Silakan pindai QR code baru untuk terhubung kembali.' 
        });
    } catch (e) {
        console.error('Error deleting WhatsApp session:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// Backup database
router.post('/backup', async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const backupPath = path.join(__dirname, '../data/backup');
        
        // Buat direktori backup jika belum ada
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupPath, `billing_backup_${timestamp}.db`);
        
        // Copy database file
        fs.copyFileSync(dbPath, backupFile);
        
        logger.info(`Database backup created: ${backupFile}`);
        
        res.json({
            success: true,
            message: 'Database backup berhasil dibuat',
            backup_file: path.basename(backupFile)
        });
    } catch (error) {
        logger.error('Error creating backup:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating backup',
            error: error.message
        });
    }
});

// Restore database
router.post('/restore', upload.single('backup_file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'File backup tidak ditemukan'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const backupPath = path.join(__dirname, '../data/backup', req.file.filename);
        
        // Backup database saat ini sebelum restore
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const currentBackup = path.join(__dirname, '../data/backup', `pre_restore_${timestamp}.db`);
        fs.copyFileSync(dbPath, currentBackup);
        
        // Restore database
        fs.copyFileSync(backupPath, dbPath);
        
        logger.info(`Database restored from: ${req.file.filename}`);
        
        res.json({
            success: true,
            message: 'Database berhasil di-restore',
            restored_file: req.file.filename
        });
    } catch (error) {
        logger.error('Error restoring database:', error);
        res.status(500).json({
            success: false,
            message: 'Error restoring database',
            error: error.message
        });
    }
});

// Get backup files list
router.get('/backups', async (req, res) => {
    try {
        const backupPath = path.join(__dirname, '../data/backup');
        
        if (!fs.existsSync(backupPath)) {
            return res.json({
                success: true,
                backups: []
            });
        }
        
        const files = fs.readdirSync(backupPath)
            .filter(file => file.endsWith('.db'))
            .map(file => {
                const filePath = path.join(backupPath, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: stats.size,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({
            success: true,
            backups: files
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error getting backup files',
            error: error.message
        });
    }
});

// Get activity logs - Temporarily disabled due to logger refactoring
router.get('/activity-logs', async (req, res) => {
    res.status(501).json({
        success: false,
        message: 'Activity logs feature temporarily disabled'
    });
});

// Clear old activity logs - Temporarily disabled due to logger refactoring
router.post('/clear-logs', async (req, res) => {
    res.status(501).json({
        success: false,
        message: 'Clear logs feature temporarily disabled'
    });
});

// GET: Test endpoint untuk upload logo (tanpa auth)
router.get('/test-upload', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Upload Logo</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .form-group { margin: 10px 0; }
                input[type="file"] { margin: 10px 0; }
                button { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
                .result { margin: 10px 0; padding: 10px; border-radius: 5px; }
                .success { background: #d4edda; color: #155724; }
                .error { background: #f8d7da; color: #721c24; }
            </style>
        </head>
        <body>
            <h2>Test Upload Logo</h2>
            <form id="uploadForm" enctype="multipart/form-data">
                <div class="form-group">
                    <label>Pilih file logo:</label><br>
                    <input type="file" name="logo" accept="image/*,.svg" required>
                </div>
                <button type="submit">Upload Logo</button>
            </form>
            <div id="result"></div>
            
            <script>
                document.getElementById('uploadForm').addEventListener('submit', function(e) {
                    e.preventDefault();
                    
                    const formData = new FormData(this);
                    const resultDiv = document.getElementById('result');
                    
                    fetch('/admin/setting/upload-logo', {
                        method: 'POST',
                        body: formData
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            resultDiv.innerHTML = '<div class="result success">✓ ' + data.message + '</div>';
                        } else {
                            resultDiv.innerHTML = '<div class="result error">✗ ' + data.error + '</div>';
                        }
                    })
                    .catch(error => {
                        resultDiv.innerHTML = '<div class="result error">✗ Error: ' + error.message + '</div>';
                    });
                });
            </script>
        </body>
        </html>
    `);
});

// GET: Test endpoint untuk upload SVG (tanpa auth)
router.get('/test-svg', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const testHtmlPath = path.join(__dirname, '../test-svg-upload.html');
    
    if (fs.existsSync(testHtmlPath)) {
        res.sendFile(testHtmlPath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Test SVG Upload</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .form-group { margin: 10px 0; }
                    input[type="file"] { margin: 10px 0; }
                    button { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
                    .result { margin: 10px 0; padding: 10px; border-radius: 5px; }
                    .success { background: #d4edda; color: #155724; }
                    .error { background: #f8d7da; color: #721c24; }
                </style>
            </head>
            <body>
                <h2>Test SVG Upload</h2>
                <form id="uploadForm" enctype="multipart/form-data">
                    <div class="form-group">
                        <label>Pilih file SVG:</label><br>
                        <input type="file" name="logo" accept=".svg" required>
                    </div>
                    <button type="submit">Upload SVG Logo</button>
                </form>
                <div id="result"></div>
                
                <script>
                    document.getElementById('uploadForm').addEventListener('submit', function(e) {
                        e.preventDefault();
                        
                        const formData = new FormData(this);
                        const resultDiv = document.getElementById('result');
                        
                        fetch('/admin/setting/upload-logo', {
                            method: 'POST',
                            body: formData
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                resultDiv.innerHTML = '<div class="result success">✓ ' + data.message + '</div>';
                            } else {
                                resultDiv.innerHTML = '<div class="result error">✗ ' + data.error + '</div>';
                            }
                        })
                        .catch(error => {
                            resultDiv.innerHTML = '<div class="result error">✗ Error: ' + error.message + '</div>';
                        });
                    });
                </script>
            </body>
            </html>
        `);
    }
});

// GET: Halaman test notifikasi pembayaran
router.get('/test-payment-notification', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Notifikasi Pembayaran</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h2 { color: #333; text-align: center; margin-bottom: 30px; }
                .form-group { margin: 20px 0; }
                label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
                input[type="text"], input[type="number"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; box-sizing: border-box; }
                button { width: 100%; padding: 15px; background: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; margin-top: 20px; }
                button:hover { background: #0056b3; }
                .result { margin: 20px 0; padding: 15px; border-radius: 5px; font-weight: bold; }
                .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
                .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
                .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🧪 Test Notifikasi Pembayaran WhatsApp</h2>
                <div class="info">
                    <strong>Info:</strong> Halaman ini untuk testing apakah notifikasi pembayaran berhasil dikirim ke pelanggan via WhatsApp.
                </div>
                
                <form id="testForm">
                    <div class="form-group">
                        <label>Nomor WhatsApp Pelanggan:</label>
                        <input type="text" name="customer_phone" placeholder="6281234567890" required>
                    </div>
                    
                    <div class="form-group">
                        <label>Nama Pelanggan:</label>
                        <input type="text" name="customer_name" placeholder="Nama Lengkap" required>
                    </div>
                    
                    <div class="form-group">
                        <label>Nomor Tagihan:</label>
                        <input type="text" name="invoice_number" placeholder="INV-2024-001" required>
                    </div>
                    
                    <div class="form-group">
                        <label>Jumlah Pembayaran:</label>
                        <input type="number" name="amount" placeholder="50000" required>
                    </div>
                    
                    <button type="submit">📱 Kirim Test Notifikasi</button>
                </form>
                
                <div id="result"></div>
            </div>
            
            <script>
                document.getElementById('testForm').addEventListener('submit', function(e) {
                    e.preventDefault();
                    
                    const formData = new FormData(this);
                    const resultDiv = document.getElementById('result');
                    const submitBtn = document.querySelector('button[type="submit"]');
                    
                    // Disable button dan show loading
                    submitBtn.disabled = true;
                    submitBtn.textContent = '⏳ Mengirim...';
                    resultDiv.innerHTML = '<div class="info">⏳ Mengirim notifikasi test...</div>';
                    
                    // Convert FormData to JSON
                    const data = {};
                    formData.forEach((value, key) => data[key] = value);
                    
                    fetch('/admin/setting/test-payment-notification', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            resultDiv.innerHTML = '<div class="success">✅ ' + data.message + '</div>';
                        } else {
                            resultDiv.innerHTML = '<div class="error">❌ ' + data.message + '</div>';
                        }
                    })
                    .catch(error => {
                        resultDiv.innerHTML = '<div class="error">❌ Error: ' + error.message + '</div>';
                    })
                    .finally(() => {
                        // Re-enable button
                        submitBtn.disabled = false;
                        submitBtn.textContent = '📱 Kirim Test Notifikasi';
                    });
                });
            </script>
        </body>
        </html>
    `);
});

// POST: Test notifikasi pembayaran
router.post('/test-payment-notification', async (req, res) => {
    try {
        const { customer_phone, customer_name, invoice_number, amount } = req.body;
        
        if (!customer_phone || !customer_name || !invoice_number || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi: customer_phone, customer_name, invoice_number, amount'
            });
        }

        // Simulasi data customer dan invoice untuk testing
        const mockCustomer = {
            name: customer_name,
            phone: customer_phone
        };
        
        const mockInvoice = {
            invoice_number: invoice_number,
            amount: parseFloat(amount)
        };

        // Import billing manager untuk testing notifikasi
        const billingManager = require('../config/billing');
        
        // Test kirim notifikasi
        await billingManager.sendPaymentSuccessNotification(mockCustomer, mockInvoice);
        
        res.json({
            success: true,
            message: `Notifikasi pembayaran berhasil dikirim ke ${customer_phone}`,
            data: {
                customer: mockCustomer,
                invoice: mockInvoice
            }
        });
        
    } catch (error) {
        logger.error('Error testing payment notification:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengirim notifikasi test',
            error: error.message
        });
    }
});





module.exports = router;
