const express = require('express');
const Questionnaire = require('../models/Questionnaire');
const Fiche = require('../models/Fiche');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_TYPES = ['sel', 'multi', 'txt', 'textarea', 'date', 'num', 'consent', 'scale', 'geo', 'photo'];
const ALLOWED_OPS = ['eq', 'neq', 'contains'];

function sanitizeShowIf(showIf) {
  if (!showIf || typeof showIf !== 'object' || !showIf.field) return null;
  return {
    field: String(showIf.field).trim(),
    op: ALLOWED_OPS.includes(showIf.op) ? showIf.op : 'eq',
    value: String(showIf.value ?? '').trim()
  };
}

function sanitizeQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map((q, i) => ({
    id: String(q.id || ('q' + Date.now().toString(36) + i)),
    field: String(q.field || q.id || ('champ' + i)).trim(),
    block: String(q.block || '').trim(),
    fr: String(q.fr || '').trim(),
    mg: String(q.mg || '').trim(),
    type: ALLOWED_TYPES.includes(q.type) ? q.type : 'txt',
    options: Array.isArray(q.options) ? q.options.map(o => ({
      v: String(o.v || '').trim(),
      fr: String(o.fr || o.v || '').trim(),
      mg: String(o.mg || '').trim()
    })).filter(o => o.v) : [],
    autre: !!q.autre,
    required: !!q.required,
    order: typeof q.order === 'number' ? q.order : i,
    scaleMin: Number.isFinite(q.scaleMin) ? q.scaleMin : 1,
    scaleMax: Number.isFinite(q.scaleMax) ? q.scaleMax : 5,
    showIf: sanitizeShowIf(q.showIf)
  })).filter(q => q.fr && q.field);
}

// GET /api/questionnaires  → liste des questionnaires de l'utilisateur connecté
router.get('/', async (req, res) => {
  const list = await Questionnaire.find({ owner: req.userId })
    .select('title description createdAt updatedAt questions')
    .sort({ updatedAt: -1 });
  const withCounts = await Promise.all(list.map(async (q) => {
    const count = await Fiche.countDocuments({ questionnaire: q._id, owner: req.userId });
    return {
      _id: q._id,
      title: q.title,
      description: q.description,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      nbQuestions: q.questions.length,
      nbReponses: count
    };
  }));
  res.json(withCounts);
});

// POST /api/questionnaires  → créer un nouveau questionnaire (vide ou avec questions)
router.post('/', async (req, res) => {
  try {
    const { title, description, questions } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Le titre est requis.' });
    }
    const q = await Questionnaire.create({
      owner: req.userId,
      title: title.trim(),
      description: description || '',
      questions: sanitizeQuestions(questions)
    });
    res.status(201).json(q);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du questionnaire.' });
  }
});

// GET /api/questionnaires/:id  → détail (avec questions) — vérifie que c'est le propriétaire
router.get('/:id', async (req, res) => {
  const q = await Questionnaire.findOne({ _id: req.params.id, owner: req.userId });
  if (!q) return res.status(404).json({ error: 'Questionnaire introuvable.' });
  res.json(q);
});

// POST /api/questionnaires/:id/duplicate  → duplique un questionnaire (structure des questions uniquement, pas les réponses)
router.post('/:id/duplicate', async (req, res) => {
  try {
    const q = await Questionnaire.findOne({ _id: req.params.id, owner: req.userId });
    if (!q) return res.status(404).json({ error: 'Questionnaire introuvable.' });
    const copy = await Questionnaire.create({
      owner: req.userId,
      title: q.title + ' (copie)',
      description: q.description,
      questions: q.questions
    });
    res.status(201).json(copy);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la duplication.' });
  }
});

// PUT /api/questionnaires/:id  → mettre à jour titre/description/questions (ajout, édition, suppression, réordonnancement)
router.put('/:id', async (req, res) => {
  try {
    const { title, description, questions } = req.body;
    const q = await Questionnaire.findOne({ _id: req.params.id, owner: req.userId });
    if (!q) return res.status(404).json({ error: 'Questionnaire introuvable.' });

    if (typeof title === 'string' && title.trim()) q.title = title.trim();
    if (typeof description === 'string') q.description = description;
    if (Array.isArray(questions)) q.questions = sanitizeQuestions(questions);

    await q.save();
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// DELETE /api/questionnaires/:id  → supprime le questionnaire ET ses réponses
router.delete('/:id', async (req, res) => {
  const q = await Questionnaire.findOne({ _id: req.params.id, owner: req.userId });
  if (!q) return res.status(404).json({ error: 'Questionnaire introuvable.' });
  await Fiche.deleteMany({ questionnaire: q._id, owner: req.userId });
  await q.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
