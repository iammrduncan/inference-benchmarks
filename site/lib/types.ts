// The manifest the site renders. scripts/build-manifest.ts writes it from results/, subjects/
// and suites/; pages only read it. Everything derived (intervals, rank bands, deltas) is
// computed there, once, so every page shows the same numbers.

export type Interval = { value: number; low: number; high: number; n: number };

export type Verdict = 'broken' | 'degraded' | 'faithful' | 'lossless';

export type Fidelity = {
  n: number; mean_cosine: number; p1_cosine: number; min_cosine: number;
  top10_overlap: number; queries: number; documents: number; verdict: Verdict;
};

/** `note` says when device facts were added after the run instead of recorded by it. */
export type Hardware = { class: string; label: string; host: string; note?: string };

export type RecipeRef = {
  id: string; profile: string | null; commit: string; repo: string;
  params: Record<string, string>;
};

export type Subject = {
  key: string;
  model: string;
  target: 'recipe' | 'cloud' | 'endpoint';
  label: string | null;
  engine_visibility: 'public' | 'private';
  verified_identity: boolean;
  checkpoint: Record<string, string>;
  quant: Record<string, string>;
  engine: { name: string; version: string };
  /** Run ids (see Run.id), newest first. */
  runs: string[];
};

type RunBase = {
  /** `<subject key>/<suite>/<run_id>`: also the run's folder under results/. */
  id: string;
  run_id: string;
  subject: string;
  suite: string;
  tier: string;
  profile: string;
  mode: string;
  status: string;
  label: string | null;
  started_at: string;
  finished_at: string;
  items: { planned: number; attempted: number; succeeded: number; failed: number };
  harness: { commit: string; dirty: boolean; scorer: string; suite_hash: string };
  latency_ms: { p50: number; p95: number; p99: number } | null;
  usage: { input_tokens: number; output_tokens: number; cost_usd: number } | null;
  hardware: Hardware | null;
  recipe: RecipeRef | null;
  endpoint: string | null;
  /** Files published next to the site under /results/<id>/. */
  files: string[];
  notes: string[];
  reproduce: string;
};

export type DecisionsRun = RunBase & {
  kind: 'decisions';
  metrics: {
    decisions: number; valid: number;
    accuracy: Interval; kl_from_gold: Interval; brier: Interval; ece: number;
    accuracy_by_type: Record<string, Interval>;
    accuracy_by_workflow: Record<string, Interval>;
  };
  invalid_reasons: Record<string, number>;
};

export type ConformanceCheck = { passed: number; total: number; failures: string[] };

export type ConformanceRun = RunBase & {
  kind: 'conformance';
  metrics: { passed: number; total: number; checks: Record<string, ConformanceCheck> };
};

export type EmbeddingDim = {
  dim: number;
  /** Mean of MTEB main scores over the tier's tasks, with a bootstrap interval over tasks. */
  score: Interval;
  tasks: Record<string, number>;
  fidelity: Fidelity | null;
  /** Paired with the reference run, task by task; null for the reference itself. */
  delta: Interval | null;
};

export type EmbeddingsRun = RunBase & {
  kind: 'embeddings';
  reference: string | null;
  is_reference: boolean;
  dims: EmbeddingDim[];
  throughput: { texts_per_s: number; tokens_per_s: number; engine_tokens_per_s: number; tokens: number; texts: number } | null;
  engine_info: Record<string, unknown> | null;
};

export type Run = DecisionsRun | ConformanceRun | EmbeddingsRun;

export type Suite = {
  name: string;
  status: string;
  description: string;
  protocol: string;
  category: string | null;
  tiers: Record<string, string>;
  scorer: string | null;
};

export type RankedRow = { run: string; rank: { low: number; high: number } };

/** One leaderboard: one suite, one tier, one settings profile (D9). */
export type Board = {
  id: string;
  suite: string;
  tier: string;
  profile: string;
  metric: string;
  rows: RankedRow[];
};

export type MatrixCell = { run: string; subject: string; engine: string };

/**
 * One checkpoint. Rows are variants (a quant served by an engine family, e.g. q8 on
 * onnxruntime), columns are hardware classes, and each cell is one run. The exact engine
 * (onnxruntime-cuda vs onnxruntime-cpu, torch cu126 vs mps) is shown inside the cell.
 */
export type Matrix = {
  model: string;
  checkpoint: string;
  suite: string;
  reference: string | null;
  variants: { key: string; quant: string; family: string }[];
  hardware: { class: string; label: string }[];
  cells: Record<string, Record<string, MatrixCell>>;
};

/** A category column on the home page. `suites` are the ranked suites that feed it. */
export type Bucket = { id: string; label: string; note: string | null; suites: string[]; boards: string[] };

export type SpeedFigure = { value: number; what: string; hardware: string | null };

/** A speed column. Prefill (input) and decode (output) are separate: they are different work. */
export type SpeedColumn = { id: string; label: string; lower_is_better: boolean; note: string };

/** One subject in one overall table. Missing buckets are absent, never 0. */
export type OverallRow = {
  subject: string;
  buckets: Record<string, { score: number; runs: string[] } | undefined>;
  /** Only within its group: never compared across model types. */
  index: number | null;
  coverage: number;
  /** Keyed by SpeedColumn.id; null means not measured. */
  speed: Record<string, SpeedFigure | null>;
  last_run: string;
};

/** One overall table: a model type with its own categories, speed columns and Index. */
export type OverallGroup = { id: string; label: string; description: string; buckets: Bucket[]; speed: SpeedColumn[]; rows: OverallRow[] };

export type Manifest = {
  generated_at: string;
  repo: string;
  engines_repo: string;
  suites: Suite[];
  subjects: Subject[];
  runs: Run[];
  boards: Board[];
  matrices: Matrix[];
  overall: OverallGroup[];
  /** Which model-type table each suite belongs to (by its category); null if none. */
  suite_groups: Record<string, string | null>;
};
