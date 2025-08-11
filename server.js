const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const moment = require("moment");
const cors = require("cors");
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const stripe = require('stripe');
const { doc, updateDoc, serverTimestamp, getDoc } = require("firebase/firestore");
const { db } = require("./firebase");
const { 
  sendOrderConfirmationEmail, 
  sendOrderStatusUpdateEmail, 
  sendOrderCancellationEmail,
  sendPaymentConfirmationEmail
} = require('./emailService');
const { processTransactionInvoice, storeCustomerInformation } = require('./invoiceService');
const { checkUnpaidLinks, sendManualReminder } = require('./reminderService');
const { createPaymentIntent, handleWebhookEvent: handleStripeWebhook, getStripeInstance } = require('./stripeService');
const { initializeTransaction, verifyTransaction, handleWebhookEvent: handlePaystackWebhook, getPaystackSecretKey } = require('./paystackService');

// Add environment variables for email configuration
require('dotenv').config();

const app = express();

// Increase the size limit for JSON payloads
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: false, limit: '10mb' }));

// Get allowed origins from environment variable or use default values
const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
  process.env.ALLOWED_ORIGINS.split(',') : 
  [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://paynow-frontend.onrender.com'
  ];

// Configure CORS with proper options
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS for origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Add middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  console.log('Request Headers:', req.headers);
  console.log('Request Body:', req.body);
  console.log('Origin:', req.headers.origin);
  
  // Add CORS headers manually for preflight requests
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Custom response handler
const sendJsonResponse = (res, statusCode, data) => {
  res.status(statusCode).json(data);
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  sendJsonResponse(res, 500, {
    ResponseCode: "1",
    errorMessage: err.message || 'Internal server error'
  });
});

// ACCESS TOKEN FUNCTION
async function getAccessToken() {
  const consumer_key = "frmypHgIJYc7mQuUu5NBvnYc0kF1StP3"; 
  const consumer_secret = "UAeJAJLNUkV5MLpL"; 
  const url = "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const auth = "Basic " + Buffer.from(consumer_key + ":" + consumer_secret).toString("base64");

  try {
    console.log('Requesting access token...');
    const response = await axios.get(url, {
      headers: {
        Authorization: auth,
      },
    });
    console.log('Access token response:', response.data);
    const accessToken = response.data.access_token;
    return accessToken;
  } catch (error) {
    console.error('Error getting access token:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      error: error.message
    });
    throw new Error('Failed to get access token: ' + (error.response?.data?.errorMessage || error.message));
  }
}

// Routes
app.get("/", (req, res) => {
  sendJsonResponse(res, 200, { 
    ResponseCode: "0",
    message: "M-Pesa API Server is running" 
  });
});

app.get("/access_token", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    sendJsonResponse(res, 200, { 
      ResponseCode: "0",
      accessToken 
    });
  } catch (error) {
    console.error('Access token error:', error);
    sendJsonResponse(res, 500, { 
      ResponseCode: "1",
      errorMessage: error.message 
    });
  }
});

