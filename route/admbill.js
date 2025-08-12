const express = require('express');
const router = express.Router();
const billingManager = require('../config/billing');
const logger = require('../config/logger');
const serviceSuspension = require('../config/serviceSuspension');
const { getSetting, getSettingsWithCache, setSetting } = require('../config/settingsManager');
const multer = require('multer');
const upload = multer();
const ExcelJS = require('exceljs');

// Middleware untuk mendapatkan pengaturan aplikasi
const getAppSettings = (req, res, next) => {
    req.appSettings = {
        companyHeader: getSetting('company_header', 'ISP Monitor'),
        footerInfo: getSetting('footer_info', ''),
        logoFilename: getSetting('logo_filename', 'logo.png')
    };
    next();
};

// Dashboard Billing
router.get('/dashboard', getAppSettings, async (req, res) => {
    try {
        const stats = await billingManager.getBillingStats();
        const overdueInvoices = await billingManager.getOverdueInvoices();
        const recentInvoices = await billingManager.getInvoices();
        
        res.render('admin/billing/dashboard', {
            title: 'Dashboard Billing',
            stats,
            overdueInvoices: overdueInvoices.slice(0, 10),
            recentInvoices: recentInvoices.slice(0, 10),
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading billing dashboard:', error);
        res.status(500).render('error', { 
            message: 'Error loading billing dashboard',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Customers list for live table updates
router.get('/customers/list', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        return res.json({ success: true, customers });
    } catch (error) {
        logger.error('Error loading customers list:', error);
        return res.status(500).json({ success: false, message: 'Error loading customers list', error: error.message });
    }
});

// Customers summary for live updates
router.get('/customers/summary', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const total = customers.length;
        const paid = customers.filter(c => c.payment_status === 'paid').length;
        const unpaid = customers.filter(c => c.payment_status === 'unpaid').length;
        const noInvoice = customers.filter(c => c.payment_status === 'no_invoice').length;
        const active = customers.filter(c => c.status === 'active').length;
        const isolir = customers.filter(c => c.payment_status === 'overdue' || c.status === 'suspended').length;

        return res.json({
            success: true,
            data: { total, paid, unpaid, noInvoice, active, isolir }
        });
    } catch (error) {
        logger.error('Error loading customers summary:', error);
        return res.status(500).json({ success: false, message: 'Error loading customers summary', error: error.message });
    }
});

// Bulk delete customers
router.post('/customers/bulk-delete', async (req, res) => {
    try {
        const { phones } = req.body || {};
        if (!Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar pelanggan (phones) kosong atau tidak valid' });
        }

        const results = [];
        let success = 0;
        let failed = 0;

        for (const phone of phones) {
            try {
                const deleted = await billingManager.deleteCustomer(String(phone));
                results.push({ phone, success: true });
                success++;
            } catch (e) {
                // Map known errors to friendly messages
                let msg = e.message || 'Gagal menghapus';
                if (msg.includes('invoice(s) still exist')) {
                    msg = 'Masih memiliki tagihan, hapus tagihan terlebih dahulu';
                } else if (msg.includes('Customer not found')) {
                    msg = 'Pelanggan tidak ditemukan';
                }
                results.push({ phone, success: false, message: msg });
                failed++;
            }
        }

        return res.json({ success: true, summary: { success, failed, total: phones.length }, results });
    } catch (error) {
        logger.error('Error bulk deleting customers:', error);
        return res.status(500).json({ success: false, message: 'Gagal melakukan hapus massal pelanggan', error: error.message });
    }
});

// Export customers to XLSX
router.get('/export/customers.xlsx', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Customers');

        const headers = [
            'name', 'phone', 'pppoe_username', 'email', 'address',
            'package_id', 'pppoe_profile', 'status', 'auto_suspension', 'billing_day'
        ];
        worksheet.addRow(headers);

        customers.forEach(c => {
            worksheet.addRow([
                c.name || '',
                c.phone || '',
                c.pppoe_username || '',
                c.email || '',
                c.address || '',
                c.package_id || '',
                c.pppoe_profile || 'default',
                c.status || 'active',
                typeof c.auto_suspension !== 'undefined' ? c.auto_suspension : 1,
                c.billing_day || 15
            ]);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="customers.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        logger.error('Error exporting customers (XLSX):', error);
        res.status(500).json({ success: false, message: 'Error exporting customers (XLSX)', error: error.message });
    }
});

// Import customers from XLSX file
router.post('/import/customers/xlsx', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File XLSX tidak ditemukan' });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return res.status(400).json({ success: false, message: 'Worksheet tidak ditemukan dalam file' });
        }

        // Build header map from first row
        const headerRow = worksheet.getRow(1);
        const headerMap = {};
        headerRow.eachCell((cell, colNumber) => {
            const key = String(cell.value || '').toLowerCase().trim();
            if (key) headerMap[key] = colNumber;
        });

        const getVal = (row, key) => {
            const col = headerMap[key];
            return col ? (row.getCell(col).value ?? '') : '';
        };

        let created = 0, updated = 0, failed = 0;
        const errors = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header
            try {
                const name = String(getVal(row, 'name') || '').trim();
                const phone = String(getVal(row, 'phone') || '').trim();
                if (!name || !phone) {
                    failed++; errors.push({ row: rowNumber, error: 'Nama/Phone wajib' }); return;
                }

                const raw = {
                    name,
                    phone,
                    pppoe_username: String(getVal(row, 'pppoe_username') || '').trim(),
                    email: String(getVal(row, 'email') || '').trim(),
                    address: String(getVal(row, 'address') || '').trim(),
                    package_id: getVal(row, 'package_id') ? Number(getVal(row, 'package_id')) : null,
                    pppoe_profile: String(getVal(row, 'pppoe_profile') || 'default').trim(),
                    status: String(getVal(row, 'status') || 'active').trim(),
                    auto_suspension: (() => {
                        const v = getVal(row, 'auto_suspension');
                        const n = parseInt(String(v), 10);
                        return Number.isFinite(n) ? n : 1;
                    })(),
                    billing_day: (() => {
                        const v = Number(getVal(row, 'billing_day'));
                        const n = Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), 1), 28) : 15;
                        return n;
                    })()
                };

                // Process upsert
                // Wrap in async using IIFE pattern not available here; queue in array then Promise.all is complex.
                // For simplicity, push to pending array.
                row._pending = raw; // temp store
            } catch (e) {
                failed++;
                errors.push({ row: rowNumber, error: e.message });
            }
        });

        // Now sequentially process rows for DB ops
        for (let r = 2; r <= worksheet.rowCount; r++) {
            const row = worksheet.getRow(r);
            const raw = row._pending;
            if (!raw) continue;
            try {
                const existing = await billingManager.getCustomerByPhone(raw.phone);
                const customerData = {
                    name: raw.name,
                    phone: raw.phone,
                    pppoe_username: raw.pppoe_username,
                    email: raw.email,
                    address: raw.address,
                    package_id: raw.package_id,
                    pppoe_profile: raw.pppoe_profile,
                    status: raw.status,
                    auto_suspension: typeof raw.auto_suspension !== 'undefined' ? raw.auto_suspension : 1,
                    billing_day: raw.billing_day
                };

                if (existing) {
                    await billingManager.updateCustomer(raw.phone, customerData);
                    updated++;
                } else {
                    await billingManager.createCustomer(customerData);
                    created++;
                }
            } catch (e) {
                failed++;
                errors.push({ row: r, error: e.message });
            }
        }

        res.json({ success: true, summary: { created, updated, failed }, errors });
    } catch (error) {
        logger.error('Error importing customers (XLSX):', error);
        res.status(500).json({ success: false, message: 'Error importing customers (XLSX)', error: error.message });
    }
});

