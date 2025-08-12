const admin = require('firebase-admin');
const { sendSMS } = require('./smsService');
const { sendPaymentLinkEmail } = require('./emailService');

/**
 * Send a payment link notification via SMS
 * @param {Object} data - The notification data
 * @returns {Promise<Object>} - The SMS response
 */
const sendPaymentLinkSMS = async (data) => {
  try {
    const { to, name, paymentUrl, description, amount, currency, merchantId } = data;
    
    // Validate required fields
    if (!to || !paymentUrl) {
      throw new Error('Phone number and payment URL are required');
    }
    
    // Format the message
    const message = `Hello ${name || 'there'},\n\nYou have a payment request for ${currency || 'KES'} ${amount || ''}.\n\n${description || 'Payment request'}\n\nPay here: ${paymentUrl}\n\nThank you.`;
    
    // Format phone number to ensure it starts with 254
    let formattedPhone = to.toString().trim();
    formattedPhone = formattedPhone.replace(/^\+|^0+|\s+/g, "");
    if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }
    
    // Send the SMS
    const response = await sendSMS(formattedPhone, message);
    
    // Log the notification in Firestore
    await admin.firestore().collection('notifications').add({
      type: 'sms',
      recipient: formattedPhone,
      recipientName: name,
      message,
      paymentUrl,
      merchantId,
      status: response.success ? 'sent' : 'failed',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('Payment link SMS notification sent successfully to:', formattedPhone);
    return response;
  } catch (error) {
    console.error('Error sending payment link SMS:', error);
    throw error;
  }
};

/**
 * Send a payment link notification via email
 * @param {Object} data - The notification data
 * @returns {Promise<Object>} - The email response
 */
const sendPaymentLinkEmailNotification = async (data) => {
  try {
    const { to, name, paymentUrl, description, amount, currency, merchantId } = data;
    
    // Validate required fields
    if (!to || !paymentUrl) {
      throw new Error('Email and payment URL are required');
    }
    
    // Send the email
    const response = await sendPaymentLinkEmail(to, name, paymentUrl, description, amount, currency);
    
    // Log the notification in Firestore
    await admin.firestore().collection('notifications').add({
      type: 'email',
      recipient: to,
      recipientName: name,
      paymentUrl,
      description,
      amount,
      currency,
      merchantId,
      status: 'sent',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('Payment link email notification logged successfully');
    return response;
  } catch (error) {
    console.error('Error sending payment link email:', error);
    throw error;
  }
};

/**
 * Add a new customer to the merchant's customers collection
 * @param {Object} customerData - The customer data
 * @param {string} merchantId - The merchant ID
 * @returns {Promise<Object>} - The new customer data with ID
 */
const addCustomer = async (customerData, merchantId) => {
  try {
    // Validate required fields
    if (!merchantId) {
      throw new Error('Merchant ID is required');
    }
    
    if (!customerData.name) {
      throw new Error('Customer name is required');
    }
    
    if (!customerData.email && !customerData.phoneNumber) {
      throw new Error('Either email or phone number is required');
    }
    
    // Add customer to Firestore
    const customerRef = await admin.firestore()
      .collection('merchants')
      .doc(merchantId)
      .collection('customers')
      .add({
        ...customerData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        totalSpent: 0,
        totalTransactions: 0
      });
    
    // Get the customer data with ID
    const customerDoc = await customerRef.get();
    
    return {
      id: customerRef.id,
      ...customerDoc.data()
    };
  } catch (error) {
    console.error('Error adding customer:', error);
    throw error;
  }
};

module.exports = {
  sendPaymentLinkSMS,
  sendPaymentLinkEmailNotification,
  addCustomer
};
