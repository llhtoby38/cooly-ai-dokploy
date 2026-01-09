"use client";
import React from "react";
import AppShell from "../../components/AppShell";

export default function PrivacyPolicyPage() {
  return (
    <AppShell
      selectedTool="privacy"
      showMobilePrompt={false}
      showLeftSidebar={false}
      onCreditsUpdate={() => {}}
      childrenMain={
        <div className="max-w-4xl mx-auto py-8">
          <div className="bg-[#18181b] rounded-lg p-8 border border-white/20">
            <h1 className="text-3xl font-bold mb-6 text-white">Privacy Policy</h1>
            
            <div className="prose prose-invert max-w-none text-gray-300 space-y-6">
              <p className="text-sm text-gray-400 mb-8">
                <strong>Effective Date: September 2025</strong>
              </p>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">1. Information We Collect</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">1.1 Account Information</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Email address and password (for local accounts)</li>
                  <li>Google OAuth profile information (name, email, profile picture)</li>
                  <li>Account preferences and settings</li>
                  <li>Subscription and billing information</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">1.2 Usage Data</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>AI generation requests and prompts</li>
                  <li>Generated content and downloads</li>
                  <li>Credit usage and transaction history</li>
                  <li>Device information and browser type</li>
                  <li>IP address and general location</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">1.3 Technical Data</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Log files and error reports</li>
                  <li>Performance metrics and analytics</li>
                  <li>Security and authentication logs</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">2. How We Use Your Information</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">2.1 Service Provision</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Provide AI generation services</li>
                  <li>Process payments and manage subscriptions</li>
                  <li>Store and deliver generated content</li>
                  <li>Provide customer support</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">2.2 Service Improvement</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Analyze usage patterns to improve our services</li>
                  <li>Develop new features and capabilities</li>
                  <li>Monitor system performance and security</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">2.3 Communication</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Send service updates and notifications</li>
                  <li>Provide billing and account information</li>
                  <li>Respond to support requests</li>
                  <li>Send marketing communications (with consent)</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">3. Information Sharing</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">3.1 Third-Party Service Providers</h3>
                <p>
                  We share information with trusted service providers who help us operate our platform:
                </p>
                <ul className="list-disc ml-6 space-y-2">
                  <li><strong>AI Model Providers</strong>: BytePlus, Google, and other AI service providers for content generation</li>
                  <li><strong>Payment Processors</strong>: Stripe for billing and payment processing</li>
                  <li><strong>Cloud Storage</strong>: Backblaze B2 for content storage and delivery</li>
                  <li><strong>Analytics</strong>: Service providers for usage analytics and performance monitoring</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">3.2 Legal Requirements</h3>
                <p>
                  We may disclose information when required by law, to protect our rights, or to ensure user safety.
                </p>

                <h3 className="text-lg font-medium text-white mb-2">3.3 Business Transfers</h3>
                <p>
                  In the event of a merger, acquisition, or sale of assets, user information may be transferred as part of the transaction.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">4. Data Security</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">4.1 Security Measures</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Encryption of data in transit and at rest</li>
                  <li>Secure authentication and session management</li>
                  <li>Regular security assessments and updates</li>
                  <li>Access controls and monitoring</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">4.2 Data Retention</h3>
                <p>
                  We retain your information for as long as your account is active or as needed to provide services. Generated content may be stored for a limited period to ensure service delivery.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">5. Your Rights and Choices</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">5.1 Account Management</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Update your account information at any time</li>
                  <li>Change your password and security settings</li>
                  <li>Manage your subscription and billing preferences</li>
                  <li>Delete your account and associated data</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">5.2 Data Access and Portability</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Request a copy of your personal data</li>
                  <li>Download your generated content</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">5.3 Communication Preferences</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Opt out of marketing emails</li>
                  <li>Manage notification preferences</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">6. Cookies and Tracking</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">6.1 Types of Cookies</h3>
                <ul className="list-disc ml-6 space-y-2">
                  <li><strong>Essential Cookies</strong>: Required for basic site functionality and security</li>
                  <li><strong>Performance Cookies</strong>: Help us understand how users interact with our site</li>
                  <li><strong>Functional Cookies</strong>: Remember your preferences and settings</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">6.2 Third-Party Analytics</h3>
                <p>
                  We may use third-party analytics services to understand user behavior and improve our services. These services may use cookies and similar technologies.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">7. International Data Transfers</h2>
                <p>
                  Your information may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place to protect your data in accordance with applicable privacy laws.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">8. Children's Privacy</h2>
                <p>
                  Our services are not intended for children under 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected such information, we will take steps to delete it.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">9. Changes to This Policy</h2>
                <p>
                  We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on our website and updating the effective date. Your continued use of our services after such changes constitutes acceptance of the updated policy.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">10. Contact Us</h2>
                <p>
                  If you have any questions about this Privacy Policy or our data practices, please contact us:
                </p>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Email: privacy@cooly.ai</li>
                  <li>Support: https://cooly.ai/support</li>
                </ul>
              </section>

              <div className="border-t border-white/20 pt-6 mt-8">
                <p className="text-sm text-gray-400">
                  <strong>Last Updated: September 2025</strong>
                </p>
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}
