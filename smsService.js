const https = require('https');
const axios = require('axios');

/**
 * Send an SMS using the new SMS API
 * @param {string} message - The message to send
 * @param {string} phoneNumber - The recipient phone number
 * @returns {Promise<boolean>} - Promise that resolves with success status
 */
const sendSMS = async (message, phoneNumber) => {
    const url = 'http://167.172.14.50:4002/v1/send-sms';

    const requestBody = {
        apiClientID: 845,
        key: '5okbdtElzXzOAcC',
        secret: '5B3lFsvKAYFt7Nb377aiSVaGcnoSki',
        txtMessage: message,
        MSISDN: phoneNumber,
        serviceID: 5518,
    };

    try {
        const response = await axios.post(url, requestBody, {
        headers: {
            'Content-Type': 'application/json',
        },
        });

        // Handle the response as needed
        console.log('SMS sent:', response.data);
        return true;
    } catch (error) {
        // Handle errors
        console.error('Error sending SMS:', error.message);
        return false;
    }
};

module.exports = {
  sendSMS
};
