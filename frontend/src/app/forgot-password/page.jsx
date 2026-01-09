"use client";
import React, { useState } from "react";
import phFetch from "../services/phFetch";
import Link from "next/link";
import { useApiBase } from "../hooks/useApiBase";

export default function ForgotPasswordPage() {
  const API_BASE = useApiBase();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await phFetch(`${API_BASE}/api/auth/password/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      const data = await response.json();
      
      if (response.ok) {
        setMessage(data.message);
      } else {
        setError(data.error || "Failed to send reset email");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-3xl font-extrabold tracking-wide">
            COOLY
          </Link>
        </div>
        
        <div className="bg-gray-900 rounded-lg p-8 border border-gray-700">
          <h1 className="text-2xl font-bold mb-6 text-center">Reset Password</h1>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                placeholder="Enter your email"
                required
              />
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-900 bg-opacity-20 p-3 rounded-md">
                {typeof error === 'string' ? error : (error?.message || error?.error || JSON.stringify(error))}
              </div>
            )}

            {message && (
              <div className="text-green-400 text-sm bg-green-900 bg-opacity-20 p-3 rounded-md">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold py-2 px-4 rounded-md transition-colors"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