// Validation URL endpoint
app.post("/validation/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const validationData = req.body;
    
    console.log('Received M-Pesa validation request for order:', orderId, validationData);

    // Store validation request in Firestore
    if (orderId) {
      try {
        // Check if this is a transaction or an order
        const transactionRef = doc(db, 'transactions', orderId);
        const transactionDoc = await getDoc(transactionRef);
        
        if (transactionDoc.exists()) {
          // Update the transaction with validation data
          await updateDoc(transactionRef, {
            validationRequest: {
              TransactionType: validationData.TransactionType || "Pay Bill",
              TransID: validationData.TransID || "",
              TransTime: validationData.TransTime || "",
              TransAmount: validationData.TransAmount || "",
              BusinessShortCode: validationData.BusinessShortCode || "",
              BillRefNumber: validationData.BillRefNumber || "",
              InvoiceNumber: validationData.InvoiceNumber || "",
              OrgAccountBalance: validationData.OrgAccountBalance || "",
              ThirdPartyTransID: validationData.ThirdPartyTransID || "",
              MSISDN: validationData.MSISDN || "",
              FirstName: validationData.FirstName || "",
              MiddleName: validationData.MiddleName || "",
              LastName: validationData.LastName || ""
            },
            validationTimestamp: serverTimestamp(),
            validationStatus: 'received'
          });
          console.log('Validation data stored for transaction:', orderId);
        } else {
          // Try as an order instead
          const orderRef = doc(db, 'orders', orderId);
          const orderDoc = await getDoc(orderRef);
          
          if (orderDoc.exists()) {
            await updateDoc(orderRef, {
              validationRequest: {
                TransactionType: validationData.TransactionType || "Pay Bill",
                TransID: validationData.TransID || "",
                TransTime: validationData.TransTime || "",
                TransAmount: validationData.TransAmount || "",
                BusinessShortCode: validationData.BusinessShortCode || "",
                BillRefNumber: validationData.BillRefNumber || "",
                InvoiceNumber: validationData.InvoiceNumber || "",
                OrgAccountBalance: validationData.OrgAccountBalance || "",
                ThirdPartyTransID: validationData.ThirdPartyTransID || "",
                MSISDN: validationData.MSISDN || "",
                FirstName: validationData.FirstName || "",
                MiddleName: validationData.MiddleName || "",
                LastName: validationData.LastName || ""
              },
              validationTimestamp: serverTimestamp(),
              validationStatus: 'received'
            });
            console.log('Validation data stored for order:', orderId);
          } else {
            console.warn('No transaction or order found with ID:', orderId);
          }
        }
      } catch (dbError) {
        console.error('Error storing validation data:', dbError);
        // Continue processing - we don't want to fail the validation
      }
    }

    // Always respond with success to M-Pesa
    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });
  } catch (error) {
    console.error('Validation error:', error);
    // Still send success response to M-Pesa
    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });
  }
});

app.post("/stkpush", async (req, res) => {
  try {
    console.log("Received STK push request:", req.body);
    
    // Validate required fields
    if (!req.body.phone || !req.body.amount || !req.body.orderId) {
      console.error('Missing required fields:', req.body);
      return sendJsonResponse(res, 400, {
        ResponseCode: "1",
        errorMessage: "Missing required fields. Please provide 'phone', 'amount', and 'orderId'"
      });
    }

    let phoneNumber = req.body.phone;
    const amount = req.body.amount;
    const orderId = req.body.orderId;

    // Format the phone number
    phoneNumber = phoneNumber.toString().trim();
    // Remove leading zeros, plus, or spaces
    phoneNumber = phoneNumber.replace(/^\+|^0+|\s+/g, "");
    // Add country code if not present
    if (!phoneNumber.startsWith("254")) {
      phoneNumber = "254" + phoneNumber;
    }

    // Validate phone number format
    if (!/^254\d{9}$/.test(phoneNumber)) {
      console.error('Invalid phone number format:', phoneNumber);
      return sendJsonResponse(res, 400, {
        ResponseCode: "1",
        errorMessage: "Invalid phone number format. Must be 12 digits starting with 254"
      });
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      console.error('Invalid amount:', amount);
      return sendJsonResponse(res, 400, {
        ResponseCode: "1",
        errorMessage: "Invalid amount. Must be a positive number"
      });
    }

    const accessToken = await getAccessToken();
    const url = "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
    const auth = "Bearer " + accessToken;
    const timestampx = moment().format("YYYYMMDDHHmmss");
    const password = Buffer.from(
      "4121151" +
        "68cb945afece7b529b4a0901b2d8b1bb3bd9daa19bfdb48c69bec8dde962a932" +
        timestampx
    ).toString("base64");

    const requestBody = {
      BusinessShortCode: "4121151",
      Password: password,
      Timestamp: timestampx,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: "4121151",
      PhoneNumber: phoneNumber,
      CallBackURL: `${process.env.BASE_URL}/callback/${orderId}`,
      AccountReference: "PAYNOW",
      TransactionDesc: "Payment for order",
    };

    console.log('Making STK push request:', {
      url,
      body: requestBody,
      headers: { Authorization: auth }
    });

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
      });

      console.log('STK push response:', response.data);
      
      // Ensure the response has the expected format
      if (!response.data.ResponseCode && response.data.ResponseCode !== "0") {
        throw new Error('Invalid response format from M-Pesa API');
      }

      // Send response with proper headers
      res.setHeader('Content-Type', 'application/json');
      res.json({
        ResponseCode: "0",
        ResponseDescription: "Success. Request accepted for processing",
        CheckoutRequestID: response.data.CheckoutRequestID,
        CustomerMessage: response.data.CustomerMessage,
        orderId: orderId
      });
    } catch (mpesaError) {
      console.error('M-Pesa API error:', mpesaError.response?.data || mpesaError);
      return sendJsonResponse(res, 502, {
        ResponseCode: "1",
        errorMessage: mpesaError.response?.data?.errorMessage || 'M-Pesa API request failed'
      });
    }
  } catch (error) {
    console.error('STK push error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      error: error.message
    });

    // Send error response with proper headers
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      ResponseCode: "1",
      ResponseDescription: error.message || "Failed to initiate payment"
    });
  }
});

