const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { sendPasswordResetEmail, sendWelcomeEmail } = require('../utils/email');
const { getAvailableCredits, registerEmailCredits } = require('../utils/emailCredits');
const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check if user exists
    const existingUser = await db.query(
      'SELECT id, deleted_at FROM users WHERE lower(email) = lower($1) ORDER BY deleted_at NULLS FIRST LIMIT 1',
      [email]
    );
    
    if (existingUser.rows.length > 0 && existingUser.rows[0].deleted_at == null) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check available credits for this email (never block registration)
    const creditInfo = await getAvailableCredits(email);
    
    // Always allow registration - give free + restored paid (could be 0)
    const freeToGive = Number(creditInfo.freeAvailable) || 0;
    const paidToRestore = Number(creditInfo.paidRestore) || 0;
    const creditsToGive = freeToGive + paidToRestore;
    
    if (creditsToGive === 0) {
      console.log(`ℹ️ User ${email} registering with 0 credits (lifetime limit reached)`);
    } else {
      console.log(`💰 User ${email} registering with ${creditsToGive} credits available (free=${freeToGive}, paid=${paidToRestore})`);
    }

    // Hash password and create user with available credits
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (email, password_hash, credits, provider, role, created_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NULL)
       RETURNING id, email, credits`,
      [email, passwordHash, creditsToGive, 'local', 'user']
    );

    const newUser = result.rows[0];

    // Register the credits in our tracking system
    try {
      await registerEmailCredits(email, freeToGive, paidToRestore, { incrementLifetimeTotal: !creditInfo.isRestore });
      console.log(`💰 Registered credits for ${email} free=${freeToGive} paid=${paidToRestore} (lifetime total: ${creditInfo.totalGiven + (!creditInfo.isRestore ? freeToGive : 0)})`);
    } catch (creditError) {
      console.error('⚠️ Failed to register credits (continuing with registration):', creditError);
      // Continue with registration even if credit tracking fails
    }

    // Send welcome email (only show FREE credits granted now)
    try {
      await sendWelcomeEmail(newUser.email, newUser.email.split('@')[0], freeToGive);
      console.log(`✅ Welcome email sent to ${newUser.email}`);
    } catch (emailError) {
      console.error('⚠️ Failed to send welcome email (continuing with registration):', emailError);
      // Continue with registration even if welcome email fails
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set cookie and return user data
    const cookieOptions = {
      httpOnly: true,
      secure: !(['localhost', '127.0.0.1'].includes(req.hostname)),
      sameSite: ['localhost', '127.0.0.1'].includes(req.hostname) ? 'lax' : 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    // Decide if we can safely set the Domain attribute
    const rootDomain = (process.env.COOKIE_DOMAIN || '').replace(/^\./, ''); // strip leading dot
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.COOKIE_DOMAIN &&
      rootDomain &&
      req.hostname.endsWith(rootDomain)
    ) {
      // Only add Domain when host already matches the root domain
      cookieOptions.domain = process.env.COOKIE_DOMAIN;
    }
    // otherwise leave host-only (safer for previews)
    // Queue analytics events (centralized flush in middleware)
    try {
      res.locals.analyticsEvents = [
        ...(res.locals.analyticsEvents || []),
        { distinctId: String(newUser.id), event: 'Registration Completed', properties: { method: 'email_password' } },
        { distinctId: String(newUser.id), event: 'Login Completed', properties: { method: 'email_password' } },
      ];
    } catch {}

    res.cookie('token', token, cookieOptions).json({
      id: newUser.id,
      email: newUser.email,
      credits: newUser.credits
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login existing user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await db.query(
      'SELECT id, email, credits, password_hash, provider FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      [email]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // If account is OAuth-only, block password login
    if (user.provider && user.provider !== 'local') {
      return res.status(400).json({ error: 'Use Continue with Google to sign in' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set cookie and return user data
    const cookieOptions = {
      httpOnly: true,
      secure: !(['localhost', '127.0.0.1'].includes(req.hostname)),
      sameSite: ['localhost', '127.0.0.1'].includes(req.hostname) ? 'lax' : 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    console.log('Login cookie debug:', {
      NODE_ENV: process.env.NODE_ENV,
      COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
      IS_PULL_REQUEST: process.env.IS_PULL_REQUEST
    });
    // Decide if we can safely set the Domain attribute
    const rootDomain = (process.env.COOKIE_DOMAIN || '').replace(/^\./, '');
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.COOKIE_DOMAIN &&
      rootDomain &&
      req.hostname.endsWith(rootDomain)
    ) {
      cookieOptions.domain = process.env.COOKIE_DOMAIN;
      console.log('Setting cookie domain to:', process.env.COOKIE_DOMAIN);
    } else {
      console.log('Leaving cookie host-only for preview');
    }
    try {
      res.locals.analyticsEvents = [
        ...(res.locals.analyticsEvents || []),
        { distinctId: String(user.id), event: 'Login Completed', properties: { method: 'email_password' } },
      ];
    } catch {}
    res.cookie('token', token, cookieOptions).json({
      id: user.id,
      email: user.email,
      credits: user.credits
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  const clearOptions = {
    secure: !(['localhost', '127.0.0.1'].includes(req.hostname)),
    sameSite: ['localhost', '127.0.0.1'].includes(req.hostname) ? 'lax' : 'none'
  };
  const rootDomain = (process.env.COOKIE_DOMAIN || '').replace(/^\./, '');
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.COOKIE_DOMAIN &&
    rootDomain &&
    req.hostname.endsWith(rootDomain)
  ) {
    clearOptions.domain = process.env.COOKIE_DOMAIN;
  }
  res.clearCookie('token', clearOptions).json({ message: 'Logged out successfully' });
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query(
      'SELECT id, email, credits FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --------------------
// Google OAuth (code flow)
// --------------------

function buildCookieOptions(req) {
  const cookieOptions = {
    httpOnly: true,
    secure: !(['localhost', '127.0.0.1'].includes(req.hostname)),
    sameSite: ['localhost', '127.0.0.1'].includes(req.hostname) ? 'lax' : 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
  const rootDomain = (process.env.COOKIE_DOMAIN || '').replace(/^\./, '');
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.COOKIE_DOMAIN &&
    rootDomain &&
    req.hostname.endsWith(rootDomain)
  ) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }
  return cookieOptions;
}

// Step 1: redirect to Google
router.get('/google', async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    
    // Dynamic redirect URI construction based on environment
    const host = req.headers.host;
    let redirectUri;

    // Check for explicit GOOGLE_REDIRECT_URI first (takes precedence for all environments)
    if (process.env.GOOGLE_REDIRECT_URI) {
      redirectUri = process.env.GOOGLE_REDIRECT_URI;
    } else if (host.includes('cooly-ai-pr-')) {
      // Preview environment - construct URL dynamically
      redirectUri = `https://${host}/api/auth/google/callback`;
    } else if (host.includes('localhost') || host.includes('127.0.0.1')) {
      // Localhost - force localhost for consistency (not 127.0.0.1)
      redirectUri = `http://localhost:5000/api/auth/google/callback`;
    } else {
      // Production - construct from APP_BASE_URL or host
      redirectUri = `${process.env.APP_BASE_URL || `https://${host}`}/api/auth/google/callback`;
    }
    const csrf = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest()
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    // Store CSRF + PKCE in short-lived cookies
    // Cookie settings for different environments:
    // - Localhost: sameSite: 'lax', secure: false (HTTP)
    // - Preview/Production: sameSite: 'none', secure: true (HTTPS, cross-site)
    const isLocalhost = req.headers.host?.includes('localhost') || req.headers.host?.includes('127.0.0.1');
    const isPreview = req.headers.host?.includes('cooly-ai-pr-') || (req.headers.origin && /vercel\.app$/i.test(req.headers.origin));
    const isProduction = !isLocalhost && !isPreview;
    
    console.log('🔍 OAuth Cookie Debug:', { 
      host: req.headers.host, 
      origin: req.headers.origin,
      isLocalhost, 
      isPreview, 
      isProduction 
    });
    
    const cookieOptions = {
      httpOnly: true,
      secure: !isLocalhost, // Require secure for preview/production (HTTPS)
      sameSite: isLocalhost ? 'lax' : 'none', // 'lax' for localhost, 'none' for cross-site (preview/prod)
      maxAge: 10 * 60 * 1000, // 10 minutes
      domain: isLocalhost ? undefined : (isPreview ? undefined : '.cooly.ai') // No domain for localhost/preview, .cooly.ai for production
    };
    
    res.cookie('g_csrf', csrf, cookieOptions);
    res.cookie('g_pkce', verifier, cookieOptions);
    const reqOrigin = req.headers.origin || req.headers.referer || null;
    const returnTo = req.query.returnTo || '/';
    // Encode origin + returnTo into OAuth state so the callback can read it
    const encodedState = Buffer.from(JSON.stringify({ csrf, origin: reqOrigin, returnTo })).toString('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state: encodedState,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline'
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.redirect(authUrl);
  } catch (err) {
    console.error('Google auth start error:', err);
    res.status(500).json({ error: 'Failed to start Google OAuth' });
  }
});

