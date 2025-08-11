const stripe = require('stripe');
const admin = require('firebase-admin');
const { doc: firestoreDoc, getDoc } = require("firebase/firestore");
const { db: firestoreDb } = require("./firebase");

// Use a valid test key as fallback
const DEFAULT_STRIPE_SECRET_KEY = 'sk_test_51NxMhLIgdXRfgqGLJkEbCTxBEJLcRgGZyUBbKGnMmzYAGxRHDQpLDDpbXwHKe3XRxvVMKWoAOUkrSzxCVTxGq00Jf9Qy1Jb';

// Initialize Stripe with a function that gets the API key dynamically
let stripeClient = null;

/**
 * Gets a Stripe instance with the merchant's API key
 * @param {string} merchantId - The merchant's user ID
 * @returns {Promise<Object>} - Stripe instance
 */
const getStripeInstance = async (merchantId) => {
  if (!merchantId) {
    console.warn('No merchant ID provided, using default Stripe key');
    return stripe(DEFAULT_STRIPE_SECRET_KEY);
  }
  
  try {
    // Get merchant settings from Firestore
    const settingsRef = firestoreDoc(firestoreDb, 'merchantSettings', merchantId);
    const settingsDoc = await getDoc(settingsRef);
    
    if (!settingsDoc.exists()) {
      console.warn(`No settings found for merchant ${merchantId}, using default key`);
      return stripe(DEFAULT_STRIPE_SECRET_KEY);
    }
    
    const settings = settingsDoc.data();
    
    if (!settings.stripe || !settings.stripe.secretKey || !settings.stripe.enabled) {
      console.warn(`Stripe not properly configured for merchant ${merchantId}, using default key`);
      return stripe(DEFAULT_STRIPE_SECRET_KEY);
    }
    
    // Use the merchant's secret key
    return stripe(settings.stripe.secretKey);
  } catch (error) {
    console.error('Error getting Stripe instance:', error);
    // Fallback to default key
    return stripe(DEFAULT_STRIPE_SECRET_KEY);
  }
};
const { doc, updateDoc, serverTimestamp, getDoc } = require("firebase/firestore");
const { db } = require("./firebase");
const { sendPaymentConfirmationEmail } = require("./emailService");

/**
 * Creates a payment intent for Stripe
 * @param {Object} paymentData - Payment data including amount, currency, description
 * @returns {Promise<Object>} - Stripe payment intent object
 */
const createPaymentIntent = async (paymentData) => {
  try {
    const { amount, currency = 'usd', description, metadata = {}, transactionId, merchantId } = paymentData;
    
    if (!merchantId) {
      throw new Error('Merchant ID is required to create a payment intent');
    }
    
    // Get Stripe instance for this merchant
    const stripeInstance = await getStripeInstance(merchantId);
    
    // Convert amount to cents (Stripe requires amounts in smallest currency unit)
    const amountInCents = Math.round(amount * 100);
    
    const paymentIntent = await stripeInstance.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      description,
      metadata: {
        ...metadata,
        transactionId,
        merchantId,
      },
    });
    
    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error) {
    console.error('Error creating Stripe payment intent:', error);
    throw error;
  }
};

/**
 * Handles Stripe webhook events
 * @param {Object} event - Stripe webhook event
 * @returns {Promise<void>}
 */
const handleWebhookEvent = async (event) => {
  try {
    const { type, data } = event;
    
    // Extract merchant ID from metadata to get the right Stripe instance
    const merchantId = data?.object?.metadata?.merchantId;
    
    // We don't need a Stripe instance for webhook handling, just for verification
    // which is handled at the server.js level
    
    switch (type) {
      case 'payment_intent.succeeded':
        await handleSuccessfulPayment(data.object);
        break;
      case 'payment_intent.payment_failed':
        await handleFailedPayment(data.object);
        break;
      default:
        console.log(`Unhandled event type: ${type}`);
    }
  } catch (error) {
    console.error('Error handling Stripe webhook:', error);
    throw error;
  }
};

/**
 * Handles successful Stripe payments
 * @param {Object} paymentIntent - Stripe payment intent object
 * @returns {Promise<void>}
 */
const handleSuccessfulPayment = async (paymentIntent) => {
  try {
    const { metadata, amount, id: stripePaymentId } = paymentIntent;
    const { transactionId } = metadata;
    
    if (!transactionId) {
      console.error('No transaction ID found in payment intent metadata');
      return;
    }
    
    // Update transaction in Firestore
    const transactionRef = doc(db, 'transactions', transactionId);
    await updateDoc(transactionRef, {
      status: 'success',
      stripePaymentId,
      completedAt: serverTimestamp(),
      paymentProcessor: 'stripe'
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
          paymentMethod: 'Credit/Debit Card',
          description: transactionData.description,
          receiptNumber: stripePaymentId
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
 * Handles failed Stripe payments
 * @param {Object} paymentIntent - Stripe payment intent object
 * @returns {Promise<void>}
 */
const handleFailedPayment = async (paymentIntent) => {
  try {
    const { metadata, id: stripePaymentId, last_payment_error } = paymentIntent;
    const { transactionId } = metadata;
    
    if (!transactionId) {
      console.error('No transaction ID found in payment intent metadata');
      return;
    }
    
    // Update transaction in Firestore
    const transactionRef = doc(db, 'transactions', transactionId);
    await updateDoc(transactionRef, {
      status: 'failed',
      stripePaymentId,
      failureReason: last_payment_error?.message || 'Payment failed',
      updatedAt: serverTimestamp(),
      paymentProcessor: 'stripe'
    });
    
    console.log(`Transaction ${transactionId} marked as failed`);
  } catch (error) {
    console.error('Error handling failed payment:', error);
    throw error;
  }
};

module.exports = {
  createPaymentIntent,
  handleWebhookEvent,
  getStripeInstance,
};
