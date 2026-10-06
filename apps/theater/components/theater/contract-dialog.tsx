'use client';
import { useEffect, useRef, useState } from 'react';
import { readContract, readNativeContract, readNeedleContract, readRlcdContract, type ContractSnapshot } from '../../lib/theater/contract-view';
import { JsonCode } from './json-code';

export function ContractDialog({ snapshot, onClose }: { snapshot: ContractSnapshot; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<'rules' | 'schema' | 'request'>('rules');
  const [copied, setCopied] = useState('Copy request JSON');
  const contract = readContract(snapshot.request);
  const native = readNativeContract(snapshot.request);
  const needle = readNeedleContract(snapshot.request);
  const rlcd = readRlcdContract(snapshot.request);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  async function copyRequest() {
    try { await navigator.clipboard.writeText(JSON.stringify(snapshot.request, null, 2)); setCopied('Copied'); }
    catch { setCopied('Copy unavailable'); }
  }
  return <dialog ref={dialog} className="contract-dialog" aria-labelledby="contract-title" aria-describedby="contract-source"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="contract-heading"><div><span>THE CONTRACT</span><h2 id="contract-title">{snapshot.title}</h2>
      <p id="contract-source">{snapshot.source}{snapshot.requestId ? ` · ${snapshot.requestId}` : ''} · snapshot at open</p></div>
      <button type="button" className="contract-close" aria-label="Close contract" onClick={onClose}>Close ×</button></header>
    <div className="contract-meta"><code>{needle ? 'LOCAL needle.complete' : rlcd ? 'LOCAL rlcd.parallel' : native ? 'POST /v1/systemone' : 'POST /v1/chat/completions'}</code><span>{native?.model ?? contract?.model}</span><b>{needle ? 'FORCED STRUCTURED CALL' : rlcd ? 'PARALLEL CONSTRAINED' : native ? 'NATIVE QUESTIONS' : contract?.format.json_schema.strict ? 'STRICT OUTPUT' : 'OUTPUT CONTRACT'}</b></div>
    <nav className="contract-tabs" aria-label="Contract views">{([
      ['rules', 'Choices & rules'], ['schema', native ? 'Native questions' : 'JSON schema'], ['request', 'Full request'],
    ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</nav>
    <div className="contract-body">
      {view === 'rules' ? <>
        <p className="contract-intro">These descriptions guide the model’s judgment. Required fields, allowed choices and numeric limits are enforced before a result is returned.</p>
        {native ? <div className="contract-fields">{Object.entries(native.questions).map(([id, question]) => <article key={id} className="contract-field"><header><h3>{id}</h3><span>{question.type.toUpperCase()}</span></header><p>{question.instructions}</p>{question.criteria && <div className="contract-values">{Object.keys(question.criteria).map(value => <code key={value}>{value}</code>)}</div>}</article>)}</div> : contract ? <div className="contract-fields">{contract.fields.map(field => <article key={field.name} className="contract-field">
          <header><h3>{field.name}</h3><span>{field.enum ? 'CHOICE' : field.type === 'boolean' ? 'BOOLEAN' : field.type === 'integer' ? 'INTEGER' : field.type.toUpperCase()}{field.required ? ' · REQUIRED' : ''}</span></header>
          <div className="contract-values">{field.enum ? field.enum.map((value, index) => <code key={index}>{typeof value === 'string' ? value : JSON.stringify(value)}</code>)
            : field.type === 'boolean' ? <><code>false</code><code>true</code></>
              : field.minimum !== undefined || field.maximum !== undefined ? <code>{field.minimum ?? '−∞'} ≤ {field.name} ≤ {field.maximum ?? '∞'}</code> : null}</div>
          {field.description && <p>{field.description}</p>}
        </article>)}</div> : <p>The readable summary is unavailable. Open Full request to inspect the recorded JSON.</p>}
        {snapshot.scoreThreshold !== undefined && <aside className="contract-display-policy"><b>Scene display rule · accuracy &gt; {snapshot.scoreThreshold}%</b><p>The green cells and valid-answer count use this adjustable threshold. The model’s <code>valid</code> field separately checks complete content and formatting compliance.</p></aside>}
        <p className="contract-enforcement">{needle ? `Needle runs locally at 20 layers with one record-only tool, forced selection, and a ${needle.max_new_tokens}-token response cap sized for this schema. No tool is executed. Every field is validated locally; refusals, conflicting calls, and invalid output fail. The engine’s reasoning is discarded. Static scenes reuse reset workers; routing starts a process per hop. Cold startup and queue wait are included in timing; token counts and first-token timing are not reported. This mapping differs from the cloud prompts.` : rlcd ? 'RLCD runs locally with compact scene context and semantic classifier labels. It batches the fields inside one request; independent inputs remain serialized. Labels are mapped back through the unchanged scene validator, and judge criteria are summed deterministically. Reported field scores are diagnostics, not benchmark-validated calibration.' : native ? 'One native TypeSafe request evaluates all questions. Choice labels map directly; Noul values above 0.5 become true. Scoring sums rubric points for criteria above 0.5. Native probabilities remain in exports.' : 'Extra fields are rejected. The proxy translates choices into numeric slots, validates the returned numbers, and reconstructs this typed result.'} Type validity does not guarantee a correct judgment.</p>
      </> : <pre className="theater-code contract-json"><JsonCode value={view === 'schema' ? needle?.tools ?? native?.questions ?? contract?.format ?? snapshot.request : snapshot.request}/></pre>}
    </div>
    <footer className="contract-footer"><span>Read only. Opening this view makes no model call.</span><button type="button" onClick={() => { void copyRequest(); }} aria-live="polite">{copied}</button></footer>
  </dialog>;
}
