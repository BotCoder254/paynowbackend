const { doc, collection, query, where, getDocs, updateDoc, serverTimestamp, getDoc, addDoc } = require("firebase/firestore");
const { db } = require("./firebase");
const https = require('https');
const moment = require('moment');

/**
 * Sends an SMS reminder for an unpaid payment link
 * @param {string} phoneNumber - The recipient's phone number
 * @param {string} message - The message to send
 * @returns {Promise<Object>} - The response from the SMS provider
 */
const sendSMSReminder = async (phoneNumber, message) => {
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
          console.log('SMS reminder sent successfully:', responseData);
          resolve(responseData);
        });
      });

      smsReq.on('error', (error) => {
        console.error('Error sending SMS reminder:', error);
        reject(error);
      });

      smsReq.write(data);
      smsReq.end();
    });
  } catch (error) {
    console.error('SMS reminder sending error:', error);
    throw error;
  }
};

/**
 * Track reminder in the database
 * @param {Object} linkData - The payment link data
 * @param {string} recipientPhone - The recipient's phone number
 * @param {string} reminderType - The type of reminder (e.g., 'first', 'second', 'final')
 * @returns {Promise<void>}
 */
const trackReminder = async (linkData, recipientPhone, reminderType) => {
  try {
    // Create a reminder document in the reminders collection
    const reminderRef = collection(db, 'reminders');
    await addDoc(reminderRef, {
      linkId: linkData.id,
      ownerUid: linkData.ownerUid,
      recipientPhone: recipientPhone,
      reminderType: reminderType,
      sentAt: serverTimestamp(),
      linkDescription: linkData.description,
      linkSlug: linkData.slug,
      amount: linkData.amount,
      currency: linkData.currency || 'KES',
    });

    // Update the payment link with reminder information
    const linkRef = doc(db, 'paymentLinks', linkData.id);
    const linkDoc = await getDoc(linkRef);
    
    if (linkDoc.exists()) {
      const currentReminders = linkDoc.data().reminders || [];
      
      await updateDoc(linkRef, {
        reminders: [
          ...currentReminders,
          {
            type: reminderType,
            sentAt: serverTimestamp(),
            recipientPhone: recipientPhone
          }
        ],
        lastReminderSent: serverTimestamp(),
        lastReminderType: reminderType
      });
    }
    
    console.log(`Reminder tracked for link ${linkData.id}`);
  } catch (error) {
    console.error('Error tracking reminder:', error);
    throw error;
  }
};

/**
 * Check for unpaid links that need reminders
 * @returns {Promise<Array>} - Array of links that were processed for reminders
 */
const checkUnpaidLinks = async () => {
  try {
    console.log('Checking for unpaid links that need reminders...');
    const processedLinks = [];
    
    // Get all active payment links
    const linksQuery = query(
      collection(db, 'paymentLinks'),
      where('status', '==', 'active')
    );
    
    const linksSnapshot = await getDocs(linksQuery);
    
    // Process each link
    for (const linkDoc of linksSnapshot.docs) {
      const linkData = {
        id: linkDoc.id,
        ...linkDoc.data()
      };
      
      // Skip if the link is expired
      if (linkData.expiryDate && linkData.expiryDate.seconds < Date.now() / 1000) {
        continue;
      }
      
      // Skip if the link has been paid
      if (linkData.paid) {
        continue;
      }
      
      // Check if this link has a recipient phone number
      if (!linkData.recipientPhone) {
        continue;
      }
      
      // Determine if we should send a reminder based on creation date and last reminder
      const createdAt = linkData.createdAt?.seconds ? new Date(linkData.createdAt.seconds * 1000) : null;
      const lastReminderSent = linkData.lastReminderSent?.seconds ? new Date(linkData.lastReminderSent.seconds * 1000) : null;
      
      if (!createdAt) {
        continue;
      }
      
      const now = new Date();
      const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);
      const hoursSinceLastReminder = lastReminderSent ? (now - lastReminderSent) / (1000 * 60 * 60) : null;
      
      // Reminder logic:
      // 1. First reminder: 24 hours after creation if no payment
      // 2. Second reminder: 48 hours after first reminder
      // 3. Final reminder: 72 hours after second reminder
      
      let reminderType = null;
      
      if (!lastReminderSent && hoursSinceCreation >= 24) {
        // First reminder
        reminderType = 'first';
      } else if (lastReminderSent && linkData.lastReminderType === 'first' && hoursSinceLastReminder >= 48) {
        // Second reminder
        reminderType = 'second';
      } else if (lastReminderSent && linkData.lastReminderType === 'second' && hoursSinceLastReminder >= 72) {
        // Final reminder
        reminderType = 'final';
      }
      
      if (reminderType) {
        try {
          // Prepare and send the reminder
          const message = createReminderMessage(linkData, reminderType);
          await sendSMSReminder(linkData.recipientPhone, message);
          
          // Track the reminder in the database
          await trackReminder(linkData, linkData.recipientPhone, reminderType);
          
          processedLinks.push({
            linkId: linkData.id,
            reminderType,
            recipientPhone: linkData.recipientPhone
          });
          
          console.log(`Sent ${reminderType} reminder for link ${linkData.id} to ${linkData.recipientPhone}`);
        } catch (error) {
          console.error(`Error sending reminder for link ${linkData.id}:`, error);
        }
      }
    }
    
    return processedLinks;
  } catch (error) {
    console.error('Error checking unpaid links:', error);
    throw error;
  }
};

