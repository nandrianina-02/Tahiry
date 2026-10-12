const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const mailer = require('../lib/mailer');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 jours
};

const MAX_FAILED_ATTEMPTS = 6;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// Limitation basique des tentatives de connexion par IP (anti-bruteforce), sans dépendance externe.
// Fenêtre glissante de 10 minutes, 20 tentatives max par IP sur /login et /forgot-password.
const attemptsByIp = new Map();
function rateLimitByIp(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = bucket + ':' + (req.ip || req.headers['x-forwarded-for'] || 'unknown');
    const now = Date.now();
    const entry = attemptsByIp.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count += 1;
    attemptsByIp.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' });
    }
    next();
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: email.toLowerCase().trim(), passwordHash, name: name || '' });
    const token = signToken(user._id.toString());
    res.cookie('token', token, COOKIE_OPTS);
    res.status(201).json({ id: user._id, email: user.email, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription.' });
  }
});

// POST /api/auth/login
router.post('/login', rateLimitByIp('login', 20, 10 * 60 * 1000), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil - new Date()) / 60000);
      return res.status(429).json({ error: `Compte temporairement verrouillé suite à plusieurs échecs. Réessaie dans ${minutes} min.` });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      user.failedLoginCount = (user.failedLoginCount || 0) + 1;
      if (user.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        user.failedLoginCount = 0;
      }
      await user.save();
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await user.save();

    const token = signToken(user._id.toString());
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ id: user._id, email: user.email, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', { ...COOKIE_OPTS, maxAge: undefined });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('email name createdAt');
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json(user);
});

// POST /api/auth/forgot-password  → génère un lien de réinitialisation et l'envoie par email
router.post('/forgot-password', rateLimitByIp('forgot', 8, 10 * 60 * 1000), async (req, res) => {
  const { email } = req.body;
  // Réponse volontairement identique que le compte existe ou non (évite de révéler les emails inscrits).
  const genericResponse = { ok: true, message: 'Si un compte existe avec cet email, un lien de réinitialisation vient d\'être envoyé.' };
  if (!email) return res.status(400).json({ error: 'Email requis.' });

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure
    await user.save();

    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${base}/?reset_token=${rawToken}#reset-password`;

    if (mailer.isConfigured()) {
      await mailer.sendResetPasswordEmail(user.email, resetUrl);
    } else {
      // Email non configuré (variables SMTP_* absentes) : on log le lien côté serveur pour le dev/l'admin.
      console.log('[INFO] SMTP non configuré — lien de réinitialisation pour ' + user.email + ' : ' + resetUrl);
    }
    res.json(genericResponse);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la demande de réinitialisation.' });
  }
});

// POST /api/auth/reset-password  → applique le nouveau mot de passe à partir du token reçu par email
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et nouveau mot de passe requis.' });
    if (password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetTokenHash: tokenHash, resetTokenExpires: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'Lien invalide ou expiré. Refais une demande de réinitialisation.' });

    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await user.save();

    res.json({ ok: true, message: 'Mot de passe mis à jour. Tu peux te connecter.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la réinitialisation.' });
  }
});

module.exports = router;