// Function to send SMS notifications
const sendSMSNotification = async (phoneNumber, message) => {
  try {
    // Format phone number to ensure it starts with 254
    let formattedPhone = phoneNumber.toString().trim();
    formattedPhone = formattedPhone.replace(/^\+|^0+|\s+/g, "");
    if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    const data = JSON.stringify({
      apiKey: 'f9e412887a42ff4938baa34971e0b096',
      shortCode: 'VasPro',
      message: message,
      recipient: formattedPhone,
      callbackURL: '',
      enqueue: 1,
      isScheduled: false,
    });

    const options = {
      hostname: 'api.vaspro.co.ke',
      port: 443,
      path: '/v3/BulkSMS/api/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    return new Promise((resolve, reject) => {
      const smsReq = https.request(options, (smsRes) => {
        let responseData = '';

        smsRes.on('data', (chunk) => {
          responseData += chunk;
        });

        smsRes.on('end', () => {
          console.log('SMS sent successfully:', responseData);
          resolve(responseData);
        });
      });

      smsReq.on('error', (error) => {
        console.error('Error sending SMS:', error);
        reject(error);
      });

      smsReq.write(data);
      smsReq.end();
    });
  } catch (error) {
    console.error('SMS sending error:', error);
    throw error;
  }
};

// Update the callback endpoint to include SMS notification and store validation data
app.post("/callback/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const callbackData = req.body;
    
    console.log('Received M-Pesa callback for order:', orderId, callbackData);

    // Update transaction status in Firebase
    const transactionRef = doc(db, 'transactions', orderId);
    const transactionDoc = await getDoc(transactionRef);
    
    if (transactionDoc.exists()) {
      const transactionData = transactionDoc.data();
      
      let newStatus = 'failed';
      let mpesaReceiptNumber = null;
      let resultDesc = 'Payment failed';

      if (callbackData.Body.stkCallback.ResultCode === 0) {
        newStatus = 'success';
        resultDesc = 'Payment successful';
        const callbackItems = callbackData.Body.stkCallback.CallbackMetadata?.Item;
        if (callbackItems) {
          const receiptItem = callbackItems.find(item => item.Name === 'MpesaReceiptNumber');
          if (receiptItem) {
            mpesaReceiptNumber = receiptItem.Value;
          }
        }
      } else {
        resultDesc = callbackData.Body.stkCallback.ResultDesc || 'Payment failed';
      }

      // Extract additional data from callback metadata if available
      let phoneNumber = transactionData.payerPhone || "";
      let firstName = "Customer";
      let middleName = "";
      let lastName = "";
      let transactionDate = moment().format("YYYYMMDDHHmmss");
      let businessShortCode = callbackData.Body?.stkCallback?.BusinessShortCode || "4121151";
      
      // Try to extract real customer data from the callback
      if (callbackData.Body?.stkCallback?.CallbackMetadata?.Item) {
        const items = callbackData.Body.stkCallback.CallbackMetadata.Item;
        
        // Look for phone number
        const phoneItem = items.find(item => item.Name === 'PhoneNumber');
        if (phoneItem && phoneItem.Value) {
          phoneNumber = phoneItem.Value.toString();
        }
        
        // Look for transaction date
        const dateItem = items.find(item => item.Name === 'TransactionDate');
        if (dateItem && dateItem.Value) {
          transactionDate = dateItem.Value.toString();
        }
      }
      
      // Try to get customer name from transaction data or generate it
      if (transactionData.payerName) {
        const nameParts = transactionData.payerName.split(' ');
        firstName = nameParts[0] || "Customer";
        if (nameParts.length === 2) {
          lastName = nameParts[1] || ""; 
        } else if (nameParts.length > 2) {
          middleName = nameParts[1] || "";
          lastName = nameParts.slice(2).join(' ') || "";
        }
      }
      
      await updateDoc(transactionRef, {
        status: newStatus,
        mpesaResponse: callbackData, // Store the full callback data
        mpesaReceiptNumber: mpesaReceiptNumber,
        updatedAt: serverTimestamp(),
        resultDescription: resultDesc,
        callbackData: {
          TransactionType: "Pay Bill",
          TransID: mpesaReceiptNumber || "",
          TransTime: transactionDate,
          TransAmount: transactionData.amount?.toString() || "",
          BusinessShortCode: businessShortCode,
          BillRefNumber: orderId,
          InvoiceNumber: transactionData.invoiceNumber || "",
          OrgAccountBalance: transactionData.accountBalance || "",
          ThirdPartyTransID: transactionData.thirdPartyTransID || "",
          MSISDN: phoneNumber,
          FirstName: firstName,
          MiddleName: middleName,
          LastName: lastName
        }
      });
      
      // Generate invoice for successful payments
      if (newStatus === 'success') {
        try {
          // Update transaction with customer information
          const updatedTransactionData = {
            ...transactionData,
            status: newStatus,
            mpesaReceiptNumber: mpesaReceiptNumber,
            payerPhone: phoneNumber,
            payerName: `${firstName} ${middleName} ${lastName}`.trim(),
          };
          
          // Store customer information
          await storeCustomerInformation(updatedTransactionData);
          
          // Generate and store invoice
          const invoiceUrl = await processTransactionInvoice(updatedTransactionData);
          console.log('Invoice generated successfully:', invoiceUrl);
        } catch (invoiceError) {
          console.error('Error generating invoice:', invoiceError);
          // Don't fail the callback if invoice generation fails
        }
      }

      // Send SMS notification if successful
      if (newStatus === 'success') {
        // Include invoice link in the SMS if available
        let invoiceMessage = '';
        if (transactionData.invoiceUrl) {
          invoiceMessage = ` Your invoice is available at: ${transactionData.invoiceUrl}`;
        }
        
        const message = `Thank you for your payment of KES ${transactionData.amount} for ${transactionData.description}! Your transaction was successful. Receipt: ${mpesaReceiptNumber}. Transaction ID: ${orderId.substring(0, 8)}.${invoiceMessage} Thank you for using PayNow.`;
        try {
          await sendSMSNotification(transactionData.payerPhone, message);
          console.log('SMS notification sent successfully to:', transactionData.payerPhone);
        } catch (smsError) {
          console.error('Failed to send SMS notification:', smsError);
        }
        
        // Send email confirmation if email is available
        if (transactionData.payerEmail) {
          try {
            await sendPaymentConfirmationEmail({
              transactionId: orderId,
              email: transactionData.payerEmail,
              customerName: `${firstName} ${middleName} ${lastName}`.trim(),
              amount: transactionData.amount,
              currency: transactionData.currency || 'KES',
              paymentMethod: 'M-Pesa',
              description: transactionData.description,
              receiptNumber: mpesaReceiptNumber
            });
            console.log('Email confirmation sent successfully to:', transactionData.payerEmail);
          } catch (emailError) {
            console.error('Failed to send email confirmation:', emailError);
          }
        }
      }
    }

    console.log('Transaction updated successfully:', orderId);

    // Always respond with success to M-Pesa
    res.json({
      ResponseCode: "0",
      ResponseDesc: "Success"
    });
  } catch (error) {
    console.error('Callback error:', error);
    // Still send success response to M-Pesa
    res.json({
      ResponseCode: "0",
      ResponseDesc: "Success"
    });
  }
});

