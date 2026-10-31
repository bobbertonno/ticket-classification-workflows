import {
  Binary,
  BrainCircuit,
  Database,
  FileClock,
  Fingerprint,
  KeyRound,
  Layers,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

export type FeatureId =
  | 'document-model'
  | 'indexes'
  | 'atomic-updates'
  | 'event-log'
  | 'vector-search'
  | 'auto-embedding'
  | 'search-index-mgmt'
  | 'audit'
  | 'security'
  | 'serverless-driver'

export interface AtlasFeature {
  id: FeatureId
  title: string
  atlasCapability: string
  icon: LucideIcon
  summary: string
  usage: string[]
  collections: string[]
  snippet: string
  centrality: string
  sourceFile: string
}

export const ATLAS_FEATURES: AtlasFeature[] = [
  {
    id: 'document-model',
    title: 'Document model',
    atlasCapability: 'Modello documentale JSON/BSON',
    icon: Database,
    summary: 'Ogni entità del dominio è un documento ricco: ticket, istanze di workflow con i loro step, evidenze di classificazione.',
    usage: [
      'Un’istanza di workflow contiene gli step con input, output, tentativi ed errori annidati: un unico read restituisce lo stato completo mostrato in Live Executions.',
      'Il ticket Remedy include la timeline e l’agenzia di origine, senza join applicativi.',
      'Le definizioni dei workflow (step, SLA, retry policy, approval policy) sono documenti versionati e validati con Zod prima della scrittura.',
    ],
    collections: ['remedy_tickets', 'workflow_instances', 'workflow_definitions', 'classification_results'],
    snippet: `{
  instanceId: "WFI-…", ticketId: "INC-…", agencyId: "MI001",
  status: "WAITING_FOR_HUMAN", currentStepIndex: 7,
  steps: [
    { stepId: "classify", type: "classification", status: "COMPLETED",
      attempts: 1, output: { category: "CLAIMS_REPORT" } },
    { stepId: "approve", type: "human_approval", status: "WAITING" }
  ]
}`,
    centrality: 'Lo schema flessibile segue il dominio: aggiungere un tipo di step o un parametro estratto non richiede migrazioni, e tutte le pagine leggono lo stesso documento.',
    sourceFile: 'lib/domain/schemas.ts',
  },
  {
    id: 'indexes',
    title: 'Indici unique e idempotenza',
    atlasCapability: 'Indici secondari, unique e composti',
    icon: Fingerprint,
    summary: 'Gli indici unique su eventId, instanceId e ticketId sono la garanzia di idempotenza della piattaforma.',
    usage: [
      'Pubblicare due volte lo stesso evento Kafka produce un errore E11000 sull’indice unique di kafka_messages: il secondo inserimento viene riconosciuto come duplicato e non crea un nuovo workflow.',
      'Il replay di eventi dal Kafka Simulator si appoggia sulla stessa garanzia.',
      'L’indice composto { status, nextRunAt } serve ai tick del motore per trovare le istanze da far avanzare; { topic, timestamp } alimenta il topic browser.',
    ],
    collections: ['kafka_messages', 'workflow_instances', 'workflow_events', 'audit_logs'],
    snippet: `kafka_messages:     { eventId: 1 } unique, { topic: 1, timestamp: -1 }
workflow_instances: { instanceId: 1 } unique, { status: 1, nextRunAt: 1 }

try { await c.insertOne(doc) }
catch (e) { if (e.code === 11000) return false /* duplicato */ }`,
    centrality: 'L’idempotenza è delegata al database invece che a lock applicativi: funziona anche con più istanze serverless concorrenti.',
    sourceFile: 'lib/store/mongo-store.ts',
  },
  {
    id: 'atomic-updates',
    title: 'Transizioni di stato atomiche',
    atlasCapability: 'Atomicità a livello di documento',
    icon: Layers,
    summary: 'Ogni avanzamento del workflow è un update condizionato sullo stato atteso: due tick concorrenti non eseguono lo stesso step.',
    usage: [
      'Il motore "reclama" lo step corrente aggiornando il documento solo se lo stato non è cambiato nel frattempo.',
      'Approve, reject, retry e cancel modificano l’istanza con un singolo update atomico, quindi lo stato è sempre coerente in tutte le viste.',
      'Le retry non duplicano artefatti né notifiche finali, perché gli effetti sono legati a ID deterministici.',
    ],
    collections: ['workflow_instances', 'human_tasks', 'remedy_tickets'],
    snippet: `await instances.updateOne(
  { instanceId, status: { $in: ["PENDING", "RUNNING", "RETRYING"] } },
  { $set: { status: "RUNNING", steps: claimedSteps } }
)  // matchedCount === 0 → un altro worker ha già avanzato`,
    centrality: 'Permette un motore di workflow persistito e senza processi in background, compatibile con le funzioni serverless di Vercel.',
    sourceFile: 'lib/engine/engine.ts',
  },
  {
    id: 'event-log',
    title: 'Event log e outbox',
    atlasCapability: 'Collezioni append-only come log persistito',
    icon: FileClock,
    summary: 'I messaggi Kafka simulati e gli eventi di workflow sono persistiti: il database è la fonte di verità del ciclo di vita.',
    usage: [
      'Ogni evento pubblicato è scritto in kafka_messages con correlationId, offset e stato del consumer prima di avviare il workflow.',
      'workflow_events registra ogni transizione con correlationId: la pagina di dettaglio ricostruisce la timeline da qui.',
      'Le notifiche in uscita seguono un pattern outbox: vengono scritte, poi marcate come consegnate dal simulatore.',
    ],
    collections: ['kafka_messages', 'workflow_events', 'notifications'],
    snippet: `{ eventId, topic: "remedy.ticket.created", correlationId,
  ticketId, agencyId, payload, consumerStatus: "PROCESSED",
  schemaVersion: "1.0" }`,
    centrality: 'Sostituendo il simulatore con un broker Kafka reale, lo stesso modello di persistenza resta valido.',
    sourceFile: 'lib/engine/engine.ts',
  },
  {
    id: 'vector-search',
    title: 'Atlas Vector Search',
    atlasCapability: '$vectorSearch (ANN) con pre-filtri',
    icon: ScanSearch,
    summary: 'La classificazione semantica dei ticket cerca gli esempi più simili nella knowledge base con $vectorSearch.',
    usage: [
      'La richiesta del ticket viene trasformata in un vettore e confrontata con oltre 100 esempi in workflow_classification_knowledge.',
      'Il pre-filtro su active ed embeddingModel garantisce che si confrontino solo vettori dello stesso modello.',
      'Il punteggio restituito da vectorSearchScore viene riportato come coseno grezzo, non come probabilità calibrata.',
    ],
    collections: ['workflow_classification_knowledge', 'classification_results'],
    snippet: `knowledge.aggregate([
  { $vectorSearch: { index: "kb_vector_index", path: "embedding",
      queryVector, numCandidates: 100, limit: 5,
      filter: { active: true, embeddingModel: "voyage-4" } } },
  { $project: { embedding: 0, score: { $meta: "vectorSearchScore" } } }
])`,
    centrality: 'Dati operativi e vettori vivono nello stesso cluster: nessun vector database separato da sincronizzare.',
    sourceFile: 'lib/server/atlas.ts',
  },
  {
    id: 'auto-embedding',
    title: 'Voyage AI e Automated Embedding',
    atlasCapability: 'Voyage AI integrato in Atlas (Preview)',
    icon: Sparkles,
    summary: 'Gli embedding sono generati da Voyage AI, tramite API esterna lato server oppure direttamente da Atlas.',
    usage: [
      'Modalità B (API esterna): il server chiama Voyage AI con input_type "document" per la knowledge base e "query" per il ticket; reranking opzionale.',
      'Modalità A (Atlas Automated Embedding): l’indice autoEmbed fa generare ad Atlas i vettori sia in indicizzazione sia in query; l’app invia solo il testo.',
      'Se il provider non è disponibile, l’app usa un classificatore deterministico etichettato come simulato, senza fingere di aver chiamato Voyage AI.',
    ],
    collections: ['workflow_classification_knowledge'],
    snippet: `{ $vectorSearch: { index: "kb_autoembed_index",
    path: "exampleRequest", query: { text },
    numCandidates: 100, limit: 5, filter: { active: true } } }`,
    centrality: 'Con l’embedding gestito da Atlas, la pipeline semantica non richiede codice applicativo per mantenere i vettori allineati ai dati.',
    sourceFile: 'lib/server/atlas.ts',
  },
  {
    id: 'search-index-mgmt',
    title: 'Gestione indici di ricerca',
    atlasCapability: 'Search Index API (create / update / list)',
    icon: BrainCircuit,
    summary: 'Il Setup Wizard crea e verifica da codice l’indice vettoriale, attendendo che diventi queryable.',
    usage: [
      'createSearchIndex con type "vectorSearch" definisce dimensioni, similarità coseno e campi filtro.',
      'listSearchIndexes controlla lo stato: l’interfaccia mostra PENDING finché Atlas non ha costruito l’indice.',
      'Se il cluster non supporta la funzionalità, lo stato è UNSUPPORTED e la classificazione resta in fallback dichiarato.',
    ],
    collections: ['workflow_classification_knowledge'],
    snippet: `await kb.createSearchIndex({ name, type: "vectorSearch", definition })
const [idx] = await kb.listSearchIndexes(name).toArray()
if (idx?.queryable) // READY`,
    centrality: 'L’infrastruttura di ricerca è gestita come codice, nello stesso ciclo di setup delle collezioni.',
    sourceFile: 'lib/server/atlas.ts',
  },
  {
    id: 'audit',
    title: 'Audit trail',
    atlasCapability: 'Collezione append-only indicizzata',
    icon: Binary,
    summary: 'Ogni azione significativa genera un evento di audit con stato precedente e nuovo, attore e correlationId.',
    usage: [
      'Approvazioni, rifiuti, retry, reset e transizioni del ticket sono tracciati in audit_logs.',
      'Gli indici su timestamp, ticketId e agencyId supportano i filtri della pagina Audit & Analytics.',
      'I valori sensibili (password, API key, connection string) sono oscurati prima della scrittura.',
    ],
    collections: ['audit_logs', 'artifacts'],
    snippet: `{ eventId, timestamp, actor: "m.rossi", agencyId: "MI001",
  action: "HUMAN_TASK_APPROVED", previousState: "WAITING_FOR_HUMAN",
  newState: "RUNNING", correlationId, outcome: "SUCCESS" }`,
    centrality: 'Lo stesso database che esegue i workflow ne conserva la storia completa, interrogabile per ticket, agenzia o attore.',
    sourceFile: 'lib/engine/support.ts',
  },
  {
    id: 'security',
    title: 'Sicurezza e separazione dei piani',
    atlasCapability: 'Utenti least-privilege, TLS, database dedicato',
    icon: ShieldCheck,
    summary: 'L’app opera solo sul database demo selezionato, con credenziali cifrate e mai restituite al browser.',
    usage: [
      'Control plane (configurazione ambienti) e data plane (database demo scelto dall’utente) sono separati.',
      'La connection string è validata (solo host Atlas *.mongodb.net, database dati diverso dal control plane) per prevenire SSRF, e cifrata con AES-256-GCM lato server.',
      'Il reset demo opera solo sulle collezioni dell’ambiente selezionato.',
    ],
    collections: ['app_settings'],
    snippet: `// Utente Atlas consigliato: readWrite sul solo database demo
{ role: "readWrite", db: "generali_automation_demo" }`,
    centrality: 'Il modello di sicurezza di Atlas (ruoli per database, rete, TLS) delimita ciò che l’applicazione può toccare.',
    sourceFile: 'lib/server/control-plane.ts',
  },
  {
    id: 'serverless-driver',
    title: 'Driver Node.js in ambiente serverless',
    atlasCapability: 'Connection pooling e riuso del client',
    icon: KeyRound,
    summary: 'Il client MongoDB è riutilizzato tra le invocazioni con pool limitato, adatto alle funzioni di Vercel.',
    usage: [
      'maxPoolSize ridotto e appName dedicato rendono le connessioni identificabili nel monitoraggio di Atlas.',
      'Il test di connessione usa il comando ping e verifica i permessi prima di salvare l’ambiente.',
      'Gli errori del cluster (non raggiungibile, credenziali errate) sono mostrati con messaggi chiari e senza dati sensibili.',
    ],
    collections: [],
    snippet: `new MongoClient(uri, { maxPoolSize: 10,
  appName: "generali-automation-control-center" })
await client.db(dbName).command({ ping: 1 })`,
    centrality: 'Permette di eseguire l’intera piattaforma senza server dedicati, mantenendo Atlas come unico componente stateful.',
    sourceFile: 'lib/server/atlas.ts',
  },
]

export const FLOW_STEPS: { label: string; detail: string; feature: FeatureId }[] = [
  { label: 'Ticket Remedy → evento Kafka', detail: 'Il messaggio è persistito con eventId unique', feature: 'indexes' },
  { label: 'Creazione ticket e istanza workflow', detail: 'Documenti ricchi con step annidati', feature: 'document-model' },
  { label: 'Embedding della richiesta', detail: 'Voyage AI, esterno o gestito da Atlas', feature: 'auto-embedding' },
  { label: 'Ricerca esempi simili', detail: '$vectorSearch sulla knowledge base', feature: 'vector-search' },
  { label: 'Avanzamento degli step', detail: 'Update condizionati, nessun doppio step', feature: 'atomic-updates' },
  { label: 'Approvazione umana e notifica', detail: 'Eventi e outbox persistiti', feature: 'event-log' },
  { label: 'Chiusura ticket e audit', detail: 'Storia completa e interrogabile', feature: 'audit' },
]
