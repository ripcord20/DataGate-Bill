const express = require('express');
const router = express.Router();
const billingManager = require('../config/billing');
const logger = require('../config/logger');
const { getSetting } = require('../config/settingsManager');

// Middleware untuk mendapatkan pengaturan aplikasi
const getAppSettings = (req, res, next) => {
    req.appSettings = {
        companyHeader: getSetting('company_header', 'ISP Monitor'),
        footerInfo: getSetting('footer_info', ''),
        logoFilename: getSetting('logo_filename', 'logo.png')
    };
    next();
};

// Dashboard Billing Customer
router.get('/dashboard', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                appSettings: req.appSettings
            });
        }

        const invoices = await billingManager.getInvoices(username);
        const payments = await billingManager.getPayments();
        
        // Filter payments untuk customer ini
        const customerPayments = payments.filter(payment => {
            return invoices.some(invoice => invoice.id === payment.invoice_id);
        });

        // Hitung statistik customer
        const totalInvoices = invoices.length;
        const paidInvoices = invoices.filter(inv => inv.status === 'paid').length;
        const unpaidInvoices = invoices.filter(inv => inv.status === 'unpaid').length;
        const overdueInvoices = invoices.filter(inv => 
            inv.status === 'unpaid' && new Date(inv.due_date) < new Date()
        ).length;
        const totalPaid = invoices
            .filter(inv => inv.status === 'paid')
            .reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
        const totalUnpaid = invoices
            .filter(inv => inv.status === 'unpaid')
            .reduce((sum, inv) => sum + parseFloat(inv.amount), 0);

        res.render('customer/billing/dashboard', {
            title: 'Dashboard Billing',
            customer,
            invoices: invoices.slice(0, 5), // 5 tagihan terbaru
            payments: customerPayments.slice(0, 5), // 5 pembayaran terbaru
            stats: {
                totalInvoices,
                paidInvoices,
                unpaidInvoices,
                overdueInvoices,
                totalPaid,
                totalUnpaid
            },
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer billing dashboard:', error);
        res.status(500).render('error', { 
            message: 'Error loading billing dashboard',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Halaman Tagihan Customer
router.get('/invoices', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                appSettings: req.appSettings
            });
        }

        const invoices = await billingManager.getInvoices(username);
        
        res.render('customer/billing/invoices', {
            title: 'Tagihan Saya',
            customer,
            invoices,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer invoices:', error);
        res.status(500).render('error', { 
            message: 'Error loading invoices',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Detail Tagihan Customer
router.get('/invoices/:id', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                appSettings: req.appSettings
            });
        }

        // Pastikan tagihan milik customer yang login
        if (invoice.username !== username) {
            return res.status(403).render('error', {
                message: 'Akses ditolak',
                appSettings: req.appSettings
            });
        }

        const payments = await billingManager.getPayments(id);
        
        res.render('customer/billing/invoice-detail', {
            title: `Tagihan ${invoice.invoice_number}`,
            invoice,
            payments,
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

// Halaman Riwayat Pembayaran Customer
router.get('/payments', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                appSettings: req.appSettings
            });
        }

        const invoices = await billingManager.getInvoices(username);
        const allPayments = await billingManager.getPayments();
        
        // Filter payments untuk customer ini
        const customerPayments = allPayments.filter(payment => {
            return invoices.some(invoice => invoice.id === payment.invoice_id);
        });

        res.render('customer/billing/payments', {
            title: 'Riwayat Pembayaran',
            customer,
            payments: customerPayments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading payments',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Halaman Profil Customer
router.get('/profile', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                appSettings: req.appSettings
            });
        }

        const packages = await billingManager.getPackages();
        
        res.render('customer/billing/profile', {
            title: 'Profil Saya',
            customer,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customer profile:', error);
        res.status(500).render('error', { 
            message: 'Error loading profile',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API Routes untuk AJAX
router.get('/api/invoices', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const invoices = await billingManager.getInvoices(username);
        res.json(invoices);
    } catch (error) {
        logger.error('Error getting customer invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/payments', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const invoices = await billingManager.getInvoices(username);
        const allPayments = await billingManager.getPayments();
        
        // Filter payments untuk customer ini
        const customerPayments = allPayments.filter(payment => {
            return invoices.some(invoice => invoice.id === payment.invoice_id);
        });

        res.json(customerPayments);
    } catch (error) {
        logger.error('Error getting customer payments API:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/profile', async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const customer = await billingManager.getCustomerByUsername(username);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json(customer);
    } catch (error) {
        logger.error('Error getting customer profile API:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download Invoice PDF (placeholder)
router.get('/invoices/:id/download', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice || invoice.username !== username) {
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                appSettings: req.appSettings
            });
        }

        // TODO: Implement PDF generation
        res.json({
            success: true,
            message: 'Fitur download PDF akan segera tersedia',
            invoice_number: invoice.invoice_number
        });
    } catch (error) {
        logger.error('Error downloading invoice:', error);
        res.status(500).json({ error: error.message });
    }
});

// Print Invoice (placeholder)
router.get('/invoices/:id/print', getAppSettings, async (req, res) => {
    try {
        const username = req.session.customer_username;
        if (!username) {
            return res.redirect('/customer/login');
        }

        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice || invoice.username !== username) {
            return res.status(404).render('error', {
                message: 'Tagihan tidak ditemukan',
                appSettings: req.appSettings
            });
        }

        const payments = await billingManager.getPayments(id);
        
        res.render('customer/billing/invoice-print', {
            title: `Print Tagihan ${invoice.invoice_number}`,
            invoice,
            payments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error printing invoice:', error);
        res.status(500).render('error', { 
            message: 'Error printing invoice',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

module.exports = router; 
