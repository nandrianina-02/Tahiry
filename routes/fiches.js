const express = require('express');
const Questionnaire = require('../models/Questionnaire');
const Fiche = require('../models/Fiche');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../lib/asyncHandler');

const router = express.Router();
router.use(requireAuth);

function genRefId() {
  return 'MIT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// Une réponse est vide si absente, chaîne vide, tableau vide ou consentement non coché.
// (L'ancien test `!data[field]` rejetait à tort la valeur numérique 0.)
function isEmptyAnswer(type, v) {
  if (type === 'consent') return v !== true;
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

// Même logique que le frontend : une question masquée par sa condition d'affichage n'est pas exigée.
function isShown(q, data) {
  if (!q.showIf || !q.showIf.field) return true;
  const val = data[q.showIf.field];
  const cur = Array.isArray(val) ? val.join(', ') : String(val ?? '');
  const target = q.showIf.value || '';
  if (q.showIf.op === 'neq') return cur !== target;
  if (q.showIf.op === 'contains') return cur.includes(target);
  return cur === target;
}

// vérifie que les champs obligatoires sont bien présents dans les données envoyées
function checkRequired(questions, data) {
  return questions.filter(qq => qq.required && isShown(qq, data) && isEmptyAnswer(qq.type, data[qq.field]));
}

// GET /api/questionnaires/:qid/fiches  → réponses paginées + recherche (de l'utilisateur connecté)
// Query params: page (défaut 1), limit (défaut 20), q (recherche texte libre dans les valeurs), sort (asc|desc, défaut desc)
router.get('/questionnaires/:qid/fiches', wrap(async (req, res) => {
  const q = await Questionnaire.findOne({ _id: req.params.qid, owner: req.userId });
  if (!q) return res.status(404).json({ error: 'Questionnaire introuvable.' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const sortDir = req.query.sort === 'asc' ? 1 : -1;
  const search = (req.query.q || '').trim();

  const filter = { questionnaire: q._id, owner: req.userId };

  if (search) {
    // Recherche texte libre sur la référence et les valeurs des réponses.
    // L'ancienne version appliquait $toString à un objet, ce que MongoDB refuse
    // ("Unsupported conversion from object to string") : toute recherche échouait.
    // Le champ "data" étant libre (Mixed), on filtre donc en JS.
    const needle = search.toLowerCase();
    const all = await Fiche.find(filter).sort({ createdAt: sortDir });
    const matched = all.filter(f =>
      f.refId.toLowerCase().includes(needle) || JSON.stringify(f.data || {}).toLowerCase().includes(needle));
    const total = matched.length;
    const fiches = matched.slice((page - 1) * limit, page * limit);
    return res.json({ fiches, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  }

  const total = await Fiche.countDocuments(filter);
  const fiches = await Fiche.find(filter)
    .sort({ createdAt: sortDir })
    .skip((page - 1) * limit)
    .limit(limit);

  res.json({ fiches, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// GET /api/questionnaires/:qid/fiches/all  → TOUTES les réponses sans pagination (pour export PDF/CSV/Excel)
router.get('/questionnaires/:qid/fiches/all', wrap(async (req, res) => {
  const q = await Questionnaire.findOne({ _id: req.params.qid, owner: req.userId });
  if (!q) return res.status(404).json({ error: 'Questionnaire introuvable.' });
  const fiches = await Fiche.find({ questionnaire: q._id, owner: req.userId }).sort({ createdAt: -1 });
  res.json(fiches);
}));

// POST /api/questionnaires/:qid/fiches  → enregistrer une nouvelle réponse
// Si "clientId" est fourni (entretien réalisé hors-ligne puis synchronisé) et qu'une fiche
// avec ce clientId existe déjà, on la renvoie telle quelle au lieu d'en recréer une (idempotence).
router.post('/questionnaires/:qid/fiches', async (req, res) => {
  try {
    const q = await Questionnaire.findOne({ _id: req.params.qid, owner: req.userId });
    if (!q) return res.status(404).json({ error: 'Questionnaire introuvable.' });

    const { data, clientId } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Données de réponse manquantes.' });
    }

    if (clientId) {
      const existing = await Fiche.findOne({ clientId: String(clientId), owner: req.userId });
      if (existing) return res.status(200).json(existing);
    }

    const missing = checkRequired(q.questions, data);
    if (missing.length) {
      return res.status(400).json({
        error: 'Champs obligatoires manquants: ' + missing.map(m => m.fr).join(', ')
      });
    }

    const fiche = await Fiche.create({
      owner: req.userId,
      questionnaire: q._id,
      refId: genRefId(),
      data,
      // undefined et non null : l'index unique "sparse" ignore les documents SANS le champ mais
      // indexe la valeur null — deux fiches sans clientId provoquaient une erreur de doublon.
      clientId: clientId ? String(clientId) : undefined
    });
    res.status(201).json(fiche);
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Questionnaire introuvable.' });
    if (err.code === 11000 && req.body.clientId) {
      // course possible entre deux tentatives de sync simultanées du même clientId
      const existing = await Fiche.findOne({ clientId: String(req.body.clientId), owner: req.userId });
      if (existing) return res.status(200).json(existing);
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la fiche.' });
  }
});

// PUT /api/fiches/:id  → modifier une réponse déjà enregistrée
router.put('/fiches/:id', async (req, res) => {
  try {
    const fiche = await Fiche.findOne({ _id: req.params.id, owner: req.userId });
    if (!fiche) return res.status(404).json({ error: 'Fiche introuvable.' });

    const q = await Questionnaire.findOne({ _id: fiche.questionnaire, owner: req.userId });
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Données de réponse manquantes.' });
    }

    if (q) {
      const missing = checkRequired(q.questions, data);
      if (missing.length) {
        return res.status(400).json({
          error: 'Champs obligatoires manquants: ' + missing.map(m => m.fr).join(', ')
        });
      }
    }

    fiche.data = data;
    fiche.markModified('data'); // champ Mixed : sans ça, Mongoose peut ne pas détecter la modification
    await fiche.save();
    res.json(fiche);
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Fiche introuvable.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la modification de la fiche.' });
  }
});

// DELETE /api/fiches/:id  → supprimer une réponse
router.delete('/fiches/:id', wrap(async (req, res) => {
  const fiche = await Fiche.findOne({ _id: req.params.id, owner: req.userId });
  if (!fiche) return res.status(404).json({ error: 'Fiche introuvable.' });
  await fiche.deleteOne();
  res.json({ ok: true });
}));

module.exports = router;