app.post("/query", async (req, res) => {
  try {
    console.log("Received query request:", req.body);
    const queryCode = req.body.queryCode;

    if (!queryCode) {
      console.error('Missing queryCode parameter');
      return sendJsonResponse(res, 200, {
        ResponseCode: "1",
        ResultCode: "1",
        ResultDesc: "Missing queryCode parameter",
        errorMessage: "Missing queryCode parameter"
      });
    }

    const accessToken = await getAccessToken();
    const url = "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query";
    const auth = "Bearer " + accessToken;
    const timestampx = moment().format("YYYYMMDDHHmmss");
    const password = Buffer.from(
      "4121151" +
        "68cb945afece7b529b4a0901b2d8b1bb3bd9daa19bfdb48c69bec8dde962a932" +
        timestampx
    ).toString("base64");

    const requestBody = {
      BusinessShortCode: "4121151", //change this to the correct Till number 
      Password: password,
      Timestamp: timestampx,
      CheckoutRequestID: queryCode,
    };

    console.log('Making query request:', {
      url,
      body: requestBody,
      headers: { Authorization: auth }
    });

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
      });

      console.log('Query response:', response.data);
      
      // Check for successful payment
      if (response.data.ResultCode === "0") {
        // Payment was successful
        return sendJsonResponse(res, 200, {
          ResponseCode: "0",
          ResultCode: "0",
          ResultDesc: "The service request is processed successfully.",
          isSuccessful: true
        });
      }
      
      // Check for specific error codes that indicate cancellation
      if (response.data.ResultCode === "1032") {
        return sendJsonResponse(res, 200, {
          ResponseCode: "3", // Custom code for cancellation
          ResultCode: "1032",
          ResultDesc: "Transaction canceled by user",
          errorMessage: "Transaction was canceled",
          isCanceled: true
        });
      }

      // Special case for ResultCode 4999 - "The transaction is still under processing"
      // This should be treated as processing, not as an error
      if (response.data.ResultCode === "4999" || response.data.ResultCode === 4999) {
        return sendJsonResponse(res, 200, {
          ResponseCode: "2", // Custom code for processing
          ResultCode: "4999",
          ResultDesc: "The transaction is still under processing",
          isProcessing: true
        });
      }

      // Handle successful response
      return sendJsonResponse(res, 200, {
        ...response.data,
        ResponseCode: response.data.ResponseCode || "0"
      });
    } catch (mpesaError) {
      console.error('M-Pesa API error response:', mpesaError.response?.data);
      
      // Check for specific error codes
      const errorCode = mpesaError.response?.data?.errorCode;
      const errorMessage = mpesaError.response?.data?.errorMessage;

      // Check if it's a processing status error
      if (errorCode === '500.001.1001') {
        return sendJsonResponse(res, 200, {
          ResponseCode: "2", // Custom code for processing
          ResultCode: "2",
          ResultDesc: "The transaction is being processed",
          errorMessage: errorMessage,
          isProcessing: true
        });
      }

      // Check if it's a cancellation error
      if (errorCode === '500.001.1032') {
        return sendJsonResponse(res, 200, {
          ResponseCode: "3", // Custom code for cancellation
          ResultCode: "1032",
          ResultDesc: "Transaction canceled by user",
          errorMessage: errorMessage,
          isCanceled: true
        });
      }

      // Handle other M-Pesa API errors
      return sendJsonResponse(res, 200, {
        ResponseCode: "1",
        ResultCode: "1",
        ResultDesc: errorMessage || "Failed to check payment status",
        errorMessage: errorMessage || "Payment query failed"
      });
    }
  } catch (error) {
    console.error('Query error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      error: error.message
    });

    // Return a structured error response
    return sendJsonResponse(res, 200, {
      ResponseCode: "1",
      ResultCode: "1",
      ResultDesc: error.message || "Failed to check payment status",
      errorMessage: error.message || "Payment query failed"
    });
  }
});

