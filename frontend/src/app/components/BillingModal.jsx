'use client';

import { useState } from 'react';
import { FaCreditCard, FaCoins } from 'react-icons/fa';
import { useApiBase } from '../hooks/useApiBase';
import { toErrorText } from "../utils/toErrorText";

const BillingModal = ({ isOpen, onClose, onCreditsUpdate }) => {
  // Use the centralized useApiBase hook
  const API_BASE = useApiBase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const creditPackages = [
    { credits: 50, price: 500, popular: false },
    { credits: 100, price: 900, popular: true },
    { credits: 200, price: 1600, popular: false },
  ];

  const handlePurchase = async (credits, price) => {
    setLoading(true);
    setError('');

    try {
      const payload = {
        credits,
        amount_usd_cents: price,
      };
      
      // Capture current page to return after payment
      if (typeof window !== 'undefined') {
        payload.returnTo = window.location.pathname;
      }

      const response = await fetch(`${API_BASE}/api/billing/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe checkout
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700 text-white">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FaCoins className="text-yellow-500" />
            Buy Credits
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900 bg-opacity-20 border border-red-500 text-red-400 rounded">{toErrorText(error)}</div>
        )}

        <div className="space-y-4">
          {creditPackages.map((pkg) => (
            <div
              key={pkg.credits}
              className={`border rounded-lg p-4 cursor-pointer transition-all hover:shadow-lg ${
                pkg.popular
                  ? 'border-blue-500 bg-blue-900 bg-opacity-20'
                  : 'border-gray-600 hover:border-gray-500 bg-gray-800'
              }`}
              onClick={() => handlePurchase(pkg.credits, pkg.price)}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">
                      {pkg.credits} Credits
                    </span>
                    {pkg.popular && (
                      <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded">
                        Popular
                      </span>
                    )}
                  </div>
                  <div className="text-gray-400">
                    ${(pkg.price / 100).toFixed(2)}
                  </div>
                </div>
                <FaCreditCard className="text-gray-400" />
              </div>
            </div>
          ))}
        </div>

        {loading && (
          <div className="mt-4 text-center text-gray-600">
            Redirecting to checkout...
          </div>
        )}

        <div className="mt-6 text-sm text-gray-500 text-center">
          Credits are used for image generation and text-to-speech. 
          Each image costs 1 credit, each TTS request costs 1 credit.
        </div>
      </div>
    </div>
  );
};

export default BillingModal; 