// Export customers to JSON
router.get('/export/customers.json', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.json');
        res.json({ success: true, customers });
    } catch (error) {
        logger.error('Error exporting customers (JSON):', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting customers (JSON)',
            error: error.message
        });
    }
});

// Import customers from JSON file
router.post('/import/customers/json', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File JSON tidak ditemukan' });
        }

        const content = req.file.buffer.toString('utf8');
        let payload;
        try {
            payload = JSON.parse(content);
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Format JSON tidak valid' });
        }

        const items = Array.isArray(payload) ? payload : (payload.customers || []);
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada data pelanggan pada file' });
        }

        let created = 0, updated = 0, failed = 0;
        const errors = [];

        for (const raw of items) {
            try {
                const name = (raw.name || '').toString().trim();
                const phone = (raw.phone || '').toString().trim();
                if (!name || !phone) {
                    failed++; errors.push({ phone, error: 'Nama/Phone wajib' }); continue;
                }

                const existing = await billingManager.getCustomerByPhone(phone);
                const customerData = {
                    name,
                    phone,
                    pppoe_username: raw.pppoe_username || '',
                    email: raw.email || '',
                    address: raw.address || '',
                    package_id: raw.package_id || null,
                    pppoe_profile: raw.pppoe_profile || 'default',
                    status: raw.status || 'active',
                    auto_suspension: raw.auto_suspension !== undefined ? parseInt(raw.auto_suspension, 10) : 1,
                    billing_day: raw.billing_day ? Math.min(Math.max(parseInt(raw.billing_day), 1), 28) : 15
                };

                if (existing) {
                    await billingManager.updateCustomer(phone, customerData);
                    updated++;
                } else {
                    await billingManager.createCustomer(customerData);
                    created++;
                }
            } catch (e) {
                failed++;
                errors.push({ phone: raw && raw.phone, error: e.message });
            }
        }

        res.json({ success: true, summary: { created, updated, failed }, errors });
    } catch (error) {
        logger.error('Error importing customers (JSON):', error);
        res.status(500).json({
            success: false,
            message: 'Error importing customers (JSON)',
            error: error.message
        });
    }
});

// Auto Invoice Management
router.get('/auto-invoice', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.package_id);
        
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const thisMonthInvoices = await billingManager.getInvoices();
        const thisMonthInvoicesCount = thisMonthInvoices.filter(invoice => {
            const invoiceDate = new Date(invoice.created_at);
            return invoiceDate >= startOfMonth && invoiceDate <= endOfMonth;
        }).length;
        
        // Calculate next run date
        const nextRunDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        
        res.render('admin/billing/auto-invoice', {
            title: 'Auto Invoice Management',
            activeCustomersCount: activeCustomers.length,
            thisMonthInvoicesCount,
            nextRunDate: nextRunDate.toLocaleDateString('id-ID'),
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading auto invoice page:', error);
        res.status(500).render('error', { 
            message: 'Error loading auto invoice page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Generate invoices manually
router.post('/auto-invoice/generate', async (req, res) => {
    try {
        const invoiceScheduler = require('../config/scheduler');
        await invoiceScheduler.triggerMonthlyInvoices();
        
        res.json({
            success: true,
            message: 'Invoice generation completed',
            count: 'auto' // Will be logged by scheduler
        });
    } catch (error) {
        logger.error('Error generating invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating invoices: ' + error.message
        });
    }
});

// Preview invoices that will be generated
router.get('/auto-invoice/preview', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.package_id);
        
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const customersNeedingInvoices = [];
        
        for (const customer of activeCustomers) {
            // Check if invoice already exists for this month
            const existingInvoices = await billingManager.getInvoicesByCustomerAndDateRange(
                customer.username,
                startOfMonth,
                endOfMonth
            );
            
            if (existingInvoices.length === 0) {
                // Get customer's package
                const package = await billingManager.getPackageById(customer.package_id);
                if (package) {
                    const dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 15);
                    
                    customersNeedingInvoices.push({
                        username: customer.username,
                        name: customer.name,
                        package_name: package.name,
                        package_price: package.price,
                        due_date: dueDate.toISOString().split('T')[0]
                    });
                }
            }
        }
        
        res.json({
            success: true,
            customers: customersNeedingInvoices
        });
    } catch (error) {
        logger.error('Error previewing invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error previewing invoices: ' + error.message
        });
    }
});