// Update the order status update endpoint to include enhanced notification tracking
app.post("/update-order-status", async (req, res) => {
  try {
    const { orderId, newStatus } = req.body;

    if (!orderId || !newStatus) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Order ID and new status are required"
      });
    }

    const orderRef = doc(db, 'orders', orderId);
    const orderDoc = await getDoc(orderRef);

    if (!orderDoc.exists()) {
      return res.status(404).json({
        ResponseCode: "1",
        errorMessage: "Order not found"
      });
    }

    const orderData = orderDoc.data();

    // Check if notification was already sent for this status
    if (orderData.lastNotificationStatus === newStatus && orderData.notificationSent) {
      return res.json({
        ResponseCode: "0",
        message: "Status already updated and notification sent"
      });
    }

    // Update order status
    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });

    try {
      // Send email notification
      await sendOrderStatusUpdateEmail(orderData, newStatus);
      console.log('Status update email sent successfully for order:', orderId);

      // Send SMS notification based on status
      let message = '';
      switch (newStatus) {
        case 'processing':
          message = `Your PayNow order #${orderId.slice(-6)} is being processed. We'll notify you when it ships.`;
          break;
        case 'shipped':
          message = `Great news! Your PayNow order #${orderId.slice(-6)} has been shipped and is on its way.`;
          break;
        case 'delivered':
          message = `Your PayNow order #${orderId.slice(-6)} has been delivered. Thank you for shopping with us!`;
          break;
        default:
          message = `Your PayNow order #${orderId.slice(-6)} status has been updated to: ${newStatus}`;
      }
      
      await sendSMSNotification(orderData.shippingDetails.phone, message);
      console.log('Status update SMS sent successfully for order:', orderId);

      // Update notification tracking
      await updateDoc(orderRef, {
        notificationSent: true,
        lastNotificationStatus: newStatus,
        lastNotificationTime: serverTimestamp(),
        notificationHistory: [...(orderData.notificationHistory || []), {
          type: 'status_update',
          status: newStatus,
          emailSent: true,
          smsSent: true,
          timestamp: serverTimestamp()
        }]
      });

      res.json({
        ResponseCode: "0",
        message: "Order status updated and notifications sent successfully"
      });
    } catch (notificationError) {
      console.error('Error sending notifications:', notificationError);
      
      // Update notification tracking with error
      await updateDoc(orderRef, {
        notificationSent: false,
        notificationError: notificationError.message,
        notificationHistory: [...(orderData.notificationHistory || []), {
          type: 'status_update',
          status: newStatus,
          error: notificationError.message,
          timestamp: serverTimestamp()
        }]
      });

      throw notificationError;
    }
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to update order status"
    });
  }
});

