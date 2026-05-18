import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'
import fs from 'fs'
import multer from 'multer'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8080
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'josue-admin'

// En Railway: STORAGE_PATH apunta al Volume montado (ej: /storage)
// En local: usa la carpeta del proyecto
const STORAGE_ROOT = process.env.STORAGE_PATH || __dirname
const DATA_DIR    = join(STORAGE_ROOT, 'data')
const UPLOADS_DIR = join(STORAGE_ROOT, 'uploads')
const VISITS_FILE = join(DATA_DIR, 'visits.json')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { return fallback }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

// ── Valores por defecto ──────────────────────────────────────────────
const BUILT_IN_SLOTS = [
  { id: 'profile', name: 'Foto de perfil',  defaultSrc: '/Img/Josue.jpeg' },
  { id: 'logo',    name: 'Logo del sitio',   defaultSrc: '/logo.png' },
]

const DEFAULT_RESOURCES = {
  title: 'Recursos y Salud Mental',
  subtitle: 'Herramientas y guías visuales para ayudarte a comprender mejor tus procesos emocionales.',
  cards: [
    { id: 'res-1', image: '/post-ansiedad.jpg',   title: 'Dominando la Ansiedad',    description: 'Identifica y comprende los mecanismos de la ansiedad para recuperar tu equilibrio.' },
    { id: 'res-2', image: '/post-burnout.jpg',     title: 'Ciclo del Burnout',         description: 'Reconoce señales de agotamiento antes de que afecten tu salud física y mental.' },
    { id: 'res-3', image: '/post-agotamiento.jpg', title: 'Agotamiento Emocional',    description: 'Aprende a diferenciar el cansancio físico de la saturación emocional profunda.' }
  ]
}

const DEFAULT_CONFIG = {
  imageSlots: BUILT_IN_SLOTS.map(s => ({ ...s, path: null })),
  resources: DEFAULT_RESOURCES,
  content: {}
}

// ── Leer config con migración ────────────────────────────────────────
function getConfig() {
  let cfg = readJson(CONFIG_FILE, null)
  if (!cfg) { writeJson(CONFIG_FILE, DEFAULT_CONFIG); return structuredClone(DEFAULT_CONFIG) }

  // Migrar formato antiguo { images: {} }
  if (!cfg.imageSlots && cfg.images !== undefined) {
    const old = cfg.images || {}
    cfg.imageSlots = BUILT_IN_SLOTS.map(s => ({ ...s, path: old[s.id] || null }))
    delete cfg.images
  }

  // Asegurar recursos
  if (!cfg.resources) cfg.resources = structuredClone(DEFAULT_RESOURCES)

  // Limpiar imageSlots: solo profile, logo y extras
  if (cfg.imageSlots) {
    const resourceIds = new Set(['postAnsiedad', 'postBurnout', 'postAgotamiento'])
    cfg.imageSlots = cfg.imageSlots.filter(s => !resourceIds.has(s.id))
    BUILT_IN_SLOTS.forEach(bi => {
      if (!cfg.imageSlots.find(s => s.id === bi.id))
        cfg.imageSlots.unshift({ ...bi, path: null })
    })
  } else {
    cfg.imageSlots = DEFAULT_CONFIG.imageSlots
  }

  return cfg
}

// ── Init ─────────────────────────────────────────────────────────────
if (!fs.existsSync(VISITS_FILE)) writeJson(VISITS_FILE, { total: 0, daily: {} })
if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, DEFAULT_CONFIG)

const app = express()
app.use(express.json())
app.use(cookieParser())

const sessions = new Set()

// ── Registrar visitas ─────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
    try {
      const v = readJson(VISITS_FILE, { total: 0, daily: {} })
      const today = new Date().toISOString().split('T')[0]
      v.total = (v.total || 0) + 1
      v.daily[today] = (v.daily[today] || 0) + 1
      writeJson(VISITS_FILE, v)
    } catch {}
  }
  next()
})

// ── Estáticos ─────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')))
app.use('/uploads', express.static(UPLOADS_DIR))
app.use('/Img', express.static(join(__dirname, 'Img')))

// ── API pública ───────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json(getConfig()))

// ── Auth ──────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies?.adminSession
  if (token && sessions.has(token)) return next()
  res.status(401).json({ error: 'No autorizado' })
}

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex')
    sessions.add(token)
    res.cookie('adminSession', token, { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 })
    res.json({ ok: true })
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' })
  }
})

app.post('/api/admin/logout', auth, (req, res) => {
  sessions.delete(req.cookies.adminSession)
  res.clearCookie('adminSession')
  res.json({ ok: true })
})