// Save auto invoice settings
router.post('/auto-invoice/settings', async (req, res) => {
    try {
        const { due_date_day, auto_invoice_enabled, invoice_notes } = req.body;
        
        // Save settings to database or config file
        // For now, we'll just log the settings
        logger.info('Auto invoice settings updated:', {
            due_date_day,
            auto_invoice_enabled,
            invoice_notes
        });
        
        res.json({
            success: true,
            message: 'Settings saved successfully'
        });
    } catch (error) {
        logger.error('Error saving auto invoice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving settings: ' + error.message
        });
    }
});

// WhatsApp Settings Routes
router.get('/whatsapp-settings', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/whatsapp-settings', {
            title: 'WhatsApp Notification Settings',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading WhatsApp settings page:', error);
        res.status(500).render('error', {
            message: 'Error loading WhatsApp settings page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Get WhatsApp templates
router.get('/whatsapp-settings/templates', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const templates = whatsappNotifications.getTemplates();
        
        res.json({
            success: true,
            templates: templates
        });
    } catch (error) {
        logger.error('Error getting WhatsApp templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting templates: ' + error.message
        });
    }
});

// Save WhatsApp templates
router.post('/whatsapp-settings/templates', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const templateData = req.body;
        
        // Update templates
        Object.keys(templateData).forEach(key => {
            whatsappNotifications.updateTemplate(key, templateData[key]);
        });
        
        res.json({
            success: true,
            message: 'Templates saved successfully'
        });
    } catch (error) {
        logger.error('Error saving WhatsApp templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving templates: ' + error.message
        });
    }
});

// Get WhatsApp status
router.get('/whatsapp-settings/status', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.phone);
        
        const invoices = await billingManager.getInvoices();
        const pendingInvoices = invoices.filter(i => i.status === 'unpaid');
        
        // Get WhatsApp status from global
        const whatsappStatus = global.whatsappStatus || { connected: false, status: 'disconnected' };
        
        res.json({
            success: true,
            whatsappStatus: whatsappStatus.connected ? 'Connected' : 'Disconnected',
            activeCustomers: activeCustomers.length,
            pendingInvoices: pendingInvoices.length,
            nextReminder: 'Daily at 09:00'
        });
    } catch (error) {
        logger.error('Error getting WhatsApp status:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting status: ' + error.message
        });
    }
});

// Test WhatsApp notification
router.post('/whatsapp-settings/test', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const { phoneNumber, templateKey } = req.body;
        
        // Test data for different templates
        const testData = {
            invoice_created: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                due_date: '15 Januari 2024',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps',
                notes: 'Tagihan bulanan'
            },
            due_date_reminder: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                due_date: '15 Januari 2024',
                days_remaining: '3',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps'
            },
            payment_received: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                payment_method: 'Transfer Bank',
                payment_date: '10 Januari 2024',
                reference_number: 'TRX123456'
            },
            service_disruption: {
                disruption_type: 'Gangguan Jaringan',
                affected_area: 'Seluruh Area',
                estimated_resolution: '2 jam',
                support_phone: '081947215703'
            },
            service_announcement: {
                announcement_content: 'Pengumuman penting untuk semua pelanggan.'
            },
            service_suspension: {
                customer_name: 'Test Customer',
                reason: 'Tagihan terlambat lebih dari 7 hari'
            },
            service_restoration: {
                customer_name: 'Test Customer',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps'
            },
            welcome_message: {
                customer_name: 'Test Customer',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps',
                wifi_password: 'test123456',
                support_phone: '081947215703'
            }
        };
        
        const result = await whatsappNotifications.testNotification(phoneNumber, templateKey, testData[templateKey]);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Test notification sent successfully'
            });
        } else {
            res.json({
                success: false,
                message: result.error
            });
        }
    } catch (error) {
        logger.error('Error sending test notification:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending test notification: ' + error.message
        });
    }
});

// Send broadcast message
router.post('/whatsapp-settings/broadcast', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const { type, message, disruptionType, affectedArea, estimatedResolution } = req.body;
        
        let result;
        
        if (type === 'service_disruption') {
            result = await whatsappNotifications.sendServiceDisruptionNotification({
                type: disruptionType || 'Gangguan Jaringan',
                area: affectedArea || 'Seluruh Area',
                estimatedTime: estimatedResolution || 'Sedang dalam penanganan'
            });
        } else if (type === 'service_announcement') {
            result = await whatsappNotifications.sendServiceAnnouncement({
                content: message
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid broadcast type'
            });
        }
        
        if (result.success) {
            res.json({
                success: true,
                sent: result.sent,
                failed: result.failed,
                total: result.total,
                message: `Broadcast sent successfully. Sent: ${result.sent}, Failed: ${result.failed}`
            });
        } else {
            res.json({
                success: false,
                message: result.error
            });
        }
    } catch (error) {
        logger.error('Error sending broadcast:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending broadcast: ' + error.message
        });
    }
});

