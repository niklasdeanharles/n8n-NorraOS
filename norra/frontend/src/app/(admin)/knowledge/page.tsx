import { createClient } from '@/lib/supabase/server';
import { formatDateTime, statusTone } from '@/lib/format';
import { UploadForm } from './upload-form';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const supabase = await createClient();

  const [documentsResult, agentsResult] = await Promise.all([
    supabase
      .from('knowledge_base_documents')
      .select('id, title, status, chunk_count, source_type, error, created_at, agents(name)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('agents').select('id, name').order('name'),
  ]);

  const documents = documentsResult.data ?? [];
  const totalChunks = documents.reduce((sum, doc) => sum + doc.chunk_count, 0);

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Wissensbasis</h1>
          <div className="small muted">Quelle für jede inhaltliche Antwort des Agenten</div>
        </div>
        <div className="small muted num">{documents.length} Dokumente · {totalChunks} Blöcke</div>
      </header>

      <div className="content stack">
        {documentsResult.error ? <p className="error">{documentsResult.error.message}</p> : null}

        <div className="card card-body-flush">
          {documents.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Dokument</th><th>Agent</th><th>Status</th><th className="num">Blöcke</th><th>Hinzugefügt</th></tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <span style={{ fontWeight: 550 }}>{doc.title}</span>
                        {doc.error ? <div className="tiny error">{doc.error}</div> : null}
                      </td>
                      <td className="small dim">{doc.agents?.name ?? 'alle'}</td>
                      <td><span className={statusTone(doc.status)}>{doc.status}</span></td>
                      <td className="num small">{doc.chunk_count}</td>
                      <td className="small muted">{formatDateTime(doc.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Noch keine Dokumente. Ohne Wissensbasis kann der Agent nur allgemein antworten.</p>
          )}
        </div>

        <UploadForm agents={agentsResult.data ?? []} />
      </div>
    </>
  );
}