app.get('/api/admin/stats',  auth, (req, res) => res.json(readJson(VISITS_FILE, { total: 0, daily: {} })))
app.get('/api/admin/config', auth, (req, res) => res.json(getConfig()))

// ── Multer (imágenes) ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase() || '.jpg'
    const key = req.params.id || req.params.cardId || 'upload'
    cb(null, `${key}-${Date.now()}${ext}`)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Solo imágenes'))
  }
})

// ── Image Slots ───────────────────────────────────────────────────────
app.post('/api/admin/image/:id', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sin imagen' })
  const cfg = getConfig()
  const slot = cfg.imageSlots.find(s => s.id === req.params.id)
  if (!slot) return res.status(404).json({ error: 'Slot no encontrado' })
  slot.path = `/uploads/${req.file.filename}`
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true, path: slot.path })
})

app.patch('/api/admin/image-slot/:id', auth, (req, res) => {
  const cfg = getConfig()
  const slot = cfg.imageSlots.find(s => s.id === req.params.id)
  if (!slot) return res.status(404).json({ error: 'Slot no encontrado' })
  if (req.body.name?.trim()) slot.name = req.body.name.trim()
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

app.post('/api/admin/image-slot', auth, (req, res) => {
  const cfg = getConfig()
  const newSlot = { id: 'extra-' + Date.now(), name: req.body.name?.trim() || 'Nueva imagen', defaultSrc: null, path: null }
  cfg.imageSlots.push(newSlot)
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true, slot: newSlot })
})

app.delete('/api/admin/image-slot/:id', auth, (req, res) => {
  const cfg = getConfig()
  const idx = cfg.imageSlots.findIndex(s => s.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' })
  if (!cfg.imageSlots[idx].id.startsWith('extra-'))
    return res.status(403).json({ error: 'No puedes eliminar imágenes del sistema' })
  cfg.imageSlots.splice(idx, 1)
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

// ── Recursos ──────────────────────────────────────────────────────────

// Actualizar encabezado de la sección
app.patch('/api/admin/resources', auth, (req, res) => {
  const cfg = getConfig()
  if (req.body.title    !== undefined) cfg.resources.title    = req.body.title
  if (req.body.subtitle !== undefined) cfg.resources.subtitle = req.body.subtitle
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

// Actualizar texto de una tarjeta
app.patch('/api/admin/resources/card/:cardId', auth, (req, res) => {
  const cfg = getConfig()
  const card = cfg.resources.cards.find(c => c.id === req.params.cardId)
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' })
  if (req.body.title       !== undefined) card.title       = req.body.title
  if (req.body.description !== undefined) card.description = req.body.description
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

// Subir imagen de una tarjeta
app.post('/api/admin/resources/card/:cardId/image', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sin imagen' })
  const imgPath = `/uploads/${req.file.filename}`
  const cfg = getConfig()
  const card = cfg.resources.cards.find(c => c.id === req.params.cardId)
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' })
  card.image = imgPath
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true, path: imgPath })
})

// Agregar tarjeta
app.post('/api/admin/resources/card', auth, (req, res) => {
  const cfg = getConfig()
  const newCard = {
    id: 'res-' + Date.now(),
    image: '',
    title: req.body.title || 'Nueva tarjeta',
    description: req.body.description || ''
  }
  cfg.resources.cards.push(newCard)
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true, card: newCard })
})

// Eliminar tarjeta
app.delete('/api/admin/resources/card/:cardId', auth, (req, res) => {
  const cfg = getConfig()
  const before = cfg.resources.cards.length
  cfg.resources.cards = cfg.resources.cards.filter(c => c.id !== req.params.cardId)
  if (cfg.resources.cards.length === before) return res.status(404).json({ error: 'No encontrada' })
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

// Reordenar tarjetas
app.patch('/api/admin/resources/order', auth, (req, res) => {
  const { ids } = req.body
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser array' })
  const cfg = getConfig()
  const map = new Map(cfg.resources.cards.map(c => [c.id, c]))
  cfg.resources.cards = ids.map(id => map.get(id)).filter(Boolean)
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

// ── Información de contacto ───────────────────────────────────────────
app.patch('/api/admin/content', auth, (req, res) => {
  const cfg = getConfig()
  cfg.content = { ...(cfg.content || {}), ...req.body }
  writeJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

// ── Panel admin ───────────────────────────────────────────────────────
app.get('/panel-josue', (req, res) => res.sendFile(join(__dirname, 'admin.html')))

// ── Fallback SPA ──────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const idx = join(__dirname, 'dist', 'index.html')
  fs.existsSync(idx) ? res.sendFile(idx) : res.status(503).send('Ejecuta npm run build primero.')
})

app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`))