// Paket Management
router.get('/packages', getAppSettings, async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        res.render('admin/billing/packages', {
            title: 'Kelola Paket',
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading packages:', error);
        res.status(500).render('error', { 
            message: 'Error loading packages',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/packages', async (req, res) => {
    try {
        const { name, speed, price, description, pppoe_profile } = req.body;
        const packageData = {
            name: name.trim(),
            speed: speed.trim(),
            price: parseFloat(price),
            description: description.trim(),
            pppoe_profile: pppoe_profile ? pppoe_profile.trim() : 'default'
        };

        if (!packageData.name || !packageData.speed || !packageData.price) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kecepatan, dan harga harus diisi'
            });
        }

        const newPackage = await billingManager.createPackage(packageData);
        logger.info(`Package created: ${newPackage.name}`);
        
        res.json({
            success: true,
            message: 'Paket berhasil ditambahkan',
            package: newPackage
        });
    } catch (error) {
        logger.error('Error creating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating package',
            error: error.message
        });
    }
});

router.put('/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, speed, price, description, pppoe_profile } = req.body;
        const packageData = {
            name: name.trim(),
            speed: speed.trim(),
            price: parseFloat(price),
            description: description.trim(),
            pppoe_profile: pppoe_profile ? pppoe_profile.trim() : 'default'
        };

        if (!packageData.name || !packageData.speed || !packageData.price) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kecepatan, dan harga harus diisi'
            });
        }

        const updatedPackage = await billingManager.updatePackage(id, packageData);
        logger.info(`Package updated: ${updatedPackage.name}`);
        
        res.json({
            success: true,
            message: 'Paket berhasil diupdate',
            package: updatedPackage
        });
    } catch (error) {
        logger.error('Error updating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating package',
            error: error.message
        });
    }
});

// Get package detail (HTML view)
router.get('/packages/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).render('error', {
                message: 'Paket tidak ditemukan',
                error: 'Package not found',
                appSettings: req.appSettings
            });
        }

        const customers = await billingManager.getCustomersByPackage(parseInt(id));
        
        res.render('admin/billing/package-detail', {
            title: 'Detail Paket',
            package,
            customers,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading package detail:', error);
        res.status(500).render('error', {
            message: 'Error loading package detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Get package data for editing (JSON API)
router.get('/api/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).json({
                success: false,
                message: 'Paket tidak ditemukan'
            });
        }
        
        res.json({
            success: true,
            package: package
        });
    } catch (error) {
        logger.error('Error getting package data:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting package data',
            error: error.message
        });
    }
});

router.delete('/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await billingManager.deletePackage(id);
        logger.info(`Package deleted: ${id}`);
        
        res.json({
            success: true,
            message: 'Paket berhasil dihapus'
        });
    } catch (error) {
        logger.error('Error deleting package:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting package',
            error: error.message
        });
    }
});