// Step 2: callback exchanges code → tokens, signs user in
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const storedCsrf = req.cookies.g_csrf;
    const verifier = req.cookies.g_pkce;
    // Decode state to recover origin + csrf
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).send('Invalid OAuth state');
    }
    if (!decoded?.csrf || decoded.csrf !== storedCsrf || !verifier) {
      return res.status(400).send('Invalid OAuth state');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    // Use the same dynamic redirect URI logic as the initial OAuth request
    const host = req.headers.host;
    let redirectUri;

    // Check for explicit GOOGLE_REDIRECT_URI first (takes precedence for all environments)
    if (process.env.GOOGLE_REDIRECT_URI) {
      redirectUri = process.env.GOOGLE_REDIRECT_URI;
    } else if (host.includes('cooly-ai-pr-')) {
      // Preview environment - construct URL dynamically
      redirectUri = `https://${host}/api/auth/google/callback`;
    } else if (host.includes('localhost') || host.includes('127.0.0.1')) {
      // Localhost - force localhost for consistency (not 127.0.0.1)
      redirectUri = `http://localhost:5000/api/auth/google/callback`;
    } else {
      // Production - construct from APP_BASE_URL or host
      redirectUri = `${process.env.APP_BASE_URL || `https://${host}`}/api/auth/google/callback`;
    }

    // Exchange code for tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      throw new Error(`Token exchange failed: ${t}`);
    }
    const tokenJson = await tokenResp.json();

    // Decode ID token (don't verify signature here; we trust Google endpoint response)
    const idToken = tokenJson.id_token;
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    const googleId = payload.sub;
    const email = payload.email;

    // Check available credits for this email (never block registration)
    const creditInfo = await getAvailableCredits(email);
    
    // Always allow registration - give free + restored paid (could be 0)
    const freeToGive = Number(creditInfo.freeAvailable) || 0;
    const paidToRestore = Number(creditInfo.paidRestore) || 0;
    const creditsToGive = freeToGive + paidToRestore;
    
    if (creditsToGive === 0) {
      console.log(`ℹ️ Google OAuth: User ${email} registering with 0 credits (lifetime limit reached)`);
    } else {
      console.log(`💰 Google OAuth: User ${email} registering with ${creditsToGive} credits available (free=${freeToGive}, paid=${paidToRestore})`);
    }

    // Link or create user
    let userRow;
    let isNewUser = false;
    const byGoogle = await db.query('SELECT id, email, credits FROM users WHERE google_id = $1', [googleId]);
    if (byGoogle.rows.length > 0) {
      userRow = byGoogle.rows[0];
    } else {
    const byEmail = await db.query('SELECT id, email, credits, deleted_at FROM users WHERE email = $1', [email]);
      if (byEmail.rows.length > 0) {
        // Link existing account
        userRow = byEmail.rows[0];
        await db.query('UPDATE users SET provider = $1, provider_email = $2, google_id = $3 WHERE id = $4', [
          'google',
          email,
          googleId,
          userRow.id
        ]);
      } else {
        // Create new user with available credits
        isNewUser = true;
        const ins = await db.query(
          'INSERT INTO users (email, provider, provider_email, google_id, credits, role, created_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL) RETURNING id, email, credits',
          [email, 'google', email, googleId, creditsToGive, 'user']
        );
        userRow = ins.rows[0];

        // Register the credits in our tracking system
        try {
          await registerEmailCredits(email, freeToGive, paidToRestore, { incrementLifetimeTotal: !creditInfo.isRestore });
          console.log(`💰 Google OAuth: Registered credits for ${email} free=${freeToGive} paid=${paidToRestore}`);
        } catch (creditError) {
          console.error('⚠️ Failed to register credits for Google OAuth (continuing):', creditError);
        }
      }
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userRow.id]);

    // Send welcome email for new users (don't block on failure)
    if (isNewUser) {
      const username = email.split('@')[0];
      sendWelcomeEmail(email, username, freeToGive).catch(err => {
        console.error('Failed to send welcome email:', err);
      });
    }

    // Determine if this came from a preview origin and perform exchange flow if so
    const previewOrigin = decoded?.origin || null;
    const isPreview = !!previewOrigin && /vercel\.app$/i.test(previewOrigin);

    if (isPreview && process.env.EXCHANGE_JWT_SECRET) {
      // Mint short-lived exchange token for the preview backend to create its own session
      const exchangeToken = jwt.sign(
        {
          sub: userRow.id,
          email: userRow.email,
          iss: 'cooly-api',
          aud: 'session-exchange',
        },
        process.env.EXCHANGE_JWT_SECRET,
        { expiresIn: '2m' }
      );

      // Clean temp cookies with proper domain
      const clearCookieOptions = { domain: isPreview ? '.cooly.ai' : undefined };
      res.clearCookie('g_csrf', clearCookieOptions);
      res.clearCookie('g_pkce', clearCookieOptions);
      // Redirect the browser to the preview frontend bridge
      const bridgeUrl = `${previewOrigin.replace(/\/$/, '')}/oauth-bridge?token=${encodeURIComponent(exchangeToken)}`;
      return res.redirect(302, bridgeUrl);
    }

    // Normal flow: Issue our session cookie and redirect to configured frontend
    const appJwt = jwt.sign({ userId: userRow.id, email: userRow.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Queue analytics events for OAuth
    try {
      res.locals.analyticsEvents = [
        ...(res.locals.analyticsEvents || []),
        { distinctId: String(userRow.id), event: 'Login Completed', properties: { method: 'google_oauth' } },
        ...(isNewUser ? [{ distinctId: String(userRow.id), event: 'Registration Completed', properties: { method: 'google_oauth' } }] : [])
      ];
    } catch {}
    
    // Clean temp cookies with proper domain
    const isLocalhost = req.headers.host?.includes('localhost') || req.headers.host?.includes('127.0.0.1');
    const clearCookieOptions = { domain: isLocalhost ? undefined : '.cooly.ai' };
    res.clearCookie('g_csrf', clearCookieOptions);
    res.clearCookie('g_pkce', clearCookieOptions);
    
    res.cookie('token', appJwt, buildCookieOptions(req));

    const redirectTo = decoded.returnTo || process.env.POST_LOGIN_REDIRECT || '/';
    // Use the origin from OAuth state (where the request came from) to redirect back to the same environment
    // This ensures preview → preview, production → production, localhost → localhost
    const frontendBase = decoded.origin || process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
    return res.redirect(`${frontendBase}${redirectTo}`);
  } catch (err) {
    console.error('Google callback error:', err);
    res.status(500).send('Google sign-in failed');
  }
});