// Update the order cancellation endpoint to include SMS
app.post("/cancel-order", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Order ID is required"
      });
    }

    const orderRef = doc(db, 'orders', orderId);
    const orderDoc = await getDoc(orderRef);

    if (!orderDoc.exists()) {
      return res.status(404).json({
        ResponseCode: "1",
        errorMessage: "Order not found"
      });
    }

    const orderData = orderDoc.data();
    await updateDoc(orderRef, {
      status: 'cancelled',
      updatedAt: serverTimestamp()
    });

    // Send cancellation email
    await sendOrderCancellationEmail(orderData);

    // Send SMS notification
    const message = `Your PayNow order #${orderId.slice(-6)} has been cancelled. Any payment made will be refunded within 5-7 business days.`;
    await sendSMSNotification(orderData.shippingDetails.phone, message);

    res.json({
      ResponseCode: "0",
      message: "Order cancelled successfully"
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to cancel order"
    });
  }
});

// Add verification notification endpoint
app.post("/api/notifications/verification", async (req, res) => {
  try {
    const { userId, status, rejectionReason, adminId } = req.body;
    
    if (!userId || !status || !adminId) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Missing required parameters"
      });
    }
    
    // Import verification service
    const { updateVerificationStatus } = require('./verificationService');
    
    // Update verification status and send notifications
    const result = await updateVerificationStatus(userId, status, rejectionReason || '', adminId);
    
    res.json({
      ResponseCode: "0",
      message: `Verification ${status} notification sent successfully`
    });
  } catch (error) {
    console.error('Error sending verification notification:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to send verification notification"
    });
  }
});

