const nodemailer = require('nodemailer');
const path = require('path');
const nodemailerHbs = require('nodemailer-express-handlebars');
require('dotenv').config();

// Verify email credentials are present
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.error('Missing email credentials in environment variables');
  console.error('EMAIL_USER:', process.env.EMAIL_USER ? 'Present' : 'Missing');
  console.error('EMAIL_PASS:', process.env.EMAIL_PASS ? 'Present' : 'Missing');
}

// Create a transporter using Gmail SMTP with secure connection
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // use SSL
  auth: {
    user: process.env.EMAIL_USER || 'telvivaztelvin@gmail.com',
    pass: process.env.EMAIL_PASS || 'lkqv vgqn dfqc qcgr'
  },
  debug: true, // Enable debug logs
  tls: {
    rejectUnauthorized: false // Allow self-signed certificates
  },
  maxConnections: 5, // Limit concurrent connections
  pool: true // Use connection pooling for better performance
});

// Verify transporter configuration
transporter.verify(function(error, success) {
  if (error) {
    console.error('Email transporter verification failed:', error);
    console.error('Current email configuration:', {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS ? '****' : 'missing'
      }
    });
    
    // Check for common errors
    if (error.code === 'EAUTH') {
      console.error('Authentication error: Check your email credentials');
    } else if (error.code === 'ESOCKET') {
      console.error('Socket error: Check your network connection and firewall settings');
    } else if (error.code === 'ECONNECTION') {
      console.error('Connection error: Check your SMTP settings and network');
    }
    
    // Try to reconnect after a delay
    setTimeout(() => {
      console.log('Attempting to reconnect to email server...');
      transporter.verify((retryError, retrySuccess) => {
        if (retryError) {
          console.error('Email reconnection failed:', retryError);
        } else {
          console.log('Email server reconnection successful');
        }
      });
    }, 5000);
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Configure handlebars
const handlebarOptions = {
  viewEngine: {
    extName: '.handlebars',
    partialsDir: path.resolve('./views/emails/'),
    defaultLayout: false,
  },
  viewPath: path.resolve('./views/emails/'),
  extName: '.handlebars',
};

// Use handlebars with nodemailer
transporter.use('compile', nodemailerHbs(handlebarOptions));

const sendOrderConfirmationEmail = async (orderDetails) => {
  try {
    console.log('Preparing to send order confirmation email for order:', orderDetails.id);
    
    if (!orderDetails?.shippingDetails?.email) {
      throw new Error('Missing recipient email address');
    }

    const mailOptions = {
      from: `"LuxeCarts" <${process.env.EMAIL_USER}>`,
      to: orderDetails.shippingDetails.email,
      subject: 'Order Confirmation - LuxeCarts',
      template: 'orderConfirmation',
      context: {
        orderNumber: orderDetails.id,
        customerName: orderDetails.shippingDetails.name,
        items: orderDetails.items,
        total: orderDetails.total,
        shippingAddress: `${orderDetails.shippingDetails.address}, ${orderDetails.shippingDetails.city}, ${orderDetails.shippingDetails.state}, ${orderDetails.shippingDetails.zipCode}`,
        orderDate: new Date().toLocaleDateString()
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Order confirmation email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    console.error('Order details:', JSON.stringify(orderDetails, null, 2));
    throw error;
  }
};

const sendOrderStatusUpdateEmail = async (orderDetails, newStatus) => {
  try {
    console.log('Preparing to send status update email for order:', orderDetails.id);
    
    if (!orderDetails?.shippingDetails?.email) {
      throw new Error('Missing recipient email address');
    }

    const mailOptions = {
      from: `"LuxeCarts" <${process.env.EMAIL_USER}>`,
      to: orderDetails.shippingDetails.email,
      subject: `Order Status Update - LuxeCarts`,
      template: 'orderStatusUpdate',
      context: {
        orderNumber: orderDetails.id,
        customerName: orderDetails.shippingDetails.name,
        newStatus: newStatus,
        orderDate: new Date().toLocaleDateString()
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Order status update email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending order status update email:', error);
    console.error('Order details:', JSON.stringify(orderDetails, null, 2));
    console.error('New status:', newStatus);
    throw error;
  }
};

const sendOrderCancellationEmail = async (orderDetails) => {
  try {
    console.log('Preparing to send cancellation email for order:', orderDetails.id);
    
    if (!orderDetails?.shippingDetails?.email) {
      throw new Error('Missing recipient email address');
    }

    const mailOptions = {
      from: `"LuxeCarts" <${process.env.EMAIL_USER}>`,
      to: orderDetails.shippingDetails.email,
      subject: 'Order Cancellation - LuxeCarts',
      template: 'orderCancellation',
      context: {
        orderNumber: orderDetails.id,
        customerName: orderDetails.shippingDetails.name,
        orderDate: new Date().toLocaleDateString(),
        cancellationDate: new Date().toLocaleDateString()
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Order cancellation email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending order cancellation email:', error);
    console.error('Order details:', JSON.stringify(orderDetails, null, 2));
    throw error;
  }
};

const sendPaymentConfirmationEmail = async (paymentData) => {
  try {
    console.log('Preparing to send payment confirmation email:', paymentData.transactionId);
    
    if (!paymentData?.email) {
      console.warn('Missing recipient email address, cannot send confirmation email');
      return { success: false, error: 'Missing recipient email address' };
    }

    const mailOptions = {
      from: `"PayNow" <${process.env.EMAIL_USER}>`,
      to: paymentData.email,
      subject: 'Payment Confirmation - PayNow',
      template: 'paymentConfirmation',
      context: {
        transactionId: paymentData.transactionId,
        customerName: paymentData.customerName || 'Valued Customer',
        amount: paymentData.amount,
        currency: paymentData.currency || 'KES',
        paymentMethod: paymentData.paymentMethod,
        description: paymentData.description || 'Payment',
        receiptNumber: paymentData.receiptNumber || '',
        date: new Date().toLocaleDateString()
      },
      // Add priority and importance flags
      priority: 'high',
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      }
    };

    // Add plain text alternative for better deliverability
    mailOptions.text = `
    Payment Confirmation
    
    Dear ${paymentData.customerName || 'Valued Customer'},
    
    Thank you for your payment of ${paymentData.currency || 'KES'} ${paymentData.amount} for ${paymentData.description || 'Payment'}.
    
    Transaction ID: ${paymentData.transactionId}
    Receipt Number: ${paymentData.receiptNumber || 'N/A'}
    Payment Method: ${paymentData.paymentMethod}
    Date: ${new Date().toLocaleDateString()}
    
    Thank you for using PayNow.
    `;

    // Set a timeout for the email sending operation
    const emailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Email sending timed out')), 30000)
    );
    
    // Race the email sending against the timeout
    const info = await Promise.race([emailPromise, timeoutPromise]);
    console.log('Payment confirmation email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending payment confirmation email:', error);
    console.error('Payment details:', JSON.stringify(paymentData, null, 2));
    
    // Try to send with fallback configuration if original fails
    if (error.code === 'EAUTH' || error.code === 'ESOCKET') {
      try {
        console.log('Attempting to send confirmation email with fallback configuration...');
        
        // Create a temporary fallback transporter with different settings
        const fallbackTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER || 'telvivaztelvin@gmail.com',
            pass: process.env.EMAIL_PASS || 'lkqv vgqn dfqc qcgr'
          },
          tls: { rejectUnauthorized: false }
        });
        
        const fallbackMailOptions = {
          from: `"PayNow" <${process.env.EMAIL_USER}>`,
          to: paymentData.email,
          subject: 'Payment Confirmation - PayNow',
          text: `
          Payment Confirmation
          
          Dear ${paymentData.customerName || 'Valued Customer'},
          
          Thank you for your payment of ${paymentData.currency || 'KES'} ${paymentData.amount} for ${paymentData.description || 'Payment'}.
          
          Transaction ID: ${paymentData.transactionId}
          Receipt Number: ${paymentData.receiptNumber || 'N/A'}
          Payment Method: ${paymentData.paymentMethod}
          Date: ${new Date().toLocaleDateString()}
          
          Thank you for using PayNow.
          `,
          priority: 'high'
        };
        
        const fallbackInfo = await fallbackTransporter.sendMail(fallbackMailOptions);
        console.log('Payment confirmation email sent with fallback configuration:', fallbackInfo.messageId);
        return { success: true, messageId: fallbackInfo.messageId, fallback: true };
      } catch (fallbackError) {
        console.error('Fallback email sending also failed:', fallbackError);
        return { success: false, error: fallbackError.message };
      }
    }
    
    // Don't throw error to prevent transaction processing failure
    return { success: false, error: error.message };
  }
};

const sendPaymentLinkEmail = async (to, name, paymentUrl, description, amount, currency) => {
  try {
    console.log('Preparing to send payment link email to:', to);
    
    if (!to) {
      throw new Error('Missing recipient email address');
    }

    if (!paymentUrl) {
      throw new Error('Missing payment URL');
    }

    const mailOptions = {
      from: `"PayNow" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: 'Payment Request - PayNow',
      template: 'paymentLink',
      context: {
        customerName: name || 'Valued Customer',
        paymentUrl: paymentUrl,
        description: description || 'Payment Request',
        amount: amount || '',
        currency: currency || 'KES',
        date: new Date().toLocaleDateString()
      },
      // Add priority and importance flags
      priority: 'high',
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      }
    };

    // Set a timeout for the email sending operation
    const emailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Email sending timed out')), 30000)
    );
    
    // Race the email sending against the timeout
    const info = await Promise.race([emailPromise, timeoutPromise]);
    console.log('Payment link email sent successfully:', info.messageId);
    
    // Log delivery info
    if (info.accepted && info.accepted.length > 0) {
      console.log('Email accepted by recipient server for:', info.accepted);
    }
    
    return info;
  } catch (error) {
    console.error('Error sending payment link email:', error);
    
    // Try to send with fallback configuration if original fails
    if (error.code === 'EAUTH' || error.code === 'ESOCKET') {
      try {
        console.log('Attempting to send email with fallback configuration...');
        
        // Create a temporary fallback transporter with different settings
        const fallbackTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER || 'telvivaztelvin@gmail.com',
            pass: process.env.EMAIL_PASS || 'lkqv vgqn dfqc qcgr'
          },
          tls: { rejectUnauthorized: false }
        });
        
        const mailOptions = {
          from: `"PayNow" <${process.env.EMAIL_USER}>`,
          to: to,
          subject: 'Payment Request - PayNow',
          text: `Hello ${name || 'Valued Customer'},\n\nYou have a payment request for ${currency || 'KES'} ${amount || ''}.\n\n${description || 'Payment Request'}\n\nPay here: ${paymentUrl}\n\nThank you.`,
          priority: 'high'
        };
        
        const fallbackInfo = await fallbackTransporter.sendMail(mailOptions);
        console.log('Payment link email sent with fallback configuration:', fallbackInfo.messageId);
        return fallbackInfo;
      } catch (fallbackError) {
        console.error('Fallback email sending also failed:', fallbackError);
        // Don't throw, return error info instead
        return { error: fallbackError.message, success: false };
      }
    }
    
    // Don't throw, return error info instead
    return { error: error.message, success: false };
  }
};

module.exports = {
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendOrderCancellationEmail,
  sendPaymentConfirmationEmail,
  sendPaymentLinkEmail
}; 