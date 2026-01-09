const nodemailer = require('nodemailer');

// Create transporter based on environment
function createTransport() {
  // Check if using Gmail
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
  }

  // Check if using custom SMTP (Zoho Mail)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Fallback to Ethereal for testing
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: 'test@ethereal.email',
      pass: 'test123'
    }
  });
}

// Send password reset email
async function sendPasswordResetEmail(email, resetToken, resetLink) {
  try {
    const transporter = createTransport();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@cooly.ai',
      to: email,
      subject: 'Reset Your Password - Cooly.ai',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #333; margin: 0; font-size: 28px;">Reset Your Password</h1>
              <p style="color: #666; margin: 10px 0 0 0;">Cooly.ai</p>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Hello! We received a request to reset your password for your Cooly.ai account.
            </p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
              Click the button below to reset your password. This link will expire in 1 hour.
            </p>
            
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${resetLink}" style="background-color: #007bff; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">Reset Password</a>
            </div>
            
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
            </p>
            
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin-bottom: 0;">
              If you have any questions, please contact our support team.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
              This is an automated email. Please do not reply to this message.
            </p>
          </div>
        </div>
      `,
      text: `
Reset Your Password - Cooly.ai

Hello! We received a request to reset your password for your Cooly.ai account.

Click the link below to reset your password. This link will expire in 1 hour.

${resetLink}

If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.

If you have any questions, please contact our support team.

This is an automated email. Please do not reply to this message.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw new Error('Failed to send password reset email');
  }
}

// Send welcome email (no free-credit messaging)
async function sendWelcomeEmail(email, username, _creditsReceived = 0) {
  try {
    const transporter = createTransport();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@cooly.ai',
      to: email,
      subject: 'Welcome to Cooly.ai! 🎉',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #333; margin: 0; font-size: 28px;">Welcome to Cooly.ai! 🎉</h1>
              <p style="color: #666; margin: 10px 0 0 0;">Your AI-powered creative journey starts now</p>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Hi ${username}! Welcome to Cooly.ai, where your imagination meets AI-powered creativity.
            </p>
            
            <div style="background-color: #fff7ed; border-left: 4px solid #fb923c; padding: 16px; margin-bottom: 24px; border-radius: 5px;">
              <p style="color: #7c2d12; margin: 0;">
                Please note this is currently <strong>beta</strong>.
              </p>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              With Cooly.ai, you can:
            </p>
            
            <ul style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 30px; padding-left: 20px;">
              <li>Generate stunning AI images with <strong>Seedream 4.0</strong></li>
              <li>Create amazing videos with <strong>Seedance 1.0 Pro</strong></li>
            </ul>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              Buy monthly or yearly packages, or <strong>one-off credits</strong>, to start creating.
              <a href="${(process.env.FRONTEND_URL || 'http://localhost:3000') + '/billing'}" style="color:#007bff; text-decoration: none;">Manage billing</a>
            </p>
            
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" style="background-color: #007bff; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">Start Creating Now</a>
            </div>
            
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin-bottom: 0;">
              If you have any questions or need help getting started, feel free to reach out to our support team.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
              Welcome aboard! 🚀
            </p>
          </div>
        </div>
      `,
      text: `
Welcome to Cooly.ai! 🎉

Hi ${username}! Welcome to Cooly.ai, where your imagination meets AI-powered creativity.

Please note this is currently beta.

With Cooly.ai, you can:
- Generate stunning AI images with Seedream 4.0
- Create amazing videos with Seedance 1.0 Pro

Buy monthly or yearly packages, or one-off credits, to start creating.
Billing: ${(process.env.FRONTEND_URL || 'http://localhost:3000') + '/billing'}

Start creating now: ${process.env.FRONTEND_URL || 'http://localhost:3000'}

If you have any questions or need help getting started, feel free to reach out to our support team.

Welcome aboard! 🚀
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    throw new Error('Failed to send welcome email');
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendWelcomeEmail
};
