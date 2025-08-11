const axios = require('axios');
const { doc, updateDoc, serverTimestamp, getDoc } = require("firebase/firestore");
const { db } = require("./firebase");
const { sendPaymentConfirmationEmail } = require("./emailService");

// Paystack API base URL
const PAYSTACK_API_URL = 'https://api.paystack.co';

// Default Paystack key for testing
const DEFAULT_PAYSTACK_SECRET_KEY = 'sk_test_c449a3c5c2bef1e8f7b87add1c6a5a9b1b66a88c';

/**
 * Gets the Paystack secret key for a merchant
 * @param {string} merchantId - The merchant's user ID
 * @returns {Promise<string>} - Paystack secret key
 */
const getPaystackSecretKey = async (merchantId) => {
  if (!merchantId) {
    console.warn('No merchant ID provided, using default Paystack key');
    return DEFAULT_PAYSTACK_SECRET_KEY;
  }
  
  try {
    // Get merchant settings from Firestore
    const settingsRef = doc(db, 'merchantSettings', merchantId);
    const settingsDoc = await getDoc(settingsRef);
    
    if (!settingsDoc.exists()) {
      console.warn(`No settings found for merchant ${merchantId}, using default key`);
      return DEFAULT_PAYSTACK_SECRET_KEY;
    }
    
    const settings = settingsDoc.data();
    
    if (!settings.paystack || !settings.paystack.secretKey || !settings.paystack.enabled) {
      console.warn(`Paystack not properly configured for merchant ${merchantId}, using default key`);
      return DEFAULT_PAYSTACK_SECRET_KEY;
    }
    
    return settings.paystack.secretKey;
  } catch (error) {
    console.error('Error getting Paystack secret key:', error);
    return DEFAULT_PAYSTACK_SECRET_KEY;
  }
};

/**
 * Initializes a Paystack transaction
 * @param {Object} paymentData - Payment data including amount, email, reference
 * @returns {Promise<Object>} - Paystack initialization response
 */
const initializeTransaction = async (paymentData) => {
  try {
    const { amount, email, reference, callbackUrl, metadata = {}, merchantId } = paymentData;
    
    if (!merchantId) {
      throw new Error('Merchant ID is required to initialize a Paystack transaction');
    }
    
    // Get the merchant's Paystack secret key
    const secretKey = await getPaystackSecretKey(merchantId);
    
    // Convert amount to kobo (Paystack requires amounts in smallest currency unit)
    const amountInKobo = Math.round(amount * 100);
    
    const response = await axios.post(`${PAYSTACK_API_URL}/transaction/initialize`, {
      amount: amountInKobo,
      email,
      reference,
      callback_url: callbackUrl,
      metadata: {
        ...metadata,
        transactionId: reference,
        merchantId
      }
    }, {
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.data;
  } catch (error) {
    console.error('Error initializing Paystack transaction:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Verifies a Paystack transaction
 * @param {string} reference - Transaction reference
 * @param {string} merchantId - The merchant's user ID
 * @returns {Promise<Object>} - Verification response
 */
const verifyTransaction = async (reference, merchantId) => {
  try {
    if (!merchantId) {
      throw new Error('Merchant ID is required to verify a Paystack transaction');
    }
    
    // Get the merchant's Paystack secret key
    const secretKey = await getPaystackSecretKey(merchantId);
    
    const response = await axios.get(`${PAYSTACK_API_URL}/transaction/verify/${reference}`, {
      headers: {
        'Authorization': `Bearer ${secretKey}`
      }
    });
    
    return response.data.data;
  } catch (error) {
    console.error('Error verifying Paystack transaction:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Handles Paystack webhook events
 * @param {Object} event - Paystack webhook event
 * @returns {Promise<void>}
 */
const handleWebhookEvent = async (event) => {
  try {
    const { event: eventType, data } = event;
    
    switch (eventType) {
      case 'charge.success':
        await handleSuccessfulPayment(data);
        break;
      case 'charge.failed':
        await handleFailedPayment(data);
        break;
      default:
        console.log(`Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    console.error('Error handling Paystack webhook:', error);
    throw error;
  }
};

/**
 * Handles successful Paystack payments
 * @param {Object} paymentData - Paystack payment data
 * @returns {Promise<void>}
 */
const handleSuccessfulPayment = async (paymentData) => {
  try {
    const { reference, metadata, customer } = paymentData;
    const transactionId = metadata?.transactionId || reference;
    
    if (!transactionId) {
      console.error('No transaction ID found in payment metadata');
      return;
    }
    
    // Update transaction in Firestore
    const transactionRef = doc(db, 'transactions', transactionId);
    await updateDoc(transactionRef, {
      status: 'success',
      paystackReference: reference,
      completedAt: serverTimestamp(),
      paymentProcessor: 'paystack'
    });
    
    // Get the full transaction data for the email
    const transactionDoc = await getDoc(transactionRef);
    if (transactionDoc.exists()) {
      const transactionData = transactionDoc.data();
      
      // Send email confirmation if email is available
      const email = transactionData.payerEmail || customer?.email;
      if (email) {
        await sendPaymentConfirmationEmail({
          transactionId,
          email: email,
          customerName: transactionData.payerName || customer?.name,
          amount: transactionData.amount,
          currency: transactionData.currency,
          paymentMethod: 'Paystack',
          description: transactionData.description,
          receiptNumber: reference
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
 * Handles failed Paystack payments
 * @param {Object} paymentData - Paystack payment data
 * @returns {Promise<void>}
 */
const handleFailedPayment = async (paymentData) => {
  try {
    const { reference, metadata, gateway_response } = paymentData;
    const transactionId = metadata?.transactionId || reference;
    
    if (!transactionId) {
      console.error('No transaction ID found in payment metadata');
      return;
    }
    
    // Update transaction in Firestore
    const transactionRef = doc(db, 'transactions', transactionId);
    await updateDoc(transactionRef, {
      status: 'failed',
      paystackReference: reference,
      failureReason: gateway_response || 'Payment failed',
      updatedAt: serverTimestamp(),
      paymentProcessor: 'paystack'
    });
    
    console.log(`Transaction ${transactionId} marked as failed`);
  } catch (error) {
    console.error('Error handling failed payment:', error);
    throw error;
  }
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  handleWebhookEvent,
  getPaystackSecretKey,
};