/**
 * Create a reminder message based on the link data and reminder type
 * @param {Object} linkData - The payment link data
 * @param {string} reminderType - The type of reminder (first, second, final)
 * @returns {string} - The formatted reminder message
 */
const createReminderMessage = (linkData, reminderType) => {
  const paymentUrl = `https://paylink.co.ke/${linkData.slug}`;
  const amount = `${linkData.currency || 'KES'} ${linkData.amount?.toLocaleString() || '0'}`;
  
  switch (reminderType) {
    case 'first':
      return `Reminder: You have a pending payment of ${amount} for ${linkData.description}. Pay easily via M-Pesa: ${paymentUrl}`;
    
    case 'second':
      return `Second reminder: Your payment of ${amount} for ${linkData.description} is still pending. Please complete your payment: ${paymentUrl}`;
    
    case 'final':
      return `Final reminder: Please complete your pending payment of ${amount} for ${linkData.description}. Pay now: ${paymentUrl}`;
    
    default:
      return `Reminder: You have a pending payment of ${amount} for ${linkData.description}. Pay now: ${paymentUrl}`;
  }
};

/**
 * Manually send a reminder for a specific payment link
 * @param {string} linkId - The ID of the payment link
 * @param {string} phoneNumber - The phone number to send the reminder to
 * @param {string} reminderType - The type of reminder (first, second, final)
 * @returns {Promise<Object>} - The result of the reminder operation
 */
const sendManualReminder = async (linkId, phoneNumber, reminderType = 'manual') => {
  try {
    // Get the payment link data
    const linkRef = doc(db, 'paymentLinks', linkId);
    const linkDoc = await getDoc(linkRef);
    
    if (!linkDoc.exists()) {
      throw new Error(`Payment link ${linkId} not found`);
    }
    
    const linkData = {
      id: linkDoc.id,
      ...linkDoc.data()
    };
    
    // Skip if the link is expired or inactive
    if ((linkData.expiryDate && linkData.expiryDate.seconds < Date.now() / 1000) || linkData.status !== 'active') {
      throw new Error(`Payment link ${linkId} is expired or inactive`);
    }
    
    // Skip if the link has been paid
    if (linkData.paid) {
      throw new Error(`Payment link ${linkId} has already been paid`);
    }
    
    // Format the phone number
    let formattedPhone = phoneNumber.toString().trim();
    formattedPhone = formattedPhone.replace(/^\+|^0+|\s+/g, "");
    if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }
    
    // Prepare and send the reminder
    const message = createReminderMessage(linkData, reminderType);
    await sendSMSReminder(formattedPhone, message);
    
    // Track the reminder in the database
    await trackReminder(linkData, formattedPhone, reminderType);
    
    return {
      success: true,
      message: `Reminder sent to ${formattedPhone} for payment link ${linkId}`,
      linkId,
      reminderType,
      recipientPhone: formattedPhone
    };
  } catch (error) {
    console.error(`Error sending manual reminder for link ${linkId}:`, error);
    return {
      success: false,
      message: error.message || 'Failed to send reminder',
      linkId,
      error: error.toString()
    };
  }
};

module.exports = {
  checkUnpaidLinks,
  sendManualReminder,
  sendSMSReminder,
  trackReminder
};