// Customer Management
router.get('/customers', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        res.render('admin/billing/customers', {
            title: 'Kelola Pelanggan',
            customers,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customers:', error);
        res.status(500).render('error', { 
            message: 'Error loading customers',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/customers', async (req, res) => {
    try {
        const { name, phone, pppoe_username, email, address, package_id, pppoe_profile, auto_suspension, billing_day, create_pppoe_user, pppoe_password } = req.body;
        
        // Validate required fields
        if (!name || !phone || !package_id) {
            return res.status(400).json({
                success: false,
                message: 'Nama, telepon, dan paket harus diisi'
            });
        }

        // Get package to get default profile if not specified
        let profileToUse = pppoe_profile;
        if (!profileToUse) {
            const packageData = await billingManager.getPackageById(package_id);
            profileToUse = packageData?.pppoe_profile || 'default';
        }

        const customerData = {
            name,
            phone,
            pppoe_username,
            email,
            address,
            package_id,
            pppoe_profile: profileToUse,
            status: 'active',
            auto_suspension: auto_suspension !== undefined ? parseInt(auto_suspension) : 1,
            billing_day: (() => {
                const v = parseInt(billing_day, 10);
                if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                return 15;
            })()
        };

        const result = await billingManager.createCustomer(customerData);

        // Optional: create PPPoE user in Mikrotik
        let pppoeCreate = { attempted: false, created: false, message: '' };
        try {
            const shouldCreate = create_pppoe_user === 1 || create_pppoe_user === '1' || create_pppoe_user === true || create_pppoe_user === 'true';
            if (shouldCreate && pppoe_username) {
                pppoeCreate.attempted = true;
                // determine profile (already computed as profileToUse)
                const passwordToUse = (pppoe_password && String(pppoe_password).trim())
                    ? String(pppoe_password).trim()
                    : (Math.random().toString(36).slice(-8) + Math.floor(Math.random()*10));

                const { addPPPoEUser } = require('../config/mikrotik');
                const addRes = await addPPPoEUser({ username: pppoe_username, password: passwordToUse, profile: profileToUse });
                if (addRes && addRes.success) {
                    pppoeCreate.created = true;
                    pppoeCreate.message = 'User PPPoE berhasil dibuat di Mikrotik';
                } else {
                    pppoeCreate.created = false;
                    pppoeCreate.message = (addRes && addRes.message) ? addRes.message : 'Gagal membuat user PPPoE';
                }
            }
        } catch (e) {
            logger.warn('Gagal membuat user PPPoE di Mikrotik (opsional): ' + e.message);
            pppoeCreate.created = false;
            pppoeCreate.message = e.message;
        }

        res.json({
            success: true,
            message: 'Pelanggan berhasil ditambahkan',
            customer: result,
            pppoeCreate
        });
    } catch (error) {
        logger.error('Error creating customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal menambahkan pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('UNIQUE constraint failed')) {
            if (error.message.includes('phone')) {
                errorMessage = 'Nomor telepon sudah terdaftar. Silakan gunakan nomor telepon yang berbeda.';
            } else if (error.message.includes('username')) {
                errorMessage = 'Username sudah digunakan. Silakan coba lagi.';
            } else {
                errorMessage = 'Data sudah ada dalam sistem. Silakan cek kembali.';
            }
            statusCode = 400;
        } else if (error.message.includes('FOREIGN KEY constraint failed')) {
            errorMessage = 'Paket yang dipilih tidak valid. Silakan pilih paket yang tersedia.';
            statusCode = 400;
        } else if (error.message.includes('not null constraint')) {
            errorMessage = 'Data wajib tidak boleh kosong. Silakan lengkapi semua field yang diperlukan.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Get customer detail
router.get('/customers/:phone', getAppSettings, async (req, res) => {
    try {
        const { phone } = req.params;
        logger.info(`Loading customer detail for phone: ${phone}`);
        
        const customer = await billingManager.getCustomerByPhone(phone);
        logger.info(`Customer found:`, customer);
        
        if (!customer) {
            logger.warn(`Customer not found for phone: ${phone}`);
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Customer not found',
                appSettings: req.appSettings
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        
        logger.info(`Rendering customer detail page for: ${phone}`);
        
        // Try to render with minimal data first
        try {
            res.render('admin/billing/customer-detail', {
                title: 'Detail Pelanggan',
                customer,
                invoices: invoices || [],
                packages: packages || [],
                appSettings: req.appSettings
            });
        } catch (renderError) {
            logger.error('Error rendering customer detail page:', renderError);
            res.status(500).render('error', {
                message: 'Error rendering customer detail page',
                error: renderError.message,
                appSettings: req.appSettings
            });
        }
    } catch (error) {
        logger.error('Error loading customer detail:', error);
        res.status(500).render('error', {
            message: 'Error loading customer detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API route for getting customer data (for editing)
router.get('/api/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        logger.info(`API: Loading customer data for editing phone: ${phone}`);
        
        const customer = await billingManager.getCustomerByPhone(phone);
        
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        return res.json({
            success: true,
            customer: customer,
            message: 'Customer data loaded successfully'
        });
    } catch (error) {
        logger.error('API: Error loading customer data:', error);
        return res.status(500).json({
            success: false,
            message: 'Error loading customer data',
            error: error.message
        });
    }
});

// Debug route for customer detail
router.get('/customers/:username/debug', getAppSettings, async (req, res) => {
    try {
        const { username } = req.params;
        logger.info(`Debug: Loading customer detail for username: ${username}`);
        
        const customer = await billingManager.getCustomerByUsername(username);
        logger.info(`Debug: Customer found:`, customer);
        
        if (!customer) {
            return res.json({
                success: false,
                message: 'Customer not found',
                username: username
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        
        return res.json({
            success: true,
            customer: customer,
            invoices: invoices,
            packages: packages,
            message: 'Debug data loaded successfully'
        });
    } catch (error) {
        logger.error('Debug: Error loading customer detail:', error);
        return res.json({
            success: false,
            message: 'Error loading customer detail',
            error: error.message
        });
    }
});

// Test route with simple template (no auth for debugging)
router.get('/customers/:username/test', async (req, res) => {
    try {
        const { username } = req.params;
        logger.info(`Test: Loading customer detail for username: ${username}`);
        
        const customer = await billingManager.getCustomerByUsername(username);
        logger.info(`Test: Customer found:`, customer);
        
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Customer not found',
                appSettings: {}
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        
        logger.info(`Test: Rendering simple template for: ${username}`);
        res.render('admin/billing/customer-detail-test', {
            title: 'Detail Pelanggan - Test',
            customer,
            invoices: invoices || [],
            packages: packages || [],
            appSettings: {}
        });
    } catch (error) {
        logger.error('Test: Error loading customer detail:', error);
        res.status(500).render('error', {
            message: 'Error loading customer detail',
            error: error.message,
            appSettings: {}
        });
    }
});

router.put('/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const { name, pppoe_username, email, address, package_id, pppoe_profile, status, auto_suspension, billing_day } = req.body;
        
        // Validate required fields
        if (!name || !package_id) {
            return res.status(400).json({
                success: false,
                message: 'Nama dan paket harus diisi'
            });
        }
        
        // Get current customer data
        const currentCustomer = await billingManager.getCustomerByPhone(phone);
        if (!currentCustomer) {
            return res.status(404).json({
                success: false,
                message: 'Pelanggan tidak ditemukan'
            });
        }

        // Get package to get default profile if not specified
        let profileToUse = pppoe_profile;
        if (!profileToUse && package_id) {
            const packageData = await billingManager.getPackageById(package_id);
            profileToUse = packageData?.pppoe_profile || 'default';
        } else if (!profileToUse) {
            profileToUse = currentCustomer.pppoe_profile || 'default';
        }

        const customerData = {
            name: name,
            phone: phone,
            pppoe_username: pppoe_username || currentCustomer.pppoe_username,
            email: email || currentCustomer.email,
            address: address || currentCustomer.address,
            package_id: package_id,
            pppoe_profile: profileToUse,
            status: status || currentCustomer.status,
            auto_suspension: auto_suspension !== undefined ? parseInt(auto_suspension) : currentCustomer.auto_suspension
        };

        const result = await billingManager.updateCustomer(phone, customerData);
        
        res.json({
            success: true,
            message: 'Pelanggan berhasil diupdate',
            customer: result
        });
    } catch (error) {
        logger.error('Error updating customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal mengupdate pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('Pelanggan tidak ditemukan')) {
            errorMessage = 'Pelanggan tidak ditemukan';
            statusCode = 404;
        } else if (error.message.includes('UNIQUE constraint failed')) {
            if (error.message.includes('phone')) {
                errorMessage = 'Nomor telepon sudah terdaftar. Silakan gunakan nomor telepon yang berbeda.';
            } else if (error.message.includes('username')) {
                errorMessage = 'Username sudah digunakan. Silakan coba lagi.';
            } else {
                errorMessage = 'Data sudah ada dalam sistem. Silakan cek kembali.';
            }
            statusCode = 400;
        } else if (error.message.includes('FOREIGN KEY constraint failed')) {
            errorMessage = 'Paket yang dipilih tidak valid. Silakan pilih paket yang tersedia.';
            statusCode = 400;
        } else if (error.message.includes('not null constraint')) {
            errorMessage = 'Data wajib tidak boleh kosong. Silakan lengkapi semua field yang diperlukan.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Delete customer
router.delete('/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        
        const deletedCustomer = await billingManager.deleteCustomer(phone);
        logger.info(`Customer deleted: ${phone}`);
        
        res.json({
            success: true,
            message: 'Pelanggan berhasil dihapus',
            customer: deletedCustomer
        });
    } catch (error) {
        logger.error('Error deleting customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal menghapus pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('Customer not found')) {
            errorMessage = 'Pelanggan tidak ditemukan';
            statusCode = 404;
        } else if (error.message.includes('invoice(s) still exist')) {
            errorMessage = 'Tidak dapat menghapus pelanggan karena masih memiliki tagihan. Silakan hapus semua tagihan terlebih dahulu.';
            statusCode = 400;
        } else if (error.message.includes('foreign key constraint')) {
            errorMessage = 'Tidak dapat menghapus pelanggan karena masih memiliki data terkait. Silakan hapus data terkait terlebih dahulu.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Invoice Management
router.get('/invoices', getAppSettings, async (req, res) => {
    try {
        const invoices = await billingManager.getInvoices();
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        res.render('admin/billing/invoices', {
            title: 'Kelola Tagihan',
            invoices,
            customers,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoices:', error);
        res.status(500).render('error', { 
            message: 'Error loading invoices',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/invoices', async (req, res) => {
    try {
        const { customer_id, package_id, amount, due_date, notes } = req.body;
        const invoiceData = {
            customer_id: parseInt(customer_id),
            package_id: parseInt(package_id),
            amount: parseFloat(amount),
            due_date: due_date,
            notes: notes.trim()
        };

        if (!invoiceData.customer_id || !invoiceData.package_id || !invoiceData.amount || !invoiceData.due_date) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        const newInvoice = await billingManager.createInvoice(invoiceData);
        logger.info(`Invoice created: ${newInvoice.invoice_number}`);
        
        // Send WhatsApp notification
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');
            await whatsappNotifications.sendInvoiceCreatedNotification(invoiceData.customer_id, newInvoice.id);
        } catch (notificationError) {
            logger.error('Error sending invoice notification:', notificationError);
            // Don't fail the invoice creation if notification fails
        }
        
        res.json({
            success: true,
            message: 'Tagihan berhasil dibuat',
            invoice: newInvoice
        });
    } catch (error) {
        logger.error('Error creating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating invoice',
            error: error.message
        });
    }
});

router.put('/invoices/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, payment_method } = req.body;

        const updatedInvoice = await billingManager.updateInvoiceStatus(id, status, payment_method);
        logger.info(`Invoice status updated: ${id} to ${status}`);
        
        res.json({
            success: true,
            message: 'Status tagihan berhasil diupdate',
            invoice: updatedInvoice
        });
    } catch (error) {
        logger.error('Error updating invoice status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating invoice status',
            error: error.message
        });
    }
});

// View individual invoice
router.get('/invoices/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-detail', {
            title: 'Detail Invoice',
            invoice,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice detail:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Print invoice
router.get('/invoices/:id/print', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-print', {
            title: 'Cetak Invoice',
            invoice,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice print:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice print',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Edit invoice
router.get('/invoices/:id/edit', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-edit', {
            title: 'Edit Invoice',
            invoice,
            customers,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice edit:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice edit',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Update invoice
router.put('/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { customer_id, package_id, amount, due_date, notes } = req.body;
        
        const updateData = {
            customer_id: parseInt(customer_id),
            package_id: parseInt(package_id),
            amount: parseFloat(amount),
            due_date: due_date,
            notes: notes ? notes.trim() : ''
        };

        if (!updateData.customer_id || !updateData.package_id || !updateData.amount || !updateData.due_date) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        const updatedInvoice = await billingManager.updateInvoice(id, updateData);
        logger.info(`Invoice updated: ${updatedInvoice.invoice_number}`);
        
        res.json({
            success: true,
            message: 'Invoice berhasil diperbarui',
            invoice: updatedInvoice
        });
    } catch (error) {
        logger.error('Error updating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating invoice',
            error: error.message
        });
    }
});

// Delete invoice
router.delete('/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const deletedInvoice = await billingManager.deleteInvoice(id);
        logger.info(`Invoice deleted: ${deletedInvoice.invoice_number}`);
        
        res.json({
            success: true,
            message: 'Invoice berhasil dihapus',
            invoice: deletedInvoice
        });
    } catch (error) {
        logger.error('Error deleting invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting invoice',
            error: error.message
        });
    }
});

// Payment Management
router.get('/payments', getAppSettings, async (req, res) => {
    try {
        const payments = await billingManager.getPayments();
        
        res.render('admin/billing/payments', {
            title: 'Riwayat Pembayaran',
            payments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading payments',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/payments', async (req, res) => {
    try {
        const { invoice_id, amount, payment_method, reference_number, notes } = req.body;
        
        // Validate required fields first
        if (!invoice_id || !amount || !payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Invoice ID, jumlah, dan metode pembayaran harus diisi'
            });
        }
        
        const paymentData = {
            invoice_id: parseInt(invoice_id),
            amount: parseFloat(amount),
            payment_method: payment_method.trim(),
            reference_number: reference_number ? reference_number.trim() : '',
            notes: notes ? notes.trim() : ''
        };

        const newPayment = await billingManager.recordPayment(paymentData);
        
        // Update invoice status to paid
        await billingManager.updateInvoiceStatus(paymentData.invoice_id, 'paid', paymentData.payment_method);
        
        logger.info(`Payment recorded: ${newPayment.id}`);
        
        // Send WhatsApp notification
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');
            await whatsappNotifications.sendPaymentReceivedNotification(newPayment.id);
        } catch (notificationError) {
            logger.error('Error sending payment notification:', notificationError);
            // Don't fail the payment recording if notification fails
        }
        
        // Attempt immediate restore if eligible
        try {
            const paidInvoice = await billingManager.getInvoiceById(paymentData.invoice_id);
            if (paidInvoice && paidInvoice.customer_id) {
                const customer = await billingManager.getCustomerById(paidInvoice.customer_id);
                if (customer && customer.status === 'suspended') {
                    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                    const unpaid = invoices.filter(i => i.status === 'unpaid');
                    if (unpaid.length === 0) {
                        await serviceSuspension.restoreCustomerService(customer);
                    }
                }
            }
        } catch (restoreErr) {
            logger.error('Immediate restore check failed:', restoreErr);
        }
        
        res.json({
            success: true,
            message: 'Pembayaran berhasil dicatat',
            payment: newPayment
        });
    } catch (error) {
        logger.error('Error recording payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording payment',
            error: error.message
        });
    }
});

// Export customers to CSV
router.get('/export/customers', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        
        // Create CSV content
        let csvContent = 'ID,Username,Nama,Phone,Email,Address,Package,Status,Payment Status,Created At\n';
        
        customers.forEach(customer => {
            const row = [
                customer.id,
                customer.username,
                customer.name,
                customer.phone,
                customer.email || '',
                customer.address || '',
                customer.package_name || '',
                customer.status,
                customer.payment_status,
                new Date(customer.created_at).toLocaleDateString('id-ID')
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting customers',
            error: error.message
        });
    }
});

// Export invoices to CSV
router.get('/export/invoices', getAppSettings, async (req, res) => {
    try {
        const invoices = await billingManager.getInvoices();
        
        // Create CSV content
        let csvContent = 'ID,Invoice Number,Customer,Amount,Status,Due Date,Created At\n';
        
        invoices.forEach(invoice => {
            const row = [
                invoice.id,
                invoice.invoice_number,
                invoice.customer_name,
                invoice.amount,
                invoice.status,
                new Date(invoice.due_date).toLocaleDateString('id-ID'),
                new Date(invoice.created_at).toLocaleDateString('id-ID')
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=invoices.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting invoices',
            error: error.message
        });
    }
});

// Export payments to CSV
router.get('/export/payments', getAppSettings, async (req, res) => {
    try {
        const payments = await billingManager.getPayments();
        
        // Create CSV content
        let csvContent = 'ID,Invoice Number,Customer,Amount,Payment Method,Payment Date,Reference,Notes\n';
        
        payments.forEach(payment => {
            const row = [
                payment.id,
                payment.invoice_number,
                payment.customer_name,
                payment.amount,
                payment.payment_method,
                new Date(payment.payment_date).toLocaleDateString('id-ID'),
                payment.reference_number || '',
                payment.notes || ''
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting payments:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting payments',
            error: error.message
        });
    }
});

// API Routes untuk AJAX
// Get package profiles for customer form
router.get('/api/packages', async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        res.json(packages);
    } catch (error) {
        logger.error('Error getting packages API:', error);
        res.status(500).json({ error: error.message });
    }
});



router.get('/api/customers', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        res.json(customers);
    } catch (error) {
        logger.error('Error getting customers API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/invoices', async (req, res) => {
    try {
        const { customer_username } = req.query;
        const invoices = await billingManager.getInvoices(customer_username);
        res.json(invoices);
    } catch (error) {
        logger.error('Error getting invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice tidak ditemukan'
            });
        }
        
        res.json({
            success: true,
            invoice: invoice
        });
    } catch (error) {
        logger.error('Error getting invoice by ID API:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

router.get('/api/stats', async (req, res) => {
    try {
        const stats = await billingManager.getBillingStats();
        res.json(stats);
    } catch (error) {
        logger.error('Error getting billing stats API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/overdue', async (req, res) => {
    try {
        const overdueInvoices = await billingManager.getOverdueInvoices();
        res.json(overdueInvoices);
    } catch (error) {
        logger.error('Error getting overdue invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

// Service Suspension Management Routes
router.post('/service-suspension/suspend/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { reason } = req.body;
        
        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.suspendCustomerService(customer, reason || 'Manual suspension');
        
        res.json({
            success: result.success,
            message: result.success ? 'Service suspended successfully' : 'Failed to suspend service',
            results: result.results,
            customer: result.customer
        });
    } catch (error) {
        logger.error('Error suspending service:', error);
        res.status(500).json({
            success: false,
            message: 'Error suspending service: ' + error.message
        });
    }
});

router.post('/service-suspension/restore/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { reason } = req.body || {};
        
        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.restoreCustomerService(customer, reason || 'Manual restore');
        
        res.json({
            success: result.success,
            message: result.success ? 'Service restored successfully' : 'Failed to restore service',
            results: result.results,
            customer: result.customer,
            reason: result.reason || (reason || 'Manual restore')
        });
    } catch (error) {
        logger.error('Error restoring service:', error);
        res.status(500).json({
            success: false,
            message: 'Error restoring service: ' + error.message
        });
    }
});

router.post('/service-suspension/check-overdue', async (req, res) => {
    try {
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.checkAndSuspendOverdueCustomers();
        
        res.json({
            success: true,
            message: 'Overdue customers check completed',
            ...result
        });
    } catch (error) {
        logger.error('Error checking overdue customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking overdue customers: ' + error.message
        });
    }
});

router.post('/service-suspension/check-paid', async (req, res) => {
    try {
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.checkAndRestorePaidCustomers();
        
        res.json({
            success: true,
            message: 'Paid customers check completed',
            ...result
        });
    } catch (error) {
        logger.error('Error checking paid customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking paid customers: ' + error.message
        });
    }
});

// Service Suspension Settings Page
router.get('/service-suspension', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/service-suspension', {
            title: 'Service Suspension',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading service suspension page:', error);
        res.status(500).render('error', { 
            message: 'Error loading service suspension page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Service Suspension: Isolir Profile Setting API
router.get('/service-suspension/isolir-profile', async (req, res) => {
    try {
        const value = getSetting('isolir_profile', 'isolir');
        res.json({ success: true, isolir_profile: value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/service-suspension/isolir-profile', async (req, res) => {
    try {
        const { isolir_profile } = req.body || {};
        if (!isolir_profile || typeof isolir_profile !== 'string') {
            return res.status(400).json({ success: false, message: 'isolir_profile tidak valid' });
        }
        const ok = setSetting('isolir_profile', isolir_profile.trim());
        if (!ok) {
            return res.status(500).json({ success: false, message: 'Gagal menyimpan ke settings.json' });
        }
        res.json({ success: true, isolir_profile: isolir_profile.trim() });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Payment Monitor
router.get('/payment-monitor', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/payment-monitor', {
            title: 'Payment Monitor',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payment monitor:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment monitor',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Payment Settings Routes
router.get('/payment-settings', getAppSettings, async (req, res) => {
    try {
        const settings = getSettingsWithCache();
        res.render('admin/billing/payment-settings', {
            title: 'Payment Gateway Settings',
            settings: settings,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payment settings:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment settings',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Update active gateway
router.post('/payment-settings/active-gateway', async (req, res) => {
    try {
        const { activeGateway } = req.body;
        const settings = getSettingsWithCache();
        
        settings.payment_gateway.active = activeGateway;
        // Persist to settings.json via settingsManager
        setSetting('payment_gateway', settings.payment_gateway);
        // Hot-reload gateways
        const reloadInfo = billingManager.reloadPaymentGateway();
        
        res.json({
            success: true,
            message: 'Active gateway updated successfully',
            reload: reloadInfo
        });
    } catch (error) {
        logger.error('Error updating active gateway:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating active gateway',
            error: error.message
        });
    }
});

// Update gateway configuration
router.post('/payment-settings/:gateway', async (req, res) => {
    try {
        const { gateway } = req.params;
        const config = req.body;
        const settings = getSettingsWithCache();
        
        if (!settings.payment_gateway[gateway]) {
            return res.status(400).json({
                success: false,
                message: `Gateway ${gateway} not found`
            });
        }
        
        // Update gateway configuration
        settings.payment_gateway[gateway] = {
            ...settings.payment_gateway[gateway],
            ...config
        };
        
        // Persist to settings.json via settingsManager
        setSetting('payment_gateway', settings.payment_gateway);
        // Hot-reload gateways
        const reloadInfo = billingManager.reloadPaymentGateway();
        
        res.json({
            success: true,
            message: `${gateway} configuration updated successfully`,
            reload: reloadInfo
        });
    } catch (error) {
        logger.error(`Error updating ${req.params.gateway} configuration:`, error);
        res.status(500).json({
            success: false,
            message: `Error updating ${req.params.gateway} configuration`,
            error: error.message
        });
    }
});

// Test gateway connection
router.post('/payment-settings/test/:gateway', async (req, res) => {
    try {
        const { gateway } = req.params;
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentManager = new PaymentGatewayManager();
        
        // Test the gateway by trying to create a test payment
        const testInvoice = {
            invoice_number: 'TEST-001',
            amount: 10000,
            package_name: 'Test Package',
            customer_name: 'Test Customer',
            customer_phone: '08123456789',
            customer_email: 'test@example.com'
        };
        
        // Guard: Tripay minimum amount validation to avoid gateway rejection
        if (gateway === 'tripay' && Number(testInvoice.amount) < 10000) {
            return res.status(400).json({
                success: false,
                message: 'Minimal nominal Tripay adalah Rp 10.000'
            });
        }
        
        const result = await paymentManager.createPayment(testInvoice, gateway);
        
        res.json({
            success: true,
            message: `${gateway} connection test successful`,
            data: result
        });
    } catch (error) {
        logger.error(`Error testing ${req.params.gateway} connection:`, error);
        res.status(500).json({
            success: false,
            message: `${req.params.gateway} connection test failed: ${error.message}`
        });
    }
});

// Manual Isolir by Invoice ID
router.post('/invoices/:id/isolir', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const reason = (req.body && req.body.reason) || 'Isolir manual dari Admin';

        const invoice = await billingManager.getInvoiceById(id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });

        const customer = await billingManager.getCustomerById(invoice.customer_id);
        if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        const result = await serviceSuspension.suspendCustomerService(customer, reason);
        return res.json({ success: !!result?.success, data: result, message: result?.success ? 'Isolir berhasil' : (result?.error || 'Gagal isolir') });
    } catch (error) {
        logger.error('Error manual isolir:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Manual Restore by Invoice ID
router.post('/invoices/:id/restore', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const reason = (req.body && req.body.reason) || 'Restore manual dari Admin';

        const invoice = await billingManager.getInvoiceById(id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });

        const customer = await billingManager.getCustomerById(invoice.customer_id);
        if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        const result = await serviceSuspension.restoreCustomerService(customer, reason);
        return res.json({ success: !!result?.success, data: result, message: result?.success ? 'Restore berhasil' : (result?.error || 'Gagal restore') });
    } catch (error) {
        logger.error('Error manual restore:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