const PORT = 8000; // Changed port to 8000
// Add endpoint for checking unpaid links and sending reminders
app.post("/check-unpaid-links", async (req, res) => {
  try {
    console.log('Received request to check unpaid links');
    const processedLinks = await checkUnpaidLinks();
    
    res.json({
      ResponseCode: "0",
      message: `Processed ${processedLinks.length} links for reminders`,
      processedLinks
    });
  } catch (error) {
    console.error('Error checking unpaid links:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to check unpaid links"
    });
  }
});

// Add endpoint for sending manual reminders
app.post("/send-reminder", async (req, res) => {
  try {
    const { linkId, phoneNumber, reminderType } = req.body;
    
    if (!linkId || !phoneNumber) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Link ID and phone number are required"
      });
    }
    
    const result = await sendManualReminder(linkId, phoneNumber, reminderType || 'manual');
    
    if (result.success) {
      res.json({
        ResponseCode: "0",
        message: result.message,
        result
      });
    } else {
      res.status(400).json({
        ResponseCode: "1",
        errorMessage: result.message,
        result
      });
    }
  } catch (error) {
    console.error('Error sending manual reminder:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to send reminder"
    });
  }
});

// Stripe payment endpoint
app.post("/stripe/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency, description, metadata, transactionId, merchantId } = req.body;
    
    if (!amount || !transactionId) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Amount and transaction ID are required"
      });
    }
    
    if (!merchantId) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Merchant ID is required"
      });
    }
    
    const paymentIntent = await createPaymentIntent({
      amount,
      currency,
      description,
      metadata,
      transactionId,
      merchantId
    });
    
    res.json({
      ResponseCode: "0",
      clientSecret: paymentIntent.clientSecret,
      paymentIntentId: paymentIntent.paymentIntentId
    });
  } catch (error) {
    console.error('Error creating Stripe payment intent:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to create payment intent"
    });
  }
});

// Stripe webhook endpoint
app.post("/stripe/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
      // For webhook verification, we use a different key than for API calls
      const stripeModule = require('stripe');
      // Use a hardcoded key for testing - in production, use environment variable
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_your_stripe_webhook_secret_here';
      const stripeClient = stripeModule(process.env.STRIPE_SECRET_KEY || 'sk_test_51O2KBJFYIgdXRfgqGLqVGQJHRxBEJLcRgGZyUBbKGnMmzYAGxRHDQpLDDpbXwHKe3XRxvVMKWoAOUkrSzxCVTxGq00Jf9Qy1Jb');
      
      event = stripeClient.webhooks.constructEvent(
        req.body,
        sig,
        webhookSecret
      );
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle the event
    await handleStripeWebhook(event);
    
    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
  } catch (error) {
    console.error('Error handling Stripe webhook:', error);
    res.status(500).json({
      error: error.message || "Failed to process webhook"
    });
  }
});

// Paystack initialization endpoint
app.post("/paystack/initialize", async (req, res) => {
  try {
    const { amount, email, reference, callbackUrl, metadata, merchantId } = req.body;
    
    if (!amount || !email || !reference) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Amount, email, and reference are required"
      });
    }
    
    if (!merchantId) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Merchant ID is required"
      });
    }
    
    const transaction = await initializeTransaction({
      amount,
      email,
      reference,
      callbackUrl,
      metadata,
      merchantId
    });
    
    res.json({
      ResponseCode: "0",
      authorization_url: transaction.authorization_url,
      access_code: transaction.access_code,
      reference: transaction.reference
    });
  } catch (error) {
    console.error('Error initializing Paystack transaction:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to initialize transaction"
    });
  }
});

