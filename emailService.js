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
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  debug: true // Enable debug logs
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

module.exports = {
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendOrderCancellationEmail
}; 