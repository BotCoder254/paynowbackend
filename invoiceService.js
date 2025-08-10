const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { getStorage } = require('firebase-admin/storage');
const admin = require('firebase-admin');
const { doc, setDoc, collection, serverTimestamp } = require('firebase/firestore');
const { db } = require('./firebase');

// Initialize Firebase Admin if not already initialized
let adminApp;
try {
  adminApp = admin.app();
} catch (e) {
  adminApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || "twitterclone-47ebf",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "twitterclone-47ebf.appspot.com"
  });
}

// Get a reference to the storage service
const storage = getStorage(adminApp);
const bucket = storage.bucket();

/**
 * Generates an invoice PDF for a transaction
 * @param {Object} transactionData - The transaction data
 * @returns {Promise<string>} - URL of the stored PDF
 */
const generateInvoicePDF = async (transactionData) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Create a document
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Invoice ${transactionData.id}`,
          Author: 'PayNow',
        }
      });

      // Set up the PDF buffer
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      
      // When the PDF is done, resolve with the buffer
      doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(buffers);
        
        // Upload to Firebase Storage
        try {
          const fileName = `invoices/${transactionData.ownerUid}/${transactionData.id}.pdf`;
          const file = bucket.file(fileName);
          
          await file.save(pdfBuffer, {
            metadata: {
              contentType: 'application/pdf',
              metadata: {
                transactionId: transactionData.id,
                customerId: transactionData.payerPhone || 'unknown',
                amount: transactionData.amount,
                date: new Date().toISOString()
              }
            }
          });
          
          // Get a signed URL that expires in 1 week
          const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 1 week
          });
          
          // Store invoice reference in Firestore
          await storeInvoiceReference(transactionData, url, fileName);
          
          resolve(url);
        } catch (error) {
          console.error('Error uploading invoice to storage:', error);
          reject(error);
        }
      });

      // Add company logo if available
      try {
        // You would need to replace this with actual merchant logo retrieval
        // const merchantLogo = await getMerchantLogo(transactionData.ownerUid);
        // if (merchantLogo) {
        //   doc.image(merchantLogo, 50, 45, { width: 150 });
        // } else {
          // Default PayNow logo
          doc.fontSize(24).text('PayNow', 50, 45, { align: 'left' });
        // }
      } catch (error) {
        console.error('Error adding logo to invoice:', error);
        // Continue without logo
        doc.fontSize(24).text('PayNow', 50, 45, { align: 'left' });
      }

      // Add invoice header
      doc.fontSize(20).text('INVOICE', 50, 100);
      doc.moveDown();
      
      // Add invoice details
      doc.fontSize(12);
      doc.text(`Invoice Number: ${transactionData.id}`, 50, 140);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 50, 160);
      doc.text(`Receipt Number: ${transactionData.mpesaReceiptNumber || 'N/A'}`, 50, 180);
      
      // Add customer information
      doc.text('Bill To:', 50, 220);
      doc.text(`Name: ${transactionData.payerName || 'Customer'}`, 50, 240);
      doc.text(`Phone: ${transactionData.payerPhone || 'N/A'}`, 50, 260);
      doc.text(`Email: ${transactionData.payerEmail || 'N/A'}`, 50, 280);
      
      // Add transaction details
      doc.moveDown(2);
      
      // Create a table for items
      const invoiceTableTop = 330;
      doc.font('Helvetica-Bold');
      doc.text('Description', 50, invoiceTableTop);
      doc.text('Amount', 400, invoiceTableTop, { width: 90, align: 'right' });
      doc.moveTo(50, invoiceTableTop + 20).lineTo(500, invoiceTableTop + 20).stroke();
      doc.font('Helvetica');
      
      // Add the item
      doc.text(transactionData.description || 'Payment', 50, invoiceTableTop + 30);
      doc.text(`${transactionData.currency || 'KES'} ${transactionData.amount?.toLocaleString() || '0'}`, 400, invoiceTableTop + 30, { width: 90, align: 'right' });
      
      // Add total
      doc.moveTo(50, invoiceTableTop + 60).lineTo(500, invoiceTableTop + 60).stroke();
      doc.font('Helvetica-Bold');
      doc.text('Total:', 300, invoiceTableTop + 70);
      doc.text(`${transactionData.currency || 'KES'} ${transactionData.amount?.toLocaleString() || '0'}`, 400, invoiceTableTop + 70, { width: 90, align: 'right' });
      
      // Add payment information
      doc.moveDown(4);
      doc.font('Helvetica');
      doc.text('Payment Information', 50, invoiceTableTop + 120);
      doc.text(`Payment Method: M-Pesa`, 50, invoiceTableTop + 140);
      doc.text(`Transaction ID: ${transactionData.mpesaReceiptNumber || transactionData.id}`, 50, invoiceTableTop + 160);
      doc.text(`Payment Status: ${transactionData.status === 'success' ? 'Paid' : 'Pending'}`, 50, invoiceTableTop + 180);
      
      // Add footer
      doc.fontSize(10).text('Thank you for your business!', 50, 700, { align: 'center' });
      doc.text('This is a computer-generated document and requires no signature.', 50, 720, { align: 'center' });
      
      // Finalize the PDF
      doc.end();
      
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      reject(error);
    }
  });
};

/**
 * Store invoice reference in Firestore
 * @param {Object} transactionData - The transaction data
 * @param {string} invoiceUrl - The URL of the invoice PDF
 * @param {string} storagePath - The storage path of the invoice PDF
 */
const storeInvoiceReference = async (transactionData, invoiceUrl, storagePath) => {
  try {
    // Create invoice document
    const invoiceData = {
      transactionId: transactionData.id,
      merchantId: transactionData.ownerUid,
      customerId: transactionData.payerPhone || 'unknown',
      customerName: transactionData.payerName || 'Customer',
      customerEmail: transactionData.payerEmail || '',
      amount: transactionData.amount || 0,
      currency: transactionData.currency || 'KES',
      description: transactionData.description || 'Payment',
      status: transactionData.status || 'pending',
      invoiceUrl: invoiceUrl,
      storagePath: storagePath,
      mpesaReceiptNumber: transactionData.mpesaReceiptNumber || '',
      createdAt: serverTimestamp(),
    };
    
    // Add to invoices collection
    await setDoc(doc(db, 'invoices', transactionData.id), invoiceData);
    
    // Update transaction with invoice URL
    await setDoc(doc(db, 'transactions', transactionData.id), {
      invoiceUrl: invoiceUrl,
      hasInvoice: true
    }, { merge: true });
    
    // Store or update customer information
    await storeCustomerInformation(transactionData);
    
    console.log(`Invoice reference stored for transaction ${transactionData.id}`);
  } catch (error) {
    console.error('Error storing invoice reference:', error);
    throw error;
  }
};

/**
 * Store or update customer information in Firestore
 * @param {Object} transactionData - The transaction data
 */
const storeCustomerInformation = async (transactionData) => {
  try {
    if (!transactionData.payerPhone) {
      console.log('No customer phone number provided, skipping customer storage');
      return;
    }
    
    const customerId = transactionData.payerPhone;
    const merchantId = transactionData.ownerUid;
    
    // Check if customer exists
    const customerRef = doc(db, 'merchants', merchantId, 'customers', customerId);
    const customerDoc = await getDoc(customerRef);
    
    const customerData = {
      phoneNumber: customerId,
      name: transactionData.payerName || 'Customer',
      email: transactionData.payerEmail || '',
      lastTransactionDate: serverTimestamp(),
      lastTransactionAmount: transactionData.amount || 0,
      totalTransactions: customerDoc.exists() 
        ? (customerDoc.data().totalTransactions || 0) + 1 
        : 1,
      totalSpent: customerDoc.exists() 
        ? (customerDoc.data().totalSpent || 0) + (transactionData.amount || 0) 
        : (transactionData.amount || 0),
      updatedAt: serverTimestamp(),
    };
    
    if (!customerDoc.exists()) {
      customerData.createdAt = serverTimestamp();
    }
    
    // Add transaction to customer's history
    const transactionRef = doc(collection(customerRef, 'transactions'), transactionData.id);
    await setDoc(transactionRef, {
      transactionId: transactionData.id,
      amount: transactionData.amount || 0,
      currency: transactionData.currency || 'KES',
      description: transactionData.description || 'Payment',
      status: transactionData.status || 'pending',
      createdAt: serverTimestamp(),
      mpesaReceiptNumber: transactionData.mpesaReceiptNumber || '',
    });
    
    // Update or create customer document
    await setDoc(customerRef, customerData, { merge: true });
    
    console.log(`Customer information stored/updated for ${customerId}`);
  } catch (error) {
    console.error('Error storing customer information:', error);
    // Don't throw error to prevent invoice generation failure
  }
};

/**
 * Send invoice by email
 * @param {Object} transactionData - The transaction data
 * @param {string} invoiceUrl - The URL of the invoice PDF
 */
const sendInvoiceByEmail = async (transactionData, invoiceUrl) => {
  try {
    if (!transactionData.payerEmail) {
      console.log('No customer email provided, skipping invoice email');
      return;
    }
    
    // This would integrate with your existing email service
    // For example:
    // await sendTransactionEmail(
    //   transactionData.payerEmail,
    //   'Your Invoice',
    //   'invoiceEmail',
    //   {
    //     customerName: transactionData.payerName || 'Customer',
    //     transactionId: transactionData.id,
    //     amount: transactionData.amount,
    //     currency: transactionData.currency || 'KES',
    //     invoiceUrl: invoiceUrl
    //   }
    // );
    
    console.log(`Invoice email would be sent to ${transactionData.payerEmail}`);
  } catch (error) {
    console.error('Error sending invoice email:', error);
    // Don't throw error to prevent invoice generation failure
  }
};

/**
 * Process a successful transaction to generate and store invoice
 * @param {Object} transactionData - The transaction data
 * @returns {Promise<string>} - URL of the stored PDF
 */
const processTransactionInvoice = async (transactionData) => {
  try {
    console.log('Processing invoice for transaction:', transactionData.id);
    const invoiceUrl = await generateInvoicePDF(transactionData);
    
    // Send invoice by email if customer email is available
    if (transactionData.payerEmail) {
      await sendInvoiceByEmail(transactionData, invoiceUrl);
    }
    
    return invoiceUrl;
  } catch (error) {
    console.error('Error processing transaction invoice:', error);
    throw error;
  }
};

module.exports = {
  generateInvoicePDF,
  processTransactionInvoice,
  storeCustomerInformation
};
