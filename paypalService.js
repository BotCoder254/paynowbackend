const axios = require('axios');
const admin = require('firebase-admin');
const { doc: firestoreDoc, getDoc, updateDoc, serverTimestamp } = require("firebase/firestore");
const { db: firestoreDb } = require("./firebase");
const { sendPaymentConfirmationEmail } = require("./emailService");

// Use sandbox credentials as fallback
const DEFAULT_PAYPAL_CLIENT_ID = 'AQwaPBBf1-OF1TS_29leZUm_NWcZMJnpnODwIB6FSoXJykYNPKIzuJLe1uXV0pT-qwuJHvEhEfOUUJR9';
const DEFAULT_PAYPAL_SECRET = 'EKSQs-RPojR5VtN-a-wHEIAIlUhDmjl7YTMnFMGPfbk-rGSGw4I33UcUfJgbPT9UD1YpqDDzA8RLLyPj';

// PayPal API URLs
const SANDBOX_API_URL = 'https://api-m.sandbox.paypal.com';
const PRODUCTION_API_URL = 'https://api-m.paypal.com';

/**
 * Gets PayPal credentials for a merchant
 * @param {string} merchantId - The merchant's user ID
 * @returns {Promise<Object>} - PayPal credentials
 */
const getPayPalCredentials = async (merchantId) => {
  if (!merchantId) {
    console.warn('No merchant ID provided, using default PayPal credentials');
    return {
      clientId: DEFAULT_PAYPAL_CLIENT_ID,
      clientSecret: DEFAULT_PAYPAL_SECRET,
      environment: 'sandbox'
    };
  }
  
  try {
    // Get merchant settings from Firestore
    const settingsRef = firestoreDoc(firestoreDb, 'merchantSettings', merchantId);
    const settingsDoc = await getDoc(settingsRef);
    
    if (!settingsDoc.exists()) {
      console.warn(`No settings found for merchant ${merchantId}, using default credentials`);
      return {
        clientId: DEFAULT_PAYPAL_CLIENT_ID,
        clientSecret: DEFAULT_PAYPAL_SECRET,
        environment: 'sandbox'
      };
    }
    
    const settings = settingsDoc.data();
    
    if (!settings.paypal || !settings.paypal.clientId || !settings.paypal.clientSecret || !settings.paypal.enabled) {
      console.warn(`PayPal not properly configured for merchant ${merchantId}, using default credentials`);
      return {
        clientId: DEFAULT_PAYPAL_CLIENT_ID,
        clientSecret: DEFAULT_PAYPAL_SECRET,
        environment: 'sandbox'
      };
    }
    
    // Use the merchant's credentials
    return {
      clientId: settings.paypal.clientId,
      clientSecret: settings.paypal.clientSecret,
      environment: settings.paypal.environment || 'sandbox'
    };
  } catch (error) {
    console.error('Error getting PayPal credentials:', error);
    // Fallback to default credentials
    return {
      clientId: DEFAULT_PAYPAL_CLIENT_ID,
      clientSecret: DEFAULT_PAYPAL_SECRET,
      environment: 'sandbox'
    };
  }
};

/**
 * Get PayPal access token
 * @param {Object} credentials - PayPal API credentials
 * @returns {Promise<string>} - Access token
 */
