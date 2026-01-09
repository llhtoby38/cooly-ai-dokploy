"use client";
import React from "react";
import AppShell from "../../components/AppShell";

export default function TermsOfServicePage() {
  return (
    <AppShell
      selectedTool="terms"
      showMobilePrompt={false}
      showLeftSidebar={false}
      onCreditsUpdate={() => {}}
      childrenMain={
        <div className="max-w-4xl mx-auto py-8">
          <div className="bg-[#18181b] rounded-lg p-8 border border-white/20">
            <h1 className="text-3xl font-bold mb-6 text-white">Terms of Service</h1>
            
            <div className="prose prose-invert max-w-none text-gray-300 space-y-6">
              <p className="text-sm text-gray-400 mb-8">
                <strong>Effective Date: September 2025</strong>
              </p>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">1. Services Offered</h2>
                <p>
                  Through the Website, COOLY.ai offers:
                </p>
                <ul className="list-disc ml-6 space-y-2">
                  <li><strong>AI Image Generation</strong>: Using cutting-edge AI models including Seedream 3.0 and Seedream 4.0 for creating high-quality images from text prompts</li>
                  <li><strong>AI Video Generation</strong>: Video creation services using Google Veo 3 and Seedance 1.0 AI models</li>
                  <li><strong>Content Storage</strong>: Secure cloud storage for generated content via Backblaze B2</li>
                  <li><strong>Credit-based System</strong>: Flexible credit system for accessing AI generation services</li>
                  <li><strong>Subscription Plans</strong>: Monthly and yearly subscription options with varying credit allocations</li>
                  <li><strong>User Account Management</strong>: Registration, authentication, and profile management</li>
                </ul>
                <p>
                  The Services utilize third-party AI models and technologies from providers including BytePlus, Google, and other AI service providers. The Company acts as an intermediary providing access to these services through a unified platform.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">2. Authorized Use</h2>
                <p>
                  The User is only authorized to use the Website and the Services in good faith and under these Terms. Users undertake that any access or downloads of any content available on the Website will always be the result of a genuine legitimate interest of the User. Any method which artificially increases usage, downloads, or system load is strictly prohibited and will result in account termination.
                </p>
                
                <p>The User agrees not to:</p>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Use the Services negligently, for fraudulent purposes, or in an unlawful manner</li>
                  <li>Interfere with the functioning of the Website or Services</li>
                  <li>Attempt to reverse engineer, decompile, or extract source code from the Services</li>
                  <li>Use automated systems (bots, spiders, scrapers) to access the Services</li>
                  <li>Impersonate another user or person</li>
                  <li>Upload or generate content that violates applicable laws or third-party rights</li>
                </ul>
                
                <p>
                  The rights granted to the User under these Terms are personal and shall not be assigned to any third party without prior written consent from the Company.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">3. Registration and Account Management</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">3.1 Account Creation</h3>
                <p>
                  To use certain Services, the User must register by providing a valid email address and creating a secure password. The User agrees to provide accurate, complete, and up-to-date information during registration.
                </p>

                <h3 className="text-lg font-medium text-white mb-2">3.2 Account Security</h3>
                <p>The User is responsible for:</p>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Keeping account credentials confidential</li>
                  <li>All activities conducted through their account</li>
                  <li>Immediately notifying the Company of any unauthorized access</li>
                  <li>Ensuring account information remains current</li>
                </ul>

                <h3 className="text-lg font-medium text-white mb-2">3.3 OAuth Integration</h3>
                <p>
                  The Service supports Google OAuth authentication. Users who register via OAuth consent to the sharing of basic profile information as outlined in our Privacy Policy.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">4. Credit System and Billing</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">4.1 Credit-Based Access</h3>
                <p>
                  The Services operate on a credit-based system where each AI generation consumes a predetermined number of credits, credits are deducted before content generation begins, unused credits do not expire but may be subject to subscription renewal terms, and credit costs may vary based on the AI model and generation parameters.
                </p>

                <h3 className="text-lg font-medium text-white mb-2">4.2 Subscription Plans</h3>
                <p>
                  The Company offers various subscription plans with monthly and yearly billing options, different credit allocations per billing period, automatic renewal unless cancelled by the User, and prorated billing for plan upgrades.
                </p>

                <h3 className="text-lg font-medium text-white mb-2">4.3 Payment Processing</h3>
                <p>
                  Payments are processed securely through Stripe. The Company does not store payment card information. Failed payments may result in service suspension. All prices are in USD unless otherwise specified.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">5. Content and Intellectual Property</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">5.1 User-Generated Content</h3>
                <p>
                  Users retain ownership of text prompts and input materials provided to AI services, generated content created using their own prompts and paid credits, and personal data and account information.
                </p>

                <h3 className="text-lg font-medium text-white mb-2">5.2 AI-Generated Content</h3>
                <p>
                  For content generated using the AI Services, users receive a license to use generated content for personal and commercial purposes. The Company does not claim ownership of user-generated content. Users are responsible for ensuring their use of generated content complies with applicable laws.
                </p>

                <h3 className="text-lg font-medium text-white mb-2">5.3 Prohibited Content</h3>
                <p>Users may not generate content that:</p>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Violates intellectual property rights of third parties</li>
                  <li>Contains illegal, harmful, or offensive material</li>
                  <li>Infringes on privacy rights or personal data</li>
                  <li>Violates platform-specific terms of AI model providers</li>
                  <li>Is intended for deceptive or fraudulent purposes</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">6. Liability and Disclaimers</h2>
                
                <h3 className="text-lg font-medium text-white mb-2">6.1 Service Availability</h3>
                <p>
                  The Company provides the Services on an "as is" and "as available" basis. We do not warrant uninterrupted or error-free service operation, accuracy or quality of AI-generated content, compatibility with all devices or software, or availability of specific features or AI models.
                </p>

                <h3 className="text-lg font-medium text-white mb-2">6.2 Limitation of Liability</h3>
                <p>
                  To the maximum extent permitted by law, the Company's total liability shall not exceed the amount paid by the User in the 12 months preceding the claim. The Company is not liable for indirect, incidental, or consequential damages. Users assume responsibility for their use of generated content.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">7. Termination and Suspension</h2>
                <p>
                  Users may terminate their account at any time by contacting customer support, using account management features, or cancelling active subscriptions. The Company may terminate or suspend accounts for violations of these Terms, fraudulent or abusive behavior, non-payment of fees, or legal or regulatory requirements.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-white mb-4">8. Contact Information</h2>
                <p>
                  For questions or concerns regarding these Terms, contact us at:
                </p>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Email: legal@cooly.ai</li>
                  <li>Support: https://cooly.ai/support</li>
                </ul>
              </section>

              <div className="border-t border-white/20 pt-6 mt-8">
                <p className="text-sm text-gray-400">
                  <strong>Last Updated: September 2025</strong>
                </p>
                <p className="text-sm text-gray-300 mt-2">
                  By using COOLY.ai, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
                </p>
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}