// ------------- Optional: Link/Unlink endpoints -------------
// Start Google linking while logged-in
router.get('/link/google', async (req, res) => {
  // Reuse the same redirect start
  return router.handle({ ...req, url: '/google' }, res);
});

// Set password for Google-only users
router.post('/set-password', async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists and is Google-only
    const { rows } = await db.query(
      'SELECT id, provider, password_hash FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    
    // Only allow setting password for Google-only users
    if (user.provider !== 'google' || user.password_hash) {
      return res.status(400).json({ error: 'Password can only be set for Google-only accounts' });
    }

    // Hash and store new password
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, provider = $2 WHERE id = $3',
      [passwordHash, 'google', decoded.userId]
    );

    res.json({ success: true, message: 'Password set successfully' });
  } catch (err) {
    console.error('Set password error:', err);
    res.status(500).json({ error: 'Failed to set password' });
  }
});

// Unlink Google (requires auth cookie)
router.post('/unlink/google', async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check user's current state
    const { rows } = await db.query(
      'SELECT provider, password_hash FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    
    const user = rows[0];
    
    // If no password exists, require setting one first
    if (!user.password_hash) {
      return res.status(400).json({ 
        error: 'Cannot unlink: no password set',
        requiresPassword: true 
      });
    }
    
    // Allow unlink if password exists
    await db.query(
      'UPDATE users SET google_id = NULL, provider_email = NULL, provider = $1 WHERE id = $2',
      ['local', decoded.userId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Unlink error:', err);
    res.status(500).json({ error: 'Failed to unlink Google' });
  }
});

// ------------- Password Reset Flow -------------
// Request password reset (always returns 200 for security)
router.post('/password/forgot', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists and has a password (local or linked account)
    const { rows } = await db.query(
      'SELECT id, provider FROM users WHERE email = $1 AND password_hash IS NOT NULL',
      [email]
    );

    if (rows.length > 0) {
      const user = rows[0];
      
      // Generate secure random token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      
      // Store token hash with 1 hour expiry
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      
      // Invalidate any existing tokens for this user
      await db.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [user.id]
      );
      
      // Store new token
      await db.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, expiresAt]
      );

      // Build reset URL
      const resetUrl = `${process.env.FRONTEND_BASE_URL || 'http://localhost:3000'}/reset?token=${token}&email=${encodeURIComponent(email)}`;
      
      // Send email with reset link
      try {
        await sendPasswordResetEmail(email, token, resetUrl);
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        // In development, still log the token for testing
        if (process.env.NODE_ENV === 'development') {
          console.log(`Password reset token for ${email}: ${token}`);
          console.log(`Reset link: ${resetUrl}`);
        }
      }
    }

    // Always return success (security best practice)
    res.json({ message: 'If an account with that email exists, you will receive password reset instructions.' });
  } catch (err) {
    console.error('Password reset request error:', err);
    res.json({ message: 'If an account with that email exists, you will receive password reset instructions.' });
  }
});

// Verify token and reset password
router.post('/password/reset', async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;
    if (!token || !email || !newPassword) {
      return res.status(400).json({ error: 'Token, email, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Hash the provided token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Find valid token
    const { rows } = await db.query(
      `SELECT prt.user_id, prt.expires_at, prt.used_at, u.email 
       FROM password_reset_tokens prt 
       JOIN users u ON prt.user_id = u.id 
       WHERE prt.token_hash = $1 AND u.email = $2`,
      [tokenHash, email]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const resetToken = rows[0];
    
    // Check if token is expired or already used
    if (new Date() > resetToken.expires_at || resetToken.used_at) {
      return res.status(400).json({ error: 'Token has expired or already been used' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);
    
    // Update user password
    await db.query(
      'UPDATE users SET password_hash = $1, provider = $2 WHERE id = $3',
      [passwordHash, 'local', resetToken.user_id]
    );
    
    // Mark token as used
    await db.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND token_hash = $2',
      [resetToken.user_id, tokenHash]
    );
    
    // Invalidate all other active sessions (optional security measure)
    // This would require storing session tokens, which you're not doing yet
    
    res.json({ message: 'Password updated successfully. You can now sign in with your new password.' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;