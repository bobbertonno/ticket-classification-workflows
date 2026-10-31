import { hash32 } from '@/lib/domain/ids'

const STOPWORDS = new Set(
  'il lo la i gli le un uno una di a da in con su per tra fra e o ma che chi del dello della dei degli delle al allo alla ai agli alle dal dalla dai nel nella nei negli nelle sul sulla sui mi ti ci vi si ne non è sono ho hai ha abbiamo avete hanno mio mia miei mie nostro nostra nostri nostre suo sua suoi sue questo questa quello quella tutti tutte tutto come anche più già ad è stato essere avere potete potreste vorrei serve servirebbe bisogno richiedo chiedo richiesta buongiorno grazie favore cortesemente'.split(
    ' ',
  ),
)

/**
 * Concept dictionary used ONLY by the simulated (deterministic) embedding.
 * It is a lexical approximation of semantic similarity, not a language model.
 */
const CONCEPTS: Record<string, string[]> = {
  C_SPREADSHEET: ['excel', 'xlsx', 'foglio', 'calcolo', 'tabellare', 'esportazione', 'esportare', 'estrazione', 'export', 'file'],
  C_CLAIM: ['sinistri', 'sinistro', 'danno', 'danni', 'claim', 'claims', 'risarcimento', 'denuncia', 'denunciati', 'pratiche', 'pratica', 'liquidare'],
  C_OPEN: ['aperti', 'aperte', 'aperto', 'pendenti', 'pendente', 'lavorazione', 'chiuse', 'sospesi'],
  C_REPORT: ['report', 'prospetto', 'riepilogo', 'riepilogativo', 'elenco', 'lista', 'statistiche', 'rendiconto', 'resoconto'],
  C_POLICY: ['polizza', 'polizze', 'contratto', 'contrattuale', 'contrattuali', 'frontespizio', 'certificato'],
  C_COPY: ['copia', 'duplicato', 'ristampa', 'pdf', 'documento', 'download', 'recupero', 'conforme'],
  C_ACCESS: ['abilitazione', 'abilitare', 'accesso', 'accessi', 'credenziali', 'utenza', 'account', 'login', 'password', 'permessi', 'autorizzazioni', 'profilo', 'ruolo', 'attivare', 'attivazione'],
  C_NEWUSER: ['collaboratore', 'collega', 'dipendente', 'stagista', 'subagente', 'addetto', 'assunto', 'nuovo', 'nuova', 'membro', 'produttore'],
  C_PORTAL: ['portale', 'applicativo', 'gestionale', 'sistema', 'area', 'riservata', 'applicazione', 'modulo'],
  C_CUSTOMERDATA: ['anagrafica', 'anagrafe', 'indirizzo', 'residenza', 'domicilio', 'telefono', 'email', 'iban', 'coordinate', 'codice', 'fiscale', 'recapito', 'dati', 'anagrafici'],
  C_UPDATE: ['aggiornare', 'aggiornate', 'modificare', 'modifica', 'variazione', 'cambio', 'cambiato', 'correzione', 'rettifica', 'sostituire', 'registrare'],
  C_STATUS: ['stato', 'punto', 'aggiornamenti', 'situazione', 'fase', 'notizie', 'quando', 'verificare', 'controllare', 'prevista'],
  C_PAYMENT: ['incassi', 'pagamenti', 'pagamento', 'premi', 'premio', 'rate', 'insolute', 'insoluti', 'provvigioni', 'commissioni', 'versamenti', 'quietanze', 'contabili', 'pagati', 'rimborso'],
  C_CERT: ['attestato', 'attestazione', 'certificazione', 'dichiarazione', 'carta', 'verde', 'vigenza', 'conferma', 'copertura', 'emettere', 'emissione'],
  C_ERROR: ['errore', 'errori', 'correttamente', 'bloccato', 'blocca', 'lento', 'timeout', 'corrotto', 'vuota', 'bianca', 'malfunzionamento', 'funziona', 'incompleto', 'generato', 'problema'],
  C_COMPLIANCE: ['gdpr', 'privacy', 'consenso', 'antiriciclaggio', 'ivass', 'audit', 'reclamo', 'contestazione', 'normativo', 'normativa', 'cancellazione', 'portabilità', 'sospetta', 'ispezione'],
}

const TOKEN_TO_CONCEPT = new Map<string, string>()
for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words) TOKEN_TO_CONCEPT.set(w, concept)

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[\s']+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

const DIM = 512

/** Deterministic hashed embedding (feature hashing). Labelled everywhere as SIMULATED. */
export function simulatedEmbedding(text: string): number[] {
  const v = new Array<number>(DIM).fill(0)
  const add = (feature: string, weight: number) => {
    const h = hash32(feature)
    const sign = h & 1 ? 1 : -1
    v[h % DIM] += sign * weight
  }
  for (const tok of tokenize(text)) {
    const concept = TOKEN_TO_CONCEPT.get(tok)
    if (concept) add(concept, 1.4)
    add(`s:${tok.slice(0, 6)}`, 0.6)
  }
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}
