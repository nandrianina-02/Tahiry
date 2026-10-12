const nodemailer = require('nodemailer');

// Configuré via variables d'environnement :
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Pour Gmail : SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=ton compte,
// SMTP_PASS=un "mot de passe d'application" Google (pas ton mot de passe normal).
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null; // email non configuré — voir isConfigured()
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: Number(process.env.SMTP_PORT) !== 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporter;
}

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendResetPasswordEmail(to, resetUrl) {
  const t = getTransporter();
  if (!t) throw new Error('Email non configuré (variables SMTP_* manquantes).');
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Tahiry — Réinitialisation de mot de passe',
    text: `Tu as demandé à réinitialiser ton mot de passe Tahiry.\n\n` +
          `Clique sur ce lien (valable 1 heure) :\n${resetUrl}\n\n` +
          `Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.`,
    html: `<p>Tu as demandé à réinitialiser ton mot de passe <strong>Tahiry</strong>.</p>` +
          `<p><a href="${resetUrl}">Clique ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>` +
          `<p>Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>`
  });
}

module.exports = { isConfigured, sendResetPasswordEmail };
