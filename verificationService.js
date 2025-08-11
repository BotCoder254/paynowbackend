const { db } = require('./firebase');
const { doc, getDoc, updateDoc, serverTimestamp } = require('firebase/firestore');
const { sendEmail } = require('./emailService');
const { sendSMSNotification } = require('./reminderService');

/**
 * Send verification status notification via email
 * @param {Object} userData - User data object
 * @param {string} status - Verification status (approved, rejected)
 * @param {string} rejectionReason - Reason for rejection (if status is rejected)
 * @returns {Promise<Object>} - Email send result
 */
const sendVerificationEmail = async (userData, status, rejectionReason = '') => {
  try {
    if (!userData.email) {
      throw new Error('User email is required');
    }
    
    const businessName = userData.businessName || userData.displayName || 'your business';
    
    let subject, template, context;
    
    if (status === 'approved') {
      subject = 'Verification Approved - PayNow';
      template = 'verificationApproved';
      context = {
        businessName,
        displayName: userData.displayName || 'Merchant',
      };
    } else if (status === 'rejected') {
      subject = 'Verification Update - PayNow';
      template = 'verificationRejected';
      context = {
        businessName,
        displayName: userData.displayName || 'Merchant',
        rejectionReason: rejectionReason || 'Your verification information could not be verified.',
      };
    } else {
      throw new Error('Invalid verification status');
    }
    
    const mailOptions = {
      from: `"PayNow" <${process.env.EMAIL_USER}>`,
      to: userData.email,
      subject,
      template,
      context
    };
    
    const result = await sendEmail(mailOptions);
    console.log(`Verification ${status} email sent to ${userData.email}`);
    return result;
  } catch (error) {
    console.error(`Error sending verification ${status} email:`, error);
    throw error;
  }
};

/**
 * Send verification status notification via SMS
 * @param {Object} userData - User data object
 * @param {string} status - Verification status (approved, rejected)
 * @returns {Promise<Object>} - SMS send result
 */
const sendVerificationSMS = async (userData, status) => {
  try {
    if (!userData.contactPhone) {
      console.log('No phone number provided for SMS notification');
      return null;
    }
    
    const businessName = userData.businessName || userData.displayName || 'your business';
    let message;
    
    if (status === 'approved') {
      message = `Congratulations! ${businessName} has been verified on PayNow. Your customers will now see a verification badge on your payment pages.`;
    } else if (status === 'rejected') {
      message = `Your PayNow verification request for ${businessName} has been reviewed and requires additional information. Please check your email for details.`;
    } else {
      throw new Error('Invalid verification status');
    }
    
    const result = await sendSMSNotification(userData.contactPhone, message);
    console.log(`Verification ${status} SMS sent to ${userData.contactPhone}`);
    return result;
  } catch (error) {
    console.error(`Error sending verification ${status} SMS:`, error);
    // Don't throw error, just log it - SMS is secondary notification
    return null;
  }
};

/**
 * Update verification status and send notifications
 * @param {string} userId - User ID
 * @param {string} status - Verification status (approved, rejected)
 * @param {string} rejectionReason - Reason for rejection (if status is rejected)
 * @param {string} adminId - Admin user ID who made the decision
 * @returns {Promise<void>}
 */
const updateVerificationStatus = async (userId, status, rejectionReason = '', adminId) => {
  try {
    // Get user data
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      throw new Error('User not found');
    }
    
    const userData = userDoc.data();
    
    // Update user document
    const updateData = {
      verificationStatus: status,
      updatedAt: serverTimestamp(),
      updatedBy: adminId
    };
    
    if (status === 'approved') {
      updateData.isVerified = true;
      updateData.verificationApprovedAt = serverTimestamp();
      updateData.verificationApprovedBy = adminId;
    } else if (status === 'rejected') {
      updateData.isVerified = false;
      updateData.verificationRejectedAt = serverTimestamp();
      updateData.verificationRejectedBy = adminId;
      updateData.rejectionReason = rejectionReason;
    }
    
    await updateDoc(userRef, updateData);
    
    // Update verification request
    const verificationRef = doc(db, 'verificationRequests', userId);
    await updateDoc(verificationRef, {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: adminId,
      ...(status === 'rejected' && { rejectionReason })
    });
    
    // Send email notification
    await sendVerificationEmail(userData, status, rejectionReason);
    
    // Send SMS notification
    await sendVerificationSMS(userData, status);
    
    return { success: true };
  } catch (error) {
    console.error('Error updating verification status:', error);
    throw error;
  }
};

module.exports = {
  updateVerificationStatus,
  sendVerificationEmail,
  sendVerificationSMS
};
