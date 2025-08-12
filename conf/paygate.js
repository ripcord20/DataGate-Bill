const fs = require('fs');
const crypto = require('crypto');

class PaymentGatewayManager {

    constructor() {
        this.settings = this.loadSettings();
        this.gateways = {};
        
        // Only initialize enabled gateways
        if (this.settings.payment_gateway && this.settings.payment_gateway.midtrans && this.settings.payment_gateway.midtrans.enabled) {
            try {
                this.gateways.midtrans = new MidtransGateway(this.settings.payment_gateway.midtrans);
            } catch (error) {
                console.error('Failed to initialize Midtrans gateway:', error);
            }
        }
        
        if (this.settings.payment_gateway && this.settings.payment_gateway.xendit && this.settings.payment_gateway.xendit.enabled) {
            try {
                this.gateways.xendit = new XenditGateway(this.settings.payment_gateway.xendit);
            } catch (error) {
                console.error('Failed to initialize Xendit gateway:', error);
            }
        }
        
        if (this.settings.payment_gateway && this.settings.payment_gateway.tripay && this.settings.payment_gateway.tripay.enabled) {
            try {
                this.gateways.tripay = new TripayGateway(this.settings.payment_gateway.tripay);
            } catch (error) {
                console.error('Failed to initialize Tripay gateway:', error);
            }
        }
        
        this.activeGateway = this.settings.payment_gateway ? this.settings.payment_gateway.active : null;
    }

    loadSettings() {
        try {
            return JSON.parse(fs.readFileSync('settings.json', 'utf8'));
        } catch (error) {
            console.error('Error loading settings:', error);
            return {};
        }
    }

    getActiveGateway() {
        return this.activeGateway;
    }

    // Reload settings and reinitialize gateways without server restart
    reload() {
        try {
            this.settings = this.loadSettings();
        } catch (_) {
            this.settings = {};
        }

        // Reset gateways
        this.gateways = {};

        // Reinitialize enabled gateways
        if (this.settings.payment_gateway && this.settings.payment_gateway.midtrans && this.settings.payment_gateway.midtrans.enabled) {
            try {
                this.gateways.midtrans = new MidtransGateway(this.settings.payment_gateway.midtrans);
            } catch (error) {
                console.error('Failed to initialize Midtrans gateway on reload:', error);
            }
        }

        if (this.settings.payment_gateway && this.settings.payment_gateway.xendit && this.settings.payment_gateway.xendit.enabled) {
            try {
                this.gateways.xendit = new XenditGateway(this.settings.payment_gateway.xendit);
            } catch (error) {
                console.error('Failed to initialize Xendit gateway on reload:', error);
            }
        }

        if (this.settings.payment_gateway && this.settings.payment_gateway.tripay && this.settings.payment_gateway.tripay.enabled) {
            try {
                this.gateways.tripay = new TripayGateway(this.settings.payment_gateway.tripay);
            } catch (error) {
                console.error('Failed to initialize Tripay gateway on reload:', error);
            }
        }

        this.activeGateway = this.settings.payment_gateway ? this.settings.payment_gateway.active : null;
        return { active: this.activeGateway, initialized: Object.keys(this.gateways) };
    }

    async createPayment(invoice, gateway = null) {
        const selectedGateway = gateway || this.activeGateway;
        
        if (!selectedGateway) {
            throw new Error('No payment gateway is active');
        }
        
        if (!this.gateways[selectedGateway]) {
            throw new Error(`Gateway ${selectedGateway} is not initialized or not available`);
        }

        if (!this.settings.payment_gateway || !this.settings.payment_gateway[selectedGateway] || !this.settings.payment_gateway[selectedGateway].enabled) {
            throw new Error(`Gateway ${selectedGateway} is not enabled`);
        }

        try {
            const result = await this.gateways[selectedGateway].createPayment(invoice);
            return {
                ...result,
                gateway: selectedGateway
            };
        } catch (error) {
            console.error(`Error creating payment with ${selectedGateway}:`, error);
            throw error;
        }
    }

    async handleWebhook(payload, gateway) {
        if (!this.gateways[gateway]) {
            throw new Error(`Gateway ${gateway} is not initialized or not available`);
        }

        try {
            // Support either raw body or { body, headers }
            const body = payload && payload.body ? payload.body : payload;
            const headers = payload && payload.headers ? payload.headers : {};
            console.log(`[PAYMENT_GATEWAY] Processing webhook from ${gateway}:`, JSON.stringify(body, null, 2));

            const result = await this.gateways[gateway].handleWebhook(body, headers);
            console.log(`[PAYMENT_GATEWAY] Raw result from ${gateway}:`, JSON.stringify(result, null, 2));

            // Normalize the result to ensure consistent format
            const normalizedResult = {
                order_id: result.order_id || result.merchant_ref || result.external_id || body.order_id,
                status: result.status || body.status || 'pending',
                amount: result.amount || body.amount || body.gross_amount,
                payment_type: result.payment_type || body.payment_type || body.payment_method,
                fraud_status: result.fraud_status || body.fraud_status || 'accept',
                reference: result.reference || result.invoice_id || null
            };
            
            console.log(`[PAYMENT_GATEWAY] Normalized webhook result for ${gateway}:`, normalizedResult);
            
            // Log additional info for debugging
            if (normalizedResult.status) {
                console.log(`[PAYMENT_GATEWAY] Payment status: ${normalizedResult.status}`);
            }
            if (normalizedResult.order_id) {
                console.log(`[PAYMENT_GATEWAY] Order ID: ${normalizedResult.order_id}`);
            }
            
            return normalizedResult;
        } catch (error) {
            console.error(`[PAYMENT_GATEWAY] Error handling webhook from ${gateway}:`, error);
            throw error;
        }
    }