const getAccessToken = async (credentials) => {
  try {
    const { clientId, clientSecret, environment } = credentials;
    const baseURL = environment === 'production' ? PRODUCTION_API_URL : SANDBOX_API_URL;
    
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    console.log(`Getting PayPal access token from ${baseURL}/v1/oauth2/token`);
    
    const response = await axios({
      method: 'post',
      url: `${baseURL}/v1/oauth2/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Accept-Language': 'en_US',
        'Authorization': `Basic ${auth}`
      },
      data: 'grant_type=client_credentials'
    });
    
    console.log('PayPal access token obtained successfully');
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting PayPal access token:', error.response?.data || error.message);
    throw new Error('Failed to get PayPal access token');
  }
};

/**
 * Creates a PayPal order
 * @param {Object} paymentData - Payment data including amount, currency, description
 * @returns {Promise<Object>} - PayPal order object
 */
const createOrder = async (paymentData) => {
  try {
    const { amount, currency = 'usd', description, metadata = {}, transactionId, merchantId } = paymentData;
    
    if (!merchantId) {
      throw new Error('Merchant ID is required to create a payment order');
    }
    
    console.log(`Creating PayPal order for transaction ${transactionId}, amount: ${amount} ${currency}`);
    
    // Get PayPal credentials for this merchant
    const credentials = await getPayPalCredentials(merchantId);
    const accessToken = await getAccessToken(credentials);
    
    const baseURL = credentials.environment === 'production' ? PRODUCTION_API_URL : SANDBOX_API_URL;
    
          // Create PayPal order
      const response = await axios({
        method: 'post',
        url: `${baseURL}/v2/checkout/orders`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        data: {
          intent: 'CAPTURE',
          purchase_units: [{
            amount: {
              currency_code: currency.toUpperCase(),
              value: amount.toString()
            },
            description: description || 'Payment via PayNow',
            custom_id: transactionId
          }],
          application_context: {
            brand_name: 'PayNow',
            landing_page: 'BILLING',
            user_action: 'PAY_NOW',
            return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/cancel`
          }
        }
      });
    
    return {
      orderId: response.data.id,
      status: response.data.status,
      links: response.data.links
    };
  } catch (error) {
    console.error('Error creating PayPal order:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Captures a PayPal payment
 * @param {string} orderId - PayPal order ID
 * @param {string} merchantId - Merchant ID
 * @returns {Promise<Object>} - Capture result
 */
const capturePayment = async (orderId, merchantId) => {
  try {
    if (!orderId) {
      throw new Error('Order ID is required to capture payment');
    }
    
    if (!merchantId) {
      throw new Error('Merchant ID is required to capture payment');
    }
    
    // Get PayPal credentials for this merchant
    const credentials = await getPayPalCredentials(merchantId);
    const accessToken = await getAccessToken(credentials);
    
    const baseURL = credentials.environment === 'production' ? PRODUCTION_API_URL : SANDBOX_API_URL;
    
    // Capture the payment
    const response = await axios({
      method: 'post',
      url: `${baseURL}/v2/checkout/orders/${orderId}/capture`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    // Extract transaction ID from the custom_id field
    const customId = response.data.purchase_units[0]?.custom_id;
    
    if (customId) {
      // This is our transaction ID
      await handleSuccessfulPayment(response.data, customId);
    }
    
    return {
      captureId: response.data.purchase_units[0]?.payments?.captures[0]?.id,
      status: response.data.status,
      orderId: response.data.id
    };
  } catch (error) {
    console.error('Error capturing PayPal payment:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Handles successful PayPal payments
 * @param {Object} captureData - PayPal capture data
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<void>}
 */
const handleSuccessfulPayment = async (captureData, transactionId) => {
  try {
    if (!transactionId) {
      console.error('No transaction ID found in PayPal capture data');
      return;
    }
    
    const captureId = captureData.purchase_units[0]?.payments?.captures[0]?.id;
    
    // Update transaction in Firestore
    const transactionRef = firestoreDoc(firestoreDb, 'transactions', transactionId);
    await updateDoc(transactionRef, {
      status: 'success',
      paypalOrderId: captureData.id,
      paypalCaptureId: captureId,
      completedAt: serverTimestamp(),
      paymentProcessor: 'paypal'
    });
    
    // Get the full transaction data for the email
    const transactionDoc = await getDoc(transactionRef);
    if (transactionDoc.exists()) {
      const transactionData = transactionDoc.data();
      
      // Send email confirmation if email is available
      if (transactionData.payerEmail) {
        await sendPaymentConfirmationEmail({
          transactionId,
          email: transactionData.payerEmail,
          customerName: transactionData.payerName,
          amount: transactionData.amount,
          currency: transactionData.currency,
          paymentMethod: 'PayPal',
          description: transactionData.description,
          receiptNumber: captureId
        });
      }
    }
    
    console.log(`Transaction ${transactionId} marked as successful`);
  } catch (error) {
    console.error('Error handling successful payment:', error);
    // Don't throw error to prevent webhook processing failure
  }
};

/**
 * Handles PayPal webhook events
 * @param {Object} event - PayPal webhook event
 * @returns {Promise<void>}
 */
const handleWebhookEvent = async (event) => {
  try {
    const { event_type, resource } = event;
    
    switch (event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        // Extract transaction ID from custom_id
        const customId = resource?.custom_id || 
                         resource?.supplementary_data?.related_ids?.order_id;
        
        if (customId) {
          await handleSuccessfulPayment(resource, customId);
        } else {
          console.error('No transaction ID found in PayPal webhook event');
        }
        break;
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.REFUNDED':
        // Handle failed or refunded payments
        // Implementation would be similar to handleSuccessfulPayment
        break;
      default:
        console.log(`Unhandled PayPal event type: ${event_type}`);
    }
  } catch (error) {
    console.error('Error handling PayPal webhook:', error);
    throw error;
  }
};

/**
 * Verifies PayPal webhook signature
 * @param {Object} headers - Request headers
 * @param {string} body - Request body
 * @param {string} webhookId - PayPal webhook ID
 * @returns {Promise<boolean>} - Whether the signature is valid
 */
const verifyWebhookSignature = async (headers, body, webhookId) => {
  try {
    // This is a simplified version - in production, you should implement proper verification
    // using PayPal's verify-webhook-signature API
    return true;
  } catch (error) {
    console.error('Error verifying PayPal webhook signature:', error);
    return false;
  }
};

/**
 * Tests PayPal API credentials
 * @param {Object} credentials - PayPal API credentials
 * @returns {Promise<Object>} - Test result
 */
const testCredentials = async (credentials) => {
  try {
    const { clientId, clientSecret } = credentials;
    
    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: 'Missing PayPal credentials'
      };
    }
    
    // Try to get an access token to verify credentials
    await getAccessToken({
      clientId,
      clientSecret,
      environment: 'sandbox'
    });
    
    return {
      success: true,
      message: 'PayPal credentials are valid'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Invalid PayPal credentials'
    };
  }
};

module.exports = {
  createOrder,
  capturePayment,
  handleWebhookEvent,
  verifyWebhookSignature,
  testCredentials,
  getPayPalCredentials
};