// Paystack verification endpoint
app.get("/paystack/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const { merchantId } = req.query;
    
    if (!reference) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Reference is required"
      });
    }
    
    if (!merchantId) {
      return res.status(400).json({
        ResponseCode: "1",
        errorMessage: "Merchant ID is required"
      });
    }
    
    const transaction = await verifyTransaction(reference, merchantId);
    
    if (transaction.status === 'success') {
      res.json({
        ResponseCode: "0",
        status: transaction.status,
        reference: transaction.reference,
        amount: transaction.amount / 100, // Convert back from kobo to naira
        transaction
      });
    } else {
      res.json({
        ResponseCode: "2",
        status: transaction.status,
        reference: transaction.reference,
        message: transaction.gateway_response || "Payment not successful",
        transaction
      });
    }
  } catch (error) {
    console.error('Error verifying Paystack transaction:', error);
    res.status(500).json({
      ResponseCode: "1",
      errorMessage: error.message || "Failed to verify transaction"
    });
  }
});

// Paystack webhook endpoint
app.post("/paystack/webhook", async (req, res) => {
  try {
    // Validate that the request is from Paystack
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
                       .update(JSON.stringify(req.body))
                       .digest('hex');
                       
    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    // Handle the event
    await handlePaystackWebhook(req.body);
    
    // Return a 200 response to acknowledge receipt of the event
    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling Paystack webhook:', error);
    res.status(500).json({
      error: error.message || "Failed to process webhook"
    });
  }
});

// Schedule automatic reminder checks (every hour)
setInterval(async () => {
  try {
    console.log('Running scheduled check for unpaid links...');
    await checkUnpaidLinks();
  } catch (error) {
    console.error('Error in scheduled unpaid links check:', error);
  }
}, 60 * 60 * 1000); // 1 hour

// API key testing endpoints
app.post("/test-stripe-key", async (req, res) => {
  try {
    const { secretKey } = req.body;
    
    if (!secretKey || !secretKey.startsWith('sk_')) {
      return res.status(400).json({
        success: false,
        error: "Invalid Stripe secret key format"
      });
    }
    
    // Try to create a Stripe instance with the provided key
    const stripeInstance = stripe(secretKey);
    
    // Try to fetch something simple to validate the key
    await stripeInstance.balance.retrieve();
    
    // If we got here, the key is valid
    res.json({
      success: true,
      message: "Stripe API key is valid"
    });
  } catch (error) {
    console.error('Error testing Stripe key:', error);
    res.status(400).json({
      success: false,
      error: error.message || "Invalid Stripe API key"
    });
  }
});

app.post("/test-paystack-key", async (req, res) => {
  try {
    const { secretKey } = req.body;
    
    if (!secretKey || !secretKey.startsWith('sk_')) {
      return res.status(400).json({
        success: false,
        error: "Invalid Paystack secret key format"
      });
    }
    
    // Try to make a simple API call to Paystack
    const response = await axios.get('https://api.paystack.co/transaction', {
      headers: {
        'Authorization': `Bearer ${secretKey}`
      }
    });
    
    // If we got here, the key is valid
    res.json({
      success: true,
      message: "Paystack API key is valid"
    });
  } catch (error) {
    console.error('Error testing Paystack key:', error);
    res.status(400).json({
      success: false,
      error: error.response?.data?.message || error.message || "Invalid Paystack API key"
    });
  }
});

// Health check endpoint
app.use('/api/health', require('./api/health'));

// Serve static files if in production
if (process.env.NODE_ENV === 'production') {
  // Set static folder
  app.use(express.static(path.join(__dirname, 'public')));

  // Any route that is not an API route will serve the index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`Payment API Server is running on port ${PORT}`);
});