    getGatewayStatus() {
        const status = {};
        
        // Check all configured gateways
        if (this.settings.payment_gateway) {
            if (this.settings.payment_gateway.midtrans) {
                status.midtrans = {
                    enabled: this.settings.payment_gateway.midtrans.enabled,
                    active: 'midtrans' === this.activeGateway,
                    initialized: !!this.gateways.midtrans
                };
            }
            
            if (this.settings.payment_gateway.xendit) {
                status.xendit = {
                    enabled: this.settings.payment_gateway.xendit.enabled,
                    active: 'xendit' === this.activeGateway,
                    initialized: !!this.gateways.xendit
                };
            }
            
            if (this.settings.payment_gateway.tripay) {
                status.tripay = {
                    enabled: this.settings.payment_gateway.tripay.enabled,
                    active: 'tripay' === this.activeGateway,
                    initialized: !!this.gateways.tripay
                };
            }
        }
        
        return status;
    }
}

class MidtransGateway {

    constructor(config) {
        if (!config || !config.server_key || !config.client_key) {
            throw new Error('Midtrans configuration is incomplete. Missing server_key or client_key.');
        }
        
        this.config = config;
        this.midtransClient = require('midtrans-client');
        this.snap = new this.midtransClient.Snap({
            isProduction: config.production,
            serverKey: config.server_key,
            clientKey: config.client_key
        });
    }

    async createPayment(invoice) {
        const parameter = {
            transaction_details: {
                order_id: `INV-${invoice.invoice_number}`,
                gross_amount: parseInt(invoice.amount)
            },
            customer_details: {
                first_name: invoice.customer_name,
                phone: invoice.customer_phone || '',
                email: invoice.customer_email || ''
            },
            item_details: [{
                id: invoice.package_id || 'PACKAGE-001',
                price: parseInt(invoice.amount),
                quantity: 1,
                name: invoice.package_name || 'Internet Package'
            }],
            callbacks: {
                finish: `${this.config.base_url || 'http://localhost:3003'}/payment/finish`,
                error: `${this.config.base_url || 'http://localhost:3003'}/payment/error`,
                pending: `${this.config.base_url || 'http://localhost:3003'}/payment/pending`
            }
        };

        const transaction = await this.snap.createTransaction(parameter);
        
        return {
            payment_url: transaction.redirect_url,
            token: transaction.token,
            order_id: parameter.transaction_details.order_id
        };
    }

    async handleWebhook(payload, _headers = {}) {
        try {
            // Verify signature
            const expectedSignature = crypto
                .createHash('sha512')
                .update(payload.order_id + payload.status_code + payload.gross_amount + this.config.server_key)
                .digest('hex');

            if (payload.signature_key !== expectedSignature) {
                throw new Error('Invalid signature');
            }

            // Map Midtrans status to our standard status
            let status = payload.transaction_status;
            if (payload.transaction_status === 'settlement' || payload.transaction_status === 'capture') {
                status = 'settlement';
            } else if (payload.transaction_status === 'pending') {
                status = 'pending';
            } else if (payload.transaction_status === 'deny' || payload.transaction_status === 'expire' || payload.transaction_status === 'cancel') {
                status = 'failed';
            }

            const result = {
                order_id: payload.order_id,
                status: status,
                amount: payload.gross_amount,
                payment_type: payload.payment_type,
                fraud_status: payload.fraud_status || 'accept'
            };

            console.log(`[MIDTRANS] Webhook processed:`, result);
            return result;
        } catch (error) {
            console.error(`[MIDTRANS] Webhook error:`, error);
            throw error;
        }
    }
}

class XenditGateway {

    constructor(config) {
        if (!config || !config.api_key) {
            throw new Error('Xendit configuration is incomplete. Missing api_key.');
        }
        
        if (!config.api_key.startsWith('xnd_')) {
            throw new Error('Invalid Xendit API key. API key must start with "xnd_".');
        }
        
        this.config = config;
        const { Xendit } = require('xendit-node');
        this.xenditClient = new Xendit({
            secretKey: config.api_key
        });
    }

    async createPayment(invoice) {
        const invoiceData = {
            externalID: `INV-${invoice.invoice_number}`,
            amount: parseInt(invoice.amount),
            description: `Pembayaran ${invoice.package_name}`,
            customer: {
                givenNames: invoice.customer_name,
                email: invoice.customer_email || 'customer@example.com',
                mobileNumber: invoice.customer_phone || ''
            },
            successRedirectURL: `${this.config.base_url || 'http://localhost:3003'}/payment/success`,
            failureRedirectURL: `${this.config.base_url || 'http://localhost:3003'}/payment/failed`
        };

        const xenditInvoice = await this.xenditClient.Invoice.createInvoice(invoiceData);
        
        return {
            payment_url: xenditInvoice.invoice_url,
            token: xenditInvoice.id,
            order_id: invoiceData.externalID
        };
    }

    async handleWebhook(payload, headers = {}) {
        try {
            // Prefer header-based verification using Xendit callback token
            const headerToken = headers['x-callback-token'] || headers['X-Callback-Token'] || headers['X-CALLBACK-TOKEN'];
            if (this.config.callback_token) {
                if (!headerToken || headerToken !== this.config.callback_token) {
                    // Fallback: some older integrations may send a body signature; keep backward-compat only if present
                    if (!payload || !payload.signature) {
                        throw new Error('Invalid callback token');
                    }
                    const legacySig = crypto
                        .createHmac('sha256', this.config.callback_token)
                        .update(JSON.stringify(payload))
                        .digest('hex');
                    if (payload.signature !== legacySig) {
                        throw new Error('Invalid signature');
                    }
                }
            }

            // Map Xendit status to our standard status
            let status = 'pending';
            if (payload.status === 'PAID') status = 'success';
            else if (payload.status === 'PENDING') status = 'pending';
            else if (payload.status === 'EXPIRED' || payload.status === 'FAILED') status = 'failed';

            const result = {
                order_id: payload.external_id,
                status: status,
                amount: payload.amount,
                payment_type: payload.payment_channel,
                invoice_id: payload.id
            };

            console.log(`[XENDIT] Webhook processed:`, result);
            return result;
        } catch (error) {
            console.error(`[XENDIT] Webhook error:`, error);
            throw error;
        }
    }
}

class TripayGateway {

    constructor(config) {
        if (!config || !config.api_key || !config.private_key || !config.merchant_code) {
            throw new Error('Tripay configuration is incomplete. Missing api_key, private_key, or merchant_code.');
        }
        
        this.config = config;
        this.baseUrl = config.production ? 'https://tripay.co.id' : 'https://tripay.co.id/api-sandbox';
    }

    async createPayment(invoice) {
        const orderData = {
            method: 'BRIVA',
            merchant_ref: `INV-${invoice.invoice_number}`,
            amount: parseInt(invoice.amount),
            customer_name: invoice.customer_name,
            customer_email: invoice.customer_email || 'customer@example.com',
            customer_phone: invoice.customer_phone || '',
            order_items: [{
                name: invoice.package_name || 'Internet Package',
                price: parseInt(invoice.amount),
                quantity: 1
            }],
            callback_url: `${this.config.base_url || 'http://localhost:3003'}/webhook/tripay`,
            return_url: `${this.config.base_url || 'http://localhost:3003'}/payment/finish`
        };

        // Tripay signature: HMAC SHA256 of merchant_code + merchant_ref + amount using private_key
        const rawSign = `${this.config.merchant_code}${orderData.merchant_ref}${orderData.amount}`;
        const signature = crypto
            .createHmac('sha256', this.config.private_key)
            .update(rawSign)
            .digest('hex');

        // Use global fetch if available (Node >= 18), otherwise fallback to node-fetch
        const fetchFn = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
        const response = await fetchFn(`${this.baseUrl}/transaction/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.api_key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                merchant_code: this.config.merchant_code,
                ...orderData,
                signature
            })
        });

        const result = await response.json();
        
        if (result.success) {
            return {
                payment_url: result.data.checkout_url,
                token: result.data.reference,
                order_id: orderData.merchant_ref
            };
        } else {
            throw new Error(result.message || 'Failed to create payment');
        }
    }

    async handleWebhook(payload, headers = {}) {
        try {
            // Verify Tripay callback signature from header
            const cbSig = headers['x-callback-signature'] || headers['X-Callback-Signature'] || headers['X-CALLBACK-SIGNATURE'];
            const expected = crypto
                .createHmac('sha256', this.config.private_key)
                .update(JSON.stringify(payload))
                .digest('hex');
            if (!cbSig || cbSig !== expected) {
                throw new Error('Invalid signature');
            }

            // Map Tripay status to our standard status
            let status = 'pending';
            if (payload.status === 'PAID') status = 'success';
            else if (payload.status === 'UNPAID') status = 'pending';
            else if (payload.status === 'EXPIRED' || payload.status === 'FAILED') status = 'failed';

            const result = {
                order_id: payload.merchant_ref,
                status: status,
                amount: payload.amount,
                payment_type: payload.payment_method,
                reference: payload.reference
            };

            console.log(`[TRIPAY] Webhook processed:`, result);
            return result;
        } catch (error) {
            console.error(`[TRIPAY] Webhook error:`, error);
            throw error;
        }
    }
}

module.exports = PaymentGatewayManager; 
